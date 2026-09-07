import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';
import { ProcessStep } from '../../../generated/prisma/client';
import { PROCESS_STEPS } from '../../../common/constants/process-steps.constant';

/** Body của POST /production-orders/:id/piece-step-bundles - Phôi gom mọi PieceStepBatch CHƯA
 *  gửi (pieceStepBundleId NULL) của (order, piece, step) thành 1 đợt gửi KCS. Không cần `qty` -
 *  service tự tính tổng từ các dòng chưa gửi. */
export class SubmitPieceStepDto {
  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiProperty({ enum: PROCESS_STEPS })
  @IsEnum(ProcessStep)
  step!: ProcessStep;
}
