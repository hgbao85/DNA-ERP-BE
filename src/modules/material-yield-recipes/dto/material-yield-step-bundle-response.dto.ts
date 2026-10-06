import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { PieceStepBundleStatus, ProcessStep } from '../../../generated/prisma/client';
import { PROCESS_STEPS } from '../../../common/constants/process-steps.constant';

/** 1 "đợt gửi KCS" theo công đoạn cho vật tư KHÔNG gắn piece (2026-10-01) - mirror
 *  PieceStepBundleResponseDto. */
@Exclude()
export class MaterialYieldStepBundleResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionInvoiceId!: string;
  @Expose() @ApiProperty() piCode!: string;
  @Expose() @ApiProperty() recipeId!: string;
  @Expose() @ApiProperty() outputMaterialCode!: string;
  @Expose() @ApiProperty() outputMaterialName!: string;
  @Expose() @ApiProperty({ enum: PROCESS_STEPS }) step!: ProcessStep;
  @Expose() @ApiProperty() qty!: number;
  @Expose()
  @ApiProperty({ enum: PieceStepBundleStatus, enumName: 'PieceStepBundleStatus' })
  status!: PieceStepBundleStatus;
  @Expose() @ApiProperty() submittedAt!: Date;
  @Expose() @ApiProperty() submittedById!: string;

  constructor(partial: Partial<MaterialYieldStepBundleResponseDto>) {
    Object.assign(this, partial);
  }
}
