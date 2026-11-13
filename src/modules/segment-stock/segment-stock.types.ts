import type { StockLedgerRefType } from '../../generated/prisma/client';
import type { SegmentCodeRef } from '../../common/utils/segment-code.util';

/**
 * Hợp đồng chung của tồn đoạn kho Phôi theo lệnh (13/11/2026). "Lệnh" = ProductionInvoice (LSX) - đoạn giữ theo CẢ lệnh, không
 * theo từng SKU: mọi SKU của 1 lệnh cùng 1 xưởng / 1 kho Phôi, và "Sửa SKU đợt" chỉ đổi SKU trong cùng lệnh nên không làm đổi
 * tồn đoạn. Số lượng là số đoạn (number, nguyên trong thực tế; DB Decimal(16,4)).
 *
 * Mô hình 1 ô tồn (kho Phôi, mã đoạn):
 *   tồn       = stock_quant.qty (trigger cộng / trừ từ stock_ledger)
 *   còn giữ   = Σ (reservedQty - consumedQty) của mọi lệnh trong segment_reservations
 *   dư        = tồn - còn giữ   (cột "dư" chung của xưởng, chia cho lệnh sau)
 */

/** Số ĐÍCH phía cộng của 1 lệnh cho 1 mã đoạn - SegmentProductionService tính, SegmentStockService.syncOrderProduction ghi. */
export interface SegmentTarget extends SegmentCodeRef {
  /** Đoạn đủ công đoạn + KCS đạt tính cho lệnh, trần = số cần của lệnh. */
  heldQty: number;
  /** Đoạn đủ công đoạn + KCS đạt vượt số cần của lệnh -> vào cột dư. */
  surplusQty: number;
}

export interface SyncOrderProductionInput {
  productionInvoiceId: bigint;
  /** Kho Phôi của xưởng làm lệnh (WorkshopWarehouseResolver.phoiWarehouseOfPi) - dùng cho mã đoạn chưa có dòng
   *  SegmentProduction. Mã đoạn đã có dòng thì ghi tiếp vào đúng kho của dòng đó (đổi xưởng do phía chuyển đoạn xử lý). */
  warehouseId: bigint;
  /** ĐỦ mọi mã đoạn của lệnh. Mã đoạn đã ghi trước đây mà không có ở đây = đích 0 / 0 (vd sửa định mức bỏ dòng). Lệnh đã kết
   *  thúc thì KHÔNG gọi hàm này (SegmentProductionService chặn): phần còn giữ đã nhả về dư (releaseOrderHoldings), KCS cũng không
   *  chạy được trên lệnh đã kết thúc (assertPiHasActiveFloor). */
  targets: SegmentTarget[];
  actorId?: string | null;
  /** Nguồn lần tính, ghi vào note bút toán + nhật ký (vd 'QC_CUT_BUNDLE:12', 'ADMIN_RECOMPUTE'). */
  reason: string;
}

export interface SegmentQtyPair {
  heldQty: number;
  surplusQty: number;
}

export interface SegmentSyncChange extends SegmentCodeRef {
  warehouseId: bigint;
  /** Đã ghi trước lần này (SegmentProduction). */
  before: SegmentQtyPair;
  /** Đích lần này. */
  target: SegmentQtyPair;
  /** Đã ghi sau lần này (= target nếu đủ tồn để giảm). */
  after: SegmentQtyPair;
  /** Số đoạn ghi sổ kho lần này: dương = PRODUCTION -> kho Phôi, âm = kho Phôi -> PRODUCTION, 0 = không ghi. */
  ledgerQty: number;
  /** Phần giảm CHƯA ghi được vì tồn không âm (lệnh đã dùng hết phần giữ / dư đã chia cho lệnh khác). 0 = khớp đích. */
  unappliedHeldQty: number;
  unappliedSurplusQty: number;
}

export interface SyncOrderProductionResult {
  productionInvoiceId: bigint;
  /** Chỉ các mã đoạn có thay đổi (before khác target). */
  changes: SegmentSyncChange[];
}

/** Phía trừ (phần của Bảo nối vào): lệnh dùng đoạn. */
export interface ConsumeForOrderInput extends SegmentCodeRef {
  warehouseId: bigint;
  productionInvoiceId: bigint;
  qty: number;
  /** Mặc định SEGMENT_CONSUME. */
  ledgerRefType?: StockLedgerRefType;
  /** refId của bút toán (vd ProductionBatch.id). */
  refId: string;
  /** Có thì gọi lại cùng khoá không trừ lần 2 (trả duplicate = true). */
  idempotencyKey?: string;
  note?: string;
  actorId?: string | null;
}

export interface ConsumeForOrderResult {
  /** Đã trừ thật (ghi sổ kho) = fromHeldQty + fromSurplusQty. */
  takenQty: number;
  fromHeldQty: number;
  /** Lấy từ cột dư của xưởng (chia dư lúc dùng) - ghi nhật ký SURPLUS_IN cho lệnh. */
  fromSurplusQty: number;
  /** Phần thiếu: KHÔNG ghi sổ (tồn không âm) - phía trừ ghi sổ báo vượt. */
  shortageQty: number;
  /** idempotencyKey đã dùng - không làm gì thêm, các số còn lại = 0. */
  duplicate: boolean;
}

/** Chia dư chủ động cho 1 lệnh (vd QLSX gán đoạn dư cho lệnh sau). */
export interface AllocateSurplusInput extends SegmentCodeRef {
  warehouseId: bigint;
  productionInvoiceId: bigint;
  qty: number;
  actorId?: string | null;
  refType?: string;
  refId?: string;
  note?: string;
}

export interface AllocateSurplusResult {
  /** Số đã chia (<= qty, <= dư hiện có). */
  allocatedQty: number;
  /** Dư còn lại của ô sau khi chia. */
  remainingSurplusQty: number;
}

export interface ReleaseOrderHoldingsInput {
  productionInvoiceId: bigint;
  actorId?: string | null;
  /** vd 'PI_FINISHED'. */
  reason: string;
}

export interface ReleaseOrderHoldingsResult {
  /** Tổng số đoạn còn giữ đã nhả về dư. */
  releasedQty: number;
  /** Số dòng giữ đoạn có nhả. */
  reservationCount: number;
}
