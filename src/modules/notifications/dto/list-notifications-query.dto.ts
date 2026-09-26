import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export type NotificationListStatus = 'unread' | 'all';

export class ListNotificationsQueryDto extends PaginationQueryDto {
  /** 'unread' = chỉ chưa đọc (readAt null); 'all' (mặc định) = mọi thông báo chưa tự ẩn. */
  @ApiPropertyOptional({ enum: ['unread', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['unread', 'all'])
  status: NotificationListStatus = 'all';

  /** Lọc theo 1 category (ANNOUNCEMENT/ACTION_REQUIRED/RESULT/ALERT/INFO) - bỏ trống = tất cả. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  /**
   * Lọc theo đã xử lý xong (resolvedAt) hay chưa - KHÁC `status` (đã đọc). "Cần xử lý" của
   * NotificationCenter dùng field này (category=ACTION_REQUIRED & resolved=false), KHÔNG dùng
   * status=unread - nếu không, bấm đọc 1 thông báo cần duyệt sẽ làm nó biến mất khỏi "Cần xử lý"
   * dù việc thật (vd duyệt đề xuất) chưa hề xong. "Đã đọc" và "đã xử lý" là 2 trục độc lập: 1
   * thông báo có thể đã đọc nhưng CHƯA xử lý (vẫn phải nằm trong "Cần xử lý", chỉ hết in đậm).
   */
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  resolved?: 'true' | 'false';
}
