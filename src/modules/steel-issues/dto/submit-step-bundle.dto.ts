import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ProcessStep } from '../../../generated/prisma/client';

/** Body của POST /cut-bundles/:id/step-bundles - Phôi gom mọi StepBatch CHƯA gửi của (cutBundleId,
 *  step) thành 1 đợt gửi KCS. Không cần segments - service tự gom từ StepBatch đã báo trước đó. */
export class SubmitStepBundleDto {
  @ApiProperty({ enum: ProcessStep })
  @IsEnum(ProcessStep)
  step!: ProcessStep;
}
