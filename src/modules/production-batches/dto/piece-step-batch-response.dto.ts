import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ProcessStep } from '../../../generated/prisma/client';
import { PROCESS_STEPS } from '../../../common/constants/process-steps.constant';

@Exclude()
export class PieceStepBatchResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty({ enum: PROCESS_STEPS }) step!: ProcessStep;
  @Expose() @ApiProperty() qty!: number;
  @Expose() @ApiProperty() reportedAt!: Date;
  @Expose() @ApiProperty() reportedById!: string;

  constructor(partial: Partial<PieceStepBatchResponseDto>) {
    Object.assign(this, partial);
  }
}
