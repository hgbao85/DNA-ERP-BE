import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ description: '= SKU code hiển thị' })
  @IsString()
  @MinLength(1)
  factoryCode!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
