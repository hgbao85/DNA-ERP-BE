import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class PackagingResponseDto {
  /** ProductionOrder.quantity - không qua PackagingBom (đó là định mức vật tư đóng gói). */
  @Expose() @ApiProperty() totalQty!: number;
  /** SUM(PackagingRecord.boxesPacked). */
  @Expose() @ApiProperty() packedQty!: number;
  @Expose() @ApiProperty() remainingQty!: number;

  constructor(partial: Partial<PackagingResponseDto>) {
    Object.assign(this, partial);
  }
}
