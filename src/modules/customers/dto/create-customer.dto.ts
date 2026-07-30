import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({
    description: 'Nới lỏng NOT NULL - khách xuất khẩu thường không có SĐT nội địa',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'Chỉ có ý nghĩa với khách xuất khẩu' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({
    description: "Thị trường/kênh bán, vd 'Amazon/Walmart' - chỉ khách xuất khẩu",
  })
  @IsOptional()
  @IsString()
  market?: string;

  @ApiPropertyOptional({ description: 'Người liên hệ phía khách - chỉ khách xuất khẩu' })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
