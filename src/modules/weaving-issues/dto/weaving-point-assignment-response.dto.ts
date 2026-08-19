import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** 1 dòng (mảnh, PO) đang/đã giữ ở 1 điểm đan - dùng trong WeavingPointGroupResponseDto.assignments
 *  (GET /weaving-issues/by-point, "Quản lý điểm đan"). Khác WeavingIssuePlanItemResponseDto: gộp
 *  CẢ issue lẫn receipt cho đúng 1 (productionOrderId, pieceId) tại 1 điểm đan, không tách riêng
 *  từng đợt. */
@Exclude()
export class WeavingPointAssignmentResponseDto {
  /** Mã đơn Sales gốc nếu có, fallback ProductionOrder.poNumber - cùng convention
   *  toIssueResponseDto/toReceiptResponseDto. */
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiProperty() productLabel!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() pieceName!: string;
  /** Σ WeavingIssue.qty đã xuất cho (PO, mảnh) này tại điểm đan. */
  @Expose() @ApiProperty() quantity!: number;
  /** Σ WeavingReceipt.qty đã nhận về. */
  @Expose() @ApiProperty() completed!: number;
  /** quantity - completed - số điểm đan đang giữ, chưa trả về. */
  @Expose() @ApiProperty() holding!: number;

  constructor(partial: Partial<WeavingPointAssignmentResponseDto>) {
    Object.assign(this, partial);
  }
}
