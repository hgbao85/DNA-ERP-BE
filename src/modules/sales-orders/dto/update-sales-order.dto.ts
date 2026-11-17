import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { UpdateSalesOrderItemDto } from './update-sales-order-item.dto';

/** 1 dòng sửa kèm khi sửa đơn (K6 16/11). */
export class UpdateSalesOrderItemWithIdDto extends UpdateSalesOrderItemDto {
  @ApiProperty()
  @IsString()
  id!: string;
}

/**
 * Sửa thông tin phụ (note/attachment/deposit/isActive) + các dòng đã có (items, K6 16/11) - không sửa customerId/
 * orderDate ở đây; thêm dòng SKU dùng POST :id/items.
 */
export class UpdateSalesOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  attachmentName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  depositConfirmed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** K6 16/11: sửa nhiều dòng cùng lúc - cả đơn trong 1 transaction, 1 dòng lỗi thì không lưu gì. */
  @ApiPropertyOptional({ type: [UpdateSalesOrderItemWithIdDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSalesOrderItemWithIdDto)
  items?: UpdateSalesOrderItemWithIdDto[];
}
