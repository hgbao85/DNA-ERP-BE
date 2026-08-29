import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsString, Min, MinLength } from 'class-validator';

/** Công cụ "khai lại cỡ cây" cho tồn kho cũ (kế hoạch "chiều dài cây sắt" 2026-08-29, Bước 8) -
 *  thủ kho kiểm kê thật rồi khai "N cây bucket X thực tế là cỡ Y". KHÔNG dùng để tạo/xoá tồn -
 *  chỉ chuyển tồn ĐANG CÓ từ bucket này sang bucket khác của CÙNG 1 vật tư, CÙNG 1 kho. */
export class RebucketStockDto {
  @ApiProperty()
  @IsString()
  warehouseId!: string;

  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty({ description: 'Bucket hiện tại (mm) - 0 = "chưa xác định cỡ cây"' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fromStockLengthMm!: number;

  @ApiProperty({ description: 'Bucket thật sau khi kiểm kê (mm)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  toStockLengthMm!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  qty!: number;

  @ApiProperty({
    description: 'Lý do khai lại (vd "kiểm kê thực tế 2026-09-01") - bắt buộc, để tra soát sau này',
  })
  @IsString()
  @MinLength(1)
  note!: string;
}
