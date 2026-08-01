import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { PlanFormStatus } from '../../../generated/prisma/client';
import {
  PlanFormDetailReviewResponseDto,
  PlanFormManhReviewResponseDto,
} from './plan-form-review-response.dto';

@Exclude()
export class PlanFormResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() salesOrderId!: string;
  @Expose() @ApiProperty() mfgProductId!: string;
  @Expose() @ApiProperty() factoryCode!: string;
  @Expose() @ApiProperty() productName!: string;
  @Expose() @ApiProperty() customerName!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) productionInvoiceId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) piCode!: string | null;
  @Expose() @ApiProperty({ enum: PlanFormStatus }) status!: PlanFormStatus;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) origin!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) manhData!: unknown;
  @Expose() @ApiPropertyOptional({ nullable: true }) detailQuota!: unknown;
  @Expose() @ApiPropertyOptional({ nullable: true }) qlsxReviewedAt!: Date | null;
  @Expose() @ApiProperty() createdById!: string;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;
  @Expose()
  @ApiProperty({ type: [PlanFormManhReviewResponseDto] })
  @Type(() => PlanFormManhReviewResponseDto)
  manhReviews!: PlanFormManhReviewResponseDto[];
  @Expose()
  @ApiProperty({ type: [PlanFormDetailReviewResponseDto] })
  @Type(() => PlanFormDetailReviewResponseDto)
  detailReviews!: PlanFormDetailReviewResponseDto[];

  constructor(partial: Partial<PlanFormResponseDto>) {
    Object.assign(this, partial);
  }
}
