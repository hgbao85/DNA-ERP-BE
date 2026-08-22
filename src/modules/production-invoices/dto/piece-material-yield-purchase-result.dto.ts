import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class PieceMaterialYieldPurchaseResultDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose()
  @ApiProperty({ description: 'Tổng nhu cầu piece (needsHan=false) gộp toàn PI' })
  requiredPieces!: number;
  @Expose()
  @ApiProperty({ description: 'Tồn piece sẵn sàng (pool ảo, không tính riêng theo PI/đơn hàng)' })
  onHandPieces!: number;
  @Expose() @ApiProperty() piecesPerBar!: number;
  @Expose()
  @ApiProperty({ description: 'Số cây cần có để đủ cắt (đã làm tròn lên)' })
  barsNeeded!: number;
  @Expose()
  @ApiProperty({ description: 'Tồn nguyên liệu (cây) hiện có tại kho' })
  actualStock!: number;
  @Expose() @ApiProperty({ description: 'Số cây cần mua thêm' }) buyQty!: number;
  @Expose() @ApiProperty() purchaseProposalId!: string;
  @Expose() @ApiProperty() purchaseProposalStatus!: string;

  constructor(partial: Partial<PieceMaterialYieldPurchaseResultDto>) {
    Object.assign(this, partial);
  }
}
