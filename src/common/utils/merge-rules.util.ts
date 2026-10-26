import { ProdItemStageType } from '../../generated/prisma/client';

/**
 * LUẬT GỘP (2026-10-24, Sếp Nhân: "chỉ được gom các lệnh cách nhau khoảng 3 ngày đổ lại", "không được gộp 2 lệnh cách nhau quá xa",
 * "sẽ kiểm soát lúc lên kế hoạch"; người dùng: "giới hạn chỉ được gộp tối đa bao nhiêu đó SKU"). Áp ở mọi chỗ KHSX tạo/giữ một đợt cắt
 * chung: cutting-batch-solve, merge PI, lưu hạn lệnh gộp. Cùng một hàm để 3 chỗ không nói 3 kiểu.
 *
 * Mốc so sánh = MỐC CẦN SẮT RIÊNG của SKU: hạn mua hàng (`materialDeadline`), không có thì hạn Khung cơ khí (người dùng chốt
 * 2026-10-24). KHÔNG rơi về hạn của PI như frameDeadlineOf: lệnh gộp lấy hạn PI = hạn sớm nhất của nhóm, rơi về đó thì SKU chưa có mốc
 * bị tính như đang ở mốc sớm nhất -> báo vi phạm oan. SKU chưa có mốc riêng: bỏ qua (không chặn - không biết thì không kết luận).
 *
 * KHUNG N NGÀY TÍNH CẢ NGÀY ĐẦU (Sếp Nhân 2026-10-24: "ngày 1 gộp được ngày 3, ngày 1 ko được gộp với ngày 4", "bắt buộc chỉ được gộp
 * tối đa 2 lệnh"): windowDays = 3 nghĩa là mốc sớm nhất và muộn nhất CHÊNH tối đa 2 ngày (windowDays − 1).
 */
/** Chênh lệch tối đa (ngày) giữa mốc sớm nhất và muộn nhất với khung `windowDays` ngày tính cả ngày đầu. */
export function maxGapDays(windowDays: number): number {
  return Math.max(0, windowDays - 1);
}
export interface MergeRuleItem {
  materialDeadline: Date | null;
  stages: { stageType: ProdItemStageType; deadline: Date }[];
  /** tên hiện trong câu báo, vd mã SKU */
  label: string;
}

export interface MergeRuleResult {
  ok: boolean;
  count: number;
  /** ngày giữa mốc sớm nhất và muộn nhất (làm tròn), null khi < 2 SKU có mốc */
  spanDays: number | null;
  windowDays: number;
  maxSkus: number;
  /** câu báo tiếng Việt khi vi phạm (gộp cả 2 lý do nếu có), null khi ok */
  reason: string | null;
}

const DAY_MS = 86_400_000;

/** Nhãn trong câu báo: "GHE-J55 (PO RP-…633975)" - nhiều đơn cùng SKU thì chỉ mã SKU không phân biệt được đơn nào. */
export function skuLabel(factoryCode: string, orderCode?: string | null): string {
  return orderCode ? `${factoryCode} (${orderCode})` : factoryCode;
}

export function ownSteelDeadlineOf(
  item: Pick<MergeRuleItem, 'materialDeadline' | 'stages'>,
): Date | null {
  return (
    item.materialDeadline ??
    item.stages.find((s) => s.stageType === ProdItemStageType.FRAME)?.deadline ??
    null
  );
}

// 'en-GB' cho ra đúng "12/11" (Node in 'vi-VN' thành "12-11"); giờ Việt Nam để mốc 0h không lùi sang hôm trước.
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});
const fmtDayMonth = (d: Date) => DAY_MONTH.format(d);

/**
 * `context` đổi chủ ngữ câu báo: 'batch' = đợt đang tính/gộp, 'invoice' = lệnh gộp đang sửa hạn. Số SKU chỉ kiểm khi 'batch' (sửa hạn
 * không đổi số SKU của lệnh).
 */
export function checkMergeRules(
  items: MergeRuleItem[],
  cfg: { windowDays: number; maxSkus: number },
  context: 'batch' | 'invoice' = 'batch',
): MergeRuleResult {
  const reasons: string[] = [];
  if (context === 'batch' && items.length > cfg.maxSkus) {
    reasons.push(`Đợt gồm ${items.length} SKU, tối đa ${cfg.maxSkus} SKU mỗi đợt/lệnh gộp.`);
  }
  const dated = items
    .map((i) => ({ label: i.label, at: ownSteelDeadlineOf(i) }))
    .filter((x): x is { label: string; at: Date } => x.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  let spanDays: number | null = null;
  if (dated.length >= 2) {
    const first = dated[0];
    const last = dated[dated.length - 1];
    spanDays = Math.round((last.at.getTime() - first.at.getTime()) / DAY_MS);
    if (spanDays > maxGapDays(cfg.windowDays)) {
      const who = context === 'batch' ? 'các SKU trong đợt' : 'các SKU trong lệnh gộp';
      const fix =
        context === 'batch'
          ? 'Bỏ bớt SKU hoặc tách thành đợt khác.'
          : 'Dời lại mốc hoặc tách SKU ra lệnh riêng.';
      reasons.push(
        `Mốc cần sắt của ${who} cách nhau ${spanDays} ngày (sớm nhất ${fmtDayMonth(first.at)} – ${first.label}, muộn nhất ` +
          `${fmtDayMonth(last.at)} – ${last.label}) - chỉ được gộp trong khung ${cfg.windowDays} ngày (chênh tối đa ` +
          `${maxGapDays(cfg.windowDays)} ngày, vd ngày 1 gộp được ngày ${cfg.windowDays}). ${fix}`,
      );
    }
  }
  return {
    ok: reasons.length === 0,
    count: items.length,
    spanDays,
    windowDays: cfg.windowDays,
    maxSkus: cfg.maxSkus,
    reason: reasons.length ? reasons.join(' ') : null,
  };
}
