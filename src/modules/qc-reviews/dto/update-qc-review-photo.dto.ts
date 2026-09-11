import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Admin-override CHỈ cho `photoUrl` (bằng chứng đính kèm) - 2026-09-11, theo yêu cầu người dùng
 * "chọn nhầm ảnh thì Admin sửa/xóa lại được". `failedQty`/`reason`/`defectReasonId`/`reviewedAt`/
 * `reviewedById` là phán quyết KCS, BẤT BIẾN theo đúng doc comment gốc (xem QcReview/
 * QcReviewSegment ở schema.prisma) - tuyệt đối KHÔNG thêm field nào khác vào DTO này.
 *
 * `photoUrl: null` = xóa ảnh hẳn (không bắt buộc phải thay bằng ảnh khác, khác
 * PurchaseProposalItem.approvalFileUrl - ảnh KCS chỉ là bằng chứng bổ trợ, không phải "bằng chứng
 * duy nhất" của cả quyết định).
 */
export class UpdateQcReviewPhotoDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  photoUrl?: string | null;
}
