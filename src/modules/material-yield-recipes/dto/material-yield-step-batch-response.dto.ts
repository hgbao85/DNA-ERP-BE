import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ProcessStep } from '../../../generated/prisma/client';
import { PROCESS_STEPS } from '../../../common/constants/process-steps.constant';

@Exclude()
export class MaterialYieldStepBatchResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionInvoiceId!: string;
  @Expose() @ApiProperty() recipeId!: string;
  @Expose() @ApiProperty({ enum: PROCESS_STEPS }) step!: ProcessStep;
  @Expose() @ApiProperty() qty!: number;
  @Expose() @ApiProperty() reportedAt!: Date;
  @Expose() @ApiProperty() reportedById!: string;

  constructor(partial: Partial<MaterialYieldStepBatchResponseDto>) {
    Object.assign(this, partial);
  }
}
