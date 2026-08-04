import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreatePlanFormDto {
  @ApiProperty()
  @IsString()
  salesOrderId!: string;

  @ApiProperty()
  @IsString()
  mfgProductId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
