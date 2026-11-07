import { BadRequestException } from '@nestjs/common';
import { WarehouseKind } from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';

/**
 * Đợt 7 - chia 9 kho (bản v8 12.4, YC12). Kho Phôi và kho Hàn có RIÊNG từng xưởng (Phú An, Phước An); kho Sơn, Phụ kiện,
 * Thành phẩm dùng chung. `Material.warehouseId` vẫn là kho MẶC ĐỊNH của vật tư (luôn là kho của Phú An với vật tư Phôi/Hàn) -
 * đồng thời cho biết vật tư thuộc LOẠI kho nào. Vật tư của 1 lệnh làm ở xưởng khác thì mua, giữ chỗ, nhập, xuất ở kho CÙNG
 * LOẠI của xưởng đó.
 *
 * Mọi luồng đọc kho theo vật tư + lệnh phải đi qua `resolveForPi()` ở đây, không tự dùng thẳng `Material.warehouseId`.
 * Kho mặc định KHÔNG phải Phôi/Hàn thì trả lại nguyên kho đó, không đọc DB.
 */
export const WORKSHOP_BOUND_KINDS: readonly WarehouseKind[] = [
  WarehouseKind.PHOI,
  WarehouseKind.HAN,
];

export const WAREHOUSE_KIND_LABEL: Record<WarehouseKind, string> = {
  PHOI: 'Phôi',
  HAN: 'Hàn',
  SON: 'Sơn',
  PHU_KIEN: 'Phụ kiện',
  THANH_PHAM: 'Thành phẩm',
};

/** Kho tối thiểu cần để đổi: id + code, cùng `kind`/`workshopId` (include `warehouse: true` của Prisma đã có sẵn). */
export interface WarehouseLike {
  id: bigint;
  code: string;
  kind?: WarehouseKind | null;
  workshopId?: bigint | null;
}

export function isWorkshopBoundKind(kind: WarehouseKind | null | undefined): kind is WarehouseKind {
  return kind != null && WORKSHOP_BOUND_KINDS.includes(kind);
}

const WAREHOUSE_SELECT = { id: true, code: true, kind: true, workshopId: true } as const;

type Db = Pick<PrismaTx, 'warehouse' | 'productionInvoiceItem'>;

/** Bộ đổi kho dùng trong 1 request/transaction - nhớ tạm xưởng của PI và kho đã tra. */
export class WorkshopWarehouseResolver {
  private readonly workshopOfPi = new Map<string, bigint | null>();
  private readonly byKindWorkshop = new Map<string, WarehouseLike | null>();

  constructor(private readonly db: Db) {}

  /** Xưởng của lệnh (mọi SKU của 1 PI cùng 1 xưởng - xem ProductionInvoiceItem.workshopId). null = chưa chọn xưởng. */
  async workshopIdOfPi(productionInvoiceId: bigint | null | undefined): Promise<bigint | null> {
    if (productionInvoiceId == null) return null;
    const key = productionInvoiceId.toString();
    if (!this.workshopOfPi.has(key)) {
      const row = await this.db.productionInvoiceItem.findFirst({
        where: { productionInvoiceId, workshopId: { not: null } },
        select: { workshopId: true },
      });
      this.workshopOfPi.set(key, row?.workshopId ?? null);
    }
    return this.workshopOfPi.get(key) ?? null;
  }

  private async findKindOf(kind: WarehouseKind, workshopId: bigint): Promise<WarehouseLike | null> {
    const key = `${kind}:${workshopId}`;
    if (!this.byKindWorkshop.has(key)) {
      const w = await this.db.warehouse.findFirst({
        where: { kind, workshopId, deletedAt: null },
        select: WAREHOUSE_SELECT,
      });
      this.byKindWorkshop.set(key, w);
    }
    return this.byKindWorkshop.get(key) ?? null;
  }

  /**
   * Kho thật của 1 vật tư cho 1 xưởng. `base` = kho mặc định (Material.warehouse). Không đổi khi: kho mặc định không phải
   * Phôi/Hàn, chưa có xưởng, hoặc kho mặc định đã là của xưởng đó. Xưởng chưa có kho cùng loại -> lỗi (cấu hình thiếu),
   * KHÔNG lặng lẽ dùng kho Phú An.
   */
  async resolve<T extends WarehouseLike>(
    base: T,
    workshopId: bigint | null,
  ): Promise<T | WarehouseLike> {
    if (!isWorkshopBoundKind(base.kind) || workshopId == null || base.workshopId === workshopId) {
      return base;
    }
    const target = await this.findKindOf(base.kind, workshopId);
    if (!target) {
      throw new BadRequestException(
        `Xưởng của lệnh chưa có kho ${WAREHOUSE_KIND_LABEL[base.kind]} - báo Admin tạo kho trước`,
      );
    }
    return target;
  }

  /** Như `resolve()` nhưng lấy xưởng theo PI (chỉ tra PI khi kho mặc định là Phôi/Hàn). */
  async resolveForPi<T extends WarehouseLike>(
    base: T,
    productionInvoiceId: bigint | null | undefined,
  ): Promise<T | WarehouseLike> {
    if (!isWorkshopBoundKind(base.kind)) return base;
    return this.resolve(base, await this.workshopIdOfPi(productionInvoiceId));
  }

  /** Kho cùng LOẠI với kho mặc định nhưng thuộc xưởng của thủ kho `scopeCode` (thủ kho Hàn Phước An lấy dây hàn ở kho mình). */
  async sameKindAs<T extends WarehouseLike>(
    base: T,
    scopeCode: string | null,
  ): Promise<T | WarehouseLike> {
    if (!scopeCode || !isWorkshopBoundKind(base.kind) || scopeCode === base.code) return base;
    const scope = await this.db.warehouse.findUnique({
      where: { code: scopeCode },
      select: WAREHOUSE_SELECT,
    });
    return scope && scope.kind === base.kind ? scope : base;
  }

  async byId(id: bigint): Promise<WarehouseLike | null> {
    return this.db.warehouse.findUnique({ where: { id }, select: WAREHOUSE_SELECT });
  }

  /** Kho Phôi của 1 xưởng (Đợt 8 của người A dùng để trừ tồn sắt khi tính số cây cần mua; phôi/mảnh của lệnh ghi ở đây). */
  async phoiWarehouseOf(workshopId: bigint): Promise<WarehouseLike> {
    const w = await this.findKindOf(WarehouseKind.PHOI, workshopId);
    if (!w) {
      throw new BadRequestException(
        `Xưởng ${workshopId} chưa có kho Phôi - báo Admin tạo kho trước`,
      );
    }
    return w;
  }

  /** Kho Phôi của xưởng làm lệnh; lệnh chưa chọn xưởng -> kho Phôi gốc 'phoi-son-han' (Phú An) như trước khi chia kho. */
  async phoiWarehouseOfPi(productionInvoiceId: bigint | null | undefined): Promise<WarehouseLike> {
    const workshopId = await this.workshopIdOfPi(productionInvoiceId);
    if (workshopId != null) return this.phoiWarehouseOf(workshopId);
    const root = await this.db.warehouse.findUnique({
      where: { code: 'phoi-son-han' },
      select: WAREHOUSE_SELECT,
    });
    if (!root) throw new BadRequestException("Không tìm thấy kho 'phoi-son-han'");
    return root;
  }
}

/** Gọn cho chỗ chỉ cần 1 lần: kho Phôi của 1 xưởng (điểm ghép ③ với người A). */
export function phoiWarehouseOfWorkshop(db: Db, workshopId: bigint): Promise<WarehouseLike> {
  return new WorkshopWarehouseResolver(db).phoiWarehouseOf(workshopId);
}
