import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MfgStage, ProcessStep, WorkstationKind } from '../../../generated/prisma/client';

/** QLSX thêm 1 máy / điểm làm việc dán mã QR (2026-10-13). Ràng buộc kind–stage–processStep kiểm ở
 *  service (+ CHECK DB workstations_step_chk / workstations_stage_chk). */
export class CreateWorkstationDto {
  @ApiProperty({ description: 'Mã ngắn in trên tem, vd LASER-01' })
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_.-]+$/, { message: 'Mã chỉ gồm chữ, số, dấu chấm, gạch dưới, gạch ngang' })
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: MfgStage, enumName: 'MfgStage' })
  @IsEnum(MfgStage)
  stage!: MfgStage;

  @ApiProperty({ enum: WorkstationKind, enumName: 'WorkstationKind' })
  @IsEnum(WorkstationKind)
  kind!: WorkstationKind;

  @ApiPropertyOptional({ enum: ProcessStep, enumName: 'ProcessStep' })
  @IsOptional()
  @IsEnum(ProcessStep)
  processStep?: ProcessStep;
}

/** Chỉ đổi tên / bật-tắt - đổi tổ hay loại máy thì tạo điểm mới (lần báo cũ vẫn trỏ về điểm cũ). */
export class UpdateWorkstationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
