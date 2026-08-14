import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { ProductionInvoiceStatus } from '../../../generated/prisma/client';
import { ProductionInvoiceItemResponseDto } from './production-invoice-item-response.dto';

@Exclude()
export class ProductionInvoiceResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty({ enum: ProductionInvoiceStatus }) status!: ProductionInvoiceStatus;
  /**
   * true = KHSX gộp nhiều SKU để cắt chung một đợt. FE dùng để đổi cách hiển thị (nhóm SKU theo
   * PO) và đổi cách duyệt (Sếp duyệt/từ chối CẢ CỤM, không duyệt lẻ từng SKU).
   */
  @Expose() @ApiProperty() isMerged!: boolean;
  @Expose() @ApiPropertyOptional({ nullable: true }) deadline!: Date | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;
  @Expose()
  @ApiProperty({ type: [ProductionInvoiceItemResponseDto] })
  @Type(() => ProductionInvoiceItemResponseDto)
  items!: ProductionInvoiceItemResponseDto[];

  constructor(partial: Partial<ProductionInvoiceResponseDto>) {
    Object.assign(this, partial);
  }
}
