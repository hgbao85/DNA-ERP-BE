/**
 * Phần A – Đợt 9 (YC2): sửa kế hoạch (mốc) ở mọi giai đoạn + Excel + Sếp duyệt lại - HỢP ĐỒNG dữ liệu BE ⇄ FE (FE chép ở
 * `src/services/deadline-changes-api.ts`). Thiết kế: plan mục 5b.
 *
 * Luật (v8 YC2 2.1–2.4): chỉ sửa NGÀY MỐC (không số lượng, KHÔNG hạn giao với dòng đã duyệt); dòng SKU chưa APPROVED → ghi thẳng như cũ;
 * dòng APPROVED → yêu cầu trong 1 lô chờ Sếp duyệt lại (mốc cũ vẫn chạy tới khi Sếp duyệt); dòng có lệnh Kết thúc / PI huỷ → lỗi; mỗi dòng
 * tối đa 1 yêu cầu PENDING; chỉ KHSX (+ Admin) sửa / tải Excel; Sếp duyệt.
 *
 * Sếp trả lời 4 câu ngày 06/11 (file `docs/cau-hoi-sep-dot-9-sua-ke-hoach-2026-11-05.docx`) - phần 2:
 *  Q9-1 = B: dời 1 mốc SẢN XUẤT thì các mốc sản xuất SAU nó tự dời cùng số ngày (`resolveAutoShift` ở deadline-values.util.ts); 2 mốc Mua VT
 *        và hạn giao không tự dời; KHSX vẫn sửa tay lại từng mốc được.
 *  Q9-2 = B: thứ tự mốc ngược = LỖI, không cho lưu dòng đó (`ORDER_VIOLATION_BLOCKS = true`, cả dòng sửa thẳng).
 *  Q9-3 = ý kiến khác: Excel CHỈ gồm lệnh CHƯA BẮT ĐẦU SẢN XUẤT (chưa cắt phôi) - cả chưa duyệt lẫn đã duyệt mà chưa cắt. Lệnh đã bắt đầu
 *        (lệnh SX `floorStage` ≠ PENDING, QLSX đã bấm "Bắt đầu") KHÔNG được sửa mốc ở mọi đường (form, Excel, Sếp duyệt).
 *  Q9-4 = B: Sếp bỏ chọn từng yêu cầu trong lô (đã làm ở phần 1).
 *
 * Ngày luôn là ngày VN 'YYYY-MM-DD'.
 */

/** Q9-2 (Sếp chọn B): true = thứ tự mốc ngược là LỖI (chặn dòng); false = chỉ cảnh báo. */
export const ORDER_VIOLATION_BLOCKS = true;

/** Các mốc sửa được, ĐÚNG thứ tự cột Excel / form (Phú An). Hạn giao KHÔNG nằm ở đây (2.4). */
export const DEADLINE_FIELDS = [
  { key: 'materialDeadline', label: 'Mua VT khung & đan' },
  { key: 'stage.PHOI_START', label: 'Bắt đầu Phôi' },
  { key: 'stage.FRAME_PHOI', label: 'Phôi' },
  { key: 'stage.FRAME_HAN', label: 'Hàn' },
  { key: 'stage.FRAME_SON', label: 'Sơn' },
  { key: 'stage.FRAME', label: 'Khung' },
  { key: 'stage.WEAVING', label: 'Nhập đan' },
  { key: 'stage.TRANSFER_CHECK', label: 'Chuyền kiểm' },
  { key: 'finishedMaterialDeadline', label: 'Mua VT còn lại' },
  { key: 'stage.PACKAGING_START', label: 'Bắt đầu đóng gói' },
  { key: 'stage.PACKAGING', label: 'Đóng gói' },
] as const;

export type DeadlineFieldKey = (typeof DEADLINE_FIELDS)[number]['key'];
/** Giá trị mốc theo khoá - chỉ chứa khoá có mặt; null = chưa có mốc. */
export type DeadlineValues = Partial<Record<DeadlineFieldKey, string | null>>;

export interface DeadlineFieldChange {
  key: DeadlineFieldKey;
  label: string;
  from: string | null;
  to: string | null;
  /** Q9-1: true = mốc TỰ DỜI theo mốc sản xuất phía trước (không phải ô KHSX gõ). Chỉ bản xem trước Excel gắn; vắng = KHSX gõ. */
  auto?: boolean;
}

export type DeadlineChangeSource = 'MANUAL' | 'EXCEL';
/** Lô: PENDING còn yêu cầu chờ · DECIDED Sếp đã quyết hết (duyệt / từ chối từng yêu cầu) · CANCELLED KHSX huỷ hết. */
export type DeadlineChangeBatchStatus = 'PENDING' | 'DECIDED' | 'CANCELLED';
export type DeadlineChangeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface UserRef {
  id: string;
  name: string;
}

export interface DeadlineChangeRequestDto {
  id: string;
  itemId: string;
  piId: string;
  /** Mã lệnh của dòng SKU (số LSX, chưa có thì mã lệnh của PI) - không hiện mã PI. */
  lenhCode: string;
  skuCode: string;
  skuName: string | null;
  quantity: number;
  status: DeadlineChangeRequestStatus;
  oldValues: DeadlineValues;
  newValues: DeadlineValues;
  /** Chỉ các mốc thật sự đổi, theo thứ tự DEADLINE_FIELDS. */
  changes: DeadlineFieldChange[];
  /** Cảnh báo trên giá trị MỚI (vd thứ tự mốc ngược) - tính lúc đọc. */
  warnings: string[];
  /** Lý do khi REJECTED (= decisionNote của lô). */
  rejectReason: string | null;
  /**
   * Q9-3: yêu cầu PENDING mà Sếp KHÔNG duyệt được nữa (tính lúc đọc) - lệnh đã bắt đầu sản xuất (cắt phôi) / Kết thúc / huỷ. Có giá trị → FE
   * khoá ô chọn, chỉ từ chối được (BE `decide` cũng chặn). null = duyệt được (hoặc yêu cầu không còn PENDING).
   */
  blockedReason: string | null;
}

export interface DeadlineChangeBatchDto {
  id: string;
  source: DeadlineChangeSource;
  status: DeadlineChangeBatchStatus;
  requestedBy: UserRef;
  requestedAt: string;
  decidedBy: UserRef | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** Ghi chú KHSX lúc gửi (vd tên file Excel). */
  note: string | null;
  counts: { total: number; pending: number; approved: number; rejected: number; cancelled: number };
  requests: DeadlineChangeRequestDto[];
}

/** 1 dòng nhập (form hoặc Excel): mốc mới của 1 dòng SKU. `expectedOld` (Excel) = giá trị lúc xuất file - khác hiện tại thì lỗi (V9-1). */
export interface DeadlineEntryInput {
  itemId: string;
  newValues: DeadlineValues;
  expectedOld?: DeadlineValues;
}

export type DeadlineEntryKind = 'APPLY' | 'NEEDS_APPROVAL' | 'NO_CHANGE' | 'ERROR';

export interface DeadlineEntryCheck {
  itemId: string;
  lenhCode: string;
  skuCode: string;
  kind: DeadlineEntryKind;
  changes: DeadlineFieldChange[];
  errors: string[];
  warnings: string[];
}

/** Kết quả 1 lần lưu (form "Sửa thời hạn" hoặc Xác nhận Excel). */
export interface DeadlineSaveResult {
  /** Dòng ghi thẳng (chưa duyệt). */
  applied: DeadlineEntryCheck[];
  /** Lô chờ Sếp duyệt lại cho các dòng đã duyệt (null = không có dòng nào). */
  batch: DeadlineChangeBatchDto | null;
  /** Dòng bị bỏ vì lỗi (chỉ Excel - form thì lỗi là 400 cả lần). */
  skipped: DeadlineEntryCheck[];
}

/** Sếp quyết 1 lô: yêu cầu có trong `approveRequestIds` → APPROVED (áp mốc), yêu cầu PENDING còn lại → REJECTED (cần `rejectReason`). */
export interface DecideDeadlineBatchInput {
  approveRequestIds: string[];
  rejectReason?: string;
}

/** Trạng thái đổi mốc đang chờ của 1 dòng SKU - gắn vào item trong response PI (`pendingDeadlineChange`). */
export interface PendingDeadlineChangeRef {
  requestId: string;
  batchId: string;
  requestedAt: string;
  changes: DeadlineFieldChange[];
}

/** Lịch sử đổi mốc của 1 dòng SKU (audit + các yêu cầu), mới nhất trước. */
export interface DeadlineHistoryEntry {
  at: string;
  by: UserRef | null;
  /** DIRECT sửa thẳng · REQUESTED gửi chờ Sếp · APPROVED Sếp duyệt (đã áp) · REJECTED Sếp từ chối · CANCELLED KHSX huỷ. */
  kind: 'DIRECT' | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  source: DeadlineChangeSource | null;
  changes: DeadlineFieldChange[];
  note: string | null;
}

// ─── Excel (`/deadline-plan`) ─────────────────────────────────────────────────────────────────────

/** Q9-3: 'all' = mọi lệnh CHƯA BẮT ĐẦU sản xuất (chưa duyệt + đã duyệt chưa cắt) · 'approved' = chỉ phần đã duyệt chưa cắt. */
export type DeadlinePlanScope = 'all' | 'approved';

export interface DeadlineImportRow extends DeadlineEntryCheck {
  /** Số dòng trong file Excel (dòng tiêu đề = 1). */
  rowNumber: number;
}

export interface DeadlineImportPreview {
  fileName: string;
  /** Số dòng dữ liệu đọc được trong file. */
  totalRows: number;
  counts: { apply: number; needsApproval: number; noChange: number; error: number };
  /** Chỉ dòng có đổi hoặc có lỗi / cảnh báo (dòng NO_CHANGE không cảnh báo thì bỏ). */
  rows: DeadlineImportRow[];
  /** Gửi lại nguyên cho `POST /deadline-plan/commit` (BE kiểm lại hết). Chỉ gồm dòng APPLY + NEEDS_APPROVAL. */
  commitPayload: { fileName: string; items: DeadlineEntryInput[] };
}
