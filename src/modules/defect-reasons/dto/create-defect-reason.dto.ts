import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { MfgStage } from '../../../generated/prisma/client';

export class CreateDefectReasonDto {
  @ApiProperty({ description: "vd 'Cong méo', 'Sơn bong'" })
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiPropertyOptional({ enum: MfgStage, description: 'null = áp dụng chung cho mọi công đoạn' })
  @IsOptional()
  @IsEnum(MfgStage)
  stageType?: MfgStage;
}
