import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreateSegmentSpecDto {
  @ApiProperty({ description: 'Phải trỏ tới material thuộc nhóm vật tư Sắt (systemKey=STEEL_BAR)' })
  @IsString()
  materialId!: string;

  @ApiProperty({ description: 'vd 930' })
  @IsInt()
  @Min(1)
  cutLengthMm!: number;
}
