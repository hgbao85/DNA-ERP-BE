import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** Endpoint poll rẻ cho chuông FE (mục 5.4/6.1 changelog 2026-09-25) - tránh phải tải cả danh sách
 *  chỉ để vẽ số trên badge. */
@Exclude()
export class UnreadCountResponseDto {
  @Expose() @ApiProperty() total!: number;
  @Expose() @ApiProperty({ type: Object }) byCategory!: Record<string, number>;

  constructor(partial: UnreadCountResponseDto) {
    Object.assign(this, partial);
  }
}
