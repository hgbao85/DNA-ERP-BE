import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/** Phôi tự khai đã sửa xong bao nhiêu đoạn khi bấm "Bù đủ" (2026-09-07) - THAM KHẢO cho KCS, validate
 *  1 <= qty <= outstanding hiện tại (failedQty - resolvedQty) ở service vì cần đọc DB mới biết. */
export class ReportSegmentDoneDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}
