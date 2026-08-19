import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ProductionOrderStatus } from '../../../generated/prisma/client';

@Exclude()
export class ProductionOrderResponseDto {
  @Expose() @ApiProperty() id!: string;
  /// Mã nội bộ (ProductionOrder.poNumber) - CHỈ để hệ thống tra cứu, KHÔNG hiển thị cho người
  /// dùng. FE dùng `salesOrderCode` bên dưới thay thế (xem trao đổi 2026-08-18).
  @Expose() @ApiProperty() poNumber!: string;
  /// Mã đơn hàng Sales gốc (SalesOrder.code, vd "PO-31") - đây mới là mã "PO" người dùng cần
  /// thấy. null khi SKU không gắn đơn Sales nào (tạo tay).
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  /// Id PI cha (ProductionInvoice.id) - dùng để gọi các endpoint gộp theo PI (vd
  /// POST /production-invoices/:id/steel-issues, xem changelog 2026-08-18-xuat-sat-po-pi-vat-tu.md).
  @Expose() @ApiProperty() productionInvoiceId!: string;
  /// Mã PI cha (ProductionInvoice.code, vd "PI-2026-003") - để phân biệt PO (đơn hàng) và PI
  /// (lệnh sản xuất nội bộ), vì 1 PO có thể ứng nhiều PI/SKU (xem PI gộp isMerged).
  @Expose() @ApiProperty() piCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) deliveryDeadline!: Date | null;
  @Expose() @ApiProperty() productionInvoiceItemId!: string;
  @Expose() @ApiProperty() mfgProductId!: string;
  @Expose() @ApiProperty() bomRevisionId!: string;
  @Expose() @ApiProperty() quantity!: number;
  @Expose() @ApiProperty({ enum: ProductionOrderStatus }) status!: ProductionOrderStatus;
  @Expose() @ApiPropertyOptional({ nullable: true }) releasedAt!: Date | null;
  @Expose() @ApiProperty() createdAt!: Date;

  constructor(partial: Partial<ProductionOrderResponseDto>) {
    Object.assign(this, partial);
  }
}
