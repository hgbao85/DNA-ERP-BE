import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreateBomPartDto {
  @ApiProperty()
  @IsString()
  partId!: string;

  @ApiProperty({ description: 'SL chi tiết/bộ' })
  @IsInt()
  @Min(1)
  qtyPerUnit!: number;
}
