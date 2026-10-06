import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** "Cần sản xuất/xuất bao nhiêu" cho 1 recipe trong phạm vi 1 PI - mirror
 *  MaterialYieldIssuePlanItemResponseDto, nhưng nguồn định mức là PieceMaterialItem (gộp qua MỌI
 *  mảnh cần đan có dùng outputMaterial này, không qua pieceId cụ thể nào) - xem
 *  MaterialYieldRecipesService.getProductionDemand(). */
@Exclude()
export class MaterialYieldRecipeDemandItemResponseDto {
  @Expose() @ApiProperty() recipeId!: string;
  @Expose() @ApiProperty() outputMaterialId!: string;
  @Expose() @ApiProperty() outputMaterialCode!: string;
  @Expose() @ApiProperty() outputMaterialName!: string;
  /** Σ BomPiece.qtyPerUnit × order.quantity qua mọi mảnh cần đan dùng outputMaterial này trong PI. */
  @Expose() @ApiProperty() requiredOutputQty!: number;
  /** Tồn kho outputMaterial hiện có (kho của chính outputMaterial, thường là vat-tu-tp). */
  @Expose() @ApiProperty() onHandOutputQty!: number;
  /** max(0, requiredOutputQty - onHandOutputQty) - phần còn thiếu, cần sản xuất thêm. */
  @Expose() @ApiProperty() shortfallOutputQty!: number;
  @Expose() @ApiProperty() inputMaterialId!: string;
  @Expose() @ApiProperty() inputMaterialCode!: string;
  @Expose() @ApiProperty() inputMaterialName!: string;
  /** ceil(shortfallOutputQty / piecesPerBar) - số đơn vị inputMaterial cần xuất để bù đủ. */
  @Expose() @ApiProperty() requiredInputQty!: number;

  constructor(partial: Partial<MaterialYieldRecipeDemandItemResponseDto>) {
    Object.assign(this, partial);
  }
}
