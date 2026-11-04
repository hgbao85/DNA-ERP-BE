import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

/**
 * Người mua chốt "số mua" cho 1 dòng đề xuất (2026-11-04, YC7 mục 7.2) - tăng cho tròn số tối
 * thiểu NCC bán. Phải >= "cần mua" (buyQty) hiện tại; null (hoặc bằng đúng buyQty) = bỏ số đã
 * chốt, mua đúng số cần mua.
 */
export class UpdateOrderQtyDto {
  @ApiPropertyOptional({ nullable: true, description: 'Số mua; null = mua đúng số cần mua' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  orderQty?: number | null;
}
