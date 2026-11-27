/** 7 công đoạn phôi chi tiết theo ĐÚNG THỨ TỰ nghiệp vụ (cắt trước, uốn/dập/đục lỗ/tán sau,
 *  tóp đầu/xẻ là bước hoàn thiện) - khớp enum ProcessStep trong schema.prisma. Nâng lên common vì
 *  cả module skus (khai định mức) lẫn production-batches (báo tiến độ vật tư thành phẩm) đều cần,
 *  và production-batches không được phụ thuộc ngược vào module skus.
 *
 *  QUAN TRỌNG: mảng `processSteps` lưu trên PieceBom/PieceMaterialYield KHÔNG đảm bảo đúng thứ tự
 *  này - FE ghi theo thứ tự người dùng tick checkbox (xem SpecSteelPage.tsx toggleChildProcessStep),
 *  nên mọi nơi cần biết "bước nào trước bước nào" (vd chặn báo tiến độ vượt bước trước) PHẢI tự sắp
 *  lại theo mảng này trước khi dùng, không được tin thứ tự đọc từ DB. */
export const PROCESS_STEPS = [
  'CAT',
  'UON',
  'DAP',
  'DUC_LO',
  'TAN',
  'TOP_DAU',
  'XE',
  'NHAN',
] as const;
export type ProcessStepValue = (typeof PROCESS_STEPS)[number];

/** Nhãn tiếng Việt của từng công đoạn (17/11/2026: nâng từ segment-code.util.ts để câu lỗi / tin nhắn nói "Uốn" thay vì mã "UON"). */
export const PROCESS_STEP_LABEL: Record<ProcessStepValue, string> = {
  CAT: 'Cắt',
  UON: 'Uốn',
  DAP: 'Dập',
  DUC_LO: 'Đục lỗ',
  TAN: 'Tán',
  TOP_DAU: 'Tóp đầu',
  XE: 'Xẻ',
  NHAN: 'Nhấn',
};

/** Nhãn của 1 mã công đoạn bất kỳ; mã lạ thì trả nguyên mã. */
export function processStepLabel(step: string): string {
  return (PROCESS_STEP_LABEL as Record<string, string>)[step] ?? step;
}

/** Sắp lại 1 mảng processSteps bất kỳ (có thể lộn xộn thứ tự lưu trong DB) theo đúng thứ tự
 *  Nghiệp vụ ở trên - dùng trước khi tính "bước liền trước" cho logic chặn báo vượt tiến độ. */
export function sortProcessSteps(steps: readonly ProcessStepValue[]): ProcessStepValue[] {
  return PROCESS_STEPS.filter((s) => steps.includes(s));
}
