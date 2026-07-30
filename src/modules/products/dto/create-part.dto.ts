import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** mfgProductId comes from the route param, never the body - see ProductsController. */
export class CreatePartDto {
  @ApiProperty({ description: 'vd "J55-TUA"' })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty({ description: 'vd "Ráp khung tựa"' })
  @IsString()
  @MinLength(1)
  name!: string;
}
