import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSupplierDto {
  // Cắt khoảng trắng đầu/cuối + gộp khoảng trắng thừa; tên toàn dấu cách thành rỗng và bị chặn (test tay 09/11 điểm 19).
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Tên nhà cung cấp không được để trống' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  // 12/11/2026 (anh Nhân): mã số thuế + người liên hệ của NCC.
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  taxCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  contactName?: string;

  // Cho chọn trạng thái ngay lúc thêm; không gửi thì mặc định true (test tay 09/11 điểm 21).
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
