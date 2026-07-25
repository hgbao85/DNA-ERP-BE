import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  username!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password!: string;
}
