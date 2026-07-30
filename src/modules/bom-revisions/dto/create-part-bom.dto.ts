import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreatePartBomDto {
  @ApiProperty({ description: 'Phải cùng mfg_product với bom_revision (kiểm ở service)' })
  @IsString()
  partId!: string;

  @ApiProperty()
  @IsString()
  segmentSpecId!: string;

  @ApiProperty({ description: 'perChiTiet' })
  @IsInt()
  @Min(1)
  qtyPerPart!: number;
}
