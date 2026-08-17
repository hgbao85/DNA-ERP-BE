import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateBomPieceDto {
  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiProperty({ description: 'SL mảnh/SKU' })
  @IsInt()
  @Min(1)
  qtyPerUnit!: number;

  @ApiPropertyOptional({ default: false, description: 'Mảnh này có cần routing sang Hàn' })
  @IsOptional()
  @IsBoolean()
  needsHan?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Mảnh này có cần routing sang Sơn' })
  @IsOptional()
  @IsBoolean()
  needsSon?: boolean;
}
