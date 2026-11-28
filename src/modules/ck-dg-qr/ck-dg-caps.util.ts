import {
  CancelledGoodsKind,
  TransferCheckBatchStatus,
  TransferStatus,
} from '../../generated/prisma/client';
import { WOVEN_TRANSFER_RECEIVED } from '../woven-stock/woven-stock.service';
import type { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { PIECE_TRANSFER_LEAVES_FRAME } from '../warehouse-transfers/transfer-routes.constant';

/**
 * Trần của Chuyền kiểm / Đóng gói bằng quét QR (24/11/2026, docs THIET-KE-CHUYEN-KIEM-DONG-GOI-QR C3, D2). Phần thuần (không DB)
 * để test dễ + phần đọc DB nhận `db` (prisma hoặc tx) làm tham số - cùng idiom kcs-pending.util.ts.
 */

/** Khoá (SKU, mảnh) dùng CHUNG với ProductionInvoicesService.recordTransferCheck (L4 16/11) - 2 đường ghi không vượt nhau. */
export const transferCheckLockKey = (itemId: bigint, pieceId: bigint): string =>
  `transfer-check:${itemId}:${pieceId}`;

/** Khoá theo SKU dùng CHUNG với ProductionInvoicesService.recordPackaging (L4 16/11). */
export const packagingLockKey = (itemId: bigint): string => `packaging:${itemId}`;

/** Số đã "chiếm" Hiện có của 1 (SKU, mảnh). */
export interface TransferCheckUsage {
  /** Σ TransferCheckResult.checkedQty - nhập tay cũ + phần đạt KCS chuyền kiểm đã chấm. */
  checkedQty: number;
  /** Σ (đạt + lỗi) của đợt công nhân báo còn chờ KCS chuyền kiểm. */
  pendingQty: number;
  /** Σ phần KCS chuyền kiểm chấm "bỏ" (hàng hỏng vẫn nằm trong Hiện có nhưng không kiểm lại được). */
  scrapQty: number;
}

/**
 * C3: số còn báo được = Hiện có − (đã kiểm + đang chờ KCS + đã bỏ). Phần KCS chấm "làm lại" KHÔNG chiếm - sửa xong công nhân báo
 * lại như hàng mới. Không âm.
 */
export function transferCheckAvailable(readyQty: number, usage: TransferCheckUsage): number {
  return Math.max(0, readyQty - usage.checkedQty - usage.pendingQty - usage.scrapQty);
}

/**
 * Số BỘ (sản phẩm) đã qua chuyền kiểm, ĐỒNG BỘ mọi mảnh của định mức: 1 bộ chỉ tính khi đủ mọi mảnh - cùng công thức
 * PackagingIssuesService.resolveCheckedUnits (trần xuất vật tư đóng gói). Định mức rỗng = 0.
 */
export function setsPassed(
  bomPieces: readonly { pieceId: bigint; qtyPerUnit: number }[],
  checkedByPiece: ReadonlyMap<string, number>,
): number {
  if (bomPieces.length === 0) return 0;
  return Math.min(
    ...bomPieces.map((bp) =>
      Math.floor((checkedByPiece.get(bp.pieceId.toString()) ?? 0) / bp.qtyPerUnit),
    ),
  );
}

/** D2: số bộ còn đóng được = min(đã qua KCS chuyền kiểm, số lượng lệnh) − đã đóng. Không âm. */
export function packingAvailable(input: {
  orderQty: number;
  setsPassed: number;
  packedQty: number;
}): number {
  return Math.max(0, Math.min(input.setsPassed, input.orderQty) - input.packedQty);
}

/** Kết quả KCS chuyền kiểm nhập cho 1 đợt. */
export interface KcsGradeInput {
  passedQty: number;
  reworkQty: number;
  /** Câu 9a (25/11/2026): chỉ còn nhận 0 - FE cũ có thể vẫn gửi 0. */
  scrapQty: number;
}

/**
 * Kiểm số KCS chuyền kiểm chấm (cùng ngữ nghĩa KCS Phôi / Hàn / Sơn: đạt thật không quá số báo đạt, phần còn lại là lỗi chia làm
 * lại / bỏ). Trả câu lỗi (tiếng Việt) hoặc null. `kcsExtraDefect` = số báo đạt mà KCS chấm lỗi (cần nguyên nhân).
 */
export function validateKcsGrade(
  reported: { passedQty: number; defectQty: number },
  grade: KcsGradeInput,
): string | null {
  const { passedQty, reworkQty, scrapQty } = grade;
  if ([passedQty, reworkQty, scrapQty].some((n) => !Number.isInteger(n) || n < 0)) {
    return 'Số đạt / làm lại phải là số nguyên không âm';
  }
  // Câu 9 (chốt 20/11 + 25/11/2026, phương án a): KCS chuyền kiểm không còn chấm 'bỏ' - hỏng thì chấm 'làm lại', người phụ trách đan
  // mang trả điểm đan sửa rồi báo lại. Cột kcsScrapQty giữ cho đợt cũ đã chấm bỏ (vẫn chiếm 'Hiện có' như trước).
  if (scrapQty > 0) {
    return 'KCS chuyền kiểm không còn chấm "bỏ" - hàng hỏng chấm "làm lại" để trả điểm đan / tổ sửa';
  }
  if (passedQty > reported.passedQty) {
    return `Số đạt KCS (${passedQty}) không được vượt số công nhân báo đạt (${reported.passedQty})`;
  }
  const total = reported.passedQty + reported.defectQty;
  if (passedQty + reworkQty !== total) {
    return `Đạt (${passedQty}) + làm lại (${reworkQty}) phải bằng số công nhân báo (${total})`;
  }
  return null;
}

export const kcsExtraDefect = (reportedPassed: number, kcsPassed: number): number =>
  Math.max(0, reportedPassed - kcsPassed);

// ─── Đọc DB ─────────────────────────────────────────────────────────────────────────────────

type Db = Pick<
  PrismaTx,
  | 'transferCheckResult'
  | 'transferCheckBatch'
  | 'weavingReceipt'
  | 'warehouseTransferPieceItem'
  | 'cancelledGoodsTransfer'
>;

/** Phần đợt QR đang chiếm của (SKU, mảnh): chờ KCS (đạt + lỗi) và đã bỏ. Dùng cả ở recordTransferCheck khi bật công tắc. */
export async function loadBatchReservations(
  db: Pick<PrismaTx, 'transferCheckBatch'>,
  itemId: bigint,
  pieceId: bigint,
): Promise<{ pendingQty: number; scrapQty: number }> {
  const [pending, done] = await Promise.all([
    db.transferCheckBatch.aggregate({
      where: {
        productionInvoiceItemId: itemId,
        pieceId,
        status: TransferCheckBatchStatus.AWAITING_KCS,
      },
      _sum: { passedQty: true, defectQty: true },
    }),
    db.transferCheckBatch.aggregate({
      where: {
        productionInvoiceItemId: itemId,
        pieceId,
        status: TransferCheckBatchStatus.KCS_DONE,
      },
      _sum: { kcsScrapQty: true },
    }),
  ]);
  return {
    pendingQty: (pending._sum.passedQty ?? 0) + (pending._sum.defectQty ?? 0),
    scrapQty: done._sum.kcsScrapQty ?? 0,
  };
}

/**
 * "Hiện có" của 1 mảnh - cùng nguồn recordTransferCheck: mảnh đan = Σ nhập đan về + khung đã đan lấy từ SKU huỷ (đã nhận), mảnh
 * không đan = Σ phiếu chuyển kho CONFIRMED. Lỗi 5 (nghiệp vụ báo 28/11): trước chỉ cộng nhập đan nên quét QR chuyền kiểm báo vượt
 * (0) với khung lấy từ SKU huỷ, trong khi màn thủ kho (recordTransferCheck) đếm đúng.
 */
export async function loadReadyQty(
  db: Pick<PrismaTx, 'weavingReceipt' | 'warehouseTransferPieceItem' | 'cancelledGoodsTransfer'>,
  productionOrderId: bigint,
  pieceId: bigint,
  isWoven: boolean,
  itemId: bigint,
): Promise<number> {
  if (isWoven) {
    const [r, t] = await Promise.all([
      db.weavingReceipt.aggregate({
        where: { productionOrderId, pieceId },
        _sum: { qty: true },
      }),
      db.cancelledGoodsTransfer.aggregate({
        where: {
          targetItemId: itemId,
          pieceId,
          kind: CancelledGoodsKind.WOVEN,
          ...WOVEN_TRANSFER_RECEIVED,
        },
        _sum: { qty: true },
      }),
    ]);
    return (r._sum.qty ?? 0) + (t._sum.qty ?? 0);
  }
  const r = await db.warehouseTransferPieceItem.aggregate({
    where: {
      productionOrderId,
      pieceId,
      transfer: { status: TransferStatus.CONFIRMED, ...PIECE_TRANSFER_LEAVES_FRAME },
    },
    _sum: { quantity: true },
  });
  return r._sum.quantity ?? 0;
}

/** Hiện có + phần đã chiếm của 1 (SKU, mảnh) - đọc trong tx dưới khoá transferCheckLockKey khi dùng để chặn. */
export async function loadTransferCheckUsage(
  db: Db,
  input: { itemId: bigint; productionOrderId: bigint; pieceId: bigint; isWoven: boolean },
): Promise<{ readyQty: number; usage: TransferCheckUsage }> {
  const [readyQty, checked, reserved] = await Promise.all([
    loadReadyQty(db, input.productionOrderId, input.pieceId, input.isWoven, input.itemId),
    db.transferCheckResult.aggregate({
      where: { productionInvoiceItemId: input.itemId, pieceId: input.pieceId },
      _sum: { checkedQty: true },
    }),
    loadBatchReservations(db, input.itemId, input.pieceId),
  ]);
  return { readyQty, usage: { checkedQty: checked._sum.checkedQty ?? 0, ...reserved } };
}

/** Số bộ đã qua chuyền kiểm của 1 SKU (đồng bộ mọi mảnh của định mức đã ghim) - xem setsPassed(). */
export async function loadSetsPassed(
  db: Pick<PrismaServiceType | PrismaTx, 'bomPiece' | 'transferCheckResult'>,
  bomRevisionId: bigint,
  itemId: bigint,
): Promise<number> {
  const [bomPieces, checkedSums] = await Promise.all([
    db.bomPiece.findMany({ where: { bomRevisionId }, select: { pieceId: true, qtyPerUnit: true } }),
    db.transferCheckResult.groupBy({
      by: ['pieceId'],
      where: { productionInvoiceItemId: itemId },
      _sum: { checkedQty: true },
    }),
  ]);
  return setsPassed(
    bomPieces,
    new Map(checkedSums.map((r) => [r.pieceId.toString(), r._sum.checkedQty ?? 0])),
  );
}
