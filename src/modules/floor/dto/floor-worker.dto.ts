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

  @ApiProperty({ enum: FLOOR_WORKER_STAGES })
  @IsIn(FLOOR_WORKER_STAGES)
  stage!: FloorWorkerStage;
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

  @ApiPropertyOptional({ enum: FLOOR_WORKER_STAGES })
  @IsOptional()
  @IsIn(FLOOR_WORKER_STAGES)
  stage?: FloorWorkerStage;

  /** Khoá/mở tài khoản (nghỉ việc, mất máy) - khoá thì thu hồi luôn phiên đăng nhập. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
