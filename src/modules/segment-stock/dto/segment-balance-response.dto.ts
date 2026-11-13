import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** 1 ô tồn đoạn (kho Phôi, cỡ đoạn, bộ công đoạn): tồn = còn giữ cho các lệnh + dư chung của xưởng. */
@Exclude()
export class SegmentBalanceResponseDto {
  @Expose() @ApiProperty() warehouseId!: string;
  @Expose() @ApiProperty() warehouseCode!: string;
  @Expose() @ApiProperty() warehouseName!: string;
  @Expose() @ApiProperty() segmentSpecId!: string;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() cutLengthMm!: number;
  /** Bộ công đoạn ('' = trơn). */
  @Expose() @ApiProperty() segmentSteps!: string;
  @Expose() @ApiProperty() segmentStepsLabel!: string;
  /** Nhãn đầy đủ của mã đoạn, vd "SAT-005 @ 460mm · Dập". */
  @Expose() @ApiProperty() label!: string;
  /** Tồn thực tế (stock_quant). */
  @Expose() @ApiProperty() onHandQty!: number;
  /** Σ còn giữ (đã giữ - đã dùng) của mọi lệnh. */
  @Expose() @ApiProperty() heldQty!: number;
  /** Dư chung của xưởng = tồn - còn giữ. ĐƯỢC âm khi dữ liệu cũ âm (không kẹp về 0 để lộ ra sai lệch). */
  @Expose() @ApiProperty() surplusQty!: number;
  /** Số lệnh đang còn giữ đoạn ở ô này. */
  @Expose() @ApiProperty() holdingOrderCount!: number;

  constructor(partial: Partial<SegmentBalanceResponseDto>) {
    Object.assign(this, partial);
  }
}
