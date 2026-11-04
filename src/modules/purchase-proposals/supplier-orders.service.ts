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
  SupplierOrderStatus,
} from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { writeAuditLog } from '../../prisma/extensions/audit-log.extension';
import { RealtimeService } from '../../realtime/realtime.service';
import { PENDING_APPROVAL_STATUSES, PurchaseProposalsService } from './purchase-proposals.service';
import { effectiveOrderQty } from './purchase-order-qty.util';
import { supplierOrderCode, vnYear } from './supplier-order-code.util';
import {
  CreateSupplierOrderDto,
  ListSupplierOrdersQueryDto,
  SupplierOrderCounterDto,
  SupplierOrderItemDto,
  SupplierOrderResponseDto,
} from './dto/supplier-order.dto';

const ORDER_INCLUDE = {
  supplier: true,
  createdBy: { select: { firstName: true, lastName: true } },
  items: { include: { material: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.SupplierOrderInclude;

type OrderRow = Prisma.SupplierOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * Đơn đặt hàng NCC (2026-11-04, bản v8 mục 4.10, 4.13, V3-4): người mua gom các dòng chờ duyệt
 * của mình vào 1 đơn, BẮT BUỘC chọn NCC, hệ thống cấp ngay "Số đơn đặt hàng" theo NCC + năm
 * (52/2026). Giám đốc ký phiếu theo đơn, người mua tải phiếu lên ở đúng đơn đó ("Sếp đã duyệt"),
 * các dòng trong đơn mới chuyển PURCHASING để Kho nhận hàng.
 *
 * Số đơn không bao giờ cấp lại: đơn huỷ giữ số (CANCELLED) vì số có thể đã nằm trên giấy tờ gửi
 * NCC. Bộ đếm ở SupplierOrderCounter, tăng nguyên tử trong khoá theo (NCC, năm).
 */
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
    return rows.map((r) => this.toDto(r));
  }

  async findOne(id: string): Promise<SupplierOrderResponseDto> {
    return this.toDto(await this.findOrThrow(id));
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
      const [counter] = await tx.$queryRaw<{ lastSeq: number }[]>`
        INSERT INTO "supplier_order_counters" ("supplierId", "year", "lastSeq", "updatedAt")
        VALUES (${supplierId}, ${year}, 1, NOW())
        ON CONFLICT ("supplierId", "year")
        DO UPDATE SET "lastSeq" = "supplier_order_counters"."lastSeq" + 1, "updatedAt" = NOW()
        RETURNING "lastSeq"
      `;
      const order = await tx.supplierOrder.create({
        data: { supplierId, year, seq: counter.lastSeq, createdById: actorUserId },
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
    return this.toDto(result);
  }

  /** Gỡ 1 dòng khỏi đơn CHƯA duyệt (bản v8 mục 7.5). Đơn rỗng thì tự huỷ, số đơn giữ nguyên. */
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

  /** Huỷ đơn CHƯA duyệt: các dòng quay về chờ gom đơn; số đơn giữ nguyên, không cấp lại. */
  async cancel(
    id: string,
    reason: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<SupplierOrderResponseDto> {
    const order = await this.findOrThrow(id);
    this.assertOwner(order, actorUserId, actorRoles);
    this.assertDraft(order);
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
   * sang PURCHASING (dùng lại PurchaseProposalsService.bossApprove() theo từng đề xuất chứa dòng
   * - audit, thông báo Kho, realtime giữ nguyên như trước).
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
    for (const [proposalId, itemIds] of byProposal) {
      await this.purchaseProposalsService.bossApprove(
        proposalId.toString(),
        actorUserId,
        actorRoles,
        { approvalFileUrl },
        itemIds,
      );
    }
    const { count } = await this.prisma.supplierOrder.updateMany({
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
    await this.audit(AuditAction.UPDATE, order, null, {
      event: 'supplier-order-approved',
      approvalFileUrl,
    });
    return this.findOne(id);
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
    const lastBy = new Map(counters.map((c) => [c.supplierId.toString(), c.lastSeq]));
    const maxBy = new Map(maxIssued.map((m) => [m.supplierId.toString(), m._max.seq ?? 0]));
    return suppliers.map(
      (s) =>
        new SupplierOrderCounterDto({
          supplierId: s.id.toString(),
          supplierName: s.name,
          year,
          lastSeq: lastBy.get(s.id.toString()) ?? 0,
          maxIssuedSeq: maxBy.get(s.id.toString()) ?? 0,
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
      await tx.supplierOrderCounter.upsert({
        where: { supplierId_year: { supplierId, year } },
        create: { supplierId, year, lastSeq },
        update: { lastSeq },
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

  private toDto(order: OrderRow): SupplierOrderResponseDto {
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
          }),
      ),
    });
  }
}
