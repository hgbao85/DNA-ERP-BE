import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';
import { ProcessStep } from '../../../generated/prisma/client';
import { PROCESS_STEPS } from '../../../common/constants/process-steps.constant';

/** Body của POST /production-invoices/:id/material-yield-step-bundles - Phôi gom mọi
 *  MaterialYieldStepBatch CHƯA gửi (recipeId, step) thành 1 đợt gửi KCS (mirror SubmitPieceStepDto).
 *  Không cần `qty` - service tự tính tổng từ các dòng chưa gửi. */
export class SubmitMaterialYieldStepDto {
  @ApiProperty()
  @IsString()
  recipeId!: string;

  @ApiProperty({ enum: PROCESS_STEPS })
  @IsEnum(ProcessStep)
  step!: ProcessStep;
}
