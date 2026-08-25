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
 * 1 đợt cắt đã ghi nhận, kèm ĐỦ 2 VẾ cân bằng vật chất để đối chiếu:
 *   barCount × barLengthMm = trim + đoạn + mạch cưa + mẩu nguyên + phế
 */
@Exclude()
export class CutBundleResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) proposalPatternId!: string | null;
  /** true = không bám kiểu cắt đã duyệt nào. Từ 2026-08-22 gần như luôn true (Phôi khai số thực
   *  cắt, không chọn pattern) - KHÔNG còn là tín hiệu bất thường như trước. */
  @Expose() @ApiProperty() isOffPlan!: boolean;
  /** Số cây đã dùng trong đợt này. */
  @Expose() @ApiProperty() barCount!: number;
  /** Mẩu sắt còn nguyên (mm) - nhập lại kho, KHÔNG phải phế liệu. */
  @Expose() @ApiProperty() mauNguyenMm!: number;
  /** Phế liệu (mm) - phần dư của phương trình cân bằng, hệ thống tự tính. */
  @Expose() @ApiProperty() scrapMm!: number;
  @Expose()
  @ApiProperty({ type: [CutPatternSegmentResponseDto] })
  segments!: CutPatternSegmentResponseDto[];

  constructor(partial: Partial<CutBundleResponseDto>) {
    Object.assign(this, partial);
  }
}
