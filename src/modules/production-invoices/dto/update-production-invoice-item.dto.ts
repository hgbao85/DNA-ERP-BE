import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { ProdItemStageType } from '../../../generated/prisma/client';

export class ProdItemStageInputDto {
  @ApiProperty({ enum: ProdItemStageType })
  @IsEnum(ProdItemStageType)
  stageType!: ProdItemStageType;

  @ApiProperty()
  @IsDateString()
  deadline!: string;
}

export class UpdateProductionInvoiceItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  materialDeadline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deliveryDeadline?: string;

  @ApiPropertyOptional({ type: [ProdItemStageInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProdItemStageInputDto)
  stages?: ProdItemStageInputDto[];
}
