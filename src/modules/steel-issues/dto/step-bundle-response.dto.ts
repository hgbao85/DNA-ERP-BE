import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';

@Exclude()
export class StepBundleSegmentResponseDto {
  @Expose() @ApiProperty() segmentSpecId!: string;
  @Expose() @ApiProperty() cutLengthMm!: number;
  /** TỔNG số đoạn cỡ này đã báo cho công đoạn này trong đợt gửi KCS - Σ mọi StepBatch đã gom vào. */
  @Expose() @ApiProperty() qty!: number;

  constructor(partial: Partial<StepBundleSegmentResponseDto>) {
    Object.assign(this, partial);
  }
}

/**
 * 1 "đợt gửi KCS" cho công đoạn PHỤ (Uốn/Dập/Tán/...) của 1 đợt cắt cụ thể (2026-09-07) - mirror
 * CutBundleResponseDto nhưng scope hẹp hơn (không barCount/mauNguyên/scrap). Xem StepBundle doc
 * comment (schema.prisma) tại sao KHÔNG còn là cờ tự khai (completedSteps) như trước.
 */
@Exclude()
export class StepBundleResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() cutBundleId!: string;
  @Expose() @ApiProperty() step!: string;
  /** AWAITING_QC | QC_PASSED - vòng đời riêng, ĐỘC LẬP với CutBundle.status (đợt cắt của chính
   *  công đoạn Cắt). */
  @Expose() @ApiProperty() status!: string;
  @Expose() @ApiProperty() submittedAt!: Date;
  @Expose() @ApiProperty() submittedById!: string;
  @Expose()
  @Type(() => StepBundleSegmentResponseDto)
  @ApiProperty({ type: [StepBundleSegmentResponseDto] })
  segments!: StepBundleSegmentResponseDto[];

  constructor(partial: Partial<StepBundleResponseDto>) {
    Object.assign(this, partial);
  }
}
