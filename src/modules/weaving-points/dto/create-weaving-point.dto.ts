import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateWeavingPointDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  aliasNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'Đơn giá % theo loại kỹ thuật đan' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  dayDaiPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  ketThucPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  hangQuanPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
