import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { DetailGroup, ManhGroup, ReviewDecision } from '../../../generated/prisma/client';

@Exclude()
export class PlanFormManhReviewResponseDto {
  @Expose() @ApiProperty({ enum: ManhGroup }) group!: ManhGroup;
  @Expose()
  @ApiPropertyOptional({ enum: ReviewDecision, nullable: true })
  status!: ReviewDecision | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) enteredBy!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) enteredAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reviewedAt!: Date | null;

  constructor(partial: Partial<PlanFormManhReviewResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class PlanFormDetailReviewResponseDto {
  @Expose() @ApiProperty({ enum: DetailGroup }) group!: DetailGroup;
  @Expose()
  @ApiPropertyOptional({ enum: ReviewDecision, nullable: true })
  status!: ReviewDecision | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) enteredBy!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) enteredAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reviewedAt!: Date | null;

  constructor(partial: Partial<PlanFormDetailReviewResponseDto>) {
    Object.assign(this, partial);
  }
}
