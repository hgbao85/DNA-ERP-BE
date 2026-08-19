import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ProcessStep, SteelIssueStatus } from '../../../generated/prisma/client';
import { CutBundleResponseDto } from './cut-bundle-response.dto';

@Exclude()
export class SteelIssueResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionInvoiceId!: string;
  /// Mã PI (ProductionInvoice.code) - luôn có, kể cả PI gộp (isMerged) không gắn 1 đơn Sales cụ
  /// thể nào.
  @Expose() @ApiProperty() piCode!: string;
  /// Mã đơn hàng Sales gốc (SalesOrder.code) - null cho PI gộp (isMerged, xem
  /// ProductionInvoice.salesOrderId).
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
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
  /** Hợp (union) PieceBom.processSteps của MỌI mảnh dùng materialId này trong cả PI (+ CAT mặc
   *  định) - hệ thống không biết trước cây sắt xuất ra sẽ về mảnh nào nên phải giả định xấu nhất
   *  (mảnh nào cũng có thể dùng), xem SteelIssuesService.resolveRequiredSteps(). Danh sách công
   *  đoạn phải xong hết trước khi chuyển AWAITING_QC. */
  @Expose() @ApiProperty({ enum: ProcessStep, isArray: true }) requiredSteps!: ProcessStep[];
  @Expose() @ApiPropertyOptional({ type: [CutBundleResponseDto] }) bundles?: CutBundleResponseDto[];

  constructor(partial: Partial<SteelIssueResponseDto>) {
    Object.assign(this, partial);
  }
}
