import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

/** Không phân trang (mirror đúng roadmap DTO) - số dòng thực tế bị chặn tự nhiên bởi số
 * (kho x loại hàng) đang tồn tại, không phải phân trang dữ liệu lịch sử như stock_ledger. */
export class ListStockQuantQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  materialId?: string;

  @ApiPropertyOptional({ description: 'Cỡ cây sắt (mm) - chỉ có ý nghĩa kèm materialId' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stockLengthMm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  segmentSpecId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pieceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productVariantId?: string;
}
