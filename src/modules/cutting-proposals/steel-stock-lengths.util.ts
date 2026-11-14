import { ReservationStatus, WarehouseKind } from '../../generated/prisma/client';
import type { PrismaServiceType } from '../../prisma/prisma.service';

/**
 * Bước chiều dài tồn kho là bội số của giá trị này (13/11/2026): cây lẻ kiểu 5873 mm không phải
 * hàng
 * "có sẵn" dùng lại được - chỉ lấy các chiều dài tròn theo bước dò của bộ giải.
 */
export const STOCK_LENGTH_STEP_MM = 50;

/** Dải cho phép + các chiều dài chuẩn (đã có sẵn trong danh sách gửi bộ giải nên không lặp lại). */
export interface StockLengthFilter {
  minMm: number;
  maxMm: number;
  standardLengths: number[];
}

/**
 * 1 chiều dài tồn kho có được đưa vào danh sách thử CÙNG cây chuẩn không: dương, bội 50, nằm trong
 * `[minMm, maxMm]` và khác mọi chiều dài chuẩn.
 */
export function isUsableStockLength(lengthMm: number, filter: StockLengthFilter): boolean {
  return (
    Number.isInteger(lengthMm) &&
    lengthMm > 0 &&
    lengthMm % STOCK_LENGTH_STEP_MM === 0 &&
    lengthMm >= filter.minMm &&
    lengthMm <= filter.maxMm &&
    !filter.standardLengths.includes(lengthMm)
  );
}

/**
 * Danh sách gửi bộ giải cho 1 loại sắt: chiều dài chuẩn trước, chiều dài tồn sau (đã khử trùng).
 */
export function mergeStandardAndStockLengths(standard: number[], stock: number[]): number[] {
  return [...new Set([...standard, ...stock])];
}

/**
 * Số cây còn dùng được của 1 ô tồn sau khi trừ giữ chỗ - bám
 * StockReservationsService.getAvailableQty.
 */
interface QuantBucket {
  warehouseId: bigint;
  materialId: bigint;
  stockLengthMm: number;
  spec: string;
  onHand: number;
}

const bucketKey = (warehouseId: bigint, materialId: bigint, lengthMm: number, spec: string) =>
  `${warehouseId}|${materialId}|${lengthMm}|${spec}`;

/**
 * Chiều dài đang có tồn KHẢ DỤNG ở kho Phôi của MỌI xưởng (13/11/2026, Sếp: chiều dài nào đang có
 * trong kho thì được thử cùng cây chuẩn). Trả `Map<materialId (chuỗi), chiều dài tăng dần>`; loại
 * sắt không
 * có chiều dài nào đạt thì KHÔNG có khoá.
 *
 * Khả dụng = tồn - giữ chỗ còn hiệu lực của đúng (kho, vật tư, chiều dài, quy cách)
 * (StockReservation
 * ACTIVE: quantity - consumedQty). Giữ chỗ chuyển kho (WarehouseTransferReservation) không có chiều
 * dài
 * nên - đúng như getAvailableQty - trừ vào MỌI chiều dài của (kho, vật tư, quy cách) đó. Chỉ cần
 * còn >= 1
 * cây ở BẤT KỲ kho Phôi nào là chiều dài đó vào danh sách.
 *
 * Gộp truy vấn (4 câu, không N+1). Hàm này CÓ THỂ ném lỗi DB - nơi gọi phải bắt và tính như không
 * có
 * chiều dài tồn (lỗi đọc tồn không được làm hỏng lượt tính).
 */
export async function loadAvailableStockLengths(
  prisma: PrismaServiceType,
  materialIds: bigint[],
  filter: StockLengthFilter,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (materialIds.length === 0) return result;

  const warehouses = await prisma.warehouse.findMany({
    where: { kind: WarehouseKind.PHOI, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (warehouses.length === 0) return result;
  const warehouseIds = warehouses.map((w) => w.id);

  const [quants, reservations, transferReservations] = await Promise.all([
    prisma.stockQuant.findMany({
      where: {
        warehouseId: { in: warehouseIds },
        materialId: { in: materialIds },
        stockLengthMm: { gt: 0 },
        qty: { gt: 0 },
      },
      select: { warehouseId: true, materialId: true, stockLengthMm: true, spec: true, qty: true },
    }),
    prisma.stockReservation.findMany({
      where: {
        warehouseId: { in: warehouseIds },
        materialId: { in: materialIds },
        status: ReservationStatus.ACTIVE,
        stockLengthMm: { gt: 0 },
      },
      select: {
        warehouseId: true,
        materialId: true,
        stockLengthMm: true,
        spec: true,
        quantity: true,
        consumedQty: true,
      },
    }),
    prisma.warehouseTransferReservation.findMany({
      where: {
        warehouseId: { in: warehouseIds },
        materialId: { in: materialIds },
        status: ReservationStatus.ACTIVE,
      },
      select: { warehouseId: true, materialId: true, spec: true, quantity: true },
    }),
  ]);

  const reservedByBucket = new Map<string, number>();
  for (const r of reservations) {
    const key = bucketKey(r.warehouseId, r.materialId, r.stockLengthMm, r.spec);
    const held = Math.max(0, r.quantity.toNumber() - r.consumedQty.toNumber());
    reservedByBucket.set(key, (reservedByBucket.get(key) ?? 0) + held);
  }
  const transferHeld = new Map<string, number>();
  for (const r of transferReservations) {
    const key = `${r.warehouseId}|${r.materialId}|${r.spec}`;
    transferHeld.set(key, (transferHeld.get(key) ?? 0) + r.quantity.toNumber());
  }

  const buckets = new Map<string, QuantBucket>();
  for (const q of quants) {
    if (q.materialId == null) continue;
    const key = bucketKey(q.warehouseId, q.materialId, q.stockLengthMm, q.spec);
    const cur = buckets.get(key);
    const onHand = q.qty.toNumber();
    if (cur) cur.onHand += onHand;
    else {
      buckets.set(key, {
        warehouseId: q.warehouseId,
        materialId: q.materialId,
        stockLengthMm: q.stockLengthMm,
        spec: q.spec,
        onHand,
      });
    }
  }

  const lengthsByMaterial = new Map<string, Set<number>>();
  for (const [key, b] of buckets) {
    if (!isUsableStockLength(b.stockLengthMm, filter)) continue;
    const available =
      b.onHand -
      (reservedByBucket.get(key) ?? 0) -
      (transferHeld.get(`${b.warehouseId}|${b.materialId}|${b.spec}`) ?? 0);
    if (available < 1) continue;
    const id = b.materialId.toString();
    const set = lengthsByMaterial.get(id) ?? new Set<number>();
    set.add(b.stockLengthMm);
    lengthsByMaterial.set(id, set);
  }
  for (const [id, set] of lengthsByMaterial) {
    result.set(
      id,
      [...set].sort((a, b) => a - b),
    );
  }
  return result;
}

/**
 * Đọc `SystemConfig.solverMaxSizesPerBarByWorkshop` (JSON `{ [Workshop.code]: số cỡ }`). An toàn:
 * không
 * phải object thì rỗng; giá trị không phải số nguyên 1..10 bị bỏ qua (xưởng đó coi như không có
 * luật riêng).
 */
export function parseMaxSizesPerBarByWorkshop(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10) {
      out[code] = value;
    }
  }
  return out;
}

/**
 * Tên xưởng cho câu lý do: tên đã bắt đầu bằng chữ "Xưởng" thì giữ nguyên, không lặp "Xưởng Xưởng".
 */
export function workshopLabel(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return 'Xưởng';
  return /^xưởng(\s|$)/i.test(trimmed) ? trimmed : `Xưởng ${trimmed}`;
}

/**
 * Ghi chú khi bộ giải phải nới "tối đa N cỡ đoạn/cây" của xưởng; null nếu không nới (limit = start)
 * hoặc
 * request không có luật số cỡ (start null/undefined). limit null = đã bỏ giới hạn.
 */
export function buildSizesRelaxNote(params: {
  workshopName: string | null | undefined;
  start: number | null | undefined;
  limit: number | null | undefined;
  thresholdPct: number | null | undefined;
}): string | null {
  const { start, limit } = params;
  if (start == null || limit === undefined || limit === start) return null;
  const threshold =
    params.thresholdPct != null && Number.isFinite(params.thresholdPct)
      ? `${Number(params.thresholdPct)}%`
      : 'hao hụt cho phép';
  return (
    `${workshopLabel(params.workshopName)} tối đa ${start} cỡ đoạn/cây: không đạt ngưỡng ${threshold} nên ` +
    (limit == null ? 'bỏ giới hạn số cỡ' : `nới lên ${limit} cỡ`)
  );
}
