import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** "Còn phải báo bao nhiêu" theo (mảnh, stage) - mirror MaterialIssuePlanItemResponseDto, nguồn
 *  định mức là BomPiece thay vì ConsumableBom. Piece không có cột stage (1 mảnh vật lý đi qua cả
 *  Hàn rồi Sơn rồi Đan) nên awaitingQcQty/passedQty phải tính riêng theo từng stage từ
 *  ProductionBatch, không tính sẵn ở BOM - xem ProductionBatchesService.getBatchPlan(). */
@Exclude()
export class ProductionBatchPlanItemResponseDto {
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() pieceName!: string;
  /** BomPiece.qtyPerUnit × ProductionOrder.quantity. */
  @Expose() @ApiProperty() plannedQty!: number;
  /** Σ ProductionBatch.reportedQty (status=AWAITING_QC) cho đúng (productionOrder, stage, mảnh). */
  @Expose() @ApiProperty() awaitingQcQty!: number;
  /** Σ ProductionBatch.reportedQty (status=QC_DONE) - đã là passed-qty sau khi KCS duyệt, không
   *  phải qty gốc đã báo. */
  @Expose() @ApiProperty() passedQty!: number;
  /** Chỉ có giá trị cho stage=PHOI khi piece có PieceMaterialYield (vd chân nhôm) - tồn nguyên
   *  liệu thô (vd thanh nhôm) hiện có tại kho, để FE cảnh báo "còn X cây chưa cắt hết" (chỉ hiển
   *  thị, không chặn thao tác - quyết định nghiệp vụ 2026-08-22). Null cho mọi trường hợp khác. */
  @Expose() @ApiProperty({ nullable: true }) rawMaterialOnHand!: number | null;

  constructor(partial: Partial<ProductionBatchPlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
