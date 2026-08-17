import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

/** pieceId is immutable once created - delete and re-create to point at a different piece. */
export class UpdateBomPieceDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  qtyPerUnit!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  needsHan?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  needsSon?: boolean;
}
