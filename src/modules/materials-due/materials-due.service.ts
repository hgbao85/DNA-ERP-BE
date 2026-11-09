import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { vnDayKey, vnDayStart } from '../../common/utils/floor-stats.util';
import { purchaseDeadlineOf, purchaseGroupOf } from '../../common/utils/frame-deadline.util';
import { loadLenhDisplayCodes } from '../../common/utils/lenh-code.util';
import { purchaseLineMatcher } from '../../common/utils/purchase-line-sku.util';
import { addDays } from '../../common/utils/timeline-suggest.util';
import {
  ProductionInvoiceStatus,
  ProductionOrderFloorStage,
  PurchaseProposalStatus,
} from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { daysBetween } from '../milestone-board/milestone-board.rules';
import { effectiveOrderQty } from '../purchase-proposals/purchase-order-qty.util';
import { ranksBefore } from '../stock/sku-priority.util';
import type { MaterialsDueQueryDto } from './dto/materials-due-query.dto';
import type {
  MaterialsDueCounts,
  MaterialsDueResponse,
  MaterialsDueRow,
  MaterialsDueScope,
  MaterialsDueSku,
  MaterialsDueState,
  MaterialsDueView,
} from './materials-due.types';

/** Mặc định N khi SystemConfig chưa có dòng (DB chưa seed). */
export const DEFAULT_EARLIEST_ARRIVAL_DAYS = 4;
/** Thời gian nhớ tạm kết quả tính TOÀN BỘ dòng - badge gọi 30–120 s/người nên không tính lại mỗi lần. */
export const CACHE_TTL_MS = 60_000;
const SYSTEM_CONFIG_ID = 1;

/** Dòng mua "chưa về xong": NEW / QUOTING / SUBMITTED (chưa đặt NCC) + PURCHASING (đã đặt, chờ hàng). PURCHASED / REJECTED loại. */
const OPEN_STATUSES = [
  PurchaseProposalStatus.NEW,
  PurchaseProposalStatus.QUOTING,
  PurchaseProposalStatus.SUBMITTED,
  PurchaseProposalStatus.PURCHASING,
] as const;

const STATE_RANK: Record<MaterialsDueState, number> = {
  OVERDUE: 0,
  DEADLINE_TODAY: 1,
  IN_WINDOW: 2,
  UPCOMING: 3,
  NO_DEADLINE: 4,
};

type NumLike = number | { toNumber(): number };
const num = (v: NumLike | null | undefined): number =>
  v == null ? 0 : typeof v === 'number' ? v : v.toNumber();
/** Số lượng 4 số lẻ (cột Decimal(14,4)) - tránh 0.30000000004 làm dòng đã đủ vẫn bị coi là thiếu. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Phạm vi người xem (suy từ vai trò) - list() và badge dùng chung. */
interface ViewerScope {
  canChooseScope: boolean;
  scope: MaterialsDueScope;
  warehouseScope: string | null;
  buyerId: string | null;
  warehouseCode: string | null;
}

/**
 * Phần A – Đợt 4 (YC6): "Vật tư cần về" - dòng đề xuất mua chưa về đủ SỐ CHỐT MUA của các lệnh đang chạy, kèm hạn chót vật tư
 * (hạn SKU sớm nhất) và ngày được về sớm nhất (hạn chót − N). Hợp đồng dữ liệu: materials-due.types.ts (4 quyết định của Sếp 05/11).
 * Chỉ đọc. Tập "đang chạy" cùng filter với Bảng mốc; luật dây/nệm riêng dùng chung `purchaseLineMatcher`.
 */
@Injectable()
export class MaterialsDueService {
  private cache: { day: string; at: number; rows: MaterialsDueRow[]; n: number } | null = null;

  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  /** API của màn: luôn tính mới (người dùng bấm tải lại phải thấy số mới) rồi cập nhật bộ nhớ tạm cho badge. */
  async list(
    user: AuthenticatedUser,
    query: MaterialsDueQueryDto = {},
    now: Date = new Date(),
  ): Promise<MaterialsDueResponse> {
    const view: MaterialsDueView = query.view ?? 'today';
    let date: string | null = null;
    if (view === 'date') {
      if (!query.date || vnDayStart(query.date) === null) {
        throw new BadRequestException("view = 'date' cần tham số date hợp lệ (YYYY-MM-DD)");
      }
      date = query.date;
    }
    const { rows, n, today } = await this.loadAll(now, true);
    const viewer = this.viewerScope(user, query.scope);
    const warehouseScopeName = viewer.warehouseScope
      ? await this.warehouseNameOf(viewer.warehouseScope)
      : null;
    const scoped = this.applyScope(rows, viewer);

    const counts: MaterialsDueCounts = {
      overdue: 0,
      deadlineToday: 0,
      inWindow: 0,
      upcoming: 0,
      noDeadline: 0,
    };
    for (const r of scoped) {
      if (r.state === 'OVERDUE') counts.overdue++;
      else if (r.state === 'DEADLINE_TODAY') counts.deadlineToday++;
      else if (r.state === 'IN_WINDOW') counts.inWindow++;
      else if (r.state === 'UPCOMING') counts.upcoming++;
      else counts.noDeadline++;
    }

    const filtered = scoped.filter((r) => {
      switch (view) {
        case 'overdue':
          return r.state === 'OVERDUE';
        case 'today':
          return r.state === 'DEADLINE_TODAY' || r.state === 'IN_WINDOW';
        case 'date':
          return (
            r.deadline !== null &&
            r.earliestArrival !== null &&
            r.earliestArrival <= date! &&
            date! <= r.deadline
          );
        default:
          return true;
      }
    });

    return {
      today,
      earliestArrivalDays: n,
      view,
      date,
      scope: viewer.scope,
      canChooseScope: viewer.canChooseScope,
      warehouseScope: viewer.warehouseScope,
      warehouseScopeName,
      counts,
      rows: filtered,
    };
  }

  /**
   * Badge menu "Vật tư cần về": OVERDUE + DEADLINE_TODAY + IN_WINDOW trong phạm vi người đó (người mua tính theo 'mine'). Dùng bộ
   * nhớ tạm 60 s theo ngày VN - không chạy truy vấn mỗi lần.
   */
  async countDueNow(
    user: Pick<AuthenticatedUser, 'id' | 'roles' | 'warehouseScope'>,
    now: Date = new Date(),
  ): Promise<number> {
    const { rows } = await this.loadAll(now, false);
    return this.applyScope(rows, this.viewerScope(user, 'mine')).filter(isDueNow).length;
  }

  /** Mọi dòng (không lọc người) - cho tin sáng / cảnh báo hạn chót. `fresh = true` bỏ qua bộ nhớ tạm. */
  async listAllRows(
    now: Date = new Date(),
    fresh = true,
  ): Promise<{ rows: MaterialsDueRow[]; today: string }> {
    const { rows, today } = await this.loadAll(now, fresh);
    return { rows, today };
  }

  // ─── Phạm vi người xem ─────────────────────────────────────────────────────────────────────────

  private viewerScope(
    user: Pick<AuthenticatedUser, 'id' | 'roles' | 'warehouseScope'>,
    requested: MaterialsDueScope | undefined,
  ): ViewerScope {
    const has = (r: string) => user.roles.includes(r);
    if (has(BUSINESS_ROLES.PURCHASER)) {
      const scope = requested ?? 'mine';
      return {
        canChooseScope: true,
        scope,
        warehouseScope: null,
        buyerId: scope === 'mine' ? user.id : null,
        warehouseCode: null,
      };
    }
    const seesAll = [
      BUSINESS_ROLES.PRODUCTION_PLANNER,
      BUSINESS_ROLES.PRODUCTION_MANAGER,
      BUSINESS_ROLES.BOSS,
      DEFAULT_ROLES.ADMIN,
    ].some(has);
    const wh = !seesAll && has(BUSINESS_ROLES.WAREHOUSE_STAFF) ? user.warehouseScope : null;
    return {
      canChooseScope: false,
      scope: 'all',
      warehouseScope: wh,
      buyerId: null,
      warehouseCode: wh,
    };
  }

  private applyScope(rows: MaterialsDueRow[], v: ViewerScope): MaterialsDueRow[] {
    if (v.buyerId) return rows.filter((r) => r.buyerId === v.buyerId);
    if (v.warehouseCode) return rows.filter((r) => r.warehouseCode === v.warehouseCode);
    return rows;
  }

  // ─── Tính toàn bộ dòng ─────────────────────────────────────────────────────────────────────────

  private async loadAll(
    now: Date,
    fresh: boolean,
  ): Promise<{ rows: MaterialsDueRow[]; n: number; today: string }> {
    const today = vnDayKey(now);
    const c = this.cache;
    const age = c ? now.getTime() - c.at : -1;
    if (!fresh && c && c.day === today && age >= 0 && age < CACHE_TTL_MS) {
      return { rows: c.rows, n: c.n, today };
    }
    const n = await this.readEarliestArrivalDays();
    const rows = await this.compute(today, n);
    this.cache = { day: today, at: now.getTime(), rows, n };
    return { rows, n, today };
  }

  private async readEarliestArrivalDays(): Promise<number> {
    const cfg = await this.prisma.systemConfig.findUnique({
      where: { id: SYSTEM_CONFIG_ID },
      select: { materialEarliestArrivalDays: true },
    });
    return cfg?.materialEarliestArrivalDays ?? DEFAULT_EARLIEST_ARRIVAL_DAYS;
  }

  private async compute(today: string, n: number): Promise<MaterialsDueRow[]> {
    // 1. Dòng mua còn mở, thuộc PI (lọc status theo chỉ mục) - chỉ lấy đúng cột cần, 1 truy vấn cho cả danh sách.
    const lines = await this.prisma.purchaseProposalItem.findMany({
      where: {
        status: { in: [...OPEN_STATUSES] },
        proposal: { productionInvoiceId: { not: null } },
      },
      select: {
        id: true,
        materialId: true,
        buyQty: true,
        orderQty: true,
        receivedQty: true,
        status: true,
        receiveWarehouseCode: true,
        stockLengthMm: true,
        spec: true,
        proposal: { select: { productionInvoiceId: true } },
        material: {
          select: {
            name: true,
            unit: true,
            detailKind: true,
            buyerId: true,
            buyer: { select: { firstName: true, lastName: true } },
            warehouse: { select: { code: true, name: true } },
          },
        },
        supplierOrder: {
          select: {
            id: true,
            seq: true,
            year: true,
            status: true,
            supplier: { select: { name: true } },
          },
        },
        quotes: {
          where: { isChosen: true },
          select: { supplierName: true, supplier: { select: { name: true } } },
        },
      },
      orderBy: { id: 'asc' },
    });
    // Số theo dõi = SỐ CHỐT MUA (đã gồm mua dư), không ngoại lệ (Sếp câu 3).
    const open = lines.filter(
      (l) =>
        round4(
          effectiveOrderQty(num(l.buyQty), l.orderQty == null ? null : num(l.orderQty)) -
            num(l.receivedQty),
        ) > 0,
    );
    if (open.length === 0) return [];

    // 2. Dòng SKU đang chạy của các PI đó (cùng filter Bảng mốc) + lựa chọn dây/nệm của mọi dòng đã duyệt (kể cả đã Kết thúc).
    const piIds = [...new Set(open.map((l) => l.proposal.productionInvoiceId!))];
    const [items, approvedChoices, displayCodes, overrideWarehouses] = await Promise.all([
      this.prisma.productionInvoiceItem.findMany({
        where: {
          prodApprovalStatus: 'APPROVED',
          productionInvoiceId: { in: piIds },
          productionOrder: { is: { floorStage: { not: ProductionOrderFloorStage.FINISHED } } },
          productionInvoice: { status: { not: ProductionInvoiceStatus.CANCELLED } },
          OR: [{ salesOrderId: null }, { salesOrder: { isActive: true, deletedAt: null } }],
        },
        select: {
          id: true,
          productionInvoiceId: true,
          lsxCode: true,
          materialDeadline: true,
          finishedMaterialDeadline: true,
          wireMaterialId: true,
          cushionMaterialId: true,
          productionInvoice: { select: { code: true, deadline: true } },
          mfgProduct: { select: { factoryCode: true } },
          stages: { select: { stageType: true, deadline: true } },
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.productionInvoiceItem.findMany({
        where: { productionInvoiceId: { in: piIds }, prodApprovalStatus: 'APPROVED' },
        select: {
          id: true,
          productionInvoiceId: true,
          wireMaterialId: true,
          cushionMaterialId: true,
        },
      }),
      loadLenhDisplayCodes(this.prisma, piIds).catch(() => new Map<string, string>()),
      this.loadOverrideWarehouses(open.map((l) => l.receiveWarehouseCode)),
    ]);

    const itemsByPi = new Map<string, typeof items>();
    for (const it of items) {
      const k = String(it.productionInvoiceId);
      const list = itemsByPi.get(k);
      if (list) list.push(it);
      else itemsByPi.set(k, [it]);
    }
    const matchers = new Map<string, (materialId: string) => boolean>();
    const matcherOf = (it: (typeof items)[number]) => {
      const k = String(it.id);
      let m = matchers.get(k);
      if (!m) {
        m = purchaseLineMatcher(it, approvedChoices);
        matchers.set(k, m);
      }
      return m;
    };
    const day = (d: Date | null) => (d ? vnDayKey(d) : null);

    const rows: MaterialsDueRow[] = [];
    for (const l of open) {
      const piKey = String(l.proposal.productionInvoiceId);
      const materialId = String(l.materialId);
      const group = purchaseGroupOf(l.material.detailKind);
      const users = (itemsByPi.get(piKey) ?? []).filter((it) => matcherOf(it)(materialId));
      if (users.length === 0) continue; // không còn SKU đang chạy nào dùng dòng này
      const piCode = users[0].productionInvoice?.code ?? '';
      const lenhOfPi = displayCodes.get(piKey) ?? piCode;
      const skus: MaterialsDueSku[] = users
        .map((it) => ({
          itemId: String(it.id),
          lenhCode: it.lsxCode?.trim() || lenhOfPi,
          skuCode: it.mfgProduct.factoryCode,
          deadline: day(purchaseDeadlineOf(it, group)),
        }))
        .sort(
          (a, b) =>
            (a.deadline === null ? 1 : 0) - (b.deadline === null ? 1 : 0) ||
            (a.deadline ?? '').localeCompare(b.deadline ?? '') ||
            a.lenhCode.localeCompare(b.lenhCode) ||
            a.skuCode.localeCompare(b.skuCode),
        );

      const priorityNote = buildPriorityNote(
        users.map((it) => ({
          lenhCode: it.lsxCode?.trim() || lenhOfPi,
          deadline: purchaseDeadlineOf(it, group),
          itemId: it.id,
        })),
      );

      const deadline = skus[0].deadline; // đã xếp: hạn sớm nhất đứng đầu, null cuối
      const earliestArrival = deadline ? addDays(deadline, -n) : null;
      const daysLeft = deadline ? daysBetween(today, deadline) : null;
      const state: MaterialsDueState =
        deadline === null
          ? 'NO_DEADLINE'
          : daysLeft! < 0
            ? 'OVERDUE'
            : daysLeft === 0
              ? 'DEADLINE_TODAY'
              : earliestArrival! <= today
                ? 'IN_WINDOW'
                : 'UPCOMING';

      const buyQty = num(l.buyQty);
      const orderQty = effectiveOrderQty(buyQty, l.orderQty == null ? null : num(l.orderQty));
      const receivedQty = num(l.receivedQty);
      const order =
        l.supplierOrder && l.supplierOrder.status !== 'CANCELLED' ? l.supplierOrder : null;
      const quote = l.quotes[0] ?? null;
      const whCode = l.receiveWarehouseCode ?? l.material.warehouse?.code ?? null;
      const whName = l.receiveWarehouseCode
        ? (overrideWarehouses.get(l.receiveWarehouseCode) ?? null)
        : (l.material.warehouse?.name ?? null);
      const buyer = l.material.buyer;

      rows.push({
        lineId: String(l.id),
        piId: piKey,
        lenhCode: lenhOfPi,
        materialId,
        materialName:
          l.stockLengthMm != null
            ? `${l.material.name} (${l.stockLengthMm.toLocaleString('vi-VN')} mm)`
            : l.spec
              ? `${l.material.name} (${l.spec})`
              : l.material.name,
        unit: l.stockLengthMm != null ? 'cây' : l.material.unit,
        group,
        needQty: buyQty,
        orderQty,
        receivedQty,
        remainingQty: round4(orderQty - receivedQty),
        purchaseStatus: l.status as MaterialsDueRow['purchaseStatus'],
        deadline,
        earliestArrival,
        daysLeft,
        state,
        skus,
        supplierName: order
          ? order.supplier.name
          : quote
            ? (quote.supplier?.name ?? quote.supplierName)
            : null,
        supplierOrderCode: order ? `${order.seq}/${order.year}` : null,
        supplierOrderId: order ? String(order.id) : null,
        buyerId: l.material.buyerId ?? null,
        buyerName: buyer ? `${buyer.firstName} ${buyer.lastName}`.trim() : null,
        warehouseCode: whCode,
        warehouseName: whName,
        priorityNote,
      });
    }

    rows.sort(
      (a, b) =>
        STATE_RANK[a.state] - STATE_RANK[b.state] ||
        (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') ||
        (a.earliestArrival ?? '9999').localeCompare(b.earliestArrival ?? '9999') ||
        a.materialName.localeCompare(b.materialName),
    );
    return rows;
  }

  /** Tên kho của phạm vi thủ kho - lấy thẳng từ bảng kho, không phụ thuộc dòng đang hiện (tab Hôm nay/Quá hạn có thể rỗng). */
  private async warehouseNameOf(code: string): Promise<string | null> {
    const wh = await this.prisma.warehouse.findFirst({ where: { code }, select: { name: true } });
    return wh?.name ?? null;
  }

  /** Tên kho cho các kho ghi đè (`receiveWarehouseCode`) - 1 truy vấn cho cả danh sách, bỏ qua khi không có dòng nào ghi đè. */
  private async loadOverrideWarehouses(codes: (string | null)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(codes.filter((c): c is string => !!c))];
    if (uniq.length === 0) return new Map();
    const whs = await this.prisma.warehouse.findMany({
      where: { code: { in: uniq } },
      select: { code: true, name: true },
    });
    return new Map(whs.map((w) => [w.code, w.name]));
  }
}

/**
 * Lệnh gộp 2+ SKU dùng chung 1 lần mua: câu ghi thứ tự SKU được chia hàng trước khi hàng về - đúng thứ tự `ranksBefore` của
 * bước xuất (hạn vật tư sớm hơn trước, bằng hạn thì dòng vào lệnh trước, chưa có hạn cuối). Dùng số LSX, không dùng mã PI.
 * Lệnh 1 SKU: null.
 */
export function buildPriorityNote(
  users: { lenhCode: string; deadline: Date | null; itemId: bigint }[],
): string | null {
  if (users.length < 2) return null;
  const sorted = [...users].sort((a, b) => (ranksBefore(a, b) ? -1 : ranksBefore(b, a) ? 1 : 0));
  const codes = sorted.map((u) => u.lenhCode);
  return `Hàng về chia trước cho ${codes[0]}, rồi ${codes.slice(1).join(', rồi ')}`;
}

/** Dòng "cần về hôm nay" cho badge / tin sáng: quá hạn, hạn chót hôm nay, hoặc trong khoảng được về. */
export function isDueNow(r: Pick<MaterialsDueRow, 'state'>): boolean {
  return r.state === 'OVERDUE' || r.state === 'DEADLINE_TODAY' || r.state === 'IN_WINDOW';
}
