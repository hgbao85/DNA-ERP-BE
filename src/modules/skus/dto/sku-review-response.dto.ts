import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { DetailGroup, ManhGroup, ReviewDecision } from '../../../generated/prisma/client';

@Exclude()
export class SkuManhReviewResponseDto {
  @Expose() @ApiProperty({ enum: ManhGroup }) group!: ManhGroup;
  @Expose()
  @ApiPropertyOptional({ enum: ReviewDecision, nullable: true })
  status!: ReviewDecision | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) enteredBy!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) enteredAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reviewedAt!: Date | null;

  constructor(partial: Partial<SkuManhReviewResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class SkuDetailReviewResponseDto {
  @Expose() @ApiProperty({ enum: DetailGroup }) group!: DetailGroup;
  @Expose()
  @ApiPropertyOptional({ enum: ReviewDecision, nullable: true })
  status!: ReviewDecision | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) enteredBy!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) enteredAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reviewedAt!: Date | null;

  constructor(partial: Partial<SkuDetailReviewResponseDto>) {
    Object.assign(this, partial);
  }
}
