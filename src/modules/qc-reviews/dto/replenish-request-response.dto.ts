import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ReplenishRequestStatus } from '../../../generated/prisma/client';

@Exclude()
export class ReplenishRequestResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() qcReviewId!: string;
  @Expose() @ApiProperty({ enum: ReplenishRequestStatus }) status!: ReplenishRequestStatus;
  @Expose() @ApiProperty() qty!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) fulfilledByIssueId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) fulfilledAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) fulfilledById!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;

  constructor(partial: Partial<ReplenishRequestResponseDto>) {
    Object.assign(this, partial);
  }
}
