import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { WarehouseTransferItemResponseDto } from './warehouse-transfer-item-response.dto';
import { WarehouseTransferPieceItemResponseDto } from './warehouse-transfer-piece-item-response.dto';
import { WarehouseTransferResponseDto } from './warehouse-transfer-response.dto';

@Exclude()
export class WarehouseTransferDetailResponseDto extends WarehouseTransferResponseDto {
  @Expose()
  @ApiProperty({ type: [WarehouseTransferItemResponseDto] })
  @Type(() => WarehouseTransferItemResponseDto)
  items!: WarehouseTransferItemResponseDto[];

  /** Rỗng cho phiếu vật tư, có dữ liệu cho phiếu piece - 1 phiếu chỉ chứa 1 trong 2 loại
   *  (quyết định "không gộp" mục 7.5). */
  @Expose()
  @ApiProperty({ type: [WarehouseTransferPieceItemResponseDto] })
  @Type(() => WarehouseTransferPieceItemResponseDto)
  pieceItems!: WarehouseTransferPieceItemResponseDto[];

  constructor(partial: Partial<WarehouseTransferDetailResponseDto>) {
    super(partial);
    Object.assign(this, partial);
  }
}
