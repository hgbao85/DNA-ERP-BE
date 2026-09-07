import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/** KCS duyệt lại lô (Phôi/Hàn/Sơn) đã báo "Bù đủ" (2026-09-07, nhánh productionBatchId) -
 *  remainingFailedQty=0 nghĩa là đạt hết phần sửa được, >0 là còn hỏng bấy nhiêu (mở lại lượt báo
 *  mới). Cùng ngữ nghĩa QcRecheckDto bên Sắt nhưng KHÔNG có mảng segments - nhánh này không có
 *  "cỡ đoạn", 1 review = 1 đơn vị outstanding duy nhất. */
export class RecheckProductionBatchDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  remainingFailedQty!: number;
}
