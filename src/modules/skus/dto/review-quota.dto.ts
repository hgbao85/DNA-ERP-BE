import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ReviewDecision } from '../../../generated/prisma/client';

export class ReviewQuotaDto {
  @ApiProperty({ enum: ReviewDecision })
  @IsEnum(ReviewDecision)
  status!: ReviewDecision;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
