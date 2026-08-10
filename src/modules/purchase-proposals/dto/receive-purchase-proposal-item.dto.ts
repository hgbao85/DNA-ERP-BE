import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class ReceivePurchaseProposalItemDto {
  @ApiProperty({ description: 'Số lượng nhận theo material.unit (đơn vị tồn kho), vd cái' })
  @IsNumber()
  @Min(1)
  receivedQty!: number;

  @ApiPropertyOptional({
    description:
      'Số lượng nhận theo material.purchaseUnit (đơn vị mua hàng, vd kg) - chỉ để đối chiếu/audit, không dùng để tính tồn kho. Gửi kèm khi material có purchaseUnit.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  receivedQtyPurchaseUnit?: number;
}
