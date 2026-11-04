/** "Số đơn đặt hàng" in trên phiếu: số thứ tự/năm, vd 52/2026 (bản v8 mục 4.10). */
export function supplierOrderCode(seq: number, year: number): string {
  return `${seq}/${year}`;
}

/** Năm theo giờ Việt Nam (UTC+7) - đơn tạo lúc 00:30 sáng 01/01 giờ VN thuộc năm mới. */
export function vnYear(now: Date = new Date()): number {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCFullYear();
}
