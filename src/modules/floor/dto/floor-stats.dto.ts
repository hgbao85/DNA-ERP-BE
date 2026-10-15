import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { FLOOR_WORKER_STAGES, FloorWorkerStage } from './floor-worker.dto';

export const STATS_GROUP_BY = ['day', 'month', 'year'] as const;
export type StatsGroupByValue = (typeof STATS_GROUP_BY)[number];

/**
 * "Sản lượng của tôi" đã KCS duyệt (công nhân): khoảng ngày + cách nhóm thôi. KHÔNG có `workerId`/`stage` - số luôn là của
 * chính người đăng nhập, id lấy từ token (xem FloorStatsService.getMyStats).
 */
export class MyStatsQueryDto {
  @ApiPropertyOptional({
    description: 'Ngày bắt đầu YYYY-MM-DD (giờ VN). Mặc định: mùng 1 của tháng chứa `to`.',
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

  @ApiPropertyOptional({ enum: STATS_GROUP_BY, default: 'day' })
  @IsOptional()
  @IsIn(STATS_GROUP_BY)
  groupBy?: StatsGroupByValue;
}

/** Báo cáo sản lượng đạt KCS (2026-10-15, mục 36): khoảng ngày lịch giờ VN, nhóm theo ngày/tháng/năm. */
export class FloorStatsQueryDto {
  @ApiPropertyOptional({
    description: 'Ngày bắt đầu YYYY-MM-DD (giờ VN). Mặc định: mùng 1 của tháng chứa `to`.',
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

  @ApiPropertyOptional({ enum: STATS_GROUP_BY, default: 'day' })
  @IsOptional()
  @IsIn(STATS_GROUP_BY)
  groupBy?: StatsGroupByValue;

  @ApiPropertyOptional({
    enum: FLOOR_WORKER_STAGES,
    description: 'Chỉ 1 tổ (PHOI gồm cả cắt + công đoạn phụ)',
  })
  @IsOptional()
  @IsIn(FLOOR_WORKER_STAGES)
  stage?: FloorWorkerStage;

  @ApiPropertyOptional({ description: 'Chỉ 1 công nhân (id người dùng)' })
  @IsOptional()
  @IsString()
  workerId?: string;
}
