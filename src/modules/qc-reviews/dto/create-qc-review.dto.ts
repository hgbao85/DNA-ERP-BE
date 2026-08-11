import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateQcReviewDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  failedQty!: number;

  /** Trong đó phế (đề xuất cấp lại sắt) - CHECK scrapQty <= failedQty, sửa được = failed - scrap. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  scrapQty?: number;

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
