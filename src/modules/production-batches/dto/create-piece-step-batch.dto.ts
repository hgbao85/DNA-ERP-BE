import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsString, Min } from 'class-validator';
import { MfgStage, ProcessStep } from '../../../generated/prisma/client';
import { PROCESS_STEPS } from '../../../common/constants/process-steps.constant';

/** Body của POST /production-orders/:id/piece-step-batches - Phôi báo "vừa {step} xong N mảnh"
 *  cho 1 piece có PieceMaterialYield.processSteps. `stage` khai tường minh (dù hiện chỉ nhận PHOI)
 *  để mirror shape CreateProductionBatchDto và tương lai không phải đổi contract khi mở rộng. */
export class CreatePieceStepBatchDto {
  @ApiProperty({ enum: MfgStage, enumName: 'MfgStage' })
  @IsEnum(MfgStage)
  stage!: MfgStage;

  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiProperty({ enum: PROCESS_STEPS })
  @IsEnum(ProcessStep)
  step!: ProcessStep;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}
