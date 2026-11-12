import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';

/**
 * Phạm vi xưởng của 1 tài khoản (QLSX theo xưởng, 2026-11-12).
 *
 * - `workshopId = null`: không giới hạn - KHSX, Sếp, Admin, QLSX chưa gắn xưởng (hành vi cũ).
 * - QLSX gắn xưởng W: XEM lệnh của W + lệnh của các xưởng sơn nhờ ở W (Workshop.paintWorkshopId = W, vì công đoạn Sơn
 *   của các lệnh đó chạy ở W); chỉ THAO TÁC được lệnh của chính W.
 * - SKU/lệnh chưa có xưởng (`ProductionInvoiceItem.workshopId = null`, dữ liệu cũ) ai cũng xem và thao tác được như trước.
 */
export interface WorkshopScope {
  workshopId: bigint | null;
  workshopName: string | null;
  /** Xưởng được XEM lệnh; null = tất cả. */
  visibleWorkshopIds: bigint[] | null;
}

const UNSCOPED: WorkshopScope = { workshopId: null, workshopName: null, visibleWorkshopIds: null };

@Injectable()
export class WorkshopScopeService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async getScope(userId: string | null | undefined): Promise<WorkshopScope> {
    if (!userId) return UNSCOPED;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        workshopId: true,
        workshop: { select: { name: true, paintsFor: { select: { id: true } } } },
      },
    });
    if (!user?.workshopId) return UNSCOPED;
    return {
      workshopId: user.workshopId,
      workshopName: user.workshop?.name ?? null,
      visibleWorkshopIds: [user.workshopId, ...(user.workshop?.paintsFor ?? []).map((w) => w.id)],
    };
  }

  /** Lọc ProductionInvoiceItem theo phạm vi XEM (gồm cả SKU chưa có xưởng); undefined = không lọc. */
  itemWhere(scope: WorkshopScope): Prisma.ProductionInvoiceItemWhereInput | undefined {
    if (!scope.visibleWorkshopIds) return undefined;
    return { OR: [{ workshopId: null }, { workshopId: { in: scope.visibleWorkshopIds } }] };
  }

  canView(scope: WorkshopScope, workshopId: bigint | null | undefined): boolean {
    if (!scope.visibleWorkshopIds || workshopId == null) return true;
    return scope.visibleWorkshopIds.includes(workshopId);
  }

  canManage(scope: WorkshopScope, workshopId: bigint | null | undefined): boolean {
    if (scope.workshopId == null || workshopId == null) return true;
    return scope.workshopId === workshopId;
  }

  /** Chặn thao tác ngoài xưởng phụ trách. `workshopIds` = xưởng của các SKU bị tác động (bỏ trùng/null bên trong). */
  assertCanManage(
    scope: WorkshopScope,
    workshopIds: (bigint | null | undefined)[],
    what = 'lệnh này',
  ): void {
    if (scope.workshopId == null) return;
    const other = workshopIds.find((id) => id != null && id !== scope.workshopId);
    if (other != null) {
      throw new ForbiddenException(
        `Bạn phụ trách ${scope.workshopName ?? 'xưởng khác'} - ${what} thuộc xưởng khác, chỉ QLSX của xưởng đó thao tác được`,
      );
    }
  }
}
