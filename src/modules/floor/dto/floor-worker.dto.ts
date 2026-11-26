import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Tổ của công nhân - đúng 3 tổ có màn quét (không có KCS/Đan). */
export const FLOOR_WORKER_STAGES = ['PHOI', 'HAN', 'SON'] as const;
export type FloorWorkerStage = (typeof FLOOR_WORKER_STAGES)[number];

/**
 * Tổ của TÀI KHOẢN công nhân (24/11/2026, CK_DG_QR): 3 tổ trên + Chuyền kiểm, Đóng gói, KCS chuyền kiểm. 3 tổ mới chỉ tạo / đổi được
 * khi bật CK_DG_QR_ENABLED (kiểm ở FloorAdminService). FLOOR_WORKER_STAGES giữ nguyên cho mọi chỗ khác (tiến độ, thống kê, KCS).
 */
export const FLOOR_ACCOUNT_STAGES = [
  ...FLOOR_WORKER_STAGES,
  'CHUYEN_KIEM',
  'DONG_GOI',
  'KCS_CHUYEN_KIEM',
] as const;
export type FloorAccountStage = (typeof FLOOR_ACCOUNT_STAGES)[number];
export const CK_DG_ACCOUNT_STAGES: readonly FloorAccountStage[] = [
  'CHUYEN_KIEM',
  'DONG_GOI',
  'KCS_CHUYEN_KIEM',
];

export class CreateFloorWorkerDto {
  @ApiProperty({ description: 'Tên đăng nhập, vd phoi.tuan' })
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[a-zA-Z0-9_.-]+$/, {
    message: 'Tên đăng nhập chỉ gồm chữ, số, dấu chấm, gạch dưới, gạch ngang',
  })
  username!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(60)
  lastName!: string;

  @ApiProperty({ enum: FLOOR_ACCOUNT_STAGES })
  @IsIn(FLOOR_ACCOUNT_STAGES)
  stage!: FloorAccountStage;
}

export class UpdateFloorWorkerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  lastName?: string;

  @ApiPropertyOptional({ enum: FLOOR_ACCOUNT_STAGES })
  @IsOptional()
  @IsIn(FLOOR_ACCOUNT_STAGES)
  stage?: FloorAccountStage;

  /** Khoá/mở tài khoản (nghỉ việc, mất máy) - khoá thì thu hồi luôn phiên đăng nhập. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
