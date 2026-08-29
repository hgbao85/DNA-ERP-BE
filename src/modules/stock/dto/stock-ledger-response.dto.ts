import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { StockLedgerRefType } from '../../../generated/prisma/client';

/** Đúng 1 trong 4 cặp {xxxId, xxxLabel} khác null trên mỗi dòng - mirror XOR của chính bảng gốc. */
@Exclude()
export class StockLedgerResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() fromWarehouseId!: string;
  @Expose() @ApiProperty() fromWarehouseCode!: string;
  @Expose() @ApiProperty() toWarehouseId!: string;
  @Expose() @ApiProperty() toWarehouseCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) segmentSpecId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) segmentSpecLabel!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) pieceId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) pieceCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productVariantId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productVariantLabel!: string | null;
  @Expose() @ApiProperty() stockLengthMm!: number;
  @Expose() @ApiProperty() qty!: number;
  @Expose() @ApiProperty({ enum: StockLedgerRefType }) refType!: StockLedgerRefType;
  @Expose() @ApiPropertyOptional({ nullable: true }) refId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiPropertyOptional({ nullable: true }) createdById!: string | null;

  constructor(partial: Partial<StockLedgerResponseDto>) {
    Object.assign(this, partial);
  }
}
