/**
 * "Phôi đã đồng bộ (mảnh)" - ƯỚC TÍNH từ số đoạn Phôi đã báo (2026-11-04, changelog-2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md
 * mục 58-59). Hàm THUẦN (không đọc DB) - PieceSyncBoardService tải dữ liệu rồi gọi hàm này cho TỪNG SKU (lệnh SX).
 *
 * Vì sao chỉ là ước tính: Phôi báo cắt/công đoạn theo CỠ ĐOẠN × SKU (CutPatternSegment, StepBatchSegment), không theo mảnh -
 * cùng 1 cỡ đoạn thường dùng cho nhiều mảnh (vd đoạn 436 cho Tay trái và Tay phải), nên phải CHIA số đoạn đã làm cho các mảnh.
 *
 * Cách tính (khớp docs/logic-dong-bo-va-no-dinh-muc.md bên FE: đồng bộ = min, chia lấy phần nguyên):
 *  1. Mỗi dòng định mức (PieceBom) phải qua Cắt + các công đoạn phụ của dòng đó.
 *  2. Mỗi (cỡ đoạn, công đoạn): số đoạn ĐẠT được chia cho các dòng cần công đoạn đó theo nguyên tắc ĐỦ BỘ TRƯỚC, phần dư chia
 *     theo thứ tự dòng trong định mức, mỗi lần đủ 1 mảnh.
 *  3. Số đoạn dùng được của 1 dòng = nhỏ nhất qua các công đoạn của dòng (ước tính lạc quan: không biết đoạn đã dập có trùng
 *     đoạn đã tán không).
 *  4. Mảnh đồng bộ = nhỏ nhất qua các dòng của mảnh ⌊đoạn dùng được ÷ số đoạn/mảnh⌋, chặn trần ở số mảnh cần; mảnh có
 *     Sắt tự tính (vd PAT) thì còn bị chặn bởi số mảnh Phôi tự báo ở Vật tư TP.
 *
 * ĐỦ CÔNG ĐOẠN (changelog-2026-10-08 mục 64, thay "chỉ tính theo Cắt" của mục 61): PieceSyncBoardService truyền processSteps thật của
 * từng dòng định mức và goodBySpecStep có cả khoá ':CAT' lẫn khoá công đoạn phụ. Số đoạn mỗi công đoạn đếm theo
 * PIECE_SYNC_COUNT_MODE (mặc định chỉ đoạn đã ĐẠT KCS) - hàm này không biết cách đếm, chỉ nhận số đã chuẩn bị.
 */
import {
  sortProcessSteps,
  type ProcessStepValue,
} from '../../common/constants/process-steps.constant';

export interface PieceSyncPieceInput {
  pieceId: string;
  /** BomPiece.qtyPerUnit - số mảnh trên 1 bộ (SKU). */
  qtyPerUnit: number;
  /** null = mảnh không có Sắt tự tính (PieceMaterialYield); số = mảnh Phôi đã báo ở Vật tư TP (đạt + chờ KCS + chưa gửi). */
  selfCalcPieceQty: number | null;
}

export interface PieceSyncLineInput {
  /** Khoá duy nhất của dòng trong SKU (PieceBom.id). */
  lineKey: string;
  pieceId: string;
  segmentSpecId: string;
  /** PieceBom.qtyPerPiece - số đoạn trên 1 mảnh. */
  qtyPerPiece: number;
  /** PieceBom.processSteps - công đoạn phụ, thứ tự lưu trong DB có thể lộn xộn; có hay không có 'CAT' đều được. */
  processSteps: ProcessStepValue[];
}

export interface PieceSyncOrderInput {
  /** ProductionOrder.quantity - số bộ của SKU. */
  orderQuantity: number;
  /** Thứ tự hiển thị. */
  pieces: PieceSyncPieceInput[];
  /** Thứ tự dòng trong định mức (quyết định ai nhận phần dư trước). */
  lines: PieceSyncLineInput[];
  /** Số đoạn tính được (theo PIECE_SYNC_COUNT_MODE, ≥ 0) của SKU này, khoá `${segmentSpecId}:${step}`, step gồm cả 'CAT'. Thiếu khoá = 0. */
  goodBySpecStep: Map<string, number>;
}

export interface PieceSyncLineResult {
  lineKey: string;
  /** 'CAT' + công đoạn phụ, theo thứ tự nghiệp vụ (sortProcessSteps). */
  steps: ProcessStepValue[];
  /** Số đoạn chia được cho dòng (đã qua đủ mọi công đoạn của dòng), ≤ số đoạn cần. */
  usableQty: number;
  /** ⌊usableQty ÷ qtyPerPiece⌋. */
  makeablePieces: number;
  /** Công đoạn có số chia ít nhất khi dòng CHƯA đủ (trùng thì công đoạn đứng trước); null khi đã đủ. */
  limitingStep: ProcessStepValue | null;
}

export interface PieceSyncPieceResult {
  pieceId: string;
  /** qtyPerUnit × orderQuantity. */
  requiredQty: number;
  /** null = mảnh không có định mức Phôi (không có dòng PieceBom lẫn Sắt tự tính). */
  phoiSyncedQty: number | null;
  /** Theo thứ tự dòng đầu vào. */
  lines: PieceSyncLineResult[];
}

interface ValidLine {
  line: PieceSyncLineInput;
  steps: ProcessStepValue[];
  /** Số đoạn cần cho 1 bộ = qtyPerPiece × qtyPerUnit của mảnh. */
  perSet: number;
  /** Số đoạn cần cho cả lệnh. */
  need: number;
  /** Số đoạn đã chia, theo công đoạn. */
  alloc: Map<ProcessStepValue, number>;
}

/** Chia số đoạn ĐẠT của 1 (cỡ đoạn, công đoạn) cho các dòng cần nó: đủ bộ trước, phần dư theo thứ tự dòng. */
function allocateGroup(
  group: ValidLine[],
  step: ProcessStepValue,
  good: number,
  orderQty: number,
): void {
  const a = Math.max(0, Math.floor(good));
  const d = group.reduce((sum, g) => sum + g.perSet, 0);
  const k = d > 0 ? Math.min(orderQty, Math.floor(a / d)) : 0;
  for (const g of group) g.alloc.set(step, k * g.perSet);
  let remain = a - k * d;
  if (k >= orderQty) return;
  // Phần dư chỉ cấp theo bội số đủ 1 mảnh, duyệt theo thứ tự dòng để mọi công đoạn cùng dồn vào dòng đầu.
  for (const g of group) {
    const qpp = g.line.qtyPerPiece;
    const given = g.alloc.get(step) ?? 0;
    const extra = Math.min(Math.floor(remain / qpp) * qpp, g.need - given);
    if (extra <= 0) continue;
    g.alloc.set(step, given + extra);
    remain -= extra;
  }
}

export function computePieceSync(input: PieceSyncOrderInput): PieceSyncPieceResult[] {
  const orderQty = Math.max(0, input.orderQuantity);
  const pieceById = new Map(input.pieces.map((p) => [p.pieceId, p]));

  const valid: ValidLine[] = [];
  for (const line of input.lines) {
    const piece = pieceById.get(line.pieceId);
    if (!piece || !(line.qtyPerPiece > 0)) continue;
    const steps = sortProcessSteps(['CAT', ...line.processSteps]);
    const perSet = line.qtyPerPiece * Math.max(0, piece.qtyPerUnit);
    valid.push({ line, steps, perSet, need: perSet * orderQty, alloc: new Map() });
  }

  // Gom nhóm (cỡ đoạn, công đoạn); Map giữ thứ tự chèn nên dòng trong nhóm đúng thứ tự định mức.
  const groups = new Map<string, { step: ProcessStepValue; spec: string; members: ValidLine[] }>();
  for (const v of valid) {
    for (const step of v.steps) {
      const key = `${v.line.segmentSpecId}:${step}`;
      let g = groups.get(key);
      if (!g) {
        g = { step, spec: v.line.segmentSpecId, members: [] };
        groups.set(key, g);
      }
      g.members.push(v);
    }
  }
  for (const [key, g] of groups) {
    allocateGroup(g.members, g.step, input.goodBySpecStep.get(key) ?? 0, orderQty);
  }

  const lineResults = new Map<string, PieceSyncLineResult & { pieceId: string }>();
  for (const v of valid) {
    const allocs = v.steps.map((s) => v.alloc.get(s) ?? 0);
    const usable = Math.min(...allocs);
    const limitingStep = usable < v.need ? (v.steps[allocs.indexOf(usable)] ?? null) : null;
    lineResults.set(v.line.lineKey, {
      pieceId: v.line.pieceId,
      lineKey: v.line.lineKey,
      steps: v.steps,
      usableQty: usable,
      makeablePieces: Math.floor(usable / v.line.qtyPerPiece),
      limitingStep,
    });
  }

  return input.pieces.map((p) => {
    const requiredQty = p.qtyPerUnit > 0 ? p.qtyPerUnit * orderQty : 0;
    const lines: PieceSyncLineResult[] = [];
    for (const v of valid) {
      if (v.line.pieceId !== p.pieceId) continue;
      const { pieceId: _omit, ...r } = lineResults.get(v.line.lineKey)!;
      void _omit;
      lines.push(r);
    }
    const segSync =
      lines.length > 0
        ? Math.min(Math.min(...lines.map((l) => l.makeablePieces)), requiredQty)
        : null;
    const self =
      p.selfCalcPieceQty == null ? null : Math.min(Math.max(0, p.selfCalcPieceQty), requiredQty);
    const phoiSyncedQty = segSync == null ? self : self == null ? segSync : Math.min(segSync, self);
    return { pieceId: p.pieceId, requiredQty, phoiSyncedQty, lines };
  });
}
