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
  /** Σ PieceStepBatch.qty của đúng bước này (gộp cả đã gửi KCS lẫn chưa) - append-only, không trừ
   *  lỗi. */
  @Expose() @ApiProperty() doneQty!: number;
  /** Σ PieceStepBundle.qty (MỌI status) của đúng bước này (2026-09-07) - "còn chưa gửi KCS" =
   *  doneQty - submittedQty, dùng cho nút "Gửi KCS" ở FE (chỉ gửi được phần này). */
  @Expose() @ApiProperty() submittedQty!: number;
  /** Σ PieceStepBundle.qty đã KCS duyệt (status=QC_PASSED) của đúng bước này (2026-09-07, xem
   *  PieceStepBundle) - dùng để FE tự hiện CẢNH BÁO (không chặn) khi doneQty của bước SAU vượt
   *  passedQty của bước liền TRƯỚC (theo processSteps đã chuẩn hoá thứ tự), từ khi BE bỏ chặn cứng
   *  "vượt bước trước" ở recordPieceStepBatch(). 0 khi chưa có bundle nào được duyệt. */
  @Expose() @ApiProperty() passedQty!: number;
  /** Σ QcReview.failedQty CỘNG DỒN LỊCH SỬ của đúng bước này (2026-09-07 lần 2, xem changelog
   *  "Bù đủ dồn về bảng tổng") - KHÔNG tự giảm (bỏ hẳn cơ chế report-done/recheck theo công đoạn).
   *  FE hiện nút "Bù đủ" khi remaining > 0 && failedQty > 0, chỉ gợi ý sẵn số lượng vào ô nhập -
   *  Phôi làm thêm rồi gửi KCS như đợt mới, "Còn lại" tự đúng vì cộng thêm doneQty. */
  @Expose() @ApiProperty() failedQty!: number;

  constructor(partial: Partial<PieceStepProgressDto>) {
    Object.assign(this, partial);
  }
}
