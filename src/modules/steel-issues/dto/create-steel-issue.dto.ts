import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreateSteelIssueDto {
  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  barLengthMm!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  barCount!: number;
}
