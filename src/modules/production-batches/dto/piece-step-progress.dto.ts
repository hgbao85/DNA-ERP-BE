import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ProcessStep } from '../../../generated/prisma/client';
import { PROCESS_STEPS } from '../../../common/constants/process-steps.constant';

/** Tiến độ 1 công đoạn (Cắt/Uốn/Dập/...) cho 1 mảnh vật tư thành phẩm trong 1 lệnh sản xuất -
 *  cùng shape required/done như PhoiProgressSegmentDto (Sắt) để FE dùng lại được UI panel, chỉ
 *  khác đơn vị: ở đây là SỐ MẢNH cho cả lệnh, không phải theo cỡ đoạn. requiredQty LUÔN =
 *  plannedQty của mảnh đó (mọi mảnh đều phải đi qua từng bước đã khai, không có tỉ lệ riêng theo
 *  bước như PieceBom.qtyPerPiece bên Sắt). */
@Exclude()
export class PieceStepProgressDto {
  @Expose() @ApiProperty({ enum: PROCESS_STEPS }) step!: ProcessStep;
  @Expose() @ApiProperty() requiredQty!: number;
  /** Σ PieceStepBatch.qty của đúng bước này - append-only, không trừ lỗi (không có khái niệm QC
   *  theo từng bước ở đây, chỉ có KCS duyệt lô cuối cùng qua ProductionBatch). */
  @Expose() @ApiProperty() doneQty!: number;

  constructor(partial: Partial<PieceStepProgressDto>) {
    Object.assign(this, partial);
  }
}
