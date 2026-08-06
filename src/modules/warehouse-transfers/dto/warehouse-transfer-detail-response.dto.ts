import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { WarehouseTransferItemResponseDto } from './warehouse-transfer-item-response.dto';
import { WarehouseTransferResponseDto } from './warehouse-transfer-response.dto';

@Exclude()
export class WarehouseTransferDetailResponseDto extends WarehouseTransferResponseDto {
  @Expose()
  @ApiProperty({ type: [WarehouseTransferItemResponseDto] })
  @Type(() => WarehouseTransferItemResponseDto)
  items!: WarehouseTransferItemResponseDto[];

  constructor(partial: Partial<WarehouseTransferDetailResponseDto>) {
    super(partial);
    Object.assign(this, partial);
  }
}
