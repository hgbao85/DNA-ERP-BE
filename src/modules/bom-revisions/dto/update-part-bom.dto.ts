import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/** partId/segmentSpecId are immutable once created - delete and re-create to change either. */
export class UpdatePartBomDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  qtyPerPart!: number;
}
