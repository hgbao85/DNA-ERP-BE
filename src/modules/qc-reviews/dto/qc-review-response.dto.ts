import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';

/** 1 dòng lỗi theo cỡ đoạn (chỉ nhánh Phôi - xem QcReviewSegment). */
@Exclude()
export class QcReviewSegmentResponseDto {
  @Expose() @ApiProperty() segmentSpecId!: string;
  /** Decimal(7,1) ở DB - trả về number, xem SegmentSpec.cutLengthMm. */
  @Expose() @ApiProperty() cutLengthMm!: number;
  /** BẤT BIẾN - số KCS chấm lần đầu, không sửa. */
  @Expose() @ApiProperty() failedQty!: number;
  /** KCS đã duyệt lại xác nhận đạt bao nhiêu - outstanding = failedQty - resolvedQty. */
  @Expose() @ApiProperty() resolvedQty!: number;
  /** Lúc Phôi bấm "Bù đủ" - null = chưa báo (hoặc KCS vừa duyệt lại thấy còn hỏng). */
  @Expose() @ApiPropertyOptional({ nullable: true }) phoiReportedAt!: Date | null;

  constructor(partial: Partial<QcReviewSegmentResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class QcReviewResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) steelIssueId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productionBatchId!: string | null;
  /** Tổng dẫn xuất từ segments[] cho nhánh Phôi (xem QcReview doc comment) - nhánh Hàn/Sơn vẫn là
   *  số gốc người dùng nhập (segments luôn rỗng ở nhánh đó). */
  @Expose() @ApiProperty() failedQty!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) scrapQty!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) defectReasonId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) defectReasonLabel!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) photoUrl!: string | null;
  @Expose() @ApiProperty() reviewedAt!: Date;
  @Expose() @ApiProperty() reviewedById!: string;
  /** Rỗng cho nhánh Hàn/Sơn (production_batch chưa có "cỡ" gì để bóc). */
  @Expose()
  @Type(() => QcReviewSegmentResponseDto)
  @ApiProperty({ type: [QcReviewSegmentResponseDto] })
  segments!: QcReviewSegmentResponseDto[];

  constructor(partial: Partial<QcReviewResponseDto>) {
    Object.assign(this, partial);
  }
}
