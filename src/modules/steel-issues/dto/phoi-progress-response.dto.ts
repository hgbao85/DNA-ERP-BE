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
  /** Q3: SKU đã huỷ mà QLSX cho cắt tiếp - có số cần cũ, KHÔNG cộng vào số của cỡ đoạn (review IT 26/11 mục 2.1). */
  @Expose() @ApiPropertyOptional() cutContinued?: boolean;
  /** Số cần của SKU này cho cỡ đoạn này (đoạn) = baseRequired + extraNeed (P1, 18/11/2026: ĐỔI NGHĨA, trước chỉ là
   *  định mức). Luôn 0 với dòng "Chưa phân SKU". */
  @Expose() @ApiProperty() required!: number;
  /** Định mức riêng của SKU này (đoạn) - phần gốc của `required`. */
  @Expose() @ApiProperty() baseRequired: number = 0;
  /** Số đoạn phải cắt thêm vì KCS bỏ đoạn công đoạn phụ (cắt lại) - phần cộng thêm của `required`. */
  @Expose() @ApiProperty() extraNeed: number = 0;
  /** ĐỔI NGHĨA (P1): đã báo trừ thiếu (VẪN gồm lỗi), "done - failed" = số đã tính. Ở API floor/review và floor/scan
   *  `done` là số đã tính (thô - lỗi - thiếu) - khác nghĩa, đừng lẫn. */
  @Expose() @ApiProperty() done!: number;
  @Expose() @ApiProperty() failed!: number;
  /** Số KCS ghi thiếu (đã trừ khỏi done, không tính lỗi, không làm bù). */
  @Expose() @ApiProperty() shortQty: number = 0;
  /** Chỉ công đoạn phụ: số đoạn bỏ (cắt lại) ở chính công đoạn này, nằm trong failed. Cắt luôn 0. */
  @Expose() @ApiProperty() scrapQty: number = 0;
  /** Số thô công nhân đã báo (chưa trừ lỗi / thiếu). */
  @Expose() @ApiProperty() reportedQty: number = 0;
  /** Lần báo kế tiếp tối đa được bao nhiêu = max(0, min(room, physicalLeft)); Cắt thì max(0, room). */
  @Expose() @ApiProperty() maxNow: number = 0;
  /** Câu 12b/13a (24/11/2026): đoạn dư theo phương án được báo thêm ngoài số cần (đã gồm trong maxNow, không gồm trong required). */
  @Expose() @ApiProperty() planSurplus: number = 0;
  /** Số đoạn còn "có thật" để làm công đoạn này (đoạn đã cắt - đã dùng); null với Cắt. */
  @Expose() @ApiPropertyOptional({ nullable: true }) physicalLeft: number | null = null;
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
  /** ĐỔI NGHĨA (P1, 18/11/2026): required = baseRequired + extraNeed. baseRequired = Σ qtyPerPiece × qtyPerUnit ×
   *  production_order.quantity của mọi mảnh/SKU trong PI dùng đúng (vật tư, cỡ đoạn) này (định mức). Đơn vị: ĐOẠN. */
  @Expose() @ApiProperty() required!: number;
  /** Định mức gốc (đoạn) - phần gốc của `required`. */
  @Expose() @ApiProperty() baseRequired: number = 0;
  /** Số đoạn phải cắt thêm vì KCS bỏ đoạn công đoạn phụ (cắt lại). */
  @Expose() @ApiProperty() extraNeed: number = 0;
  /** ĐỔI NGHĨA (P1): Σ CutPatternSegment.qty đã báo TRỪ số KCS ghi thiếu - đơn vị ĐOẠN, vẫn gồm lỗi (đoạn lỗi đã được
   *  cắt ra, chỉ không dùng được); "done - failed" = số đã tính. Ở API floor/review và floor/scan `done` là số đã tính
   *  (thô - lỗi - thiếu) - khác nghĩa. BẤT BIẾN theo lỗi KCS (2026-08-24): lỗi không rút khỏi `done`. */
  @Expose() @ApiProperty() done!: number;
  /** Số KCS ghi thiếu cộng dồn (đã trừ khỏi `done`, không tính lỗi, không làm bù). */
  @Expose() @ApiProperty() shortQty: number = 0;
  /** Chỉ công đoạn phụ: Σ số đoạn bỏ (cắt lại) ở chính công đoạn này, nằm trong `failed`. Cắt luôn 0. */
  @Expose() @ApiProperty() scrapQty: number = 0;
  /** Số thô công nhân đã báo (chưa trừ lỗi / thiếu). */
  @Expose() @ApiProperty() reportedQty: number = 0;
  /** Lần báo kế tiếp tối đa được bao nhiêu = max(0, min(room, physicalLeft)); Cắt thì max(0, room). */
  @Expose() @ApiProperty() maxNow: number = 0;
  /** Câu 12b/13a (24/11/2026): đoạn dư theo phương án được báo thêm ngoài số cần (đã gồm trong maxNow, không gồm trong required). */
  @Expose() @ApiProperty() planSurplus: number = 0;
  /** Số đoạn còn "có thật" để làm công đoạn này; null với Cắt. */
  @Expose() @ApiPropertyOptional({ nullable: true }) physicalLeft: number | null = null;
  /** Σ failedQty (lỗi KCS cộng dồn, không còn resolvedQty) của mọi QcReviewSegment thuộc cỡ này trong cả PI.
   *  "Còn lại" = required - (done - failed). */
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
  /** Σ đoạn đã cắt × (dài đoạn + mạch cắt), tính trên `done` mới (đã báo - thiếu). */
  @Expose() @ApiProperty() reportedMm!: number;
  @Expose() @ApiProperty() overMm!: number;
  /** P1 (18/11/2026): số đoạn còn phải cắt (Σ max(0, required - đã tính)). */
  @Expose() @ApiProperty() remainingSegments: number = 0;
  /** Trong số trên: đoạn cắt LẠI vì KCS bỏ đoạn công đoạn phụ (Σ extraNeed còn thiếu). */
  @Expose() @ApiProperty() recutSegments: number = 0;
  /** Chiều dài sắt cần cho phần còn phải cắt (mm). */
  @Expose() @ApiProperty() remainingNeedMm: number = 0;
  /** Sắt đã nhận mà chưa cắt = max(0, usableMm - reportedMm) (mm). */
  @Expose() @ApiProperty() leftoverReceivedMm: number = 0;
  /** Sắt còn có thể xuất = giữ chỗ ACTIVE còn lại x chiều dài cây (mm); null nếu không rõ chiều dài cây. */
  @Expose() @ApiPropertyOptional({ nullable: true }) issuableMm: number | null = null;
  /** Thiếu sắt = max(0, remainingNeedMm - leftoverReceivedMm - (issuableMm ?? 0)) (mm). */
  @Expose() @ApiProperty() shortMm: number = 0;

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
