import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateWarehouseDto {
  @ApiProperty({ description: "vd 'thanh-pham-2' cho kho thành phẩm phụ" })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ default: false, description: 'true = kho ảo, không có tồn vật lý' })
  @IsOptional()
  @IsBoolean()
  isVirtual?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
