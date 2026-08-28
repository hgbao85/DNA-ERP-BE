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
