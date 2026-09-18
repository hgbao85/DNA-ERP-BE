import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateOfficeSupplyDto {
  @ApiPropertyOptional({
    description:
      'CHỈ bắt buộc khi caller KHÔNG có warehouseScope (Boss/Admin/tổng kho) - thủ kho có scope thì field này bị bỏ qua, vật tư LUÔN được tạo trong ĐÚNG kho họ phụ trách.',
  })
  @IsOptional()
  @IsString()
  warehouseCode?: string;

  @ApiPropertyOptional({
    description:
      'Để trống sẽ không có mã (không bắt buộc, khác Material). Unique THEO KHO, không unique toàn cục.',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ description: 'vd "Bút bi Thiên Long"' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: 'vd "cái", "hộp", "cây"' })
  @IsString()
  unit!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: 'Tồn ban đầu - ghi 1 dòng lịch sử reason=INITIAL nếu > 0. Bỏ trống = tồn 0.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  openingQty?: number;
}
