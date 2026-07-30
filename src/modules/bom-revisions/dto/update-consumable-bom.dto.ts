import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

/** stage/materialId are immutable once created - delete and re-create to change either. */
export class UpdateConsumableBomDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  qtyPerUnit!: number;
}
