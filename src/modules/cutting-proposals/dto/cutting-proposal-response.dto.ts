import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { CuttingProposalStatus } from '../../../generated/prisma/client';

@Exclude()
export class CuttingProposalSegmentResponseDto {
  @Expose() @ApiProperty() segmentSpecId!: string;
  @Expose() @ApiProperty() cutLengthMm!: number;
  @Expose() @ApiProperty() countPerBar!: number;

  constructor(partial: Partial<CuttingProposalSegmentResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class CuttingProposalPatternResponseDto {
  @Expose() @ApiProperty() patternIndex!: number;
  @Expose() @ApiProperty() barCount!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) wastePerBarMm!: number | null;
  /// > 0 = cây thuộc pattern này cắt dở, phần còn lại để nguyên nhập kho (xem Phôi).
  @Expose() @ApiPropertyOptional({ nullable: true }) mauNguyenMm!: number | null;
  @Expose()
  @ApiProperty({ type: [CuttingProposalSegmentResponseDto] })
  @Type(() => CuttingProposalSegmentResponseDto)
  segments!: CuttingProposalSegmentResponseDto[];

  constructor(partial: Partial<CuttingProposalPatternResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class LengthComparisonEntryResponseDto {
  @Expose() @ApiProperty() length!: number;
  @Expose() @ApiProperty() bars!: number;
  @Expose() @ApiProperty() wastePct!: number;
}

@Exclude()
export class CuttingProposalLineResponseDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() unit!: string;
  @Expose() @ApiProperty() feasible!: boolean;
  @Expose() @ApiPropertyOptional({ nullable: true }) bestStockLengthMm!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) totalBars!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) totalWasteMm!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) wastePercentage!: number | null;
  /// Tổng mẩu sắt còn nguyên (chưa cắt) của loại sắt này - nhập kho, không phải hao hụt.
  @Expose() @ApiPropertyOptional({ nullable: true }) mauNguyenMm!: number | null;
  @Expose()
  @ApiPropertyOptional({ type: [LengthComparisonEntryResponseDto], nullable: true })
  lengthComparison!: { length: number; bars: number; wastePct: number }[] | null;
  @Expose()
  @ApiProperty({ type: [CuttingProposalPatternResponseDto] })
  @Type(() => CuttingProposalPatternResponseDto)
  patterns!: CuttingProposalPatternResponseDto[];

  constructor(partial: Partial<CuttingProposalLineResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class CuttingProposalResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiProperty() mfgProductCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) mfgProductName!: string | null;
  @Expose() @ApiProperty({ enum: CuttingProposalStatus }) status!: CuttingProposalStatus;
  @Expose() @ApiPropertyOptional({ nullable: true }) totalBarsAll!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) totalWasteMm!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) wastePercentage!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) errorMessage!: string | null;
  @Expose() @ApiProperty() requestedAt!: Date;
  @Expose() @ApiPropertyOptional({ nullable: true }) completedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) approvedAt!: Date | null;
  @Expose()
  @ApiPropertyOptional({ type: [CuttingProposalLineResponseDto] })
  @Type(() => CuttingProposalLineResponseDto)
  lines?: CuttingProposalLineResponseDto[];

  constructor(partial: Partial<CuttingProposalResponseDto>) {
    Object.assign(this, partial);
  }
}
