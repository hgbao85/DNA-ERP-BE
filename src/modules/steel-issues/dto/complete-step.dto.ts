import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ProcessStep } from '../../../generated/prisma/client';

export class CompleteStepDto {
  @ApiProperty({ enum: ProcessStep })
  @IsEnum(ProcessStep)
  step!: ProcessStep;
}
