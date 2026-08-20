import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, Min } from 'class-validator';

export class CreateSegmentSpecDto {
  @ApiProperty({ description: 'Phải trỏ tới material thuộc nhóm vật tư Sắt (systemKey=STEEL_BAR)' })
  @IsString()
  materialId!: string;

  /// Decimal(7,1) ở DB (2026-08-19) - dữ liệu thật có chiều dài lẻ 1 chữ số thập phân (vd
  /// 590.5mm), IsInt() cũ sẽ chặn nhầm giá trị hợp lệ. maxDecimalPlaces khớp đúng độ phân giải
  /// cột DB - gửi 590.55 sẽ bị từ chối ở tầng validate thay vì âm thầm mất số ở tầng lưu.
  @ApiProperty({ description: 'vd 930 hoặc 590.5 (tối đa 1 chữ số thập phân)' })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  cutLengthMm!: number;
}
