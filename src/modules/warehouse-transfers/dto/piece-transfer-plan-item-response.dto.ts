import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** MANH = needsHan=true (dù có needsSon hay không); VAT_TU_THANH_PHAM = needsHan=false - mốc
 *  "sẵn sàng" cho VAT_TU_THANH_PHAM đọc ProductionBatch(stage=PHOI), xem WarehouseTransfersService
 *  .getPieceTransferPlan() (khôi phục 21/08/2026 - trước đó nhánh này bị loại khỏi kế hoạch, xem
 *  quyết định thiết kế gốc mục 6 docs/review-2026-08-17-sanxuat-stage-v16-va-chuyen-kho-manh.md). */
export type PieceTransferLabel = 'MANH' | 'VAT_TU_THANH_PHAM';

@Exclude()
export class PieceTransferPlanItemResponseDto {
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty() productName!: string;
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() pieceName!: string;
  @Expose() @ApiProperty({ enum: ['MANH', 'VAT_TU_THANH_PHAM'] }) label!: PieceTransferLabel;
  /** Tổng số đã qua KCS tính đến hiện tại (mốc cuối theo needsHan/needsSon - mục 7.1). */
  @Expose() @ApiProperty() readyQty!: number;
  /** Tổng đã nằm trong phiếu PENDING hoặc CONFIRMED trước đó - chống đếm trùng qua nhiều đợt. */
  @Expose() @ApiProperty() transferredQty!: number;
  /** max(0, readyQty - transferredQty) - số gợi ý khi tạo phiếu, không ép cứng. */
  @Expose() @ApiProperty() suggestedQty!: number;

  constructor(partial: Partial<PieceTransferPlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
