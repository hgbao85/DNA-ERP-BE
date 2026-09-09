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

  /** 2026-09-09: ngày bắt đầu - CHỈ có ý nghĩa cho FRAME (giờ là khoảng) và 3 mốc con
   *  FRAME_PHOI/FRAME_HAN/FRAME_SON (bắt buộc đi kèm, xem
   *  ProductionInvoicesService.assertFrameSubStagesWithinRange()). Bỏ trống cho
   *  WEAVING/TRANSFER_CHECK/PACKAGING (vẫn 1 mốc như cũ). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;
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
