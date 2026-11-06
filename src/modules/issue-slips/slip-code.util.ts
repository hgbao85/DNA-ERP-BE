import type { PrismaTx } from '../../prisma/prisma.service';

/** Loại số phiếu kho theo ngày (bản v8 4.8): NK = nhập kho, XK = xuất kho. Chuyển kho CK theo kho giao làm ở Đợt 7. */
export type SlipKind = 'NK' | 'XK';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** yymmdd theo giờ Việt Nam - phiếu tạo lúc 00:30 sáng giờ VN thuộc ngày mới. */
export function vnDayStamp(now: Date = new Date()): string {
  const d = new Date(now.getTime() + VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCFullYear() % 100)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** NK-261106-001; quá 999 phiếu/ngày thì số dài thêm (NK-261106-1000), không vòng lại. */
export function formatSlipCode(kind: SlipKind, day: string, seq: number): string {
  return `${kind}-${day}-${String(seq).padStart(3, '0')}`;
}

/**
 * Cấp số phiếu tiếp theo của (loại, ngày) - đếm chung toàn công ty (Đợt 6, quyết định 06/11). Tăng nguyên tử bằng
 * INSERT ... ON CONFLICT trong transaction của caller (cùng idiom SupplierOrderCounter): 2 phiếu cùng lúc không trùng số,
 * transaction rollback thì số đó không bị tiêu (bộ đếm rollback theo).
 */
export async function allocateSlipCode(
  tx: PrismaTx,
  kind: SlipKind,
  now: Date = new Date(),
): Promise<string> {
  const day = vnDayStamp(now);
  const [row] = await tx.$queryRaw<{ lastSeq: number }[]>`
    INSERT INTO "warehouse_slip_counters" ("kind", "day", "lastSeq", "updatedAt")
    VALUES (${kind}, ${day}, 1, NOW())
    ON CONFLICT ("kind", "day")
    DO UPDATE SET "lastSeq" = "warehouse_slip_counters"."lastSeq" + 1, "updatedAt" = NOW()
    RETURNING "lastSeq"
  `;
  return formatSlipCode(kind, day, row.lastSeq);
}
