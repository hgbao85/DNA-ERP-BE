import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateSalesOrderItemDto {
  @ApiProperty()
  @IsString()
  mfgProductId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  skuName?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  totalQty!: number;

  // Bắt buộc (2026-10-12, theo yêu cầu nghiệp vụ): hạn giao của TỪNG dòng đơn được chép xuống
  // ProductionInvoiceItem.deliveryDeadline (xem SalesOrdersService) - bỏ trống thì lệnh sản xuất
  // của đơn đó không có hạn, mọi màn kho/sản xuất hiện "—".
  @ApiProperty()
  @IsNotEmpty({ message: 'Hạn giao của từng dòng SKU là bắt buộc' })
  @IsDateString({}, { message: 'Hạn giao của từng dòng SKU không hợp lệ' })
  deliveryDate!: string;
}
