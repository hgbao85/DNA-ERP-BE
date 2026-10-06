import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class MaterialYieldRecipePurchaseResultDto {
  @Expose() @ApiProperty() recipeId!: string;
  @Expose() @ApiProperty() outputMaterialCode!: string;
  @Expose()
  @ApiProperty({ description: 'Nguyên liệu đầu vào cần mua (vd thanh nhôm)' })
  materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() piecesPerBar!: number;
  @Expose()
  @ApiProperty({ description: 'Số đơn vị nguyên liệu vào cần có để đủ cắt (đã làm tròn lên)' })
  requiredInputQty!: number;
  @Expose()
  @ApiProperty({ description: 'Tồn nguyên liệu (cây/tấm) hiện có tại kho' })
  actualStock!: number;
  @Expose() @ApiProperty({ description: 'Số lượng cần mua thêm' }) buyQty!: number;
  @Expose() @ApiProperty() purchaseProposalId!: string;
  @Expose() @ApiProperty() purchaseProposalStatus!: string;

  constructor(partial: Partial<MaterialYieldRecipePurchaseResultDto>) {
    Object.assign(this, partial);
  }
}
