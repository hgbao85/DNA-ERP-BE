import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateQcReviewDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  failedQty!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defectReasonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  photoUrl?: string;
}
