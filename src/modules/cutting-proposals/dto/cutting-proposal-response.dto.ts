import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { CuttingProposalStatus } from '../../../generated/prisma/client';

/**
 * Trạng thái RÚT GỌN cho màn Cắt sắt (3 nhãn, xem changelog 2026-08-15 mục 15) - dẫn xuất từ
 * `status` + `hasInfeasibleLine`/`hasOverThreshold` + `completedAt`, KHÔNG lưu ở DB (tính lại mỗi
 * lần map response, xem CuttingProposalsService.computeDisplayStatus). 5 trạng thái DB gốc
 * (CALCULATING/DRAFT/APPROVED/SUPERSEDED/FAILED) vẫn giữ nguyên - APPROVED còn dùng để chống
 * trừ-kho-2-lần (autoApproveBlockReason) và tra pattern cho Phôi, không được đổi.
 *
 * - CALCULATING: đang chờ solver, HOẶC vừa tính xong <60s và không có dấu hiệu bị chặn (đang
 *   hoàn tất tự-duyệt phía sau - gộp vào đây thay vì tách riêng để tránh nháy "Cần xử lý" rồi
 *   1-2s sau nhảy "Đạt").
 * - OK: đã tự-duyệt xong (status=APPROVED), mọi vật tư đều cắt được trong ngưỡng.
 * - NEEDS_ACTION: solver lỗi kỹ thuật (FAILED), HOẶC có vật tư không cắt được/vượt ngưỡng, HOẶC
 *   nhu cầu này đã có phương án khác được duyệt trước đó (đọc `displayReason` để biết đúng lý do).
 * - SUPERSEDED: bản cũ đã bị thay thế bởi lần "Tính lại" sau - ẩn mặc định ở FE.
 */
export type CuttingProposalDisplayStatus = 'CALCULATING' | 'OK' | 'NEEDS_ACTION' | 'SUPERSEDED';

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
  /// Id thật của CuttingProposalPattern - dùng cho CompleteCuttingDto.bundles[].proposalPatternId
  /// khi Phôi báo cắt xong theo đúng pattern đã duyệt (xem steel-issues module).
  @Expose() @ApiProperty() id!: string;
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
  /// Lý do KHÔNG cắt được, NGUYÊN VĂN từ solver - null khi feasible=true. Xem
  /// `displayReason` bên dưới cho câu đã dựng sẵn tiếng Việt (ưu tiên hiển thị cái đó).
  @Expose() @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  /// "Tốt nhất có thể" nếu chấp nhận nới ngưỡng - chỉ có ở MỘT SỐ ca infeasible (không phải mọi
  /// ca). null khi feasible=true hoặc solver không tính được gợi ý này.
  @Expose() @ApiPropertyOptional({ nullable: true }) bestAchievable!: {
    length: number;
    waste_pct: number;
    bars: number;
  } | null;
  /// true = CP-SAT hết time_limit_seconds mà CHƯA kết luận được - khác hẳn infeasible THẬT.
  @Expose() @ApiPropertyOptional({ nullable: true }) timedOut!: boolean | null;
  /// Ngưỡng hao hụt % đã áp dụng cho loại sắt này khi tính - có ở CẢ 2 nhánh feasible/infeasible.
  @Expose() @ApiPropertyOptional({ nullable: true }) maxWastePctThreshold!: number | null;
  /// true = feasible NHƯNG vượt maxWastePctThreshold - null khi feasible=false.
  @Expose() @ApiPropertyOptional({ nullable: true }) overThreshold!: boolean | null;
  /// Câu tiếng Việt ĐÃ DỰNG SẴN cho dòng này (xem CuttingProposalsService.lineDisplayReason) -
  /// null khi dòng này không cần xử lý gì (feasible & không vượt ngưỡng). FE ưu tiên hiển thị
  /// field này thay vì tự ghép `reason`/`bestAchievable`/`timedOut` lại với nhau.
  @Expose() @ApiPropertyOptional({ nullable: true }) displayReason!: string | null;
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
  /** Neo vào ĐÚNG MỘT trong hai: 1 lệnh SX cắt riêng, hoặc cả 1 PI gộp cắt chung một đợt. */
  @Expose() @ApiPropertyOptional({ nullable: true }) productionOrderId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productionInvoiceId!: string | null;
  /** Mã lệnh sản xuất NỘI BỘ, hoặc mã PI khi là phương án cấp nhóm - chỉ hệ thống dùng, KHÔNG
   *  hiển thị cho người dùng nữa (xem `salesOrderCode` bên dưới). */
  @Expose() @ApiProperty() poNumber!: string;
  /** Mã đơn hàng Sales gốc - đây mới là mã "PO" người dùng cần thấy. null khi SKU không gắn đơn
   *  Sales nào; có thể là danh sách nhiều mã nối bằng ", " khi là phương án cấp nhóm (nhiều đơn
   *  Sales trong cùng 1 đợt cắt). */
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  /** Mã SKU, hoặc danh sách mã SKU (ngăn bởi dấu phẩy) khi là phương án cấp nhóm. */
  @Expose() @ApiProperty() mfgProductCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) mfgProductName!: string | null;
  @Expose() @ApiProperty({ enum: CuttingProposalStatus }) status!: CuttingProposalStatus;
  /// Trạng thái RÚT GỌN cho hiển thị - xem CuttingProposalDisplayStatus. Dùng field này để quyết
  /// định chip/màu trên FE, KHÔNG dùng `status` trực tiếp (5 giá trị DB không map 1-1 ra 3 chip).
  @Expose() @ApiProperty() displayStatus!: CuttingProposalDisplayStatus;
  /// Câu tiếng Việt ngắn gọn giải thích displayStatus=NEEDS_ACTION (list-level, không kéo lines[]
  /// nên chỉ đủ chi tiết để biết "cần mở ra xem" - lý do ĐẦY ĐỦ từng vật tư nằm ở
  /// lines[].displayReason, chỉ có khi gọi findOne() chi tiết). null ở mọi displayStatus khác.
  @Expose() @ApiPropertyOptional({ nullable: true }) displayReason!: string | null;
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
