import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** "Cần xuất bao nhiêu" theo material - mirror MaterialIssuePlanItemResponseDto, nguồn định mức là
 *  PieceMaterialYield thay vì ConsumableBom (không có field `stage` - luôn PHÔI). 1 material có
 *  thể dùng cho NHIỀU piece trong cùng order (vd cùng thanh nhôm cho cả "chân nhôm" và mảnh khác) -
 *  requiredQty gộp Σ qua mọi piece dùng material này. */
@Exclude()
export class MaterialYieldIssuePlanItemResponseDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  /** Σ ceil(plannedQty(piece) × qtyPerPiece / piecesPerBar) qua mọi PieceMaterialYield dùng
   *  material này trong revision - cùng công thức PieceMaterialYieldPurchaseService dùng để tính
   *  đề xuất mua, chỉ khác đơn vị đích (đây tính "cần xuất kho", không phải "cần mua thêm"). */
  @Expose() @ApiProperty() requiredQty!: number;
  /** Σ MaterialYieldIssue.issuedQty cho đúng (productionOrder, material) này. */
  @Expose() @ApiProperty() issuedQty!: number;
  /** requiredQty - issuedQty. Cap dùng bởi MaterialYieldIssuesService.create(). */
  @Expose() @ApiProperty() remainingToIssue!: number;

  constructor(partial: Partial<MaterialYieldIssuePlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
