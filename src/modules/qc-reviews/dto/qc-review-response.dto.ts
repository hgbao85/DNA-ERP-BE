import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class QcReviewResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) steelIssueId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productionBatchId!: string | null;
  @Expose() @ApiProperty() failedQty!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) scrapQty!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) defectReasonId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) defectReasonLabel!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) photoUrl!: string | null;
  @Expose() @ApiProperty() reviewedAt!: Date;
  @Expose() @ApiProperty() reviewedById!: string;

  constructor(partial: Partial<QcReviewResponseDto>) {
    Object.assign(this, partial);
  }
}
