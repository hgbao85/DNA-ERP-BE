import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** "Còn phải báo bao nhiêu" theo (part, stage) - mirror MaterialIssuePlanItemResponseDto, nguồn
 *  định mức là BomPart thay vì ConsumableBom. Part không có cột stage (1 Part vật lý đi qua cả
 *  Hàn rồi Sơn) nên awaitingQcQty/passedQty phải tính riêng theo từng stage từ ProductionBatch,
 *  không tính sẵn ở BOM - xem ProductionBatchesService.getBatchPlan(). */
@Exclude()
export class ProductionBatchPlanItemResponseDto {
  @Expose() @ApiProperty() partId!: string;
  @Expose() @ApiProperty() partCode!: string;
  @Expose() @ApiProperty() partName!: string;
  /** BomPart.qtyPerUnit × ProductionOrder.quantity. */
  @Expose() @ApiProperty() plannedQty!: number;
  /** Σ ProductionBatch.reportedQty (status=AWAITING_QC) cho đúng (productionOrder, stage, part). */
  @Expose() @ApiProperty() awaitingQcQty!: number;
  /** Σ ProductionBatch.reportedQty (status=QC_DONE) - đã là passed-qty sau khi KCS duyệt, không
   *  phải qty gốc đã báo. */
  @Expose() @ApiProperty() passedQty!: number;

  constructor(partial: Partial<ProductionBatchPlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
