import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class QcReviewSegmentInputDto {
  @ApiProperty()
  @IsString()
  segmentSpecId!: string;

  /** Số đoạn KHÔNG ĐẠT - đoạn hỏng thật, Phôi phải bù bằng sắt tự kiếm ngoài thực tế (không đụng
   *  cây sắt kho đã cấp). Lỗi nhẹ (giũa/nắn lại được) xem như không phải lỗi, không liệt kê ở đây. */
  @ApiProperty()
  @IsInt()
  @Min(1)
  failedQty!: number;
}

/** KCS chấm 1 SteelIssue (nhánh Phôi) THEO TỪNG CỠ ĐOẠN - thay CreateQcReviewDto (scalar
 *  failedQty/scrapQty) cho riêng route POST steel-issues/:id/qc-review. CreateQcReviewDto giữ
 *  nguyên cho POST production-batches/:id/qc-review (Hàn/Sơn, không đổi). */
export class CreateSteelIssueQcReviewDto {
  /** Rỗng = đạt hết, không cỡ nào lỗi. */
  @ApiProperty({ type: [QcReviewSegmentInputDto] })
  @IsArray()
  @ArrayUnique((s: QcReviewSegmentInputDto) => s.segmentSpecId)
  @ValidateNested({ each: true })
  @Type(() => QcReviewSegmentInputDto)
  segments!: QcReviewSegmentInputDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defectReasonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  photoUrl?: string;
}
