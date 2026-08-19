import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** "Cần xuất bao nhiêu vật tư đóng gói" theo (PO, vật tư) — mirror PieceTransferPlanItemResponseDto
 *  (warehouse-transfers) nhưng nguồn định mức là BomAccessoryItem (kind=PACKAGING) thay vì
 *  BomPiece, và gộp nhiều PO trong 1 lần gọi (WarehouseXuatPage cần liệt kê mọi PO đang hoạt động
 *  cùng lúc, giống getPieceTransferPlan()). */
@Exclude()
export class PackagingIssuePlanItemResponseDto {
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty() productName!: string;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() materialUnit!: string;
  /** BomAccessoryItem.qtyPerUnit × ProductionOrder.quantity. */
  @Expose() @ApiProperty() requiredQty!: number;
  /** Σ PackagingIssue.issuedQty cho đúng (productionOrder, material) này. */
  @Expose() @ApiProperty() issuedQty!: number;
  /** requiredQty - issuedQty. Cap dùng bởi PackagingIssuesService.create(). */
  @Expose() @ApiProperty() remainingToIssue!: number;

  constructor(partial: Partial<PackagingIssuePlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
