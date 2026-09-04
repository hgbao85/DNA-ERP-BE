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
  /** Mã kho THẬT chứa vật tư này (Material.warehouseId -> Warehouse.code, xem
   *  PackagingIssuesService.findMaterialWarehouseOrThrow() - cùng nguồn assertWarehouseScope()
   *  dùng để chặn create()). FE (WarehouseXuatPage) dùng field này để biết ĐÚNG kho nào (không chỉ
   *  gia đình 'vat-tu-tp' mặc định) mới thấy được dòng vật tư này trong màn Đóng gói - phát hiện
   *  2026-09-04: một số vật tư đóng gói (vd "Thùng"/VTK-009) lại được gán kho mặc định là CHÍNH
   *  kho thanh-pham gốc, không phải vat-tu-tp như đa số - trước đây FE gán cứng chỉ scope vat-tu-tp
   *  mới hiện màn này, khiến nhóm vật tư này không ai xuất được qua UI (thủ kho vat-tu-tp bị BE
   *  chặn scope, thủ kho thanh-pham thì FE không hiện màn Đóng gói cho họ). */
  @Expose() @ApiPropertyOptional({ nullable: true }) materialWarehouseCode!: string | null;
  /** BomAccessoryItem.qtyPerUnit × ProductionOrder.quantity. */
  @Expose() @ApiProperty() requiredQty!: number;
  /** Σ PackagingIssue.issuedQty cho đúng (productionOrder, material) này. */
  @Expose() @ApiProperty() issuedQty!: number;
  /** MIN(requiredQty theo BOM, số qua Chuyền kiểm đồng bộ theo mảnh) - issuedQty (2026-09-04) - cùng
   *  cap dùng bởi PackagingIssuesService.create(), không chỉ đơn thuần requiredQty - issuedQty. */
  @Expose() @ApiProperty() remainingToIssue!: number;

  constructor(partial: Partial<PackagingIssuePlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
