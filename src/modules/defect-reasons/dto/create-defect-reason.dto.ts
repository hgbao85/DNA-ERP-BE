import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MfgStage } from '../../../generated/prisma/client';

export class CreateDefectReasonDto {
  @ApiProperty({ description: "vd 'Cong méo', 'Sơn bong'" })
  @IsString()
  @MinLength(1)
  // 20/11/2026: giới hạn độ dài nhãn (T4-8).
  @MaxLength(100, { message: 'Tên lý do lỗi chỉ được tối đa 100 ký tự' })
  label!: string;

  @ApiPropertyOptional({ enum: MfgStage, description: 'null = áp dụng chung cho mọi công đoạn' })
  @IsOptional()
  @IsEnum(MfgStage)
  stageType?: MfgStage;
}
