import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/** Thợ (Phôi/Hàn/Sơn) tự khai đã sửa xong bao nhiêu khi bấm "Bù đủ" (2026-09-07, nhánh
 *  productionBatchId) - THAM KHẢO cho KCS, validate 1 <= qty <= outstanding ở service vì cần đọc
 *  DB mới biết outstanding (= failedQty - (scrapQty ?? 0) - resolvedQty). */
export class ReportProductionBatchDoneDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}
