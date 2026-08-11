import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreateWeavingReceiptDto {
  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiProperty()
  @IsString()
  weavingPointId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}
