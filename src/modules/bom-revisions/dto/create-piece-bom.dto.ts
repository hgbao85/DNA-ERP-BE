import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePieceBomDto {
  @ApiProperty({ description: 'Phải cùng mfg_product với bom_revision (kiểm ở service)' })
  @IsString()
  pieceId!: string;

  @ApiProperty()
  @IsString()
  segmentSpecId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qtyPerPiece!: number;

  @ApiPropertyOptional({ description: 'vd "mạ kẽm", "cắt vát 45°"' })
  @IsOptional()
  @IsString()
  note?: string;
}
