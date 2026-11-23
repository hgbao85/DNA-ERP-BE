import { ReservationStatus, StockReservationRefType } from '../../generated/prisma/client';
import type { PrismaServiceType } from '../../prisma/prisma.service';
import { WorkshopWarehouseResolver } from '../stock/workshop-warehouse.util';

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
 * CS2 (anh Nhân 20/11/2026): cây lẻ đang có KHẢ DỤNG ở ĐÚNG kho Phôi của xưởng làm lệnh, kèm SỐ CÂY. Trả
 * `Map<materialId (chuỗi), [{ length, count }] tăng dần theo chiều dài>`; loại sắt không có cây lẻ nào thì KHÔNG có khoá.
 * Không biết xưởng (`workshopId` null) -> rỗng (không biết kho nào là "đúng kho").
 *
 * Trước 20/11: lấy chiều dài có >= 1 cây ở kho Phôi của MỌI xưởng và đưa vào danh sách chiều dài MUA (không giới hạn số cây) -
 * 1 cây lẻ ở xưởng kia kéo cả lệnh sang chiều dài lẻ rồi đề xuất mua cả lô chiều dài đó (mục CS2 rà soát 18/11).
 *
 * Khả dụng = tồn - giữ chỗ còn hiệu lực của đúng (kho, vật tư, chiều dài, quy cách) (StockReservation ACTIVE: quantity -
 * consumedQty). Giữ chỗ chuyển kho (WarehouseTransferReservation) không có chiều dài nên - đúng như getAvailableQty - trừ vào MỌI
 * chiều dài của (kho, vật tư, quy cách) đó. Số cây = phần nguyên của khả dụng; chiều dài lọc theo `isUsableStockLength` (nơi
 * gọi tự bỏ chiều dài đang mua của từng loại sắt).
 *
 * Review Sang 21/11:
 *   - Đọc ĐÚNG kho mà approve() sẽ đọc/giữ chỗ (kho mặc định của vật tư qua WorkshopWarehouseResolver theo xưởng) và chỉ ô quy cách
 *     rỗng (sắt không mang quy cách; approve() chỉ đọc ô này) - trước đây cộng mọi kho Phôi của xưởng + mọi quy cách nên xưởng có 2
 *     kho Phôi / cây lẻ có quy cách thì duyệt báo 409 "Tính lại" lặp mãi.
 *   - `excludeCuttingProposalIds`: giữ chỗ của các phương án cũ cùng lệnh sẽ bị thay khi duyệt phương án này (approve() nhả
 *     trước khi tính khả dụng) - KHÔNG trừ, nếu không "Tính lại" bỏ qua cây lẻ của chính lệnh rồi nhả ra và mua thêm cây mới.
 *
 * Gộp truy vấn (không N+1 theo ô tồn). Hàm này CÓ THỂ ném lỗi DB / thiếu kho - nơi gọi phải bắt và tính như không có cây lẻ
 * (lỗi đọc tồn không được làm hỏng lượt tính).
 */
export async function loadAvailableStockLengths(
  prisma: PrismaServiceType,
  materialIds: bigint[],
  filter: StockLengthFilter,
  workshopId: bigint | null,
  opts: { excludeCuttingProposalIds?: bigint[] } = {},
): Promise<Map<string, Array<{ length: number; count: number }>>> {
  const result = new Map<string, Array<{ length: number; count: number }>>();
  if (materialIds.length === 0 || workshopId == null) return result;

  // Kho của từng loại sắt cho xưởng này - đúng cách approve() tra (Material.warehouse -> resolve theo xưởng).
  const materials = await prisma.material.findMany({
    where: { id: { in: materialIds } },
    select: {
      id: true,
      warehouse: { select: { id: true, code: true, kind: true, workshopId: true } },
    },
  });
  const resolver = new WorkshopWarehouseResolver(prisma);
  const warehouseByMaterial = new Map<string, bigint>();
  for (const m of materials) {
    if (!m.warehouse) continue;
    warehouseByMaterial.set(m.id.toString(), (await resolver.resolve(m.warehouse, workshopId)).id);
  }
  if (warehouseByMaterial.size === 0) return result;
  const warehouseIds = [...new Set(warehouseByMaterial.values())];
  const excluded = (opts.excludeCuttingProposalIds ?? []).map((id) => id.toString());

  const [quants, reservations, transferReservations] = await Promise.all([
    prisma.stockQuant.findMany({
      where: {
        warehouseId: { in: warehouseIds },
        materialId: { in: materialIds },
        stockLengthMm: { gt: 0 },
        spec: '',
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
        spec: '',
        ...(excluded.length > 0
          ? { NOT: { refType: StockReservationRefType.CUTTING_PROPOSAL, refId: { in: excluded } } }
          : {}),
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
        spec: '',
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
    // Chỉ kho của chính loại sắt này (2 loại sắt có thể thuộc 2 kho khác nhau trong cùng warehouseIds).
    if (warehouseByMaterial.get(q.materialId.toString()) !== q.warehouseId) continue;
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

  const countByMaterial = new Map<string, Map<number, number>>();
  for (const [key, b] of buckets) {
    if (!isUsableStockLength(b.stockLengthMm, filter)) continue;
    const available =
      b.onHand -
      (reservedByBucket.get(key) ?? 0) -
      (transferHeld.get(`${b.warehouseId}|${b.materialId}|${b.spec}`) ?? 0);
    const bars = Math.floor(available + 1e-9);
    if (bars < 1) continue;
    const id = b.materialId.toString();
    const byLen = countByMaterial.get(id) ?? new Map<number, number>();
    byLen.set(b.stockLengthMm, (byLen.get(b.stockLengthMm) ?? 0) + bars);
    countByMaterial.set(id, byLen);
  }
  for (const [id, byLen] of countByMaterial) {
    result.set(
      id,
      [...byLen].sort((a, b) => a[0] - b[0]).map(([length, count]) => ({ length, count })),
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
