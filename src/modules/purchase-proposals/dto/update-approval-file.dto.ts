import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Admin-override: THAY hoặc XÓA HẲN file duyệt của Sếp khi lỡ upload nhầm - 2026-09-11, sửa lại
 * lần 2 cùng ngày. Ban đầu chỉ cho thay (không cho null) vì đọc doc comment schema
 * `PurchaseProposalItem.approvalFileUrl` ("BẰNG CHỨNG DUY NHẤT... Kho chỉ nhận hàng cho dòng đã có
 * file này") - nhưng rà lại `PurchaseProposalsService.receiveItem()` xác nhận nó KHÔNG hề đọc
 * `approvalFileUrl` (chỉ dựa vào `item.status`), nên field này thuần là bằng chứng lịch sử/audit,
 * không phải điều kiện chặn runtime nào - xóa không phá luồng nghiệp vụ. Theo yêu cầu người dùng
 * ("sếp cần xóa file của SKU đó thì sao? cứ để xóa, admin chỉ vào khi có sự cố"): route đã gate
 * ADMIN + tự ghi audit log (oldValue/newValue) nên mở khoá cho xóa (`approvalFileUrl: null`) là an
 * toàn - không như UpdateQcReviewPhotoDto/UpdateTransferCheckDefectPhotoDto vốn đã cho null từ đầu,
 * DTO này giờ theo đúng cùng khuôn.
 */
export class UpdateApprovalFileDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  approvalFileUrl?: string | null;
}
