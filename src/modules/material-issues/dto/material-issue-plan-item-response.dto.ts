import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { MfgStage } from '../../../generated/prisma/client';

/** "Cần xuất bao nhiêu" theo (material, stage) - mirror SteelIssuePlanItemResponseDto/
 *  WeavingIssuePlanItemResponseDto, nguồn định mức là ConsumableBom thay vì bomPiece/pieceBom. */
@Exclude()
export class MaterialIssuePlanItemResponseDto {
  @Expose() @ApiProperty({ enum: MfgStage }) stage!: MfgStage;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  /** ĐVT của vật tư (13/11/2026 - phiếu xuất đang lập trước để trống cột ĐVT). */
  @Expose() @ApiProperty() unit!: string;
  /** ConsumableBom.qtyPerUnit × ProductionOrder.quantity. */
  @Expose() @ApiProperty() requiredQty!: number;
  /** Σ MaterialIssue.issuedQty cho đúng (productionOrder, stage, material) này. */
  @Expose() @ApiProperty() issuedQty!: number;
  /** requiredQty - issuedQty. Cap dùng bởi MaterialIssuesService.create(). */
  @Expose() @ApiProperty() remainingToIssue!: number;

  constructor(partial: Partial<MaterialIssuePlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
