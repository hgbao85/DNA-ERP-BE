/**
 * Phép tính trần "theo hàng đã nhận" của cổng báo Hàn / Sơn (giao nhận giữa tổ, 24/11/2026 - docs
 * THIET-KE-GIAO-NHAN-GIUA-TO mục 3.3b). Hàm thuần (không đọc DB) để test riêng; StageHandoverService nạp số rồi gọi.
 *
 * Mảnh làm từ ĐOẠN (Hàn; Sơn với mảnh không qua Hàn): đoạn giao theo LỆNH + MÃ ĐOẠN, không theo mảnh - 1 mã đoạn có thể dùng cho
 * nhiều mảnh / nhiều SKU của lệnh. Nên tính theo "kho đoạn đã nhận" của (lệnh, tổ):
 *   còn(mã) = đã nhận qua phiếu (ISSUED) + QLSX mở chặn quy ra đoạn - đã làm (Σ số báo mọi trạng thái × định mức đoạn / mảnh)
 *   còn theo mảnh = min theo các mã đoạn của mảnh ⌊còn(mã) / định mức⌋
 * "Đã làm" lấy số báo của lô theo cách cổng kế hoạch đang đếm (lô KCS chấm xong đã ghi đè = số đạt): mảnh KCS chấm lỗi (làm lại)
 * và số ghi thiếu tự được báo bù mà không cần nhận thêm - đúng câu "làm lại do KCS không cần nhận thêm". Lô OPEN / chờ KCS đếm 1
 * lần ở đây (chưa trừ đoạn trong kho) nên không đếm đôi với phần đã trừ tồn.
 *
 * Mảnh đã hàn giao cho Sơn (FRAME): theo (SKU, mảnh) - còn = đã nhận (phiếu FRAME_HANDOVER đã xuất + phiếu chuyển kho vào kho Sơn đã
 * xác nhận) + mở chặn - đã báo Sơn.
 */

const EPS = 1e-9;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4 + 0;

/** 1 (SKU, mảnh) dùng đoạn: định mức đoạn / mảnh theo mã đoạn (khoá segmentCodeKey). */
export interface SegmentPieceInput {
  /** `${productionOrderId}:${pieceId}` */
  key: string;
  /** Σ số báo của (SKU, mảnh, tổ) - mọi trạng thái lô. */
  usedQty: number;
  /** Σ số mảnh QLSX mở chặn cho (SKU, mảnh, tổ). */
  overrideQty: number;
  /** mã đoạn -> số đoạn / mảnh (> 0). */
  qtyPerPieceByCode: Map<string, number>;
}

export interface PieceReceivedCap {
  /** Số mảnh tương ứng đã nhận (= đã làm + còn) - để hiện "Đã nhận N · đã làm M · còn K". */
  receivedQty: number;
  usedQty: number;
  /** Còn báo được theo hàng đã nhận (kể cả phần mở chặn). */
  receivedLeft: number;
  overrideQty: number;
}

export interface SegmentPoolRow {
  receivedQty: number;
  overrideQty: number;
  usedQty: number;
  leftQty: number;
}

/**
 * Đợt 2 lượt 1 (chốt 28/11/2026, cách a): QLSX mở chặn là "ỨNG TRƯỚC" hàng chưa có phiếu - phiếu giao xác nhận SAU lần mở chặn trả dần
 * phần đã ứng (quy ước: mở chặn bao nhiêu thì kho lập phiếu bù bấy nhiêu). Trước đây phiếu bù cộng thêm vào mở chặn -> công nhân báo
 * lố đúng bằng số đã mở chặn. Trả phần ứng trước CHƯA được phiếu trả. Cùng thời điểm: ứng trước tính trước, phiếu trả sau.
 */
export function outstandingAdvance(
  events: readonly { at: Date; advance?: number; receipt?: number }[],
): number {
  const sorted = [...events].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || (b.advance ?? 0) - (a.advance ?? 0),
  );
  let loan = 0;
  for (const e of sorted) {
    if (e.advance) loan = round4(loan + e.advance);
    if (e.receipt) loan = round4(Math.max(0, loan - e.receipt));
  }
  return loan;
}

/**
 * Kho đoạn đã nhận của (lệnh, tổ) theo mã đoạn: nhận + mở chặn quy đoạn - đã làm (có thể âm khi dữ liệu cũ làm trước khi bật).
 * `advanceLeftByCode` (lượt 1, 28/11/2026): phần mở chặn CÒN LẠI theo mã đoạn sau khi phiếu sau đó đã trả (outstandingAdvance) -
 * có thì dùng thay cho Σ mở chặn × định mức.
 */
export function segmentPool(
  pieces: readonly SegmentPieceInput[],
  receivedByCode: ReadonlyMap<string, number>,
  advanceLeftByCode?: ReadonlyMap<string, number>,
): Map<string, SegmentPoolRow> {
  const pool = new Map<string, SegmentPoolRow>();
  const rowOf = (code: string): SegmentPoolRow => {
    let r = pool.get(code);
    if (!r) {
      r = { receivedQty: receivedByCode.get(code) ?? 0, overrideQty: 0, usedQty: 0, leftQty: 0 };
      pool.set(code, r);
    }
    return r;
  };
  for (const code of receivedByCode.keys()) rowOf(code);
  for (const p of pieces) {
    for (const [code, q] of p.qtyPerPieceByCode) {
      const r = rowOf(code);
      r.usedQty = round4(r.usedQty + p.usedQty * q);
      r.overrideQty = round4(r.overrideQty + p.overrideQty * q);
    }
  }
  for (const [code, r] of pool) {
    if (advanceLeftByCode) r.overrideQty = advanceLeftByCode.get(code) ?? 0;
    r.leftQty = round4(r.receivedQty + r.overrideQty - r.usedQty);
  }
  return pool;
}

/** Trần theo hàng đã nhận cho từng (SKU, mảnh) dùng đoạn. Mảnh không có định mức đoạn -> không có trong kết quả (không chặn). */
export function segmentPieceCaps(
  pieces: readonly SegmentPieceInput[],
  receivedByCode: ReadonlyMap<string, number>,
  advanceLeftByCode?: ReadonlyMap<string, number>,
): Map<string, PieceReceivedCap> {
  const pool = segmentPool(pieces, receivedByCode, advanceLeftByCode);
  const out = new Map<string, PieceReceivedCap>();
  for (const p of pieces) {
    if (p.qtyPerPieceByCode.size === 0) continue;
    let left = Number.POSITIVE_INFINITY;
    for (const [code, q] of p.qtyPerPieceByCode) {
      if (!(q > 0)) continue;
      const avail = pool.get(code)?.leftQty ?? 0;
      left = Math.min(left, Math.floor(avail / q + EPS));
    }
    if (!Number.isFinite(left)) continue;
    const receivedLeft = Math.max(0, left);
    out.set(p.key, {
      receivedQty: p.usedQty + receivedLeft,
      usedQty: p.usedQty,
      receivedLeft,
      overrideQty: p.overrideQty,
    });
  }
  return out;
}

/** Trần theo hàng đã nhận cho (SKU, mảnh) Sơn nhận mảnh đã hàn. */
export function framePieceCap(input: {
  receivedQty: number;
  overrideQty: number;
  usedQty: number;
}): PieceReceivedCap {
  return {
    receivedQty: input.receivedQty + input.overrideQty,
    usedQty: input.usedQty,
    receivedLeft: Math.max(0, Math.floor(input.receivedQty + input.overrideQty - input.usedQty)),
    overrideQty: input.overrideQty,
  };
}

/** Số báo được lần tới = min(còn theo kế hoạch, còn theo hàng đã nhận). receivedLeft null = cổng nhận không áp dụng. */
export function effectiveMaxNow(maxNow: number, receivedLeft: number | null | undefined): number {
  if (receivedLeft == null) return maxNow;
  return Math.max(0, Math.min(maxNow, receivedLeft));
}
