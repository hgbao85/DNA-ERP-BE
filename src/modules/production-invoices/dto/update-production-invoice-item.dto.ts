import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { ProdItemStageType } from '../../../generated/prisma/client';

/**
 * 2026-09-11 lần 2: đồng bộ lại - mọi `stageType` (kể cả FRAME_PHOI/FRAME_HAN/FRAME_SON, thêm
 * 2026-09-09) CHỈ còn 1 mốc `deadline`, giống hệt WEAVING/TRANSFER_CHECK/PACKAGING. Bỏ hẳn
 * `startDate`/khái niệm "khoảng thời gian" + ràng buộc "phải nằm trong khung cha" - xác nhận qua
 * DB thật lúc đổi: chưa PI nào từng dùng tính năng khoảng ngày này (0 dòng dữ liệu liên quan
 * FRAME, không mất dữ liệu). Vẫn giữ 3 mốc con FRAME_PHOI/FRAME_HAN/FRAME_SON làm mốc riêng theo
 * dõi độc lập (không gộp lại thành FRAME đơn) - chỉ đơn giản hoá từ "khoảng" xuống "1 mốc".
 */
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
