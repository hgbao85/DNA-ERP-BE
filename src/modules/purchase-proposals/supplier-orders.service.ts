import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  AuditAction,
  Prisma,
  PrismaClient,
  PurchaseProposalStatus,
  SupplierOrderStatus,
} from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { writeAuditLog } from '../../prisma/extensions/audit-log.extension';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  PENDING_APPROVAL_STATUSES,
  PreparedBossApprove,
  PurchaseProposalsService,
} from './purchase-proposals.service';
import { effectiveOrderQty } from './purchase-order-qty.util';
import { supplierOrderCode, vnYear } from './supplier-order-code.util';
import { recomputeProposalStatus } from './purchase-proposal-status.util';
import { loadLenhDisplayCodes } from '../../common/utils/lenh-code.util';
import { buildPrintRows, PrintItemInput, renderPrintWorkbook } from './supplier-order-print';
import {
  CreateSupplierOrderDto,
  ListSupplierOrdersQueryDto,
  SupplierOrderCounterDto,
  SupplierOrderItemDto,
  SupplierOrderResponseDto,
} from './dto/supplier-order.dto';

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

const ORDER_INCLUDE = {
  supplier: true,
  createdBy: { select: { firstName: true, lastName: true } },
  items: {
    include: {
      material: true,
      proposal: { select: { productionInvoiceId: true } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.SupplierOrderInclude;

type OrderRow = Prisma.SupplierOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * Đơn đặt hàng NCC (2026-11-04, bản v8 mục 4.10, 4.13, V3-4): người mua gom các dòng chờ duyệt
 * của mình vào 1 đơn, BẮT BUỘC chọn NCC, hệ thống cấp ngay "Số đơn đặt hàng" theo NCC + năm
 * (52/2026). Giám đốc ký phiếu theo đơn, người mua tải phiếu lên ở đúng đơn đó ("Sếp đã duyệt"),
 * các dòng trong đơn mới chuyển PURCHASING để Kho nhận hàng.
 *
 * Số đơn: đơn huỷ khi CHƯA TỪNG có phiếu Giám đốc ký thì số được cấp lại cho đơn kế tiếp của cùng NCC (12/11/2026,
 * anh Nhân - không nhảy cóc); đơn đã ký rồi Thay phiếu mới huỷ thì giữ số. Bộ đếm ở SupplierOrderCounter, cấp số trong
 * khoá theo (NCC, năm) - xem allocateSeq().
 */
/** Đơn gộp nhiều lệnh có thể chạm nhiều đề xuất - nới thời hạn transaction mặc định 5 s. */
const APPROVE_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

@Injectable()
export class SupplierOrdersService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly purchaseProposalsService: PurchaseProposalsService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly realtime: RealtimeService,
  ) {}

  async findAll(
    query: ListSupplierOrdersQueryDto,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<SupplierOrderResponseDto[]> {
    const rows = await this.prisma.supplierOrder.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        // Người mua chỉ thấy đơn mình tạo; Sếp/Admin thấy hết.
        ...(this.isPrivileged(actorRoles) ? {} : { createdById: actorUserId }),
      },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const codes = await this.lenhCodesOf(rows);
    return rows.map((r) => this.toDto(r, codes));
  }

  /**
   * `actor` có thì kiểm người xem: người mua chỉ xem đơn mình tạo, Sếp/Admin xem hết (cùng luật danh sách - 13/11/2026,
   * trước đây ai có quyền xem đề xuất mua, kể cả thủ kho, đều xem/in được đơn của người khác nếu biết id). Gọi nội bộ sau
   * khi ghi thì không truyền.
   */
  async findOne(
    id: string,
    actor?: { userId: string; roles: string[] },
  ): Promise<SupplierOrderResponseDto> {
    const order = await this.findOrThrow(id);
    if (actor) this.assertOwner(order, actor.userId, actor.roles);
    return this.toDto(order, await this.lenhCodesOf([order]));
  }

  async create(
    dto: CreateSupplierOrderDto,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<SupplierOrderResponseDto> {
    const supplierId = parseBigIntId(dto.supplierId);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier || supplier.deletedAt) {
      throw new NotFoundException('Không tìm thấy nhà cung cấp');
    }
    if (!supplier.isActive) {
      throw new BadRequestException(`Nhà cung cấp "${supplier.name}" đã ngừng hợp tác`);
    }
    const itemIds = [...new Set(dto.itemIds)].map((id) => parseBigIntId(id));
    const items = await this.prisma.purchaseProposalItem.findMany({
      where: { id: { in: itemIds } },
      include: { material: true },
    });
    if (items.length !== itemIds.length) {
      throw new NotFoundException('Có dòng vật tư không tồn tại');
    }
    const privileged = this.isPrivileged(actorRoles);
    for (const it of items) {
      if (!privileged && it.material.buyerId && it.material.buyerId !== actorUserId) {
        throw new ForbiddenException(
          `Vật tư ${it.material.code} do người mua khác phụ trách - không đưa vào đơn của bạn được`,
        );
      }
      if (!PENDING_APPROVAL_STATUSES.includes(it.status)) {
        throw new ConflictException(`Vật tư ${it.material.code} đã được duyệt mua rồi`);
      }
      if (it.supplierOrderId) {
        throw new ConflictException(`Vật tư ${it.material.code} đã nằm trong 1 đơn đặt hàng khác`);
      }
    }
    const proposalIds = [...new Set(items.map((it) => it.proposalId))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const year = vnYear();

    const orderId = await this.prisma.$transaction(async (tx) => {
      // Cùng khoá với bossApprove()/updateOrderQty() - không cho dòng bị duyệt xen giữa lúc gom đơn.
      // Khoá theo thứ tự id tăng dần để 2 đơn cùng đụng nhiều đề xuất không khoá chéo nhau.
      for (const pid of proposalIds) {
        await lockBusinessKey(tx, `purchase-proposal-mutate:${pid}`);
      }
      const seq = await this.allocateSeq(tx, supplierId, year);
      const order = await tx.supplierOrder.create({
        data: { supplierId, year, seq, createdById: actorUserId },
      });
      const { count } = await tx.purchaseProposalItem.updateMany({
        where: {
          id: { in: itemIds },
          supplierOrderId: null,
          status: { in: PENDING_APPROVAL_STATUSES },
        },
        data: { supplierOrderId: order.id },
      });
      if (count !== itemIds.length) {
        throw new ConflictException(
          'Một số dòng vừa được thao tác khác xử lý (duyệt hoặc đưa vào đơn khác) - tải lại trang',
        );
      }
      return order.id;
    });

    const result = await this.findOrThrow(orderId.toString());
    await this.audit(AuditAction.CREATE, result, null, {
      event: 'supplier-order-created',
      code: supplierOrderCode(result.seq, result.year),
      supplier: supplier.name,
      itemIds: dto.itemIds,
    });
    this.publish(proposalIds, actorUserId);
    return this.toDto(result, await this.lenhCodesOf([result]));
  }

  /**
   * Gỡ 1 dòng khỏi đơn CHƯA duyệt (bản v8 mục 7.5). Đơn rỗng thì tự huỷ - như Huỷ đơn: đơn chưa từng có phiếu ký
   * thì số đơn được cấp lại cho đơn kế tiếp của cùng NCC (12/11/2026, xem allocateSeq).
   */
  async removeItem(
    id: string,
    itemId: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<SupplierOrderResponseDto> {
    const order = await this.findOrThrow(id);
    this.assertOwner(order, actorUserId, actorRoles);
    this.assertDraft(order);
    const bigItemId = parseBigIntId(itemId);
    const item = order.items.find((it) => it.id === bigItemId);
    if (!item) {
      throw new NotFoundException('Dòng này không nằm trong đơn');
    }
    // Đơn đã "THAY PHIẾU" có thể còn dòng đã nhận một phần (vẫn PURCHASING) - đã nhận thì không gỡ (7.5).
    if (!PENDING_APPROVAL_STATUSES.includes(item.status)) {
      throw new ConflictException(
        `Vật tư ${item.material.code} đã nhận hàng một phần - không gỡ khỏi đơn được`,
      );
    }
    const emptied = order.items.length === 1;
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, order.id);
      await tx.purchaseProposalItem.update({
        where: { id: bigItemId },
        data: { supplierOrderId: null },
      });
      if (emptied) {
        await tx.supplierOrder.update({
          where: { id: order.id },
          data: {
            status: SupplierOrderStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelReason: 'Gỡ hết dòng khỏi đơn',
          },
        });
      }
    });
    await this.audit(AuditAction.UPDATE, order, null, {
      event: 'supplier-order-item-removed',
      itemId,
      materialCode: item.material.code,
      cancelled: emptied,
    });
    this.publish([item.proposalId], actorUserId);
    return this.findOne(id);
  }

  /**
   * Huỷ đơn CHƯA duyệt: các dòng quay về chờ gom đơn. Đơn chưa từng có phiếu Giám đốc ký (revision = 0) thì số đơn
   * được cấp lại cho đơn kế tiếp của cùng NCC (12/11/2026, anh Nhân - không nhảy cóc); đơn đã ký rồi "Thay phiếu"
   * mới huỷ thì giữ số (số đó đã nằm trên phiếu Giám đốc ký). Xem allocateSeq.
   */
  async cancel(
    id: string,
    reason: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<SupplierOrderResponseDto> {
    const order = await this.findOrThrow(id);
    this.assertOwner(order, actorUserId, actorRoles);
    this.assertDraft(order);
    if (order.items.some((it) => !PENDING_APPROVAL_STATUSES.includes(it.status))) {
      throw new ConflictException(
        'Đơn có vật tư đã nhận hàng một phần - không huỷ được cả đơn, chỉ gỡ được dòng chưa nhận',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, order.id);
      await tx.purchaseProposalItem.updateMany({
        where: { supplierOrderId: order.id },
        data: { supplierOrderId: null },
      });
      await tx.supplierOrder.update({
        where: { id: order.id },
        data: {
          status: SupplierOrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: reason,
        },
      });
    });
    await this.audit(AuditAction.UPDATE, order, null, {
      event: 'supplier-order-cancelled',
      reason,
    });
    this.publish([...new Set(order.items.map((it) => it.proposalId))], actorUserId);
    return this.findOne(id);
  }

  /**
   * "Sếp đã duyệt" theo đơn: người mua tải phiếu Giám đốc đã ký cho ĐÚNG đơn này, các dòng của đơn
   * sang PURCHASING (dùng 3 bước prepare/apply/finish của PurchaseProposalsService.bossApprove() theo từng đề xuất chứa
   * dòng - phần ghi DB trong 1 transaction cùng việc đổi đơn; audit, thông báo Kho, realtime sau commit như trước).
   */
  async approve(
    id: string,
    approvalFileUrl: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<SupplierOrderResponseDto> {
    const order = await this.findOrThrow(id);
    this.assertOwner(order, actorUserId, actorRoles);
    this.assertDraft(order);
    if (order.items.length === 0) {
      throw new BadRequestException('Đơn không còn dòng vật tư nào');
    }
    const byProposal = new Map<bigint, bigint[]>();
    for (const it of order.items) {
      if (!PENDING_APPROVAL_STATUSES.includes(it.status)) continue;
      byProposal.set(it.proposalId, [...(byProposal.get(it.proposalId) ?? []), it.id]);
    }
    // 13/11/2026: duyệt mọi đề xuất của đơn + chuyển đơn sang APPROVED trong CÙNG 1 transaction. Trước đây mỗi đề xuất 1
    // transaction riêng rồi mới đổi đơn - lỗi giữa chừng thì có dòng đã "Đang mua" trong khi đơn vẫn nháp.
    const prepared: PreparedBossApprove[] = [];
    for (const [proposalId, itemIds] of byProposal) {
      prepared.push(
        await this.purchaseProposalsService.prepareBossApprove(
          proposalId.toString(),
          actorUserId,
          actorRoles,
          itemIds,
        ),
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, order.id);
      for (const p of prepared) {
        await this.purchaseProposalsService.applyBossApproveTx(tx, p, actorUserId, approvalFileUrl);
      }
      const { count } = await tx.supplierOrder.updateMany({
        where: { id: order.id, status: SupplierOrderStatus.DRAFT },
        data: {
          status: SupplierOrderStatus.APPROVED,
          approvalFileUrl,
          approvedAt: new Date(),
          approvedById: actorUserId,
        },
      });
      if (count !== 1) {
        throw new ConflictException('Đơn vừa bị thao tác khác đổi trạng thái - tải lại trang');
      }
    }, APPROVE_TX_OPTIONS);
    for (const p of prepared) {
      await this.purchaseProposalsService.finishBossApprove(p, actorUserId, approvalFileUrl);
    }
    await this.audit(AuditAction.UPDATE, order, null, {
      event: 'supplier-order-approved',
      approvalFileUrl,
    });
    return this.findOne(id);
  }

  /**
   * "THAY PHIẾU" (bản v8 mục 7.2, 7.11): đơn đã có phiếu Giám đốc ký mà cần gỡ dòng hoặc sửa số mua.
   * Đơn về DRAFT, revision + 1; dòng CHƯA nhận gì quay về chờ duyệt (bỏ file duyệt cũ) để sửa/gỡ
   * được; dòng đã nhận một phần giữ nguyên "Đang mua" (đã nhận thì không gỡ, 7.5). Người mua in
   * phiếu mới cùng số đơn - phiếu ghi "THAY PHIẾU lần n" - xin ký lại rồi "Sếp đã duyệt" lần nữa.
   */
  async revise(
    id: string,
    reason: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<SupplierOrderResponseDto> {
    const order = await this.findOrThrow(id);
    this.assertOwner(order, actorUserId, actorRoles);
    if (order.status !== SupplierOrderStatus.APPROVED) {
      throw new ConflictException(
        `Đơn ${supplierOrderCode(order.seq, order.year)} chưa có phiếu ký - sửa trực tiếp, không cần thay phiếu`,
      );
    }
    const reopen = order.items.filter(
      (it) => it.status === PurchaseProposalStatus.PURCHASING && it.receivedQty.isZero(),
    );
    if (reopen.length === 0) {
      throw new ConflictException('Mọi vật tư trong đơn đã nhận hàng - không còn gì để thay phiếu');
    }
    const proposalIds = [...new Set(order.items.map((it) => it.proposalId))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    await this.prisma.$transaction(async (tx) => {
      for (const pid of proposalIds) {
        await lockBusinessKey(tx, `purchase-proposal-mutate:${pid}`);
      }
      const { count } = await tx.supplierOrder.updateMany({
        where: { id: order.id, status: SupplierOrderStatus.APPROVED },
        data: {
          status: SupplierOrderStatus.DRAFT,
          revision: { increment: 1 },
          revisedAt: new Date(),
          reviseReason: reason,
          approvalFileUrl: null,
          approvedAt: null,
          approvedById: null,
        },
      });
      if (count !== 1) {
        throw new ConflictException('Đơn vừa bị thao tác khác đổi trạng thái - tải lại trang');
      }
      // Chỉ dòng chưa nhận gì (receivedQty = 0, khoá trong cùng transaction) - Kho nhận xen giữa thì
      // dòng đó giữ "Đang mua".
      await tx.purchaseProposalItem.updateMany({
        where: {
          id: { in: reopen.map((it) => it.id) },
          status: PurchaseProposalStatus.PURCHASING,
          receivedQty: 0,
        },
        data: {
          status: PurchaseProposalStatus.NEW,
          approvedAt: null,
          approvedById: null,
          approvalFileUrl: null,
        },
      });
      for (const pid of proposalIds) {
        await recomputeProposalStatus(tx, pid);
      }
    });
    await this.audit(AuditAction.UPDATE, order, null, {
      event: 'supplier-order-revised',
      revision: order.revision + 1,
      reason,
      reopenedItemIds: reopen.map((it) => it.id.toString()),
      oldApprovalFileUrl: order.approvalFileUrl,
    });
    this.publish(proposalIds, actorUserId);
    return this.findOne(id);
  }

  /**
   * "Đóng phần thiếu" (Đợt 5e, bản v8 7.13, V4-7): NCC không giao nốt. Mỗi dòng chọn (đang chờ nhận, đơn đã có phiếu ký) đóng lại
   * (PURCHASED) kèm lý do; phần còn thiếu so với số CẦN mua (buyQty − đã nhận) tách thành dòng NEW mới cùng lệnh, chưa vào đơn
   * nào - người mua đặt NCC khác bằng đơn mới (số đơn mới theo NCC mới, phiếu ký mới chỉ gồm phần thiếu). Phần "mua dư" chưa về
   * thì bỏ. Đơn gộp: hàng về đã chia lệnh sớm trước (YC8), nên phần thiếu tự rơi vào các lệnh xếp sau. Dòng mới vẫn hiện ở "Vật
   * tư cần về" (đếm dòng NEW) tới khi về đủ; lượt tính lại đề xuất tự nhận dòng NEW này là dòng đang mở của vật tư.
   */
  async closeShortage(
    id: string,
    itemIds: string[],
    reason: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<SupplierOrderResponseDto> {
    const order = await this.findOrThrow(id);
    this.assertOwner(order, actorUserId, actorRoles);
    if (order.status !== SupplierOrderStatus.APPROVED) {
      throw new ConflictException(
        `Đơn ${supplierOrderCode(order.seq, order.year)} chưa có phiếu Giám đốc ký - gỡ dòng hoặc sửa số mua trực tiếp, không cần đóng phần thiếu`,
      );
    }
    const wanted = [...new Set(itemIds)].map((x) => parseBigIntId(x));
    const items = wanted.map((wid) => order.items.find((it) => it.id === wid));
    if (items.some((it) => !it)) {
      throw new NotFoundException('Có dòng không nằm trong đơn này');
    }
    const picked = items as OrderRow['items'];
    const proposalIds = [...new Set(picked.map((it) => it.proposalId))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const trimmed = reason.trim();
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // Cùng khoá với nhận hàng (applyItemReceipt) - Kho nhận xen giữa thì đọc lại số đã nhận mới nhất.
      for (const pid of proposalIds) {
        await lockBusinessKey(tx, `purchase-proposal-mutate:${pid}`);
      }
      const closed: {
        itemId: string;
        closedQty: number;
        reorderQty: number;
        newItemId?: string;
      }[] = [];
      for (const it of picked) {
        const [row] = await tx.$queryRaw<
          {
            status: PurchaseProposalStatus;
            buyQty: Prisma.Decimal;
            orderQty: Prisma.Decimal | null;
            receivedQty: Prisma.Decimal;
          }[]
        >`
          SELECT "status", "buyQty", "orderQty", "receivedQty" FROM "purchase_proposal_items"
          WHERE "id" = ${it.id} FOR UPDATE
        `;
        if (row?.status !== PurchaseProposalStatus.PURCHASING) {
          throw new ConflictException(
            `Vật tư ${it.material.code} (${it.id}) không còn chờ nhận - tải lại trang`,
          );
        }
        const buy = row.buyQty.toNumber();
        const received = row.receivedQty.toNumber();
        const closedQty = round4(
          Math.max(0, effectiveOrderQty(buy, row.orderQty?.toNumber() ?? null) - received),
        );
        if (closedQty <= 0) {
          throw new ConflictException(
            `Vật tư ${it.material.code} đã nhận đủ - không còn phần thiếu`,
          );
        }
        const reorderQty = round4(Math.max(0, buy - received));
        await tx.purchaseProposalItem.update({
          where: { id: it.id },
          data: {
            status: PurchaseProposalStatus.PURCHASED,
            purchasedAt: now,
            shortClosedAt: now,
            shortClosedById: actorUserId,
            shortCloseReason: trimmed,
            shortClosedQty: closedQty,
          },
        });
        let newItemId: string | undefined;
        if (reorderQty > 0) {
          const created = await tx.purchaseProposalItem.create({
            data: {
              proposalId: it.proposalId,
              materialId: it.materialId,
              spec: it.spec,
              stockLengthMm: it.stockLengthMm,
              receiveWarehouseCode: it.receiveWarehouseCode,
              buyQty: reorderQty,
              actualStock: 0,
              reorderOfItemId: it.id,
            },
          });
          newItemId = created.id.toString();
        }
        closed.push({ itemId: it.id.toString(), closedQty, reorderQty, newItemId });
      }
      for (const pid of proposalIds) {
        await recomputeProposalStatus(tx, pid);
      }
      return closed;
    });

    await this.audit(AuditAction.UPDATE, order, null, {
      event: 'supplier-order-short-closed',
      reason: trimmed,
      items: result,
    });
    // Đề xuất đủ hàng nhờ đóng phần thiếu (không sinh dòng mới) thì cũng báo "đủ hàng" như khi nhận hàng (13/11/2026).
    for (const pid of proposalIds) {
      await this.purchaseProposalsService.notifyIfFullyPurchased(pid, actorUserId);
    }
    this.publish(proposalIds, actorUserId);
    return this.findOne(id);
  }

  /**
   * File phiếu đề xuất (.xlsx, theo mẫu PHIEU_DE_XUAT_MAU_TRONG_IEA) của 1 đơn - trả base64 vì mọi
   * phản hồi đều bọc trong envelope JSON (ResponseInterceptor), FE tự giải mã rồi tải xuống.
   */
  async print(
    id: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<{ fileName: string; base64: string }> {
    const order = await this.findOrThrow(id);
    this.assertOwner(order, actorUserId, actorRoles);
    if (order.status === SupplierOrderStatus.CANCELLED) {
      throw new ConflictException('Đơn đã huỷ - không in phiếu');
    }
    const codes = await this.lenhCodesOf([order]);
    const inputs: PrintItemInput[] = order.items.map((it) => ({
      materialCode: it.material.code,
      materialName: it.material.name,
      spec: it.spec ?? it.material.spec ?? null,
      stockLengthMm: it.stockLengthMm,
      unit: it.stockLengthMm != null ? 'cây' : it.material.unit,
      orderCode: this.lenhCodeOf(it, codes) ?? '—',
      buyQty: it.buyQty.toNumber(),
      purchaseQty: effectiveOrderQty(it.buyQty.toNumber(), it.orderQty?.toNumber()),
    }));
    // Tồn kho hiện tại theo vật tư + quy cách + chiều dài cây, chỉ kho thật (không tính kho ảo).
    const quants = await this.prisma.stockQuant.groupBy({
      by: ['materialId', 'spec', 'stockLengthMm'],
      where: {
        materialId: { in: [...new Set(order.items.map((it) => it.materialId))] },
        warehouse: { isVirtual: false },
      },
      _sum: { qty: true },
    });
    const stockByKey = new Map(
      quants.map((q) => [
        `${q.materialId}|${q.spec}|${q.stockLengthMm}`,
        q._sum.qty?.toNumber() ?? 0,
      ]),
    );
    const materialIdByCode = new Map(order.items.map((it) => [it.material.code, it.materialId]));
    const rows = buildPrintRows(inputs, (it) => {
      const materialId = materialIdByCode.get(it.materialCode);
      return stockByKey.get(`${materialId}|${it.spec ?? ''}|${it.stockLengthMm ?? 0}`) ?? 0;
    });
    const code = supplierOrderCode(order.seq, order.year);
    const buffer = await renderPrintWorkbook(
      {
        supplierName: order.supplier.name,
        orderCode: code,
        revision: order.revision,
        date: order.revisedAt ?? order.createdAt,
        buyerName: `${order.createdBy.lastName} ${order.createdBy.firstName}`.trim(),
      },
      rows,
    );
    const suffix = order.revision > 0 ? `-thay-phieu-${order.revision}` : '';
    return {
      fileName:
        `phieu-de-xuat-${order.supplier.name}-${order.seq}-${order.year}${suffix}.xlsx`.replace(
          /[\\/:*?"<>|]/g,
          '-',
        ),
      base64: buffer.toString('base64'),
    };
  }

  /** Số đơn cuối cùng của từng NCC trong 1 năm - Admin xem/nạp trước khi dùng (bản v8 mục 4.13). */
  async listCounters(year: number): Promise<SupplierOrderCounterDto[]> {
    const [suppliers, counters, maxIssued] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.supplierOrderCounter.findMany({ where: { year } }),
      this.prisma.supplierOrder.groupBy({
        by: ['supplierId'],
        where: { year },
        _max: { seq: true },
      }),
    ]);
    const counterBy = new Map(counters.map((c) => [c.supplierId.toString(), c]));
    const maxBy = new Map(maxIssued.map((m) => [m.supplierId.toString(), m._max.seq ?? 0]));
    return Promise.all(
      suppliers.map(async (s) => {
        const c = counterBy.get(s.id.toString());
        const lastSeq = c?.lastSeq ?? 0;
        const reused = maxBy.has(s.id.toString())
          ? await this.findReusableSeq(this.prisma, s.id, year, c?.reuseFromSeq ?? 0)
          : null;
        return new SupplierOrderCounterDto({
          supplierId: s.id.toString(),
          supplierName: s.name,
          year,
          lastSeq,
          maxIssuedSeq: maxBy.get(s.id.toString()) ?? 0,
          nextSeq: reused ?? lastSeq + 1,
        });
      }),
    );
  }

  async setCounter(
    supplierIdRaw: string,
    year: number,
    lastSeq: number,
  ): Promise<SupplierOrderCounterDto> {
    const supplierId = parseBigIntId(supplierIdRaw);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier || supplier.deletedAt) {
      throw new NotFoundException('Không tìm thấy nhà cung cấp');
    }
    const old = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `supplier-order-counter:${supplierId}:${year}`);
      const max = await tx.supplierOrder.aggregate({
        where: { supplierId, year },
        _max: { seq: true },
      });
      const maxIssued = max._max.seq ?? 0;
      if (lastSeq < maxIssued) {
        throw new BadRequestException(
          `Hệ thống đã cấp tới số ${maxIssued}/${year} cho ${supplier.name} - không nạp số nhỏ hơn được`,
        );
      }
      const prev = await tx.supplierOrderCounter.findUnique({
        where: { supplierId_year: { supplierId, year } },
      });
      // Số từ mốc nạp trở xuống có thể đã dùng ngoài hệ thống - không cấp lại số đơn huỷ trong khoảng đó.
      await tx.supplierOrderCounter.upsert({
        where: { supplierId_year: { supplierId, year } },
        create: { supplierId, year, lastSeq, reuseFromSeq: lastSeq },
        update: { lastSeq, reuseFromSeq: lastSeq },
      });
      return prev?.lastSeq ?? 0;
    });
    const auditLogClient = this.prisma as unknown as Pick<PrismaClient, 'auditLog'>;
    await writeAuditLog(auditLogClient, this.cls, {
      action: AuditAction.UPDATE,
      tableName: 'SupplierOrderCounter',
      recordId: `${supplierId}:${year}`,
      oldValue: { lastSeq: old },
      newValue: { lastSeq },
    });
    const [row] = (await this.listCounters(year)).filter((c) => c.supplierId === supplierIdRaw);
    return row;
  }

  /**
   * Cấp số cho đơn mới của 1 NCC trong 1 năm (12/11/2026, anh Nhân điểm 10 - không nhảy cóc): ưu tiên số NHỎ NHẤT của
   * đơn đã huỷ khi chưa từng có phiếu Giám đốc ký (revision = 0) mà chưa đơn nào khác (chưa huỷ) đang dùng, và lớn hơn
   * mốc Admin nạp (reuseFromSeq); không có thì lastSeq + 1. Khoá cùng key với setCounter() để 2 đơn tạo cùng lúc không
   * lấy trùng 1 số trả lại (partial unique index supplier_orders_active_seq_key là chốt chặn cuối).
   */
  private async allocateSeq(tx: PrismaTx, supplierId: bigint, year: number): Promise<number> {
    await lockBusinessKey(tx, `supplier-order-counter:${supplierId}:${year}`);
    const counter = await tx.supplierOrderCounter.findUnique({
      where: { supplierId_year: { supplierId, year } },
    });
    const reused = await this.findReusableSeq(tx, supplierId, year, counter?.reuseFromSeq ?? 0);
    if (reused !== null) return reused;
    const next = (counter?.lastSeq ?? 0) + 1;
    await tx.supplierOrderCounter.upsert({
      where: { supplierId_year: { supplierId, year } },
      create: { supplierId, year, lastSeq: next },
      update: { lastSeq: next },
    });
    return next;
  }

  /** Số đơn huỷ nhỏ nhất cấp lại được (xem allocateSeq), không có thì null. */
  private async findReusableSeq(
    db: Pick<PrismaTx, '$queryRaw'>,
    supplierId: bigint,
    year: number,
    reuseFromSeq: number,
  ): Promise<number | null> {
    const [row] = await db.$queryRaw<{ seq: number | null }[]>`
      SELECT min(c."seq")::int AS "seq"
      FROM "supplier_orders" c
      WHERE c."supplierId" = ${supplierId} AND c."year" = ${year}
        AND c."status" = 'CANCELLED' AND c."revision" = 0 AND c."seq" > ${reuseFromSeq}
        AND NOT EXISTS (
          SELECT 1 FROM "supplier_orders" a
          WHERE a."supplierId" = c."supplierId" AND a."year" = c."year" AND a."seq" = c."seq"
            AND a."status" <> 'CANCELLED'
        )
    `;
    return row?.seq ?? null;
  }

  // Khoá + tái kiểm DRAFT trong transaction - đơn có thể vừa được duyệt/huỷ ở tab khác.
  private async lockDraft(tx: PrismaTx, orderId: bigint): Promise<void> {
    const [row] = await tx.$queryRaw<{ status: SupplierOrderStatus }[]>`
      SELECT "status" FROM "supplier_orders" WHERE "id" = ${orderId} FOR UPDATE
    `;
    if (row?.status !== SupplierOrderStatus.DRAFT) {
      throw new ConflictException('Đơn vừa được duyệt hoặc huỷ ở nơi khác - tải lại trang');
    }
  }

  private assertDraft(order: OrderRow): void {
    if (order.status !== SupplierOrderStatus.DRAFT) {
      throw new ConflictException(
        order.status === SupplierOrderStatus.APPROVED
          ? `Đơn ${supplierOrderCode(order.seq, order.year)} đã có phiếu Giám đốc ký - không sửa được`
          : `Đơn ${supplierOrderCode(order.seq, order.year)} đã huỷ`,
      );
    }
  }

  private assertOwner(order: OrderRow, actorUserId: string, actorRoles: string[]): void {
    if (!this.isPrivileged(actorRoles) && order.createdById !== actorUserId) {
      throw new ForbiddenException('Đơn này do người mua khác tạo');
    }
  }

  private isPrivileged(actorRoles: string[]): boolean {
    return actorRoles.includes(BUSINESS_ROLES.BOSS) || actorRoles.includes(DEFAULT_ROLES.ADMIN);
  }

  private async findOrThrow(id: string): Promise<OrderRow> {
    const order = await this.prisma.supplierOrder.findUnique({
      where: { id: parseBigIntId(id) },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn đặt hàng ${id}`);
    }
    return order;
  }

  private async audit(
    action: AuditAction,
    order: OrderRow,
    oldValue: unknown,
    newValue: unknown,
  ): Promise<void> {
    const auditLogClient = this.prisma as unknown as Pick<PrismaClient, 'auditLog'>;
    await writeAuditLog(auditLogClient, this.cls, {
      action,
      tableName: 'SupplierOrder',
      recordId: order.id.toString(),
      oldValue,
      newValue,
    });
  }

  // Màn Lệnh mua / Nhập kho đang nghe PURCHASE_PROPOSAL - báo đúng các đề xuất có dòng vừa đổi đơn.
  private publish(proposalIds: bigint[], actorId: string): void {
    for (const proposalId of proposalIds) {
      this.realtime.publishEntityChanged({
        entity: 'PURCHASE_PROPOSAL',
        entityId: proposalId,
        action: 'UPDATED',
        actorId,
      });
    }
  }

  /**
   * Mã lệnh hiển thị (số LSX, lệnh cũ chưa có LSX thì mã PI) của các lệnh có dòng trong đơn - dùng
   * hàm chung của người A (common/utils/lenh-code.util.ts, điểm ghép ①), 1 lần đọc cho cả danh sách.
   */
  private lenhCodesOf(orders: OrderRow[]): Promise<Map<string, string>> {
    const piIds = orders.flatMap((o) =>
      o.items.map((it) => it.proposal.productionInvoiceId).filter((id): id is bigint => id != null),
    );
    return loadLenhDisplayCodes(this.prisma, piIds);
  }

  private lenhCodeOf(item: OrderRow['items'][number], codes: Map<string, string>): string | null {
    const piId = item.proposal.productionInvoiceId;
    return piId != null ? (codes.get(piId.toString()) ?? null) : null;
  }

  private toDto(order: OrderRow, codes: Map<string, string>): SupplierOrderResponseDto {
    return new SupplierOrderResponseDto({
      id: order.id.toString(),
      code: supplierOrderCode(order.seq, order.year),
      year: order.year,
      seq: order.seq,
      status: order.status,
      supplierId: order.supplierId.toString(),
      supplierName: order.supplier.name,
      createdById: order.createdById,
      createdByName: `${order.createdBy.lastName} ${order.createdBy.firstName}`.trim() || null,
      createdAt: order.createdAt,
      approvalFileUrl: order.approvalFileUrl,
      approvedAt: order.approvedAt,
      cancelledAt: order.cancelledAt,
      cancelReason: order.cancelReason,
      revision: order.revision,
      revisedAt: order.revisedAt,
      reviseReason: order.reviseReason,
      items: order.items.map(
        (it) =>
          new SupplierOrderItemDto({
            id: it.id.toString(),
            proposalId: it.proposalId.toString(),
            materialCode: it.material.code,
            materialName: it.material.name,
            unit: it.stockLengthMm != null ? 'cây' : it.material.unit,
            buyQty: it.buyQty.toNumber(),
            purchaseQty: effectiveOrderQty(it.buyQty.toNumber(), it.orderQty?.toNumber()),
            status: it.status,
            receivedQty: it.receivedQty.toNumber(),
            orderCode: this.lenhCodeOf(it, codes),
            shortClosedQty: it.shortClosedQty?.toNumber() ?? null,
            shortCloseReason: it.shortCloseReason,
            shortClosedAt: it.shortClosedAt,
          }),
      ),
    });
  }
}
