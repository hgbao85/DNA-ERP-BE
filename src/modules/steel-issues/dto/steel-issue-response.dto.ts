import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ProcessStep, SteelIssueStatus } from '../../../generated/prisma/client';
import { CutBundleResponseDto } from './cut-bundle-response.dto';

@Exclude()
export class SteelIssueResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionOrderId!: string;
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() pieceName!: string;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() barLengthMm!: number;
  @Expose() @ApiProperty() barCount!: number;
  @Expose() @ApiProperty({ enum: SteelIssueStatus }) status!: SteelIssueStatus;
  @Expose() @ApiPropertyOptional({ nullable: true }) actualBarCount!: number | null;
  @Expose() @ApiProperty() issuedAt!: Date;
  @Expose() @ApiProperty() issuedById!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) completedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reworkOfId!: string | null;
  /** Công đoạn đã đánh dấu xong (luôn có CAT sau completeCutting) - xem SteelIssue.completedSteps. */
  @Expose() @ApiProperty({ enum: ProcessStep, isArray: true }) completedSteps!: ProcessStep[];
  /** Union PieceBom.processSteps của piece này (+ CAT mặc định) - danh sách công đoạn phải xong
   *  hết trước khi chuyển AWAITING_QC, xem SteelIssuesService.resolveRequiredSteps(). */
  @Expose() @ApiProperty({ enum: ProcessStep, isArray: true }) requiredSteps!: ProcessStep[];
  @Expose() @ApiPropertyOptional({ type: [CutBundleResponseDto] }) bundles?: CutBundleResponseDto[];

  constructor(partial: Partial<SteelIssueResponseDto>) {
    Object.assign(this, partial);
  }
}
