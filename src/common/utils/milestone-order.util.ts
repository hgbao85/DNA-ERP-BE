import type {
  DeadlineFieldKey,
  DeadlineValues,
} from '../../modules/production-invoices/deadline-changes/deadline-changes.types';

/**
 * Phần A – Đợt 9 (YC2): cảnh báo THỨ TỰ MỐC của 1 dòng SKU - cùng thứ tự với phép kiểm `MILESTONE_ORDER` ở data-health.checks.ts
 * (Mua VT khung & đan → Bắt đầu Phôi → Phôi → Hàn → Sơn → Khung → Nhập đan → Chuyền kiểm → Bắt đầu đóng gói → Đóng gói → Hạn giao;
 * "Mua VT còn lại" phải trước Bắt đầu đóng gói). Hàm THUẦN, mốc null thì bỏ qua (so với mốc có trước đó gần nhất).
 */
const CHAIN: { key: DeadlineFieldKey | 'deliveryDeadline'; label: string }[] = [
  { key: 'materialDeadline', label: 'Mua VT khung & đan' },
  { key: 'stage.PHOI_START', label: 'Bắt đầu Phôi' },
  { key: 'stage.FRAME_PHOI', label: 'Phôi' },
  { key: 'stage.FRAME_HAN', label: 'Hàn' },
  { key: 'stage.FRAME_SON', label: 'Sơn' },
  { key: 'stage.FRAME', label: 'Khung' },
  { key: 'stage.WEAVING', label: 'Nhập đan' },
  { key: 'stage.TRANSFER_CHECK', label: 'Chuyền kiểm' },
  { key: 'stage.PACKAGING_START', label: 'Bắt đầu đóng gói' },
  { key: 'stage.PACKAGING', label: 'Đóng gói' },
  { key: 'deliveryDeadline', label: 'Hạn giao' },
];

/** 'YYYY-MM-DD' → 'DD/MM'. */
const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

export type MilestoneOrderValues = DeadlineValues & { deliveryDeadline?: string | null };

/**
 * Mốc ngược thứ tự → câu cảnh báo. 1 mốc sau sớm hơn → "Hàn (12/11) sớm hơn Phôi (13/11)". NHIỀU mốc sau cùng sớm hơn 1 mốc (vd dời Hàn
 * ra sau cả Sơn, Khung, Đóng gói...) → GỘP 1 câu "Hàn (07/12) muộn hơn các mốc sau nó: Sơn (09/11), Khung (09/11), …" (đánh giá Opus: trước
 * đó 1 lần dời ra 7 câu, khó đọc).
 */
export function milestoneOrderWarnings(values: MilestoneOrderValues): string[] {
  const out: string[] = [];
  let prev: { label: string; day: string } | null = null;
  let later: string[] = [];
  const flush = () => {
    if (prev && later.length === 1) out.push(`${later[0]} sớm hơn ${prev.label} (${dm(prev.day)})`);
    else if (prev && later.length > 1) {
      out.push(`${prev.label} (${dm(prev.day)}) muộn hơn các mốc sau nó: ${later.join(', ')}`);
    }
    later = [];
  };
  for (const step of CHAIN) {
    const day = values[step.key] ?? null;
    if (!day) continue;
    if (prev && day < prev.day) {
      later.push(`${step.label} (${dm(day)})`);
      continue;
    }
    // Chỉ nhích "mốc trước" khi không ngược thứ tự: mốc lệch không kéo cả dây chuyền thành cảnh báo dây chuyền.
    flush();
    prev = { label: step.label, day };
  }
  flush();
  const remaining = values.finishedMaterialDeadline ?? null;
  const before = values['stage.PACKAGING_START'] ?? values['stage.PACKAGING'] ?? null;
  if (remaining && before && remaining > before) {
    const beforeLabel = values['stage.PACKAGING_START'] ? 'Bắt đầu đóng gói' : 'Đóng gói';
    out.push(`Mua VT còn lại (${dm(remaining)}) muộn hơn ${beforeLabel} (${dm(before)})`);
  }
  return out;
}
