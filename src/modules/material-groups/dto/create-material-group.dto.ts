import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateMaterialGroupDto {
  @ApiProperty({ description: 'vd Sắt ống, Dây đan, Phụ kiện, Sơn, Bao bì' })
  @IsString()
  @MinLength(1)
  name!: string;
}
