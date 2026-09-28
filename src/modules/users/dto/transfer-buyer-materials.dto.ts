import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class TransferBuyerMaterialsDto {
  @ApiProperty({
    description: 'Nhân viên mua hàng NHẬN toàn bộ vật tư (Material.buyerId) của user nguồn',
  })
  @IsString()
  @IsNotEmpty()
  toUserId!: string;
}
