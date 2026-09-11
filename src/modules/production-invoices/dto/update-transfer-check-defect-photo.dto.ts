import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Admin-override CHỈ cho `imageUrl` của 1 TransferCheckDefect đã tồn tại - 2026-09-11, cùng lý do/
 * cùng ràng buộc UpdateQcReviewPhotoDto (xem qc-reviews module): `reason`/`checkedQty`/`checkedAt`/
 * `checkedById` là kết quả kiểm BẤT BIẾN, DTO này tuyệt đối không đụng tới. `imageUrl: null` = xóa
 * ảnh hẳn (ảnh chỉ là bằng chứng bổ trợ, không phải bằng chứng duy nhất).
 */
export class UpdateTransferCheckDefectPhotoDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  imageUrl?: string | null;
}
