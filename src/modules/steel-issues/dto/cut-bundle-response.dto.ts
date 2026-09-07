import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class CutPatternSegmentResponseDto {
  @Expose() @ApiProperty() segmentSpecId!: string;
  @Expose() @ApiProperty() cutLengthMm!: number;
  /** TỔNG số đoạn cỡ này trong đợt - xem CutBatchSegmentDto.qty. */
  @Expose() @ApiProperty() qty!: number;

  constructor(partial: Partial<CutPatternSegmentResponseDto>) {
    Object.assign(this, partial);
  }
}

/**
 * 1 đợt cắt đã ghi nhận. Từ 2026-09-05 đây là ĐƠN VỊ MANG TRẠNG THÁI của công đoạn Phôi (trước
 * đây trạng thái nằm ở cả lô nhận - xem CutBundle.status trong schema): mỗi đợt tự đi
 * CUTTING → AWAITING_QC → QC_PASSED, KCS duyệt theo từng đợt.
 *
 * `barCount`/`mauNguyenMm`/`scrapMm` chỉ còn ý nghĩa với dữ liệu CŨ (đã bỏ 2 ô nhập, cân bằng vật
 * chất không còn) - dòng mới luôn 0.
 */
@Exclude()
export class CutBundleResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() steelIssueId!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) proposalPatternId!: string | null;
  /** true = không bám kiểu cắt đã duyệt nào. Từ 2026-08-22 gần như luôn true (Phôi khai số thực
   *  cắt, không chọn pattern) - KHÔNG còn là tín hiệu bất thường như trước. */
  @Expose() @ApiProperty() isOffPlan!: boolean;
  /** Số cây đã dùng trong đợt này - luôn 0 với dòng tạo từ 2026-09-05 (bỏ ô nhập). */
  @Expose() @ApiProperty() barCount!: number;
  /** Mẩu sắt còn nguyên (mm) - luôn 0 với dòng tạo từ 2026-09-05 (bỏ ô nhập). */
  @Expose() @ApiProperty() mauNguyenMm!: number;
  /** Phế liệu (mm) - luôn 0 với dòng tạo từ 2026-09-05 (không còn cân bằng để suy ra). */
  @Expose() @ApiProperty() scrapMm!: number;
  /** CUTTING | AWAITING_QC | QC_PASSED - vòng đời riêng của đợt cắt này. */
  @Expose() @ApiProperty() status!: string;
  /** Công đoạn đã xong của ĐỢT này (luôn có CAT ngay khi tạo). */
  @Expose() @ApiProperty({ type: [String] }) completedSteps!: string[];
  /** Công đoạn BẮT BUỘC theo định mức của loại sắt này - để FE biết còn thiếu bước nào. */
  @Expose() @ApiProperty({ type: [String] }) requiredSteps!: string[];
  @Expose() @ApiPropertyOptional({ nullable: true }) completedAt!: Date | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose()
  @ApiProperty({ type: [CutPatternSegmentResponseDto] })
  segments!: CutPatternSegmentResponseDto[];

  constructor(partial: Partial<CutBundleResponseDto>) {
    Object.assign(this, partial);
  }
}
