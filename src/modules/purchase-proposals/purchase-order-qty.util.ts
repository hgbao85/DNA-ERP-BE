/**
 * Số THỰC MUA của 1 dòng đề xuất (2026-11-04, YC7 mục 7.2): "số mua" người mua chốt
 * (PurchaseProposalItem.orderQty) nếu lớn hơn "cần mua" (buyQty), ngược lại đúng buyQty.
 *
 * Lấy max thay vì tin thẳng orderQty: buyQty của dòng NEW vẫn bị các lượt tính lại đề xuất ghi
 * đè (nhu cầu tăng, tồn giảm) sau khi người mua đã chốt số - số mua không bao giờ được thấp hơn
 * số cần mua hiện tại.
 */
export function effectiveOrderQty(buyQty: number, orderQty: number | null | undefined): number {
  return orderQty != null && orderQty > buyQty ? orderQty : buyQty;
}

/**
 * Phần của 1 lần nhận hàng được cộng vào giữ chỗ (pool) của PI - chỉ phần còn thiếu so với "cần
 * mua". Phần vượt (mua dư theo số mua đã duyệt, hoặc NCC giao vượt) về tồn CHƯA GIỮ cho lệnh nào
 * (bản yêu cầu v8 mục 7.4 và 4.12), để lần tính đề xuất sau tự trừ.
 */
export function receiptQtyForPool(
  buyQty: number,
  receivedBefore: number,
  incrementQty: number,
): number {
  const stillNeeded = Math.max(0, buyQty - receivedBefore);
  return Math.min(incrementQty, stillNeeded);
}
