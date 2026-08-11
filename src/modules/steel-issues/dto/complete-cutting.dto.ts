import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class CutBundleSegmentDto {
  @ApiProperty()
  @IsString()
  segmentSpecId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  countPerBar!: number;
}

export class CutBundleDto {
  /** NULL = cắt ngoài đề xuất (cho phép, cảnh báo isOffPlan ở response - không chặn cứng). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  proposalPatternId?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  barCount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  wastePerBarMm?: number;

  @ApiProperty({ type: [CutBundleSegmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CutBundleSegmentDto)
  segments!: CutBundleSegmentDto[];
}

export class CompleteCuttingDto {
  /** Số cây Phôi báo thực cắt - null = đúng như xuất (SteelIssue.barCount). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  actualBarCount?: number;

  @ApiProperty({ type: [CutBundleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CutBundleDto)
  bundles!: CutBundleDto[];
}
