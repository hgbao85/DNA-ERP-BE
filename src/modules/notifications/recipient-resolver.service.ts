import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { RecipientCriteria } from './notification-types';

/** Dữ liệu của 1 lần emit() dùng để tìm lệnh sản xuất (và xưởng) mà thông báo nói tới. */
export interface NotificationOrderRef {
  entityType?: string | null;
  entityId?: string | null;
  params?: Record<string, unknown>;
}

const toBigId = (v: unknown): bigint | null =>
  (typeof v === 'string' || typeof v === 'number') && /^\d+$/.test(String(v))
    ? BigInt(String(v))
    : null;

/**
 * Dịch `RecipientCriteria` (khai báo ở NOTIFICATION_TYPES) sang danh sách userId cụ thể - luôn
 * lọc `isActive && !deletedAt` (không báo cho tài khoản đã khoá/xoá), luôn gộp OR giữa các nhóm
 * tiêu chí, luôn khử trùng lặp (1 user khớp nhiều tiêu chí chỉ nhận 1 dòng).
 */
@Injectable()
export class RecipientResolverService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  /**
   * @param excludeUserIds Loại khỏi kết quả sau khi đã gộp - dùng để không báo cho chính người
   *   vừa thao tác (`actorId`), trừ khi type khai `notifyActor: true`.
   */
  async resolve(
    criteria: RecipientCriteria,
    excludeUserIds: string[] = [],
    tx?: PrismaTx,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const ids = new Set<string>();

    if (criteria.allActiveUsers) {
      const users = await client.user.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    if (criteria.roles?.length) {
      const users = await client.user.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          roles: { some: { role: { name: { in: criteria.roles } } } },
        },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    if (criteria.mfgRoles?.length) {
      const users = await client.user.findMany({
        where: { isActive: true, deletedAt: null, mfgRole: { in: criteria.mfgRoles } },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    if (criteria.warehouseIds?.length) {
      const users = await client.user.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          ...(criteria.warehouseFamilies
            ? {
                OR: criteria.warehouseIds.flatMap((code) => [
                  { warehouseScope: code },
                  { warehouseScope: { startsWith: `${code}-` } },
                ]),
              }
            : {
                // Đợt 7: người giữ nhiều kho nhận thông báo của mọi kho mình giữ, không chỉ kho đang làm.
                OR: [
                  { warehouseScope: { in: criteria.warehouseIds } },
                  { warehouseScopes: { hasSome: criteria.warehouseIds } },
                ],
              }),
          ...(criteria.warehouseScopeRoles?.length
            ? { roles: { some: { role: { name: { in: criteria.warehouseScopeRoles } } } } }
            : {}),
          ...(criteria.warehouseScopeExcludeRoles?.length
            ? {
                NOT: {
                  roles: { some: { role: { name: { in: criteria.warehouseScopeExcludeRoles } } } },
                },
              }
            : {}),
        },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    if (criteria.userIds?.length) {
      const users = await client.user.findMany({
        where: { id: { in: criteria.userIds }, isActive: true, deletedAt: null },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    excludeUserIds.forEach((id) => ids.delete(id));
    if (criteria.excludeRoles?.length && ids.size > 0) {
      const excluded = await client.user.findMany({
        where: {
          id: { in: [...ids] },
          roles: { some: { role: { name: { in: criteria.excludeRoles } } } },
        },
        select: { id: true },
      });
      excluded.forEach((u) => ids.delete(u.id));
    }
    return [...ids];
  }

  /**
   * QLSX theo xưởng (2026-11-12): thông báo về 1 lệnh sản xuất chỉ tới QLSX không giới hạn (chưa gắn xưởng) và QLSX của xưởng
   * lệnh đó - QLSX đã gắn xưởng KHÁC bị bỏ (kể cả xưởng sơn nhờ, vì họ chỉ xem lệnh đó). Làm tập trung ở đây thay vì sửa từng
   * chỗ phát. Mọi vai khác giữ nguyên; thông báo không gắn được với lệnh nào (vd bản tin sáng) hoặc lệnh chưa có xưởng giữ
   * nguyên người nhận.
   */
  async dropQlsxOfOtherWorkshops(
    recipientIds: string[],
    ref: NotificationOrderRef,
    tx?: PrismaTx,
  ): Promise<string[]> {
    if (recipientIds.length === 0) return recipientIds;
    const client = tx ?? this.prisma;
    const scoped = await client.user.findMany({
      where: {
        id: { in: recipientIds },
        workshopId: { not: null },
        OR: [
          { roles: { some: { role: { name: BUSINESS_ROLES.PRODUCTION_MANAGER } } } },
          { mfgRole: 'PRODUCTION_MANAGER' },
        ],
      },
      select: { id: true, workshopId: true },
    });
    if (scoped.length === 0) return recipientIds;
    const orderWorkshops = await this.workshopsOfOrder(client, ref);
    if (orderWorkshops.size === 0) return recipientIds;
    const drop = new Set(
      scoped
        .filter((u) => u.workshopId != null && !orderWorkshops.has(u.workshopId))
        .map((u) => u.id),
    );
    return drop.size === 0 ? recipientIds : recipientIds.filter((id) => !drop.has(id));
  }

  /** Xưởng (các SKU) của lệnh mà thông báo nói tới; rỗng = không xác định được hoặc lệnh chưa có xưởng. */
  private async workshopsOfOrder(
    client: PrismaServiceType | PrismaTx,
    ref: NotificationOrderRef,
  ): Promise<Set<bigint>> {
    const found = new Set<bigint>();
    const collect = async (where: Prisma.ProductionInvoiceItemWhereInput) => {
      const rows = await client.productionInvoiceItem.findMany({
        where,
        select: { workshopId: true },
      });
      rows.forEach((r) => {
        if (r.workshopId != null) found.add(r.workshopId);
      });
    };
    // Ưu tiên mã PI / số PO trong params: đáng tin hơn entityId vì có type gắn entityType PI nhưng truyền id dòng SKU, còn type
    // kho/KCS/đề xuất mua thì entityId không phải lệnh.
    const params = ref.params ?? {};
    if (typeof params.piCode === 'string') {
      const pi = await client.productionInvoice.findUnique({
        where: { code: params.piCode },
        select: { id: true },
      });
      if (pi) await collect({ productionInvoiceId: pi.id });
    } else if (typeof params.poNumber === 'string') {
      const order = await client.productionOrder.findUnique({
        where: { poNumber: params.poNumber },
        select: { id: true },
      });
      if (order) await collect({ productionOrder: { is: { id: order.id } } });
    }
    if (found.size > 0) return found;

    const entityId = toBigId(ref.entityId);
    if (entityId != null) {
      switch (ref.entityType) {
        case 'PRODUCTION_INVOICE_ITEM':
          await collect({ id: entityId });
          break;
        case 'PRODUCTION_INVOICE':
          await collect({ productionInvoiceId: entityId });
          break;
        case 'PRODUCTION_ORDER':
          await collect({ productionOrder: { is: { id: entityId } } });
          break;
        case 'CUTTING_PROPOSAL': {
          const proposal = await client.cuttingProposal.findUnique({
            where: { id: entityId },
            select: { productionOrderId: true, productionInvoiceId: true },
          });
          if (proposal?.productionOrderId != null) {
            await collect({ productionOrder: { is: { id: proposal.productionOrderId } } });
          } else if (proposal?.productionInvoiceId != null) {
            await collect({ productionInvoiceId: proposal.productionInvoiceId });
          }
          break;
        }
        default:
          break;
      }
    }
    return found;
  }
}
