import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateProductionInvoiceItemDto {
  @ApiProperty()
  @IsString()
  mfgProductId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productVariantId?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  materialDeadline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deliveryDeadline?: string;
}
