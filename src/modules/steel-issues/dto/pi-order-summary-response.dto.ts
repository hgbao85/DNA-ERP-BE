import { ApiProperty } from '@nestjs/swagger';
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

  constructor(partial: Partial<PiOrderSummaryResponseDto>) {
    Object.assign(this, partial);
  }
}
