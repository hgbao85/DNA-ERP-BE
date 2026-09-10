import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { SalesOrderItemResponseDto } from './sales-order-item-response.dto';

@Exclude()
export class SalesOrderResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiProperty() customerId!: string;
  @Expose() @ApiProperty() customerName!: string;
  @Expose() @ApiProperty() orderDate!: Date;
  @Expose() @ApiPropertyOptional({ nullable: true }) deliveryDate!: Date | null;
  @Expose() @ApiProperty() depositAmount!: number;
  @Expose() @ApiProperty() depositConfirmed!: boolean;
  @Expose() @ApiProperty() paidAmount!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) attachmentName!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) attachmentUrl!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiProperty() isActive!: boolean;
  /** null = xoá được. Có giá trị = lý do không xoá được (đã gộp PI/đã giao hàng một phần) - dùng
   *  thẳng làm message/tooltip, xem SalesOrdersService.buildDeleteBlockReason(). */
  @Expose() @ApiPropertyOptional({ nullable: true }) deleteBlockedReason!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;
  @Expose()
  @ApiProperty({ type: [SalesOrderItemResponseDto] })
  @Type(() => SalesOrderItemResponseDto)
  items!: SalesOrderItemResponseDto[];

  constructor(partial: Partial<SalesOrderResponseDto>) {
    Object.assign(this, partial);
  }
}
