import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsString, Min } from 'class-validator';
import { ProcessStep } from '../../../generated/prisma/client';
import { PROCESS_STEPS } from '../../../common/constants/process-steps.constant';

/** Body của POST /production-invoices/:id/material-yield-step-batches - Phôi báo "vừa {step} xong
 *  N {outputMaterial}" cho 1 recipe (mirror CreatePieceStepBatchDto, nhưng khoá theo recipeId thay
 *  vì pieceId - vật tư ra không gắn piece nào). */
export class CreateMaterialYieldStepBatchDto {
  @ApiProperty()
  @IsString()
  recipeId!: string;

  @ApiProperty({ enum: PROCESS_STEPS })
  @IsEnum(ProcessStep)
  step!: ProcessStep;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}
