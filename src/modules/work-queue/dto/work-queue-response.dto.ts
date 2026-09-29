import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** Badge "việc chờ tôi" trên menu (Phase 4, changelog 2026-09-25 mục 6.3/8) - mirror
 *  UnreadCountResponseDto (Record phẳng, không khai cứng từng field) vì số key thực trả về LUÔN
 *  chỉ là tập con khớp đúng role của người gọi (WorkQueueService.getWorkQueue() chỉ query những gì
 *  liên quan, không tính dư cho role người dùng không có) - FE đọc field nào không có mặt thì coi
 *  như 0/ẩn badge đó, không phải lỗi. Xem WORK_QUEUE_KEYS (work-queue.service.ts) cho danh sách đầy
 *  đủ key có thể xuất hiện + role nào tạo ra key nào. */
@Exclude()
export class WorkQueueResponseDto {
  @Expose() @ApiProperty({ type: Object }) counts!: Record<string, number>;

  constructor(partial: WorkQueueResponseDto) {
    Object.assign(this, partial);
  }
}
