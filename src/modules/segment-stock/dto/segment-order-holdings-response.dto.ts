import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';

@Exclude()
export class SegmentHoldingWarehouseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiProperty() name!: string;

  constructor(partial: Partial<SegmentHoldingWarehouseDto>) {
    Object.assign(this, partial);
  }
}

/** 1 mã đoạn của lệnh: giữ / đã dùng / còn giữ + số phía cộng đã ghi (SegmentProduction). */
@Exclude()
export class SegmentOrderHoldingRowDto {
  @Expose()
  @Type(() => SegmentHoldingWarehouseDto)
  @ApiProperty({ type: SegmentHoldingWarehouseDto })
  warehouse!: SegmentHoldingWarehouseDto;
  @Expose() @ApiProperty() segmentSpecId!: string;
  @Expose() @ApiProperty() segmentSteps!: string;
  @Expose() @ApiProperty() label!: string;
  @Expose() @ApiProperty() reservedQty!: number;
  @Expose() @ApiProperty() consumedQty!: number;
  /** = reservedQty - consumedQty. */
  @Expose() @ApiProperty() remainingQty!: number;
  /** Đoạn của chính lệnh phía cộng đã đưa vào giữ (SegmentProduction.heldQty), 0 nếu chưa có. */
  @Expose() @ApiProperty() producedHeldQty!: number;
  /** Đoạn vượt số cần đã đưa vào cột dư (SegmentProduction.surplusQty), 0 nếu chưa có. */
  @Expose() @ApiProperty() producedSurplusQty!: number;

  constructor(partial: Partial<SegmentOrderHoldingRowDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class SegmentOrderHoldingLogDto {
  @Expose() @ApiProperty() id!: string;
  /** PRODUCE | SURPLUS_IN | CONSUME | RELEASE | TRANSFER. */
  @Expose() @ApiProperty() kind!: string;
  /** Có dấu (PRODUCE âm khi tính lại giảm). */
  @Expose() @ApiProperty() qty!: number;
  @Expose() @ApiProperty() warehouseId!: string;
  @Expose() @ApiProperty() segmentSpecId!: string;
  @Expose() @ApiProperty() segmentSteps!: string;
  @Expose() @ApiProperty() label!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) refType!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) refId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiPropertyOptional({ nullable: true }) createdById!: string | null;

  constructor(partial: Partial<SegmentOrderHoldingLogDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class SegmentOrderHoldingsResponseDto {
  @Expose() @ApiProperty() productionInvoiceId!: string;
  @Expose() @ApiProperty() productionInvoiceCode!: string;
  @Expose()
  @Type(() => SegmentOrderHoldingRowDto)
  @ApiProperty({ type: [SegmentOrderHoldingRowDto] })
  rows!: SegmentOrderHoldingRowDto[];
  /** 100 dòng nhật ký gần nhất của lệnh. */
  @Expose()
  @Type(() => SegmentOrderHoldingLogDto)
  @ApiProperty({ type: [SegmentOrderHoldingLogDto] })
  logs!: SegmentOrderHoldingLogDto[];

  constructor(partial: Partial<SegmentOrderHoldingsResponseDto>) {
    Object.assign(this, partial);
  }
}
