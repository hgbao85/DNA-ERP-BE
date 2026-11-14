import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

/** GET /floor/stats/cut-machines - đo năng suất máy cắt. */
export class CutMachineStatsQueryDto {
  @ApiPropertyOptional({ description: 'Bắt buộc với người không gắn xưởng' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'Mã (id) không hợp lệ' })
  workshopId?: string;

  @ApiPropertyOptional({
    description: 'Ngày bắt đầu YYYY-MM-DD (giờ VN). Mặc định: 13 ngày trước `to` (xem 14 ngày).',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from phải dạng YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    description: 'Ngày kết thúc YYYY-MM-DD (giờ VN, gồm cả ngày này). Mặc định: hôm nay.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to phải dạng YYYY-MM-DD' })
  to?: string;
}
