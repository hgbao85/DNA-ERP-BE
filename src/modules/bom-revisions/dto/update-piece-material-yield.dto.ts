import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/** pieceId/materialId are immutable once created - delete and re-create to change either. */
export class UpdatePieceMaterialYieldDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  piecesPerBar!: number;
}
