import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** GET /production-capacity - dạng/khoảng ngày do service kiểm (câu báo lỗi tiếng Việt). */
export class CapacityQueryDto {
  @ApiPropertyOptional({ description: 'Ngày bắt đầu YYYY-MM-DD (giờ VN). Mặc định: hôm nay.' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Ngày kết thúc YYYY-MM-DD. Mặc định: from + 13 ngày. Tối đa 62 ngày.',
  })
  @IsOptional()
  @IsString()
  to?: string;
}
