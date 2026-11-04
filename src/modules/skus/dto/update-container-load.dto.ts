import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Phần A – Đợt 1 (YC9): sửa kích thước thùng + số thùng/bộ + load cont nhập tay của 1 SKU (MfgProduct).
 * Field không gửi (undefined) = giữ nguyên; gửi `null` = xoá giá trị. `@IsOptional` bỏ qua cả undefined lẫn null.
 */
export class UpdateContainerLoadDto {
  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Dài thùng (cm), 0.1-1000, tối đa 1 số lẻ',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0.1)
  @Max(1000)
  boxLengthCm?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Rộng thùng (cm), 0.1-1000, tối đa 1 số lẻ',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0.1)
  @Max(1000)
  boxWidthCm?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Cao thùng (cm), 0.1-1000, tối đa 1 số lẻ',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0.1)
  @Max(1000)
  boxHeightCm?: number | null;

  @ApiPropertyOptional({ description: 'Số thùng của 1 bộ, 1-20 (mặc định 1)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  boxesPerSet?: number;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Load cont nhập tay (thắng công thức), 1-100000; null = xoá',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  loadContManual?: number | null;
}
