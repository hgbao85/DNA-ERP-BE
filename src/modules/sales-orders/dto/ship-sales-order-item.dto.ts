import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ShipSalesOrderItemDto {
  @ApiProperty({ description: 'Số lượng vừa xuất, cộng dồn vào shippedQty hiện có của item' })
  @IsInt()
  @Min(1)
  qty!: number;
}
