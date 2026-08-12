import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RecordPackagingDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  boxesPacked!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
