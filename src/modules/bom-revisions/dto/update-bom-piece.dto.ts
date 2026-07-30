import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/** pieceId is immutable once created - delete and re-create to point at a different piece. */
export class UpdateBomPieceDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  qtyPerUnit!: number;
}
