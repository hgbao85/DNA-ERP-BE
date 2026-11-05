import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { MaterialsDueScope, MaterialsDueView } from '../materials-due.types';

export const MATERIALS_DUE_VIEWS: MaterialsDueView[] = ['overdue', 'today', 'date', 'all'];
export const MATERIALS_DUE_SCOPES: MaterialsDueScope[] = ['mine', 'all'];

export class MaterialsDueQueryDto {
  @ApiPropertyOptional({
    enum: MATERIALS_DUE_VIEWS,
    default: 'today',
    description: 'Quá hạn · Hôm nay (mặc định) · Theo ngày (cần `date`) · Tất cả.',
  })
  @IsOptional()
  @IsIn(MATERIALS_DUE_VIEWS)
  view?: MaterialsDueView;

  @ApiPropertyOptional({
    example: '2026-11-10',
    description: "Ngày VN 'YYYY-MM-DD' - bắt buộc khi view = 'date'.",
  })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({
    enum: MATERIALS_DUE_SCOPES,
    default: 'mine',
    description:
      'Chỉ người mua dùng: "Vật tư của tôi" (mặc định) hoặc "Tất cả". Vai trò khác bỏ qua tham số này.',
  })
  @IsOptional()
  @IsIn(MATERIALS_DUE_SCOPES)
  scope?: MaterialsDueScope;
}
