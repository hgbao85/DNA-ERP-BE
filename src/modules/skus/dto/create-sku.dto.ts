import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateSkuDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  salesOrderId?: string;

  @ApiProperty()
  @IsString()
  mfgProductId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerName?: string;
}
