/**
 * Phần A – Đợt 9 (YC2): "cổng" của lõi đổi mốc mà phần Excel (DeadlinePlanExcelService) gọi - tách thành abstract class để 2 phần code
 * được song song: DeadlineChangesService `implements` lớp này và module khai `{ provide: DeadlineChangesPort, useExisting:
 * DeadlineChangesService }`; phần Excel chỉ inject `DeadlineChangesPort`.
 */
import type {
  DeadlineChangeSource,
  DeadlineEntryCheck,
  DeadlineEntryInput,
  DeadlineSaveResult,
  PendingDeadlineChangeRef,
} from './deadline-changes.types';

export interface DeadlineActor {
  id: string;
  roles: string[];
}

export abstract class DeadlineChangesPort {
  /**
   * Kiểm (KHÔNG ghi) từng dòng: APPLY (chưa duyệt → ghi thẳng) · NEEDS_APPROVAL (đã duyệt → chờ Sếp) · NO_CHANGE · ERROR (mã dòng lạ, lệnh
   * Kết thúc / PI huỷ, đang có yêu cầu chờ, `expectedOld` ≠ hiện tại, luật gộp...). `warnings` = thứ tự mốc ngược trên giá trị mới.
   */
  abstract previewEntries(entries: DeadlineEntryInput[]): Promise<DeadlineEntryCheck[]>;

  /**
   * Ghi: dòng APPLY ghi thẳng (cùng đường ghi + audit + thông báo như "Sửa thời hạn" cũ), dòng NEEDS_APPROVAL gom 1 lô chờ Sếp, kiểm lại
   * mọi thứ trong giao dịch. `strict: true` (form) = có dòng ERROR thì ném 400 cả lần; `strict: false` (Excel) = bỏ dòng lỗi vào `skipped`.
   * `note`: ghi chú của lô (vd tên file Excel). `idempotencyKey` (Excel Xác nhận): đã có lô mang khoá này thì trả lại kết quả lô đó, không
   * tạo lô thứ 2 (dòng ghi thẳng tự an toàn khi gửi lại vì giá trị đã bằng → NO_CHANGE).
   */
  abstract saveEntries(
    actor: DeadlineActor,
    entries: DeadlineEntryInput[],
    source: DeadlineChangeSource,
    opts: { strict: boolean; note?: string; idempotencyKey?: string },
  ): Promise<DeadlineSaveResult>;

  /** Yêu cầu đổi mốc đang chờ theo dòng SKU (khoá = id dòng dạng chuỗi) - để Excel khoá dòng đang chờ. */
  abstract pendingByItem(itemIds: bigint[]): Promise<Map<string, PendingDeadlineChangeRef>>;
}
