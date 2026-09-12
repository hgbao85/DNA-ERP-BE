import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/**
 * Danh sách PO/SKU (ProductionOrder) thuộc 1 PI - khối "tham khảo" cho màn Lệnh sản xuất Phôi,
 * KHÔNG mang số liệu tiến độ (tiến độ cắt/công đoạn chỉ có ở cấp PI × loại sắt, xem
 * PhoiProgressResponseDto) vì SteelIssue không theo dõi theo từng SKU/mảnh (xem changelog
 * 2026-08-19-xuat-sat-theo-pi-hoan-tat.html).
 */
@Exclude()
export class PiOrderSummaryResponseDto {
  @Expose() @ApiProperty() poNumber!: string;
  /** Null cho PI gộp không gắn 1 đơn hàng Sales cụ thể nào (xem ProductionInvoiceItem.salesOrderId). */
  @Expose() @ApiProperty({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty() productName!: string;
  /** Snapshot ProductionOrder.quantity tại thời điểm Sếp duyệt - xem comment model ProductionOrder. */
  @Expose() @ApiProperty() quantity!: number;
  /** Mốc kế hoạch Phôi (ProdItemStageType.FRAME_PHOI, LenhSXPage "Sửa thời hạn") của đúng SKU này -
   *  thêm 2026-09-12 để màn Lệnh sản xuất Phôi hiện được deadline (trước đây không có, vì
   *  PHOI_STAFF không có PRODUCTION_INVOICE:VIEW để tự đọc ProductionInvoiceItem.stages - endpoint
   *  này (STEEL_ISSUE:VIEW) là đường duy nhất Phôi đọc được thông tin PO/SKU). null nếu KHSX chưa
   *  từng đặt mốc Phôi cho SKU này. */
  @Expose() @ApiPropertyOptional({ nullable: true }) phoiDeadline!: Date | null;

  constructor(partial: Partial<PiOrderSummaryResponseDto>) {
    Object.assign(this, partial);
  }
}
