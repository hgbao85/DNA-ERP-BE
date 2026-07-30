import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { MfgStage } from '../../../generated/prisma/client';

@Exclude()
export class DefectReasonResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() label!: string;
  @Expose() @ApiPropertyOptional({ enum: MfgStage, nullable: true }) stageType!: MfgStage | null;

  constructor(partial: Partial<DefectReasonResponseDto>) {
    Object.assign(this, partial);
  }
}
