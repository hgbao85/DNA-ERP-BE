import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

/** mfgProductId comes from the route param, never the body - see ProductsController. */
export class CreatePieceDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty()
  @IsInt()
  groupNumber!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  pieceNumber?: number;

  @ApiProperty({ description: 'vd "Mảnh Tựa" - chỉ định danh, không mang số liệu định mức' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isWoven?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  weavingPrice?: number;
}
