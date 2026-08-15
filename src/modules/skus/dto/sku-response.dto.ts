import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { PlanFormStatus } from '../../../generated/prisma/client';
import { SkuDetailReviewResponseDto, SkuManhReviewResponseDto } from './sku-review-response.dto';

@Exclude()
export class SkuResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderId!: string | null;
  @Expose() @ApiProperty() mfgProductId!: string;
  @Expose() @ApiProperty() factoryCode!: string;
  @Expose() @ApiProperty() productName!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) customerName!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productionInvoiceId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) piCode!: string | null;
  @Expose() @ApiProperty({ enum: PlanFormStatus }) status!: PlanFormStatus;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) origin!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) manhData!: unknown;
  @Expose() @ApiPropertyOptional({ nullable: true }) detailQuota!: unknown;
  /** KHSX đã chốt xong nhánh mảnh/chi tiết chưa - null = chưa. 2 nhánh độc lập, xem PlanForm.status. */
  @Expose() @ApiPropertyOptional({ nullable: true }) manhForwardedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) detailForwardedAt!: Date | null;
  @Expose() @ApiProperty() createdById!: string;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;
  @Expose()
  @ApiProperty({ type: [SkuManhReviewResponseDto] })
  @Type(() => SkuManhReviewResponseDto)
  manhReviews!: SkuManhReviewResponseDto[];
  @Expose()
  @ApiProperty({ type: [SkuDetailReviewResponseDto] })
  @Type(() => SkuDetailReviewResponseDto)
  detailReviews!: SkuDetailReviewResponseDto[];

  constructor(partial: Partial<SkuResponseDto>) {
    Object.assign(this, partial);
  }
}
