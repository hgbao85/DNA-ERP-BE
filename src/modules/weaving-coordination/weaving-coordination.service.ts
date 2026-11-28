import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  AuditAction,
  ProdItemStageType,
  WeavingFollowUpPromiseStatus,
} from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { isCancelledOrder } from '../../common/utils/cancelled-order.util';
import { auditEvent } from '../../common/utils/audit-event.util';
import { vnDayKey } from '../../common/utils/floor-stats.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateWeavingFollowUpDto,
  WeavingBoardQueryDto,
  WeavingFollowUpQueryDto,
} from './dto/weaving-coordination.dto';
import {
  DIEU_PHOI_DAN_DISABLED_MESSAGE,
  isDieuPhoiDanEnabled,
} from './weaving-coordination.config';
import { dayToDbDate, dbDayKey, weavingRowSums } from './weaving-coordination.read';
import {
  validateFollowUp,
  WEAVING_STATUS_RANK,
  weavingRowKey,
  weavingRowLockKey,
  weavingRowStatus,
  WeavingRowStatus,
} from './weaving-coordination.rules';

/** Loại thông báo nhắc lời hẹn (notification-types.ts) + khoá đối tượng để tự đóng. */
export const WEAVING_PROMISE_NOTIFICATION = 'WEAVING_PROMISE_DUE' as const;
export const WEAVING_FOLLOW_UP_ENTITY = 'WEAVING_FOLLOW_UP';

const OPEN_PROMISE: WeavingFollowUpPromiseStatus[] = [
  WeavingFollowUpPromiseStatus.OPEN,
  WeavingFollowUpPromiseStatus.REMINDED,
];

export interface WeavingPromiseView {
  followUpId: string;
  promisedQty: number;
  promisedDate: string;
  status: WeavingFollowUpPromiseStatus;
  /** Số đã về thêm kể từ lúc ghi lời hẹn. */
  returnedSince: number;
  createdAt: string;
}

export interface WeavingBoardRow {
  key: string;
  /** Câu 17 (chốt 25/11/2026): lệnh đã huỷ mà điểm đan còn giữ hàng - vẫn hiện để đòi về (đã trả hết thì ẩn). */
  cancelled: boolean;
  weavingPointId: string;
  weavingPointCode: string;
  weavingPointName: string;
  productionOrderId: string;
  poNumber: string;
  salesOrderCode: string | null;
  lsxCode: string | null;
  piCode: string | null;
  productName: string | null;
  pieceId: string;
  pieceCode: string;
  pieceName: string;
  sent: number;
  returned: number;
  held: number;
  /** Mốc "Nhập đan" của dòng PI ('YYYY-MM-DD' giờ VN). */
  dueDate: string | null;
  daysLeft: number | null;
  status: WeavingRowStatus;
  lastIssuedAt: string | null;
  lastReceivedAt: string | null;
  latestPromise: WeavingPromiseView | null;
  followUpCount: number;
}

export interface WeavingBoardPoint {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  isActive: boolean;
  held: number;
  openRows: number;
  lateRows: number;
}

export interface WeavingBoardResponse {
  enabled: boolean;
  today: string;
  tiles: { piecesOut: number; openRows: number; overdueRows: number; promisesDueToday: number };
  points: WeavingBoardPoint[];
  rows: WeavingBoardRow[];
}

export interface WeavingFollowUpView {
  id: string;
  weavingPointId: string;
  productionOrderId: string;
  pieceId: string;
  poNumber: string;
  pieceName: string;
  content: string;
  promisedQty: number | null;
  promisedDate: string | null;
  promiseStatus: WeavingFollowUpPromiseStatus;
  heldAtCreate: number;
  returnedAtCreate: number;
  remindedAt: string | null;
  closedAt: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

const pointName = (p: { code: string; fullName: string | null }) => p.fullName?.trim() || p.code;
const userName = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName}`.trim();

/**
 * Điều phối đan (25/11/2026, docs THIET-KE-DIEU-PHOI-DAN): bảng theo dõi điểm đan (Đ1, chỉ xem) + ghi chú làm việc có lời hẹn
 * (Đ2). Số đã gửi / đã trả đọc thẳng từ weaving_issues (phiếu xuất đan đã xác nhận) / weaving_receipts (kho Thành phẩm nhập đan).
 */
@Injectable()
export class WeavingCoordinationService {
  private readonly logger = new Logger(WeavingCoordinationService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly cls: ClsService<AppClsStore>,
    private readonly notifications: NotificationsService,
  ) {}

  getConfig(): { enabled: boolean } {
    return { enabled: isDieuPhoiDanEnabled() };
  }

  private assertEnabled(): void {
    if (!isDieuPhoiDanEnabled()) throw new BadRequestException(DIEU_PHOI_DAN_DISABLED_MESSAGE);
  }

  /**
   * Đ1: mỗi (điểm đan × lệnh × mảnh) từng nhận hàng. Ô tổng tính trên MỌI điểm đan (không theo bộ lọc). Mặc định chỉ trả dòng còn
   * giữ hàng; `status=DONE` trả dòng đã trả đủ.
   */
  async getBoard(query: WeavingBoardQueryDto, now = new Date()): Promise<WeavingBoardResponse> {
    const today = vnDayKey(now);
    const empty: WeavingBoardResponse = {
      enabled: false,
      today,
      tiles: { piecesOut: 0, openRows: 0, overdueRows: 0, promisesDueToday: 0 },
      points: [],
      rows: [],
    };
    if (!isDieuPhoiDanEnabled()) return empty;

    const by = ['weavingPointId', 'productionOrderId', 'pieceId'] as const;
    const [issued, received, points] = await Promise.all([
      this.prisma.weavingIssue.groupBy({
        by: [...by],
        _sum: { qty: true },
        _max: { issuedAt: true },
      }),
      this.prisma.weavingReceipt.groupBy({
        by: [...by],
        _sum: { qty: true },
        _max: { receivedAt: true },
      }),
      this.prisma.weavingPoint.findMany({
        where: { deletedAt: null },
        orderBy: { code: 'asc' },
        select: {
          id: true,
          code: true,
          fullName: true,
          contactPerson: true,
          phone: true,
          isActive: true,
        },
      }),
    ]);

    type Agg = {
      pointId: bigint;
      orderId: bigint;
      pieceId: bigint;
      sent: number;
      returned: number;
      lastIssuedAt: Date | null;
      lastReceivedAt: Date | null;
    };
    const agg = new Map<string, Agg>();
    const slot = (pointId: bigint, orderId: bigint, pieceId: bigint): Agg => {
      const key = weavingRowKey(pointId, orderId, pieceId);
      let a = agg.get(key);
      if (!a) {
        a = {
          pointId,
          orderId,
          pieceId,
          sent: 0,
          returned: 0,
          lastIssuedAt: null,
          lastReceivedAt: null,
        };
        agg.set(key, a);
      }
      return a;
    };
    for (const g of issued) {
      const a = slot(g.weavingPointId, g.productionOrderId, g.pieceId);
      a.sent += g._sum.qty ?? 0;
      a.lastIssuedAt = g._max.issuedAt ?? null;
    }
    for (const g of received) {
      const a = slot(g.weavingPointId, g.productionOrderId, g.pieceId);
      a.returned += g._sum.qty ?? 0;
      a.lastReceivedAt = g._max.receivedAt ?? null;
    }
    if (agg.size === 0) {
      return { ...empty, enabled: true, points: points.map((p) => this.pointView(p, 0, 0, 0)) };
    }

    const orderIds = [...new Set([...agg.values()].map((a) => a.orderId))];
    const pieceIds = [...new Set([...agg.values()].map((a) => a.pieceId))];
    const [orders, pieces, followUps] = await Promise.all([
      this.prisma.productionOrder.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          poNumber: true,
          status: true,
          mfgProduct: { select: { name: true } },
          productionInvoiceItem: {
            select: {
              lsxCode: true,
              salesOrder: { select: { orderCode: true } },
              productionInvoice: { select: { code: true } },
              stages: {
                where: { stageType: ProdItemStageType.WEAVING },
                select: { deadline: true },
              },
            },
          },
        },
      }),
      this.prisma.piece.findMany({
        where: { id: { in: pieceIds } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.weavingFollowUp.findMany({
        where: { productionOrderId: { in: orderIds } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          weavingPointId: true,
          productionOrderId: true,
          pieceId: true,
          promisedQty: true,
          promisedDate: true,
          promiseStatus: true,
          returnedAtCreate: true,
          createdAt: true,
        },
      }),
    ]);
    const orderById = new Map(orders.map((o) => [o.id.toString(), o]));
    const pieceById = new Map(pieces.map((p) => [p.id.toString(), p]));
    const pointById = new Map(points.map((p) => [p.id.toString(), p]));
    const fuCount = new Map<string, number>();
    const latestPromise = new Map<string, (typeof followUps)[number]>();
    for (const f of followUps) {
      const key = weavingRowKey(f.weavingPointId, f.productionOrderId, f.pieceId);
      fuCount.set(key, (fuCount.get(key) ?? 0) + 1);
      if (f.promisedQty != null && !latestPromise.has(key)) latestPromise.set(key, f);
    }

    const allRows: WeavingBoardRow[] = [];
    for (const [key, a] of agg) {
      const order = orderById.get(a.orderId.toString());
      const piece = pieceById.get(a.pieceId.toString());
      const point = pointById.get(a.pointId.toString());
      if (!order || !piece || !point) continue;
      const item = order.productionInvoiceItem;
      const stage = item.stages[0];
      const dueDate = stage ? vnDayKey(stage.deadline) : null;
      const { status, held, daysLeft } = weavingRowStatus(a.sent, a.returned, dueDate, today);
      // Câu 17 (chốt 25/11/2026): lệnh đã huỷ - ẩn, trừ khi điểm đan còn giữ hàng của lệnh đó (vẫn hiện để đòi về).
      const cancelled = isCancelledOrder(order);
      if (cancelled && held <= 0) continue;
      const lp = latestPromise.get(key);
      allRows.push({
        key,
        cancelled,
        weavingPointId: a.pointId.toString(),
        weavingPointCode: point.code,
        weavingPointName: pointName(point),
        productionOrderId: a.orderId.toString(),
        poNumber: order.poNumber,
        salesOrderCode: item.salesOrder?.orderCode ?? null,
        lsxCode: item.lsxCode ?? null,
        piCode: item.productionInvoice?.code ?? null,
        productName: order.mfgProduct?.name ?? null,
        pieceId: a.pieceId.toString(),
        pieceCode: piece.code,
        pieceName: piece.name,
        sent: a.sent,
        returned: a.returned,
        held,
        dueDate,
        daysLeft,
        status,
        lastIssuedAt: a.lastIssuedAt?.toISOString() ?? null,
        lastReceivedAt: a.lastReceivedAt?.toISOString() ?? null,
        latestPromise:
          lp && lp.promisedQty != null && lp.promisedDate
            ? {
                followUpId: lp.id.toString(),
                promisedQty: lp.promisedQty,
                promisedDate: dbDayKey(lp.promisedDate),
                status: lp.promiseStatus,
                returnedSince: Math.max(0, a.returned - lp.returnedAtCreate),
                createdAt: lp.createdAt.toISOString(),
              }
            : null,
        followUpCount: fuCount.get(key) ?? 0,
      });
    }

    const open = allRows.filter((r) => r.status !== 'DONE');
    const tiles = {
      piecesOut: open.reduce((s, r) => s + r.held, 0),
      openRows: open.length,
      overdueRows: open.filter((r) => r.status === 'LATE').length,
      promisesDueToday: open.filter(
        (r) =>
          r.latestPromise &&
          OPEN_PROMISE.includes(r.latestPromise.status) &&
          r.latestPromise.promisedDate === today,
      ).length,
    };
    const pointViews = points.map((p) => {
      const mine = open.filter((r) => r.weavingPointId === p.id.toString());
      return this.pointView(
        p,
        mine.reduce((s, r) => s + r.held, 0),
        mine.length,
        mine.filter((r) => r.status === 'LATE').length,
      );
    });

    const rows = allRows
      .filter((r) => !query.weavingPointId || r.weavingPointId === query.weavingPointId)
      .filter((r) => (query.status ? r.status === query.status : r.status !== 'DONE'))
      .sort(
        (x, y) =>
          WEAVING_STATUS_RANK[x.status] - WEAVING_STATUS_RANK[y.status] ||
          (x.dueDate ?? '9999').localeCompare(y.dueDate ?? '9999') ||
          x.weavingPointName.localeCompare(y.weavingPointName) ||
          x.poNumber.localeCompare(y.poNumber) ||
          x.pieceCode.localeCompare(y.pieceCode),
      );
    return { enabled: true, today, tiles, points: pointViews, rows };
  }

  private pointView(
    p: {
      id: bigint;
      code: string;
      fullName: string | null;
      contactPerson: string | null;
      phone: string | null;
      isActive: boolean;
    },
    held: number,
    openRows: number,
    lateRows: number,
  ): WeavingBoardPoint {
    return {
      id: p.id.toString(),
      code: p.code,
      name: pointName(p),
      contactPerson: p.contactPerson,
      phone: p.phone,
      isActive: p.isActive,
      held,
      openRows,
      lateRows,
    };
  }

  /** Đ2: lịch sử ghi chú (mới nhất trước), theo điểm đan và / hoặc đúng 1 dòng lệnh × mảnh. Tối đa 300 dòng. */
  async listFollowUps(query: WeavingFollowUpQueryDto): Promise<{
    enabled: boolean;
    items: WeavingFollowUpView[];
  }> {
    if (!isDieuPhoiDanEnabled()) return { enabled: false, items: [] };
    const rows = await this.prisma.weavingFollowUp.findMany({
      where: {
        ...(query.weavingPointId ? { weavingPointId: BigInt(query.weavingPointId) } : {}),
        ...(query.productionOrderId ? { productionOrderId: BigInt(query.productionOrderId) } : {}),
        ...(query.pieceId ? { pieceId: BigInt(query.pieceId) } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 300,
      include: {
        createdBy: { select: { firstName: true, lastName: true } },
        productionOrder: { select: { poNumber: true } },
        piece: { select: { name: true } },
      },
    });
    return {
      enabled: true,
      items: rows.map((r) => ({
        id: r.id.toString(),
        weavingPointId: r.weavingPointId.toString(),
        productionOrderId: r.productionOrderId.toString(),
        pieceId: r.pieceId.toString(),
        poNumber: r.productionOrder.poNumber,
        pieceName: r.piece.name,
        content: r.content,
        promisedQty: r.promisedQty,
        promisedDate: r.promisedDate ? dbDayKey(r.promisedDate) : null,
        promiseStatus: r.promiseStatus,
        heldAtCreate: r.heldAtCreate,
        returnedAtCreate: r.returnedAtCreate,
        remindedAt: r.remindedAt?.toISOString() ?? null,
        closedAt: r.closedAt?.toISOString() ?? null,
        createdById: r.createdById,
        createdByName: userName(r.createdBy),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Đ2: ghi 1 ghi chú. Số đang giữ tính dưới đúng khoá dòng của nhập đan (cùng lúc kho Thành phẩm nhập thì 1 bên chờ), để "số hẹn ≤
   * số đang giữ" đúng tại lúc ghi. Lời hẹn mới thay lời hẹn cũ còn mở của cùng dòng (cũ -> SUPERSEDED, đóng nhắc của nó).
   */
  async createFollowUp(
    dto: CreateWeavingFollowUpDto,
    userId: string,
    now = new Date(),
  ): Promise<WeavingFollowUpView> {
    this.assertEnabled();
    const pointId = parseBigIntId(dto.weavingPointId);
    const orderId = parseBigIntId(dto.productionOrderId);
    const pieceId = parseBigIntId(dto.pieceId);
    const today = vnDayKey(now);
    const point = await this.prisma.weavingPoint.findUnique({ where: { id: pointId } });
    if (!point || point.deletedAt)
      throw new NotFoundException(`Không tìm thấy điểm đan ${dto.weavingPointId}`);

    const hasPromise = dto.promisedQty != null || !!dto.promisedDate;
    const { created, superseded } = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, weavingRowLockKey(orderId, pieceId, pointId));
      const sums = await weavingRowSums(tx, orderId, pieceId, pointId);
      const error = validateFollowUp(
        { content: dto.content, promisedQty: dto.promisedQty, promisedDate: dto.promisedDate },
        { sent: sums.sent, held: sums.held, today },
      );
      if (error) throw new BadRequestException(error);

      let supersededIds: bigint[] = [];
      if (hasPromise) {
        const older = await tx.weavingFollowUp.findMany({
          where: {
            weavingPointId: pointId,
            productionOrderId: orderId,
            pieceId,
            promiseStatus: { in: OPEN_PROMISE },
          },
          select: { id: true },
        });
        supersededIds = older.map((o) => o.id);
        if (supersededIds.length > 0) {
          await tx.weavingFollowUp.updateMany({
            where: { id: { in: supersededIds } },
            data: { promiseStatus: WeavingFollowUpPromiseStatus.SUPERSEDED, closedAt: now },
          });
        }
      }
      const row = await tx.weavingFollowUp.create({
        data: {
          weavingPointId: pointId,
          productionOrderId: orderId,
          pieceId,
          content: dto.content.trim(),
          promisedQty: hasPromise ? dto.promisedQty : null,
          promisedDate: hasPromise && dto.promisedDate ? dayToDbDate(dto.promisedDate) : null,
          heldAtCreate: sums.held,
          returnedAtCreate: sums.returned,
          promiseStatus: hasPromise
            ? WeavingFollowUpPromiseStatus.OPEN
            : WeavingFollowUpPromiseStatus.NONE,
          createdById: userId,
        },
      });
      return { created: row, superseded: supersededIds };
    });

    for (const id of superseded) {
      try {
        await this.notifications.resolve({
          entityType: WEAVING_FOLLOW_UP_ENTITY,
          entityId: id.toString(),
          types: [WEAVING_PROMISE_NOTIFICATION],
        });
      } catch (e) {
        this.logger.error(`Failed to resolve superseded promise ${id}: ${(e as Error).message}`);
      }
    }
    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.CREATE,
      tableName: 'WeavingFollowUp',
      recordId: created.id,
      newValue: {
        weavingPointId: pointId.toString(),
        productionOrderId: orderId.toString(),
        pieceId: pieceId.toString(),
        promisedQty: created.promisedQty,
        promisedDate: created.promisedDate ? dbDayKey(created.promisedDate) : null,
      },
    });

    const list = await this.listFollowUps({
      weavingPointId: pointId.toString(),
      productionOrderId: orderId.toString(),
      pieceId: pieceId.toString(),
    });
    const view = list.items.find((i) => i.id === created.id.toString());
    if (!view) throw new NotFoundException(`Không đọc lại được ghi chú ${created.id}`);
    return view;
  }
}
