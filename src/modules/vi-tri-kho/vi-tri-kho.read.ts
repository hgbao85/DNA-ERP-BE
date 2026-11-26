import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WarehouseKind } from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';
import { mixWarning, sameTriple, type Triple, type TripleLabel } from './vi-tri-kho.util';

/**
 * Đọc dùng chung của vị trí kho (25/11/2026): kho Thành phẩm theo phạm vi tài khoản, ô theo tem, nhãn bộ 3 (lệnh · SKU · PO),
 * nhắc trộn hàng. `db` là PrismaService hoặc transaction.
 */
type Db = Pick<
  PrismaTx,
  'warehouse' | 'warehouseLocation' | 'productionInvoiceItem' | 'locationStock'
>;

export interface FgWarehouse {
  id: bigint;
  code: string;
  name: string;
}

/** Kho Thành phẩm của thủ kho (scope) hoặc kho tổng kho / Admin chọn. Kho khác loại: 400. */
export async function resolveFgWarehouse(
  db: Db,
  scope: string | null,
  warehouseCode?: string,
): Promise<FgWarehouse> {
  const code = scope ?? warehouseCode?.trim();
  if (!code) {
    throw new BadRequestException(
      'Chọn kho Thành phẩm (warehouseCode) - tài khoản không gắn kho đang làm',
    );
  }
  if (scope && warehouseCode && warehouseCode.trim() !== scope) {
    throw new ForbiddenException(`Bạn đang làm kho ${scope}`);
  }
  const w = await db.warehouse.findUnique({
    where: { code },
    select: { id: true, code: true, name: true, kind: true },
  });
  if (!w) throw new NotFoundException(`Không tìm thấy kho ${code}`);
  if (w.kind !== WarehouseKind.THANH_PHAM) {
    throw new BadRequestException('Vị trí kho chỉ dùng ở kho Thành phẩm');
  }
  return { id: w.id, code: w.code, name: w.name };
}

/** Tem ô là link `<origin>/floor?loc=<token>` - nhận cả link (máy quét cầm tay gõ nguyên link) lẫn token. */
export function tokenFromScan(raw: string): string {
  const s = raw.trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      const t = new URL(s).searchParams.get('loc')?.trim();
      if (t) return t;
    } catch {
      /* không phải link hợp lệ: coi như token */
    }
  }
  return s;
}

export const LOCATION_SELECT = {
  id: true,
  code: true,
  zone: true,
  aisle: true,
  slot: true,
  qrToken: true,
  isActive: true,
  warehouseId: true,
  warehouse: { select: { id: true, code: true, name: true } },
} satisfies Prisma.WarehouseLocationSelect;
export type LocationRow = Prisma.WarehouseLocationGetPayload<{ select: typeof LOCATION_SELECT }>;

/**
 * Ô theo tem quét: phải còn dùng; `warehouseId` cho thì phải đúng kho đó. Lỗi nói rõ để công nhân / thủ kho biết quét lại.
 */
export async function resolveLocationByToken(
  db: Db,
  rawToken: string,
  opts: { warehouseId?: bigint; allowInactive?: boolean } = {},
): Promise<LocationRow> {
  const token = tokenFromScan(rawToken);
  const loc = token
    ? await db.warehouseLocation.findUnique({ where: { qrToken: token }, select: LOCATION_SELECT })
    : null;
  if (!loc) throw new NotFoundException('Mã này không phải tem vị trí kho (hoặc tem đã bỏ)');
  if (!loc.isActive && !opts.allowInactive) {
    throw new ConflictException(`Ô ${loc.code} đang tắt - thủ kho bật lại ở "Vị trí kho"`);
  }
  if (opts.warehouseId != null && loc.warehouseId !== opts.warehouseId) {
    throw new ConflictException(
      `Ô ${loc.code} thuộc ${loc.warehouse.name}, không phải kho đang làm - quét tem ô của đúng kho`,
    );
  }
  return loc;
}

export const ITEM_SELECT = {
  id: true,
  productionInvoiceId: true,
  mfgProductId: true,
  salesOrderItemId: true,
  lsxCode: true,
  warehouseCode: true,
  cancelledAt: true,
  quantity: true,
  mfgProduct: { select: { factoryCode: true, name: true } },
  productionInvoice: { select: { code: true } },
  salesOrder: { select: { orderCode: true } },
  productionOrder: { select: { quantity: true, status: true } },
} satisfies Prisma.ProductionInvoiceItemSelect;
export type ItemRow = Prisma.ProductionInvoiceItemGetPayload<{ select: typeof ITEM_SELECT }>;

export const tripleOf = (i: {
  id: bigint;
  mfgProductId: bigint;
  salesOrderItemId: bigint | null;
}): Triple => ({
  productionInvoiceItemId: i.id,
  mfgProductId: i.mfgProductId,
  salesOrderItemId: i.salesOrderItemId,
});

export interface ItemLabel extends TripleLabel {
  itemId: string;
  productName: string;
  salesOrderItemId: string | null;
  /** Số lượng lệnh SX (bộ). */
  orderQty: number;
}

export const labelOf = (i: ItemRow): ItemLabel => ({
  itemId: i.id.toString(),
  lenhCode: i.lsxCode ?? i.productionInvoice?.code ?? `#${i.id}`,
  sku: i.mfgProduct.factoryCode,
  productName: i.mfgProduct.name,
  poCode: i.salesOrder?.orderCode ?? null,
  salesOrderItemId: i.salesOrderItemId?.toString() ?? null,
  orderQty: i.productionOrder?.quantity ?? i.quantity,
});

export async function loadItems(db: Db, ids: bigint[]): Promise<Map<string, ItemRow>> {
  const uniq = [...new Set(ids.map(String))].map((x) => BigInt(x));
  if (uniq.length === 0) return new Map();
  const rows = await db.productionInvoiceItem.findMany({
    where: { id: { in: uniq } },
    select: ITEM_SELECT,
  });
  return new Map(rows.map((r) => [r.id.toString(), r]));
}

export async function loadItemOrThrow(db: Db, id: bigint): Promise<ItemRow> {
  const row = await db.productionInvoiceItem.findUnique({ where: { id }, select: ITEM_SELECT });
  if (!row) throw new NotFoundException(`Không có dòng SKU ${id}`);
  return row;
}

/** V3: nhắc khi ô đang có bộ 3 khác bộ đang cất (null = ô trống hoặc chỉ có đúng bộ 3 này). */
export async function mixWarningFor(
  db: Db,
  location: { id: bigint; code: string },
  t: Triple,
): Promise<string | null> {
  const rows = await db.locationStock.findMany({
    where: { locationId: location.id, qty: { gt: 0 } },
    select: {
      qty: true,
      productionInvoiceItemId: true,
      mfgProductId: true,
      salesOrderItemId: true,
    },
  });
  const others = rows.filter((r) => !sameTriple(r, t));
  if (others.length === 0) return null;
  const items = await loadItems(
    db,
    others.map((o) => o.productionInvoiceItemId),
  );
  return mixWarning(
    location.code,
    others.map((o) => {
      const it = items.get(o.productionInvoiceItemId.toString());
      return {
        qty: o.qty,
        ...(it ? labelOf(it) : { lenhCode: '?', sku: '?', poCode: null }),
      };
    }),
  );
}
