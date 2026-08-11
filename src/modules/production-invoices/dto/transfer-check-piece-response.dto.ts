import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class TransferCheckPieceResponseDto {
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceName!: string;
  /** Suy từ BomPiece.qtyPerUnit (theo bomRevisionId đã ghim ở ProductionOrder) × quantity. */
  @Expose() @ApiProperty() totalQty!: number;
  /**
   * Đã đan xong, sẵn sàng để kiểm - SUM(WeavingReceipt.qty) theo mảnh, mọi điểm đan cộng lại
   * (xem WeavingIssuesModule, M2 "Phân bổ/nhận hàng đan", đóng gap 2026-08-11).
   */
  @Expose() @ApiProperty() readyQty!: number;
  /** SUM checkedQty của mọi lần kiểm đã ghi cho mảnh này. */
  @Expose() @ApiProperty() checkedQty!: number;
  /** Tổng số lỗi đã ghi nhận qua mọi lần kiểm. */
  @Expose() @ApiProperty() defectCount!: number;

  constructor(partial: Partial<TransferCheckPieceResponseDto>) {
    Object.assign(this, partial);
  }
}
