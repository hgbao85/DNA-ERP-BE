import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

/** Khoá mốc được thử ở /check (khớp `CapacityCheckItemInput.stages`). */
export const CAPACITY_CHECK_STAGE_KEYS = [
  'PHOI_START',
  'FRAME_PHOI',
  'FRAME_HAN',
  'FRAME_SON',
  'WEAVING',
  'TRANSFER_CHECK',
  'PACKAGING_START',
  'PACKAGING',
] as const;

export class CapacityCheckItemDto {
  @ApiProperty({ description: 'Id dòng SKU trong PI (chuỗi số)' })
  @IsString()
  @Matches(/^\d+$/, { message: 'itemId phải là chuỗi số' })
  itemId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Xưởng đang chọn (chuỗi số); bỏ trống = xưởng đã lưu',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'workshopId phải là chuỗi số' })
  workshopId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Kho đóng gói đang chọn; bỏ trống = kho đã lưu',
  })
  @IsOptional()
  @IsString()
  warehouseCode?: string | null;

  @ApiPropertyOptional({
    description:
      'Mốc đang sửa: khoá trong CAPACITY_CHECK_STAGE_KEYS, giá trị YYYY-MM-DD (kiểm tiếp ở service)',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  stages?: Partial<Record<(typeof CAPACITY_CHECK_STAGE_KEYS)[number], string>>;
}

export class CapacityCheckDto {
  @ApiProperty({ type: [CapacityCheckItemDto], description: '1–50 dòng' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Cần ít nhất 1 dòng để kiểm tra' })
  @ArrayMaxSize(50, { message: 'Tối đa 50 dòng mỗi lần kiểm tra' })
  @ValidateNested({ each: true })
  @Type(() => CapacityCheckItemDto)
  items!: CapacityCheckItemDto[];
}
