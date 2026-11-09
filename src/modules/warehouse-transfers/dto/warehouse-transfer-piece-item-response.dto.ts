import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class WarehouseTransferPieceItemResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() pieceName!: string;
  /** Chờ nhận: số gửi. Đã nhận: số thực nhận (v8 4.7). */
  @Expose() @ApiProperty() quantity!: number;
  /** Số kho giao gửi khi thực nhận ít hơn; null = nhận đủ. */
  @Expose() @ApiPropertyOptional({ nullable: true, type: Number }) sentQty!: number | null;
  /** Số LSX của lệnh (in phiếu). */
  @Expose() @ApiPropertyOptional({ nullable: true, type: String }) lenhCode!: string | null;
  @Expose() @ApiProperty() sku!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;

  constructor(partial: Partial<WarehouseTransferPieceItemResponseDto>) {
    Object.assign(this, partial);
  }
}
