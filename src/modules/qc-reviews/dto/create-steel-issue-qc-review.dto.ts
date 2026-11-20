import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsSystemUploadUrl } from '../../../common/validators/system-upload-url.validator';

export class QcReviewSegmentInputDto {
  @ApiProperty()
  @IsString()
  segmentSpecId!: string;

  /** Số đoạn KHÔNG ĐẠT - đoạn hỏng thật, Phôi phải bù bằng sắt tự kiếm ngoài thực tế (không đụng
   *  cây sắt kho đã cấp). Lỗi nhẹ (giũa/nắn lại được) xem như không phải lỗi, không liệt kê ở đây.
   *  P1 (18/11/2026): hạ xuống ≥ 0 vì dòng có thể chỉ ghi thiếu; luật "failedQty + shortQty ≥ 1" kiểm ở service. */
  @ApiProperty()
  @IsInt()
  @Min(0)
  failedQty!: number;

  /** P1: số đoạn KCS ghi THIẾU so với số báo của cỡ này (đã trừ, không tính lỗi, không làm bù). Mặc định 0. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  shortQty?: number;

  /** P1: trong failedQty, số đoạn phải BỎ và cắt lại (chỉ đợt công đoạn phụ; đợt Cắt bỏ qua, lưu 0). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  scrapQty?: number;
}

/** KCS chấm 1 SteelIssue (nhánh Phôi) THEO TỪNG CỠ ĐOẠN - thay CreateQcReviewDto (scalar
 *  failedQty) cho riêng route POST steel-issues/:id/qc-review. CreateQcReviewDto giữ nguyên cho
 *  POST production-batches/:id/qc-review (Hàn/Sơn/VTTP chốt cuối). */
export class CreateSteelIssueQcReviewDto {
  /** Rỗng = đạt hết, không cỡ nào lỗi. Thiếu hẳn thì báo "thiếu danh sách" (T4-9, 19/11/2026:
   *  trước đây ra câu "có giá trị bị trùng" vì ArrayUnique cũng rớt khi undefined). */
  @ApiProperty({ type: [QcReviewSegmentInputDto] })
  @IsDefined({ message: 'Thiếu danh sách cỡ đoạn, đạt hết thì gửi danh sách rỗng' })
  @IsArray({ message: 'Danh sách cỡ đoạn phải là một mảng' })
  @ArrayUnique((s: QcReviewSegmentInputDto) => s.segmentSpecId, {
    message: 'Danh sách cỡ đoạn có cỡ bị trùng',
  })
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
  @IsSystemUploadUrl()
  photoUrl?: string;
}
