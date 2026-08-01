import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;
}
