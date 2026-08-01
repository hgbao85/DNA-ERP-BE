import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

/** materialId is immutable once created - delete and re-create to change it. */
export class UpdateBomAccessoryItemDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  qtyPerUnit!: number;
}
