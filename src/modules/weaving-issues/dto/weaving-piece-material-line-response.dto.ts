import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** 1 dòng vật tư Dây/Đinh trong định mức của mảnh (PieceMaterialItem) - mirror
 *  toPieceMaterialLine() ở SkusService, chỉ giữ lại các field cần cho màn hình xuất đan. */
@Exclude()
export class WeavingPieceMaterialLineResponseDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialSpec!: string | null;
  @Expose() @ApiProperty() materialUnit!: string;
  @Expose() @ApiProperty() qtyPerPiece!: number;
  /// Σ WeavingIssueMaterial.qty của MỌI lần xuất đan cho piece này (mọi điểm đan) - 2026-09-11.
  /// KHÁC piece.issuedQty (số mảnh) - đây là số vật tư thật đã mang đi kèm, thủ kho tự gõ lúc xuất.
  @Expose() @ApiProperty() issuedQty!: number;
  /// Tồn kho hiện có (StockQuant.qty, CHƯA trừ giữ chỗ WarehouseTransferReservation/
  /// StockReservation - chỉ tham khảo hiển thị, không phải số dùng để chặn xuất; create() tự kiểm
  /// availableQty thật lúc ghi sổ) tại đúng kho của material này (Material.warehouseId).
  @Expose() @ApiProperty() onHandQty!: number;

  constructor(partial: Partial<WeavingPieceMaterialLineResponseDto>) {
    Object.assign(this, partial);
  }
}
