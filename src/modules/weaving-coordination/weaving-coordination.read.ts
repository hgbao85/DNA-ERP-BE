import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';

type Db = PrismaServiceType | PrismaTx;

/** Đã gửi / đã trả của đúng 1 dòng (điểm đan, lệnh, mảnh) - từ weaving_issues / weaving_receipts có sẵn (không nhập lại). */
export async function weavingRowSums(
  db: Db,
  productionOrderId: bigint,
  pieceId: bigint,
  weavingPointId: bigint,
): Promise<{ sent: number; returned: number; held: number }> {
  const where = { productionOrderId, pieceId, weavingPointId };
  const [issued, received] = await Promise.all([
    db.weavingIssue.aggregate({ where, _sum: { qty: true } }),
    db.weavingReceipt.aggregate({ where, _sum: { qty: true } }),
  ]);
  const sent = issued._sum.qty ?? 0;
  const returned = received._sum.qty ?? 0;
  return { sent, returned, held: Math.max(0, sent - returned) };
}

/** Tổng số mảnh 1 điểm đan đang giữ (mọi lệnh, mọi mảnh) - Đ3 "không ngừng điểm đan còn giữ hàng". */
export async function weavingPointHeld(db: Db, weavingPointId: bigint): Promise<number> {
  const where = { weavingPointId };
  const [issued, received] = await Promise.all([
    db.weavingIssue.aggregate({ where, _sum: { qty: true } }),
    db.weavingReceipt.aggregate({ where, _sum: { qty: true } }),
  ]);
  return Math.max(0, (issued._sum.qty ?? 0) - (received._sum.qty ?? 0));
}

/** Ngày 'YYYY-MM-DD' của cột @db.Date (Prisma trả Date lúc 00:00 UTC). */
export const dbDayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Ngày 'YYYY-MM-DD' -> giá trị ghi vào cột @db.Date. */
export const dayToDbDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
