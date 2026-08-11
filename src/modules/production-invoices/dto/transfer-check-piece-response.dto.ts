import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class TransferCheckPieceResponseDto {
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceName!: string;
  /** Suy từ BomPiece.qtyPerUnit (theo bomRevisionId đã ghim ở ProductionOrder) × quantity. */
  @Expose() @ApiProperty() totalQty!: number;
  /**
   * Đã sản xuất xong, sẵn sàng để kiểm - CHƯA có dữ liệu thật (phụ thuộc sản lượng thật của
   * công đoạn Đan, domain đó chưa xây - xem comment model TransferCheckResult). Luôn 0 cho tới
   * khi có dữ liệu thật, cố tình không dùng số giả.
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
