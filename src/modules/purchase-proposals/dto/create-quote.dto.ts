import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateQuoteDto {
  @ApiPropertyOptional({ description: 'Chọn NCC có sẵn trong danh mục (tuỳ chọn)' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiProperty({ description: 'Tên NCC - luôn bắt buộc kể cả khi đã chọn supplierId' })
  @IsString()
  @MinLength(1)
  supplierName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
