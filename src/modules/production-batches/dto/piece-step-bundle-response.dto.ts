import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { PieceStepBundleStatus, ProcessStep } from '../../../generated/prisma/client';
import { PROCESS_STEPS } from '../../../common/constants/process-steps.constant';

/** 1 "đợt gửi KCS" theo công đoạn (2026-09-07) - xem PieceStepBundle doc comment (schema.prisma)
 *  tại sao KHÔNG đụng ProductionBatch.reportedQty. */
@Exclude()
export class PieceStepBundleResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionOrderId!: string;
  /** Mã nội bộ (ProductionOrder.poNumber) - chỉ hệ thống dùng, khớp shape BeProductionBatch. */
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  /** Mã PI (ProductionInvoice.code) - dự phòng hiển thị "PO/PI" khi salesOrderCode null, khớp
   *  shape BeProductionBatch. */
  @Expose() @ApiPropertyOptional({ nullable: true }) piCode!: string | null;
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() pieceName!: string;
  @Expose() @ApiProperty({ enum: PROCESS_STEPS }) step!: ProcessStep;
  @Expose() @ApiProperty() qty!: number;
  @Expose()
  @ApiProperty({ enum: PieceStepBundleStatus, enumName: 'PieceStepBundleStatus' })
  status!: PieceStepBundleStatus;
  @Expose() @ApiProperty() submittedAt!: Date;
  @Expose() @ApiProperty() submittedById!: string;

  constructor(partial: Partial<PieceStepBundleResponseDto>) {
    Object.assign(this, partial);
  }
}
