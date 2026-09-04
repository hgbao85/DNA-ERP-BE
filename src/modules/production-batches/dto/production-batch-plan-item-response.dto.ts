import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { ProcessStep } from '../../../generated/prisma/client';
import { PROCESS_STEPS } from '../../../common/constants/process-steps.constant';
import { PieceStepProgressDto } from './piece-step-progress.dto';

/** "Còn phải báo bao nhiêu" theo (mảnh, stage) - mirror MaterialIssuePlanItemResponseDto, nguồn
 *  định mức là BomPiece thay vì ConsumableBom. Piece không có cột stage (1 mảnh vật lý đi qua cả
 *  Hàn rồi Sơn rồi Đan) nên awaitingQcQty/passedQty phải tính riêng theo từng stage từ
 *  ProductionBatch, không tính sẵn ở BOM - xem ProductionBatchesService.getBatchPlan(). */
@Exclude()
export class ProductionBatchPlanItemResponseDto {
  @Expose() @ApiProperty() pieceId!: string;
  @Expose() @ApiProperty() pieceCode!: string;
  @Expose() @ApiProperty() pieceName!: string;
  /** BomPiece.qtyPerUnit × ProductionOrder.quantity. */
  @Expose() @ApiProperty() plannedQty!: number;
  /** Σ ProductionBatch.reportedQty (status=AWAITING_QC) cho đúng (productionOrder, stage, mảnh). */
  @Expose() @ApiProperty() awaitingQcQty!: number;
  /** Σ ProductionBatch.reportedQty (status=QC_DONE) - đã là passed-qty sau khi KCS duyệt, không
   *  phải qty gốc đã báo. */
  @Expose() @ApiProperty() passedQty!: number;
  /** Chỉ có giá trị cho stage=PHOI khi piece có PieceMaterialYield (vd chân nhôm) - tồn nguyên
   *  liệu thô (vd thanh nhôm) hiện có tại kho, để FE cảnh báo "còn X cây chưa cắt hết" (chỉ hiển
   *  thị, không chặn thao tác - quyết định nghiệp vụ 2026-08-22). Null cho mọi trường hợp khác. */
  @Expose() @ApiProperty({ nullable: true }) rawMaterialOnHand!: number | null;
  /** PieceMaterialYield.processSteps của mảnh này, ĐÃ chuẩn hoá theo thứ tự nghiệp vụ (không phải
   *  thứ tự lưu trong DB - xem process-steps.constant.ts). Mảng rỗng cho MỌI trường hợp khác
   *  stage=PHOI, hoặc mảnh chưa khai công đoạn nào (giữ nguyên luồng báo thẳng ProductionBatch). */
  @Expose() @ApiProperty({ enum: PROCESS_STEPS, isArray: true }) processSteps!: ProcessStep[];
  /** Tiến độ từng bước - rỗng khi processSteps rỗng. Xem PieceStepProgressDto. */
  @Expose()
  @ApiProperty({ type: [PieceStepProgressDto] })
  @Type(() => PieceStepProgressDto)
  stepProgress!: PieceStepProgressDto[];
  /** PieceMaterialYield.qtyPerPiece - chỉ để FE hiện phụ chú "= N miếng" đối chiếu, KHÔNG dùng để
   *  tính required/done (đơn vị báo cáo luôn là MẢNH, xem PieceStepProgressDto). Null khi mảnh
   *  không có PieceMaterialYield hoặc stage khác PHOI. */
  @Expose() @ApiProperty({ nullable: true }) qtyPerPiece!: number | null;

  constructor(partial: Partial<ProductionBatchPlanItemResponseDto>) {
    Object.assign(this, partial);
  }
}
