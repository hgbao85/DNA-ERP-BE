import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ProcessStep } from '../../../generated/prisma/client';

@Exclude()
export class StepBatchSegmentResponseDto {
  @Expose() @ApiProperty() segmentSpecId!: string;
  @Expose() @ApiProperty() cutLengthMm!: number;
  @Expose() @ApiProperty() qty!: number;

  constructor(partial: Partial<StepBatchSegmentResponseDto>) {
    Object.assign(this, partial);
  }
}

/** 1 đợt "đã gia công" đã ghi nhận cho 1 công đoạn chi tiết - xem RecordStepBatchDto. */
@Exclude()
export class StepBatchResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty({ enum: ProcessStep }) step!: ProcessStep;
  @Expose()
  @ApiProperty({ type: [StepBatchSegmentResponseDto] })
  segments!: StepBatchSegmentResponseDto[];

  constructor(partial: Partial<StepBatchResponseDto>) {
    Object.assign(this, partial);
  }
}
