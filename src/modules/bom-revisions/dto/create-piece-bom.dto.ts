import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePieceBomDto {
  @ApiProperty({ description: 'Phải cùng mfg_product với bom_revision (kiểm ở service)' })
  @IsString()
  pieceId!: string;

  @ApiProperty()
  @IsString()
  segmentSpecId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qtyPerPiece!: number;

  @ApiPropertyOptional({ default: false, description: 'Dùng routing sang Hàn' })
  @IsOptional()
  @IsBoolean()
  needsHan?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Dùng routing sang Sơn' })
  @IsOptional()
  @IsBoolean()
  needsSon?: boolean;
}
