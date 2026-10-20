import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';

/**
 * Tiến độ cắt của MỘT cỡ đoạn trong 1 loại sắt của 1 PI.
 *
 * `required` suy thẳng từ ĐỊNH MỨC (piece_bom × bom_piece × production_order.quantity), KHÔNG lấy
 * từ CuttingProposalPattern - pattern là KẾ HOẠCH của solver, thường cắt DƯ (đoạn ngắn được xếp
 * lấp phần đuôi cây vốn cắt để lấy đoạn dài). Lấy pattern làm mốc thì "Còn lại" không bao giờ về 0
 * đúng lúc.
 */
@Exclude()
export class PhoiProgressOrderSegmentDto {
  /** null = phần đợt cắt CŨ (trước 2026-09-21) không biết thuộc SKU nào - "Chưa phân SKU". */
  @Expose() @ApiPropertyOptional({ nullable: true }) productionOrderId!: string | null;
  /** Định mức riêng của SKU này cho cỡ đoạn này (đoạn). Luôn 0 với dòng "Chưa phân SKU". */
  @Expose() @ApiProperty() required!: number;
  @Expose() @ApiProperty() done!: number;
  @Expose() @ApiProperty() failed!: number;
  /** Phần của `done` CHƯA gửi KCS (đợt cắt đang CUTTING / dòng công đoạn phụ chưa vào đợt gửi KCS). */
  @Expose() @ApiProperty() openQty: number = 0;
  /** Phần của `done` đã gửi KCS, đang CHỜ KCS chấm (đợt AWAITING_QC). */
  @Expose() @ApiProperty() awaitingQcQty: number = 0;

  constructor(partial: Partial<PhoiProgressOrderSegmentDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class PhoiProgressSegmentDto {
  @Expose() @ApiProperty() segmentSpecId!: string;
  /** Decimal(7,1) ở DB (vd 452.7) - trả về number, xem SegmentSpec.cutLengthMm. */
  @Expose() @ApiProperty() cutLengthMm!: number;
  /** Σ qtyPerPiece × qtyPerUnit × production_order.quantity của mọi mảnh/SKU trong PI dùng đúng
   *  (vật tư, cỡ đoạn) này. Đơn vị: ĐOẠN. */
  @Expose() @ApiProperty() required!: number;
  /** Σ CutPatternSegment.qty đã báo - đơn vị ĐOẠN, là số Phôi tự khai chứ không suy từ pattern.
   *  BẤT BIẾN theo lỗi KCS - đây là việc ĐÃ XẢY RA rồi, không rút lại được (2026-08-24, sửa lỗi
   *  ERP: bản trước trừ thẳng lỗi vào đây làm mâu thuẫn với lịch sử đợt cắt đã báo). */
  @Expose() @ApiProperty() done!: number;
  /** Σ (failedQty - resolvedQty) của mọi QcReviewSegment thuộc cỡ này trong cả PI - số đoạn ĐANG
   *  thực sự lỗi (KCS đã chấm, chưa duyệt lại xác nhận đạt). "Còn lại" = required - (done - failed). */
  @Expose() @ApiProperty() failed!: number;
  /** Phần của `done` CHƯA gửi KCS (2026-10-16, thống nhất số 3 màn QLSX). `done` = openQty + awaitingQcQty + đã chấm. */
  @Expose() @ApiProperty() openQty: number = 0;
  /** Phần của `done` đã gửi KCS, đang chờ KCS chấm. */
  @Expose() @ApiProperty() awaitingQcQty: number = 0;
  /** Tách theo SKU (2026-09-21): Σ required/done/failed/openQty/awaitingQcQty các phần tử = đúng các số ở trên. */
  @Expose()
  @Type(() => PhoiProgressOrderSegmentDto)
  @ApiProperty({ type: [PhoiProgressOrderSegmentDto] })
  byOrder!: PhoiProgressOrderSegmentDto[];

  constructor(partial: Partial<PhoiProgressSegmentDto>) {
    Object.assign(this, partial);
  }
}

/**
 * Tiến độ cắt theo LOẠI SẮT cho 1 PI - nguồn dữ liệu của bảng "Cần / Đã cắt / Còn lại" ở màn
 * Lệnh sản xuất (Phôi).
 *
 * Cố ý KHÔNG bóc theo SKU: 1 cỡ đoạn dùng chung cho nhiều mảnh/SKU (SegmentSpec là
 * @@unique([materialId, cutLengthMm]), toàn hệ thống dùng chung), và nghiệp vụ đã chốt Phôi
 * không cần biết đoạn thuộc SKU nào - cắt đủ tổng theo định mức là xong.
 *
 * Đặt ở module steel-issues (không phải production-invoices) để dùng lại đúng quyền
 * STEEL_ISSUE:VIEW mà PHOI_STAFF đã có.
 */
@Exclude()
export class PhoiStepProgressDto {
  /** Công đoạn phụ (UON/DAP/DUC_LO/TAN/TOP_DAU/XE). */
  @Expose() @ApiProperty() step!: string;
  @Expose()
  @Type(() => PhoiProgressSegmentDto)
  @ApiProperty({ type: [PhoiProgressSegmentDto] })
  segments!: PhoiProgressSegmentDto[];

  constructor(partial: Partial<PhoiStepProgressDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
/** Đối chiếu sắt vào - đoạn ra của 1 loại sắt trong cả PI (2026-10-12) - xem
 *  SteelIssuesService.attachSteelBalance(). overMm > 0 = đoạn đã báo vượt lượng sắt đã nhận: CHỈ cảnh
 *  báo (có thể do cắt bù bằng sắt thừa dưới xưởng), không chặn. */
export class PhoiSteelBalanceDto {
  /** Σ số cây thực nhận (đợt nhận trước 2026-10-12 lấy số kho xuất). */
  @Expose() @ApiProperty() receivedBarCount!: number;
  /** Σ cây × (dài cây − tề đầu). */
  @Expose() @ApiProperty() usableMm!: number;
  /** Σ đoạn đã cắt × (dài đoạn + mạch cắt). */
  @Expose() @ApiProperty() reportedMm!: number;
  @Expose() @ApiProperty() overMm!: number;

  constructor(partial: Partial<PhoiSteelBalanceDto>) {
    Object.assign(this, partial);
  }
}

export class PhoiProgressItemResponseDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  /** Σ barCount các đợt SteelIssue gốc (không tính rework) đã xuất cho vật tư này trong cả PI. */
  @Expose() @ApiProperty() issuedBarCount!: number;
  @Expose()
  @Type(() => PhoiProgressSegmentDto)
  @ApiProperty({ type: [PhoiProgressSegmentDto] })
  segments!: PhoiProgressSegmentDto[];
  /** Các công đoạn phụ SAU Cắt của loại sắt này (Uốn/Dập/...) - CHỈ có ở endpoint gộp phoi-progress/batch
   *  (2026-09-21, để "Tổng hợp lệnh SX" tính Phôi = Cắt + mọi công đoạn phụ). Rỗng nếu loại sắt không cần. */
  @Expose()
  @Type(() => PhoiStepProgressDto)
  @ApiProperty({ type: [PhoiStepProgressDto] })
  steps: PhoiStepProgressDto[] = [];
  /** Null = chưa nhận đợt sắt nào của loại này. */
  @Expose()
  @Type(() => PhoiSteelBalanceDto)
  @ApiPropertyOptional({ type: PhoiSteelBalanceDto, nullable: true })
  steelBalance: PhoiSteelBalanceDto | null = null;

  constructor(partial: Partial<PhoiProgressItemResponseDto>) {
    Object.assign(this, partial);
  }
}
