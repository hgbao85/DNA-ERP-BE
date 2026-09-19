import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class TransferCheckPieceResponseDto {
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceName!: string;
  /** Suy từ BomPiece.qtyPerUnit (theo bomRevisionId đã ghim ở ProductionOrder) × quantity. */
  @Expose() @ApiProperty() totalQty!: number;
  /**
   * "Hiện có" - số đã về kho, sẵn sàng để kiểm; checkedQty không được vượt số này. Mảnh có đan
   * (BomPiece.isWoven): SUM(WeavingReceipt.qty), mọi điểm đan cộng lại (xem WeavingIssuesModule).
   * Mảnh không đan (Pat, Chân nhôm...): SUM(WarehouseTransferPieceItem.quantity) của phiếu chuyển
   * kho CONFIRMED.
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
