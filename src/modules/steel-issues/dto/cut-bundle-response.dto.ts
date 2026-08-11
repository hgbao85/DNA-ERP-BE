import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class CutPatternSegmentResponseDto {
  @Expose() @ApiProperty() segmentSpecId!: string;
  @Expose() @ApiProperty() cutLengthMm!: number;
  @Expose() @ApiProperty() countPerBar!: number;

  constructor(partial: Partial<CutPatternSegmentResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class CutBundleResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) proposalPatternId!: string | null;
  /** true = pattern đề xuất không có (cắt ngoài đề xuất) - cần đối chiếu lại, không chặn. */
  @Expose() @ApiProperty() isOffPlan!: boolean;
  @Expose() @ApiProperty() barCount!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) wastePerBarMm!: number | null;
  @Expose()
  @ApiProperty({ type: [CutPatternSegmentResponseDto] })
  segments!: CutPatternSegmentResponseDto[];

  constructor(partial: Partial<CutBundleResponseDto>) {
    Object.assign(this, partial);
  }
}
