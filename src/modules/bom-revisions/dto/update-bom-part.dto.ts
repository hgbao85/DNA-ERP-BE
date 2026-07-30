import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/** partId is immutable once created - delete and re-create to point at a different part. */
export class UpdateBomPartDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  qtyPerUnit!: number;
}
