import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import type { PrismaTx } from '../../prisma/prisma.service';
import { locationLockKey, tripleLockKey, type Triple } from './vi-tri-kho.util';

/**
 * Ghi tồn theo ô (location_stocks) trong transaction của người gọi. Thứ tự khoá chung mọi luồng (không khoá chéo):
 * booking -> packaging (SKU) -> bộ 3 (theo id dòng SKU, tăng dần) -> ô (theo id, tăng dần). Người gọi khoá booking / packaging
 * trước (nếu cần) rồi gọi lockTriplesAndLocations 1 lần.
 */
export async function lockTriplesAndLocations(
  tx: PrismaTx,
  piiIds: bigint[],
  locationIds: bigint[],
): Promise<void> {
  const asc = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
  for (const id of [...new Set(piiIds)].sort(asc)) await lockBusinessKey(tx, tripleLockKey(id));
  for (const id of [...new Set(locationIds)].sort(asc)) {
    await lockBusinessKey(tx, locationLockKey(id));
  }
}

/** Cộng `qty` bộ của bộ 3 vào ô (tạo dòng nếu chưa có). Unique (ô, SKU, LSX, PO) NULLS NOT DISTINCT. */
export async function addLocationStock(
  tx: PrismaTx,
  locationId: bigint,
  t: Triple,
  qty: number,
): Promise<void> {
  if (qty <= 0) return;
  await tx.$executeRaw`
    INSERT INTO "location_stocks" ("locationId", "productionInvoiceItemId", "mfgProductId", "salesOrderItemId", "qty", "updatedAt")
    VALUES (${locationId}, ${t.productionInvoiceItemId}, ${t.mfgProductId}, ${t.salesOrderItemId}, ${qty}, now())
    ON CONFLICT ("locationId", "productionInvoiceItemId", "mfgProductId", "salesOrderItemId")
    DO UPDATE SET "qty" = "location_stocks"."qty" + EXCLUDED."qty", "updatedAt" = now()`;
}

/** Số bộ của bộ 3 đang ở ô (0 nếu không có dòng). */
export async function locationStockQty(
  tx: PrismaTx,
  locationId: bigint,
  t: Triple,
): Promise<number> {
  const rows = await tx.$queryRaw<{ qty: number }[]>`
    SELECT "qty" FROM "location_stocks"
    WHERE "locationId" = ${locationId} AND "productionInvoiceItemId" = ${t.productionInvoiceItemId}
      AND "mfgProductId" = ${t.mfgProductId} AND "salesOrderItemId" IS NOT DISTINCT FROM ${t.salesOrderItemId}::bigint`;
  return Number(rows[0]?.qty ?? 0);
}

/**
 * Trừ `qty` bộ của ĐÚNG bộ 3 khỏi ô - không đủ thì 409 với `shortMessage(còn)`. Dòng về 0 thì xoá (ô trống không còn dòng rỗng).
 */
export async function takeLocationStock(
  tx: PrismaTx,
  locationId: bigint,
  t: Triple,
  qty: number,
  shortMessage: (have: number) => string,
): Promise<void> {
  if (qty <= 0) return;
  const n = await tx.$executeRaw`
    UPDATE "location_stocks" SET "qty" = "qty" - ${qty}, "updatedAt" = now()
    WHERE "locationId" = ${locationId} AND "productionInvoiceItemId" = ${t.productionInvoiceItemId}
      AND "mfgProductId" = ${t.mfgProductId} AND "salesOrderItemId" IS NOT DISTINCT FROM ${t.salesOrderItemId}::bigint
      AND "qty" >= ${qty}`;
  if (n !== 1) {
    throw new ConflictException(shortMessage(await locationStockQty(tx, locationId, t)));
  }
  await tx.$executeRaw`
    DELETE FROM "location_stocks"
    WHERE "locationId" = ${locationId} AND "productionInvoiceItemId" = ${t.productionInvoiceItemId}
      AND "mfgProductId" = ${t.mfgProductId} AND "salesOrderItemId" IS NOT DISTINCT FROM ${t.salesOrderItemId}::bigint
      AND "qty" = 0`;
}

/** Tổng bộ của 1 dòng SKU đang nằm ở các ô (mọi kho). */
export async function sumLocationStockOfItem(
  tx: Pick<PrismaTx, 'locationStock'>,
  productionInvoiceItemId: bigint,
): Promise<number> {
  const r = await tx.locationStock.aggregate({
    where: { productionInvoiceItemId },
    _sum: { qty: true },
  });
  return r._sum.qty ?? 0;
}

export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Prisma bọc lỗi unique của $executeRaw khác create(): kiểm cả mã Postgres 23505. */
export const isUniqueViolationAny = (e: unknown): boolean => {
  if (isUniqueViolation(e)) return true;
  const text = (e as { message?: string })?.message ?? '';
  return /23505|Unique constraint/i.test(text);
};
