import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';

/**
 * Khoá chung giữa ĐỔI XƯỞNG và XUẤT KHO của 1 lệnh (rà soát 14/11/2026, lỗi CK6).
 *
 * Trước đây xuất sắt / xác nhận phiếu XK tra kho theo xưởng của lệnh NGOÀI transaction, còn changeWorkshop() không khoá gì
 * chung với 2 luồng đó -> đổi xưởng commit giữa lúc tra và lúc ghi thì vẫn xuất (và trừ tồn) ở kho xưởng CŨ, lách luôn cờ
 * "cần kiểm lại phương án cắt" vừa bật. Nay cả 3 luồng khoá dòng `production_invoices` của lệnh (FOR UPDATE) làm việc ĐẦU
 * TIÊN trong transaction: đổi xưởng và xuất chạy nối tiếp nhau. Luồng xuất đọc lại xưởng + cờ SAU khoá và so với lúc tra kho.
 *
 * Thứ tự khoá: dòng lệnh (theo id tăng) TRƯỚC mọi khoá khác của luồng xuất (production_orders, giữ chỗ, stock_quant).
 */
export interface LockedPiState {
  workshopId: bigint | null;
  cuttingRecheckRequired: boolean;
}

/** Xưởng hiện tại của từng lệnh (mọi SKU của 1 lệnh cùng 1 xưởng; null = chưa chọn). Đọc KHÔNG khoá - để chụp lúc tra kho. */
export async function workshopsOfPis(
  db: PrismaServiceType | PrismaTx,
  piIds: readonly bigint[],
): Promise<Map<string, bigint | null>> {
  const result = new Map<string, bigint | null>(piIds.map((id) => [id.toString(), null]));
  if (piIds.length === 0) return result;
  const rows = await db.productionInvoiceItem.findMany({
    where: { productionInvoiceId: { in: [...piIds] }, workshopId: { not: null } },
    select: { productionInvoiceId: true, workshopId: true },
  });
  for (const r of rows) {
    if (r.productionInvoiceId != null) result.set(r.productionInvoiceId.toString(), r.workshopId);
  }
  return result;
}

/** Khoá dòng lệnh (FOR UPDATE, theo id tăng - không khoá chéo) rồi đọc lại xưởng + cờ kiểm lại phương án cắt SAU khoá. */
export async function lockPisForIssue(
  tx: PrismaTx,
  piIds: readonly bigint[],
): Promise<Map<string, LockedPiState>> {
  const ids = [...new Set(piIds.map((id) => id.toString()))].map((s) => BigInt(s));
  ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const result = new Map<string, LockedPiState>();
  if (ids.length === 0) return result;
  const rows = await tx.$queryRaw<{ id: bigint; cuttingRecheckRequired: boolean }[]>`
    SELECT "id", "cuttingRecheckRequired" FROM "production_invoices"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `;
  const workshops = await workshopsOfPis(tx, ids);
  for (const r of rows) {
    result.set(r.id.toString(), {
      workshopId: workshops.get(r.id.toString()) ?? null,
      cuttingRecheckRequired: r.cuttingRecheckRequired,
    });
  }
  return result;
}

export const WORKSHOP_CHANGED_DURING_ISSUE_MESSAGE =
  'Lệnh vừa đổi xưởng trong lúc xuất - kho xuất đã khác, tải lại trang rồi lập lại';

/** Xưởng sau khoá phải trùng xưởng lúc tra kho, nếu không -> 409 (không xuất ở kho xưởng cũ). */
export function assertWorkshopUnchanged(
  locked: LockedPiState | undefined,
  workshopAtPrepare: bigint | null,
): void {
  if ((locked?.workshopId ?? null) !== workshopAtPrepare) {
    throw new ConflictException(WORKSHOP_CHANGED_DURING_ISSUE_MESSAGE);
  }
}
