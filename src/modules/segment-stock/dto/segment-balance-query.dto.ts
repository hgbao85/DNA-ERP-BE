import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** Không phân trang - số dòng bị chặn tự nhiên bởi số (kho Phôi x mã đoạn) đang có tồn / đang được giữ. Id dạng chuỗi số. */
export class SegmentBalanceQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Mã sắt (Material) của cỡ đoạn' })
  @IsOptional()
  @IsString()
  materialId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  segmentSpecId?: string;
}
