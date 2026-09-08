import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';

/** 1 dòng lỗi theo cỡ đoạn (chỉ nhánh Phôi - xem QcReviewSegment). BẤT BIẾN sau khi tạo - bỏ hẳn
 *  resolvedQty/phoiReportedAt/phoiReportedQty (2026-09-07 lần 2, xem changelog "Bù đủ dồn về bảng
 *  tổng") - "Lỗi" hiển thị ở bảng tổng (getPhoiProgress/getStepProgress) giờ là Σ failedQty CỘNG
 *  DỒN LỊCH SỬ, không tự giảm. */
@Exclude()
export class QcReviewSegmentResponseDto {
  @Expose() @ApiProperty() segmentSpecId!: string;
  /** Decimal(7,1) ở DB - trả về number, xem SegmentSpec.cutLengthMm. */
  @Expose() @ApiProperty() cutLengthMm!: number;
  /** BẤT BIẾN - số KCS chấm lần đầu, không sửa. */
  @Expose() @ApiProperty() failedQty!: number;

  constructor(partial: Partial<QcReviewSegmentResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class QcReviewResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) steelIssueId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productionBatchId!: string | null;
  /** Đợt cắt được chấm (2026-09-05) - null với review CŨ (chấm cả lô, trước khi hạ vòng đời
   *  xuống đợt cắt) hoặc review nhánh Hàn/Sơn. */
  @Expose() @ApiPropertyOptional({ nullable: true }) cutBundleId!: string | null;
  /** Đợt gửi KCS theo công đoạn PHỤ (Uốn/Dập/Tán/..., 2026-09-07, xem StepBundle) - null với mọi
   *  nhánh khác, kể cả nhánh Cắt (cutBundleId ở trên). */
  @Expose() @ApiPropertyOptional({ nullable: true }) stepBundleId!: string | null;
  /** Đợt gửi KCS theo công đoạn (VTTP, 2026-09-07, xem PieceStepBundle) - null với mọi nhánh
   *  khác. */
  @Expose() @ApiPropertyOptional({ nullable: true }) pieceStepBundleId!: string | null;
  /** Tổng dẫn xuất từ segments[] cho nhánh Phôi (xem QcReview doc comment) - nhánh Hàn/Sơn vẫn là
   *  số gốc người dùng nhập (segments luôn rỗng ở nhánh đó). BẤT BIẾN mọi nhánh - số lịch sử cộng
   *  dồn, không tự giảm (xem changelog "Bù đủ dồn về bảng tổng"). */
  @Expose() @ApiProperty() failedQty!: number;
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
