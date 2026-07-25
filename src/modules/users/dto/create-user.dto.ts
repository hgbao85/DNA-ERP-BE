import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: 'Login identifier - not the email' })
  @IsString()
  @MinLength(3)
  @Matches(/^[a-zA-Z0-9_.-]+$/, {
    message: 'username may only contain letters, numbers, dot, underscore and hyphen',
  })
  username!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty()
  @IsString()
  firstName!: string;

  @ApiProperty()
  @IsString()
  lastName!: string;

  @ApiPropertyOptional({ type: [String], description: 'Role ids to assign on creation' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  roleIds?: string[];
}
