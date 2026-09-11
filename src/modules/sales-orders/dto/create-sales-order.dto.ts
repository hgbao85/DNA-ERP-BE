import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateSalesOrderItemDto } from './create-sales-order-item.dto';

export class CreateSalesOrderDto {
  /** Mã đơn hàng Sales tự nhập tay - mã hiển thị chính cho người dùng, thay cho `code` nội bộ tự
   *  sinh. Bắt buộc, unique (SalesOrdersService.create() kiểm tra trùng). */
  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'Mã đơn hàng không được để trống' })
  orderCode!: string;

  @ApiProperty()
  @IsString()
  customerId!: string;

  @ApiProperty()
  @IsDateString()
  orderDate!: string;

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

  @ApiProperty({ type: [CreateSalesOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderItemDto)
  items!: CreateSalesOrderItemDto[];
}
