import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class ConsumableMaterialPurchaseResultDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose()
  @ApiProperty({
    description: 'Tổng nhu cầu gộp toàn PI (Dây/Đinh/Tán rút/Nút nhựa/Sơn/Phụ kiện/Bao bì)',
  })
  required!: number;
  @Expose() @ApiProperty({ description: 'Tồn nguyên liệu hiện có tại kho' }) actualStock!: number;
  @Expose() @ApiProperty({ description: 'Số lượng cần mua thêm' }) buyQty!: number;
  @Expose() @ApiProperty() purchaseProposalId!: string;
  @Expose() @ApiProperty() purchaseProposalStatus!: string;

  constructor(partial: Partial<ConsumableMaterialPurchaseResultDto>) {
    Object.assign(this, partial);
  }
}
