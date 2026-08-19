import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/**
 * "Cần xuất bao nhiêu" theo LOẠI SẮT cho CẢ 1 PI (gộp mọi mảnh/SKU dùng chung vật tư trong PI,
 * xem changelog 2026-08-18-xuat-sat-po-pi-vat-tu.md mục 2) - suy trực tiếp từ piece_bom ×
 * bom_piece × production_order.quantity của MỌI ProductionOrder thuộc PI, trừ Σ SteelIssue gốc
 * đã xuất (loại rework). Không có bảng "kế hoạch xuất sắt" riêng.
 */
@Exclude()
export class SteelIssuePlanItemResponseDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  /** Σ qtyPerPiece (đoạn) × qtyPerUnit (mảnh/SKU) × production_order.quantity, cộng dồn mọi
   *  mảnh/PO thuộc PI dùng vật tư này. */
  @Expose() @ApiProperty() requiredSegments!: number;
  /** Σ barCount các đợt SteelIssue gốc (không tính rework) đã xuất cho vật tư này trong cả PI. */
  @Expose() @ApiProperty() issuedBarCount!: number;
  /// B4 Đợt 3c (mục 13.6 changelog) - phần CÒN được xuất theo giữ chỗ (quantity - consumedQty)
  /// của CuttingProposal đã duyệt cho vật tư này. `null` = phương án duyệt TRƯỚC
  /// STEEL_ISSUE_RESERVATION_CUTOVER (không giữ chỗ, cơ chế cũ) hoặc chưa có phương án nào -
  /// không phải 0, tránh hiểu nhầm "không được xuất gì" khi thật ra không bị giới hạn qua đường
  /// giữ chỗ (theo dõi bằng requiredSegments/issuedBarCount như trước giờ).
  @Expose() @ApiProperty({ nullable: true }) remainingToIssue!: number | null;
  /// Tồn vật lý thật trong kho (stock_quant) của vật tư này TẠI THỜI ĐIỂM xem màn hình - không
  /// phải số dành riêng cho lệnh này, chỉ để thủ kho biết kho có bao nhiêu trước khi xuất.
  /// `null` = vật tư chưa được gán Kho (Material.warehouseId trống).
  @Expose() @ApiProperty({ nullable: true }) physicalStockQty!: number | null;

  constructor(partial: Partial<SteelIssuePlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
