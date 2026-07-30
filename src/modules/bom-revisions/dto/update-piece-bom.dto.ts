import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

/** pieceId/segmentSpecId are immutable once created - delete and re-create to change either. */
export class UpdatePieceBomDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  qtyPerPiece!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  needsHan?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  needsSon?: boolean;
}
