import { ApiProperty } from '@nestjs/swagger';
import type {
  RecomputeSegmentStockResult,
  SegmentProductionSpecResult,
} from '../segment-production.service';

class RecomputeVariantDto {
  @ApiProperty({ description: "Bộ công đoạn ('' = trơn)" })
  segmentSteps!: string;
  @ApiProperty() needQty!: number;
  @ApiProperty() heldQty!: number;
  @ApiProperty() surplusQty!: number;
}

class RecomputeSpecDto {
  @ApiProperty() segmentSpecId!: string;
  @ApiProperty({ description: 'Đã cắt + KCS đạt' }) cutPassedQty!: number;
  @ApiProperty({ description: 'Đã qua từng công đoạn phụ + KCS đạt', type: 'object' })
  stepPassedQty!: Record<string, number>;
  @ApiProperty({ type: [RecomputeVariantDto] }) variants!: RecomputeVariantDto[];
  @ApiProperty({ description: 'Đoạn đã cắt còn chờ công đoạn của lệnh' }) wipQty!: number;
  @ApiProperty({
    description: 'Đoạn qua công đoạn nhưng không ghép được (báo lệch)',
    type: 'object',
  })
  leftoverStepQty!: Record<string, number>;
}

class RecomputeCurrentDto {
  @ApiProperty() segmentSpecId!: string;
  @ApiProperty() segmentSteps!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() heldQty!: number;
  @ApiProperty() surplusQty!: number;
}

class RecomputeChangeDto {
  @ApiProperty() segmentSpecId!: string;
  @ApiProperty() segmentSteps!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() beforeHeldQty!: number;
  @ApiProperty() beforeSurplusQty!: number;
  @ApiProperty() targetHeldQty!: number;
  @ApiProperty() targetSurplusQty!: number;
  @ApiProperty() afterHeldQty!: number;
  @ApiProperty() afterSurplusQty!: number;
  @ApiProperty() ledgerQty!: number;
  @ApiProperty() unappliedHeldQty!: number;
  @ApiProperty() unappliedSurplusQty!: number;
}

export class RecomputeSegmentStockResponseDto {
  @ApiProperty() productionInvoiceId!: string;
  @ApiProperty() dryRun!: boolean;
  @ApiProperty({ description: 'Lệnh đã kết thúc (DONE / CANCELLED / mọi SKU FINISHED)' })
  closed!: boolean;
  @ApiProperty({ description: 'Kho Phôi của xưởng làm lệnh (dự kiến khi dryRun)', nullable: true })
  warehouseId!: string | null;
  @ApiProperty({ type: [RecomputeSpecDto] }) specs!: RecomputeSpecDto[];
  @ApiProperty({
    description: 'Đã ghi hiện tại (segment_productions)',
    type: [RecomputeCurrentDto],
  })
  current!: RecomputeCurrentDto[];
  @ApiProperty({ description: 'Phần chênh đã ghi (chỉ khi ghi thật)', type: [RecomputeChangeDto] })
  changes!: RecomputeChangeDto[];

  static from(r: RecomputeSegmentStockResult): RecomputeSegmentStockResponseDto {
    const dto = new RecomputeSegmentStockResponseDto();
    dto.productionInvoiceId = r.productionInvoiceId.toString();
    dto.dryRun = r.dryRun;
    dto.closed = r.closed;
    dto.warehouseId = r.warehouseId?.toString() ?? null;
    dto.specs = r.specs.map((s: SegmentProductionSpecResult) => ({
      segmentSpecId: s.segmentSpecId.toString(),
      cutPassedQty: s.cutPassedQty,
      stepPassedQty: { ...s.stepPassedQty },
      variants: s.variants.map((v) => ({ ...v })),
      wipQty: s.wipQty,
      leftoverStepQty: { ...s.leftoverStepQty },
    }));
    dto.current = r.current.map((c) => ({
      segmentSpecId: c.segmentSpecId.toString(),
      segmentSteps: c.segmentSteps,
      warehouseId: c.warehouseId.toString(),
      heldQty: c.heldQty,
      surplusQty: c.surplusQty,
    }));
    dto.changes = r.changes.map((c) => ({
      segmentSpecId: c.segmentSpecId.toString(),
      segmentSteps: c.segmentSteps,
      warehouseId: c.warehouseId.toString(),
      beforeHeldQty: c.before.heldQty,
      beforeSurplusQty: c.before.surplusQty,
      targetHeldQty: c.target.heldQty,
      targetSurplusQty: c.target.surplusQty,
      afterHeldQty: c.after.heldQty,
      afterSurplusQty: c.after.surplusQty,
      ledgerQty: c.ledgerQty,
      unappliedHeldQty: c.unappliedHeldQty,
      unappliedSurplusQty: c.unappliedSurplusQty,
    }));
    return dto;
  }
}
