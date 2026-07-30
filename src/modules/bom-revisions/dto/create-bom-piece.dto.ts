import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreateBomPieceDto {
  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiProperty({ description: 'SL mảnh/SKU' })
  @IsInt()
  @Min(1)
  qtyPerUnit!: number;
}
