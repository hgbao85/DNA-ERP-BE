import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/**
 * "Cần xuất bao nhiêu" theo mảnh - suy trực tiếp từ piece_bom × bom_piece ×
 * production_order.quantity, trừ Σ SteelIssue gốc đã xuất (loại rework). Không có bảng "kế
 * hoạch xuất sắt" riêng - đúng quyết định thiết kế trong plan (xem roadmap M2).
 */
@Exclude()
export class SteelIssuePlanItemResponseDto {
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() pieceName!: string;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  /** Σ qtyPerPiece (đoạn) × qtyPerUnit (mảnh/SKU) × production_order.quantity. */
  @Expose() @ApiProperty() requiredSegments!: number;
  /** Σ barCount các đợt SteelIssue gốc (không tính rework) đã xuất cho mảnh này. */
  @Expose() @ApiProperty() issuedBarCount!: number;

  constructor(partial: Partial<SteelIssuePlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
