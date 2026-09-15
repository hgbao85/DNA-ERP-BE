import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class StockQuantResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() warehouseId!: string;
  @Expose() @ApiProperty() warehouseCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) segmentSpecId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) segmentSpecLabel!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) pieceId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) pieceCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productVariantId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productVariantLabel!: string | null;
  /** Chiều dài cây (mm) với sắt bán theo chiều dài, 0 cho loại khác - cùng mã sắt khác chiều dài là
   *  2 lô tồn RIÊNG (unique index warehouseId+materialId+stockLengthMm) nên phải lộ ra mới phân
   *  biệt được trên UI (trước 14/09/2026 field này bị ẩn, khiến nhiều nơi FE gộp nhầm/báo thiếu
   *  tồn cho vật tư Sắt đa-bucket). */
  @Expose() @ApiProperty() stockLengthMm!: number;
  @Expose() @ApiProperty() qty!: number;
  /** Vấn đề #13 audit 26/08 - `qty` (tồn thực tế) trừ phần đang bị giữ chỗ (cắt sắt/chuyển kho
   *  nội bộ ACTIVE), qua ĐÚNG MỘT hàm StockReservationsService.getAvailableQty() dùng chung với
   *  màn Xuất sắt - xem stock-quant.service.ts. Luôn === qty với dòng không có materialId
   *  (segmentSpec/piece/productVariant) vì reservation chỉ khoá theo materialId. */
  @Expose() @ApiProperty() availableQty!: number;
  @Expose() @ApiProperty() updatedAt!: Date;

  constructor(partial: Partial<StockQuantResponseDto>) {
    Object.assign(this, partial);
  }
}
