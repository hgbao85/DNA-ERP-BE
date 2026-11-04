/**
 * Số cần MUA của 1 vật tư theo công thức anh Nhân chốt (V3-3, bản yêu cầu v8 mục 7.9, 04/11/2026):
 *
 *   buyQty = nhu cầu × (1 + % hao hụt mua) − tồn khả dụng (tồn CHƯA GIỮ cho lệnh khác)
 *
 * Trước 04/11 cả 3 luồng mua (vật tư tiêu hao, định mức cắt theo tỷ lệ, công thức vật tư thành
 * phẩm) tính (nhu cầu − tồn khả dụng) × (1 + %), tức chỉ đệm hao hụt trên phần còn thiếu - kho có
 * sẵn 1 phần thì số đệm bị co lại theo. Công thức mới đệm trên TOÀN BỘ nhu cầu rồi mới trừ tồn.
 *
 * Kết quả làm tròn 4 chữ số thập phân (đúng scale cột PurchaseProposalItem.buyQty Decimal(14,4))
 * TRƯỚC khi trả về, để caller ceil lên số nguyên không bị sai số dấu phẩy động đẩy lên 1 đơn vị
 * (vd 100 × 1,01 = 101,00000000000001 → ceil ra 102 thay vì 101). Âm (tồn đủ cả phần đệm) → 0.
 *
 * KHÔNG đụng phần giữ chỗ tồn kho: caller vẫn giữ chỗ min(nhu cầu thật, tồn khả dụng) như cũ -
 * phần đệm hao hụt là số mua thêm, không phải nhu cầu được giữ chỗ.
 */
export function purchaseBuyQtyWithWaste(
  requiredQty: number,
  availableQty: number,
  wastePct: number,
): number {
  const raw = requiredQty * (1 + wastePct / 100) - Math.max(0, availableQty);
  const rounded = Math.round(raw * 10_000) / 10_000;
  return rounded > 0 ? rounded : 0;
}
