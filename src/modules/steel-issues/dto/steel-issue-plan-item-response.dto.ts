import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/**
 * "Cần xuất bao nhiêu" theo LOẠI SẮT cho CẢ 1 PI (gộp mọi mảnh/SKU dùng chung vật tư trong PI,
 * xem changelog 2026-08-18-xuat-sat-po-pi-vat-tu.md mục 2) - nguồn ĐÚNG là kết quả phần mềm tính
 * cắt sắt đã duyệt (CuttingProposalLine.totalBars/bestStockLengthMm), KHÔNG phải định mức BOM (sửa
 * 2026-09-05: Mua hàng cũng mua theo đúng số này nên "Cần" phải khớp, số đoạn BOM không dùng ở đây
 * nữa). Không có bảng "kế hoạch xuất sắt" riêng.
 */
@Exclude()
export class SteelIssuePlanItemResponseDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  /** Σ CuttingProposalLine.totalBars (đơn vị CÂY) của mọi dòng phương án cắt APPROVED còn phủ vật
   *  tư này trong PI. 0 nếu vật tư chỉ còn lịch sử đã xuất (phương án phủ nó đã bị tính lại). */
  @Expose() @ApiProperty() requiredBars!: number;
  /** Chiều dài cây (mm) mà mọi dòng phương án cắt đã duyệt cho vật tư này trong PI đã CHỐT dùng
   *  chung - DB-enforced bởi CuttingProposalsService.findConflictingStockLengthReason() lúc duyệt,
   *  nên không thể có 2 giá trị khác nhau. `null` nếu không còn dòng nào hiệu lực. */
  @Expose() @ApiProperty({ nullable: true }) bestStockLengthMm!: number | null;
  /** Σ barCount các đợt SteelIssue gốc (không tính rework) đã xuất cho vật tư này trong cả PI. */
  @Expose() @ApiProperty() issuedBarCount!: number;
  /// B4 Đợt 3c (mục 13.6 changelog) - phần CÒN được xuất theo giữ chỗ (quantity - consumedQty)
  /// của CuttingProposal đã duyệt cho vật tư này. `null` = phương án duyệt TRƯỚC
  /// STEEL_ISSUE_RESERVATION_CUTOVER (không giữ chỗ, cơ chế cũ) hoặc chưa có phương án nào -
  /// không phải 0, tránh hiểu nhầm "không được xuất gì" khi thật ra không bị giới hạn qua đường
  /// giữ chỗ (theo dõi bằng requiredBars/issuedBarCount như trước giờ).
  @Expose() @ApiProperty({ nullable: true }) remainingToIssue!: number | null;
  /// Tồn vật lý thật trong kho (stock_quant) của vật tư này TẠI THỜI ĐIỂM xem màn hình - không
  /// phải số dành riêng cho lệnh này, chỉ để thủ kho biết kho có bao nhiêu trước khi xuất.
  /// `null` = vật tư chưa được gán Kho (Material.warehouseId trống).
  @Expose() @ApiProperty({ nullable: true }) physicalStockQty!: number | null;

  constructor(partial: Partial<SteelIssuePlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
