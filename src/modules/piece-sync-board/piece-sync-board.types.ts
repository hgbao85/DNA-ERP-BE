/**
 * Khuôn dữ liệu trả về của GET /piece-sync-board ("Đồng bộ Phôi – Hàn", 2026-11-04, changelog-2026-10-08 mục 59). FE
 * D:\DNA-ERP src/services/piece-sync-board-api.ts là bản sao - sửa 1 bên thì sửa cả bên kia.
 *
 * ĐỦ CÔNG ĐOẠN (anh Nhân 04/11, changelog-2026-10-08 mục 63 ý 2 → làm ở mục 64; thay "chỉ tính theo Cắt" của mục 61): 1 đoạn chỉ
 * vào đồng bộ khi đã qua Cắt + MỌI công đoạn phụ ghi ở dòng định mức (PieceBom.processSteps: uốn, dập, tán, nhấn…). Đếm theo
 * PIECE_SYNC_COUNT_MODE bên dưới.
 */
import type { ProcessStepValue } from '../../common/constants/process-steps.constant';

/**
 * Cách đếm đoạn "thành phẩm" ở mỗi công đoạn - câu 1.4 file `docs/cau-hoi-xac-nhan-anh-nhan-2026-11-04.docx` CHỜ anh Nhân, đang theo
 * đề xuất của IT:
 *  'PASSED_QC' = chỉ đoạn đã ĐẠT KCS ở công đoạn đó = đã báo − KCS lỗi − chưa gửi KCS − đang chờ KCS (≥ 0)  ← đang dùng
 *  'REPORTED'  = đã báo − KCS lỗi (gồm cả chưa gửi / đang chờ KCS) - cách đếm của mục 59.
 * Đổi cách đếm = đổi 1 hằng này (FE chép ở src/services/piece-sync-board-api.ts để đổi chữ giải thích).
 */
export const PIECE_SYNC_COUNT_MODE: 'PASSED_QC' | 'REPORTED' = 'PASSED_QC';

export interface PieceSyncLine {
  segmentSpecId: string;
  materialCode: string;
  materialName: string;
  /** Material.spec - quy cách xưởng dùng để gọi tên (vd "15" = V15, "10x20" = hộp 10x20); null nếu vật tư chưa khai. */
  materialSpec: string | null;
  cutLengthMm: number;
  /** Số đoạn trên 1 mảnh. */
  qtyPerPiece: number;
  /** Cắt + công đoạn phụ của dòng, đúng thứ tự nghiệp vụ (PROCESS_STEPS) - luôn có 'CAT' đứng đầu. */
  steps: ProcessStepValue[];
  /** Số đoạn đã qua ĐỦ mọi công đoạn của dòng (đếm theo PIECE_SYNC_COUNT_MODE) chia được cho dòng này - nhỏ nhất qua các công đoạn. */
  usableQty: number;
  /** ⌊usableQty ÷ qtyPerPiece⌋. */
  makeablePieces: number;
  /** Công đoạn có ít đoạn nhất khi dòng CHƯA đủ ("nghẽn ở"); trùng thì công đoạn đứng trước; null khi dòng đã đủ. */
  limitingStep: ProcessStepValue | null;
}

export interface PieceSyncRow {
  productionInvoiceId: string;
  piCode: string;
  productionOrderId: string;
  skuCode: string;
  skuName: string | null;
  /** Số bộ của SKU. */
  orderQuantity: number;
  pieceId: string;
  pieceCode: string;
  pieceName: string;
  /** Số mảnh trên 1 bộ. */
  qtyPerUnit: number;
  /** qtyPerUnit × orderQuantity. */
  requiredQty: number;
  /** Ước tính mảnh Phôi đã đồng bộ (đủ công đoạn, đếm theo PIECE_SYNC_COUNT_MODE); null = không có định mức Phôi cho mảnh này hoặc
   *  không tải được tiến độ Phôi của PI. */
  phoiSyncedQty: number | null;
  /**
   * Số mảnh SẼ đồng bộ thêm nếu mọi đoạn đã báo mà chưa có kết quả KCS (chưa gửi + đang chờ KCS) đều đạt = (đồng bộ đếm 'REPORTED')
   * − phoiSyncedQty, ≥ 0 - cột "Chưa qua KCS". Luôn 0 khi PIECE_SYNC_COUNT_MODE = 'REPORTED'; null khi phoiSyncedQty null.
   */
  phoiPendingQcQty: number | null;
  /** % làm tròn xuống như các màn khác (percentOf), null khi phoiSyncedQty null. */
  syncPercent: number | null;
  /** Hàn đã báo (đạt + chờ KCS + chưa gửi KCS), chặn trần ở requiredQty - cùng số "Đã báo" của màn Hàn. */
  hanDoneQty: number;
  /** Hàn báo trong hôm nay (giờ VN), không tính lần báo đã bị huỷ. */
  hanTodayQty: number;
  /** max(0, phoiSyncedQty − hanDoneQty) - "còn chưa hàn (phôi đã đồng bộ)". null khi phoiSyncedQty null. */
  notWeldedQty: number | null;
  /** max(0, requiredQty − phoiSyncedQty). null khi phoiSyncedQty null. */
  phoiNotSyncedQty: number | null;
  /** Hàn đã báo nhiều hơn số Phôi đồng bộ ước tính. */
  hanAheadOfPhoi: boolean;
  /** Mảnh có Sắt tự tính (vd PAT): số mảnh Phôi tự báo ở Vật tư TP, đếm theo PIECE_SYNC_COUNT_MODE (PASSED_QC = chỉ số đạt KCS) -
   *  đã tính vào phoiSyncedQty; null nếu mảnh không có. */
  selfCalcPieceQty: number | null;
  lines: PieceSyncLine[];
}

export interface PieceSyncBoard {
  /** 'YYYY-MM-DD' ngày VN. */
  today: string;
  generatedAt: string;
  /** Nguồn dữ liệu tải lỗi (vd 'phoi-progress', 'production-batch-plan(HAN)', 'floor-reports') - số dựa vào nguồn đó là null/0. */
  failedSources: string[];
  /** PI nhiều SKU có đợt cắt/công đoạn CŨ chưa gắn SKU - phần đó không được tính vào đồng bộ. */
  unassignedPhoiPiIds: string[];
  rows: PieceSyncRow[];
}
