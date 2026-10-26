import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import {
  coerceStockLengthsFromQuery,
  IsStockLengthsByMaterial,
  type StockLengthsByMaterial,
} from '../../../common/validators/stock-lengths-by-material.validator';
import { ProdApprovalStatus, SolverMachine } from '../../../generated/prisma/client';
import { MaterialChoiceRefDto } from '../../../common/utils/material-choice-ref.util';

/** Một loại sắt của MỘT SKU, kèm hao hụt khi SKU đó cắt một mình. */
@Exclude()
export class CandidateMaterialDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  /// Hao hụt khi CHỈ SKU này cắt loại sắt này. Ý nghĩa phụ thuộc `verified`/`verifiedLengthSource`:
  ///  - verified=false: cận dưới LÝ TƯỞNG (best-fill.util.ts, giả định nguồn đoạn vô hạn) - hiển
  ///    thị kèm dấu "≥", thực tế có thể cao hơn.
  ///  - verified=true, lengthSource='fixed': con số THẬT, so trực tiếp với thresholdPct là đúng.
  ///  - verified=true, lengthSource='scan': KHÔNG phải "hao hụt sẽ đạt được" - đây là số TỐT NHẤT
  ///    CÓ THỂ solver tìm ra SAU KHI đã phá luật "mỗi cây ≤ ngưỡng" (xem verifiedLengthSource) -
  ///    KHÔNG được trình bày như con số sẽ xảy ra thật, chỉ là dữ liệu phụ. Hao hụt THẬT ở trường
  ///    hợp này CHẮC CHẮN > thresholdPct (chứng minh chặt, xem verifiedLengthSource) - FE PHẢI hiện
  ///    theo hướng đó (vd "> X%"), không hiện standaloneWastePct như số sẽ đạt (2026-09-24: bản
  ///    trước hiện thẳng số này bị người dùng chỉ ra là "bịp bợm" vì < ngưỡng mà thực ra không đạt
  ///    được theo đúng luật - xem changelog mục 19.9).
  @Expose() @ApiProperty() standaloneWastePct!: number;
  /// Chiều dài cây (mm) con số trên được tính TRÊN đó - đổi ô chọn chiều dài thì số này đổi
  /// theo, để chip không bao giờ nói về một cây khác với cây đợt sẽ thật sự cắt. Khi verified=true
  /// và loại này vượt ngưỡng, đây là chiều dài mà "tốt nhất có thể" (best_achievable) được tính -
  /// có thể KHÁC chiều dài KHSX đang chọn (solver nới lỏng hết bộ lọc để tìm ra con số này).
  @Expose() @ApiPropertyOptional({ nullable: true }) stockLengthMm!: number | null;
  /// Số cây. verified=false: cận dưới (best-fill.util.ts - giả định nguồn đoạn vô hạn, nhu cầu
  /// nhỏ khiến cận dưới lệch xa thực tế NHẤT vì cây cuối chi phối toàn bộ % - xem changelog
  /// 2026-08-15 mục 15.6-7). verified=true: số cây THẬT solver vừa tính.
  @Expose() @ApiProperty() standaloneMinBars!: number;
  @Expose() @ApiProperty() thresholdPct!: number;
  /// verified=false, hoặc verified=true+lengthSource='fixed': = standaloneWastePct > thresholdPct
  /// (so trực tiếp, đúng nghĩa mặt chữ). verified=true+lengthSource='scan': LUÔN true - CHẮC CHẮN
  /// vượt ngưỡng theo chứng minh chặt (xem verifiedLengthSource), KHÔNG suy từ standaloneWastePct
  /// (số đó không phải "hao hụt sẽ đạt", xem field đó).
  @Expose() @ApiProperty() overThreshold!: boolean;
  /// true = 2 field standaloneWastePct/standaloneMinBars ở trên là SỐ THẬT (vừa gọi solver xác
  /// minh, auto_scan=false, đúng nhu cầu thật của SKU này), KHÔNG phải cận dưới lý tưởng. false =
  /// ước tính nhanh như trước (loại này có quá nhiều cỡ đoạn để gọi solver mỗi lần tải trang mà
  /// không làm chậm màn hình, hoặc solver không phản hồi kịp) - xem
  /// CuttingProposalsService.verifyExactStandaloneWaste.
  @Expose() @ApiProperty() verified!: boolean;
  /// CHỈ có ý nghĩa khi verified=true (null nếu không). "fixed" = ĐÃ cắt được ở đúng chiều dài
  /// KHSX đang chọn với luật "mọi cây đều ≤ ngưỡng/cây" (bộ lọc pattern generation thật của
  /// solver) - standaloneWastePct đáng tin, so trực tiếp với thresholdPct được.
  ///
  /// "scan" = KHÔNG cắt được với luật đó, và CHẮC CHẮN (không phải ước tính) hao hụt thật > ngưỡng:
  /// generate_patterns() đã liệt kê HẾT kiểu cắt ≤ ngưỡng/cây rồi thử phủ đúng nhu cầu CHỈ bằng
  /// các kiểu đó và THẤT BẠI - nên MỌI phương án cắt hợp lệ khác bắt buộc phải dùng ít nhất 1 kiểu
  /// vượt ngưỡng. standaloneWastePct lúc này đến từ _best_achievable() (nới lỏng HẲN luật đó để
  /// tìm phương án THẬT SỰ CẮT ĐƯỢC có tổng hao hụt thấp nhất) - vẫn là 1 kế hoạch cắt hợp lệ,
  /// nhưng KHÔNG phải cái solver thật sẽ chọn (pattern generation loại nó ngay từ đầu vì có cây
  /// vượt ngưỡng riêng) - chỉ dùng làm dữ liệu PHỤ, KHÔNG phải "hao hụt sẽ đạt" (xem
  /// standaloneWastePct, changelog 2026-09-24 mục 19.9).
  ///
  /// Ý NGHĨA NGHIỆP VỤ: hệ thống hiện tại (đang áp luật mỗi cây ≤ ngưỡng khi solve thật) sẽ KHÔNG
  /// tự chọn cây chuẩn cho loại này - vẫn tự auto-scan sang chiều dài khác như trước.
  @Expose()
  @ApiPropertyOptional({ nullable: true, enum: ['fixed', 'scan'] })
  verifiedLengthSource!: 'fixed' | 'scan' | null;
  /// Mã SKU của các đơn KHÁC cũng dùng loại sắt này - tức những đơn gộp vào thì MỚI có tác dụng.
  /// Rỗng = không đơn nào khác dùng, gộp không cứu được loại này.
  ///
  /// Vì sao cần: thiếu nó, KHSX thấy "⚠30x30 vượt ngưỡng" rồi phải TỰ QUÉT cả bảng tìm SKU nào
  /// cũng có 30x30. Năm dòng còn làm được, ba mươi dòng thì không - trong khi hệ thống đã biết
  /// sẵn câu trả lời.
  @Expose() @ApiProperty({ type: [String] }) mergeableWithSkus!: string[];

  constructor(partial: Partial<CandidateMaterialDto>) {
    Object.assign(this, partial);
  }
}

/** Một dòng trong bảng chọn của KHSX = một SKU chưa được Sếp duyệt. */
@Exclude()
export class CuttingBatchCandidateDto {
  @Expose() @ApiProperty() productionInvoiceItemId!: string;
  @Expose() @ApiProperty() mfgProductCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) mfgProductName!: string | null;
  /// Loại dây (mã SHT)/loại nệm Sales chọn cho dòng này - CHỈ để KHSX phân biệt 2 dòng cùng SKU
  /// khác dây (dây/nệm không ảnh hưởng cắt sắt nên vẫn gộp chung được). null = SKU không có lựa chọn.
  @Expose()
  @ApiPropertyOptional({ type: MaterialChoiceRefDto, nullable: true })
  wireMaterial!: MaterialChoiceRefDto | null;
  @Expose()
  @ApiPropertyOptional({ type: MaterialChoiceRefDto, nullable: true })
  cushionMaterial!: MaterialChoiceRefDto | null;
  @Expose() @ApiProperty() quantity!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productionInvoiceCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) deadline!: Date | null;
  @Expose()
  @ApiPropertyOptional({ enum: ProdApprovalStatus, nullable: true })
  prodApprovalStatus!: ProdApprovalStatus | null;
  /// Lý do bị từ chối lần gần nhất. SKU quay lại bảng này sau khi Sếp từ chối một đợt gộp - KHSX
  /// cần thấy vì sao để không gộp lại đúng tổ hợp vừa bị bác.
  @Expose() @ApiPropertyOptional({ nullable: true }) rejectReason!: string | null;
  /// Mọi loại sắt SKU này dùng. Rỗng = chưa có định mức ACTIVE (xem `hasActiveBom`).
  @Expose()
  @ApiProperty({ type: [CandidateMaterialDto] })
  @Type(() => CandidateMaterialDto)
  materials!: CandidateMaterialDto[];
  /// false = sản phẩm chưa có BomRevision ACTIVE nên không tính được gì. Vẫn trả về dòng này để
  /// KHSX BIẾT nó tồn tại - im lặng bỏ qua sẽ khiến họ tưởng SKU đó không có vấn đề.
  @Expose() @ApiProperty() hasActiveBom!: boolean;

  constructor(partial: Partial<CuttingBatchCandidateDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class CuttingBatchCandidateListDto {
  @Expose()
  @ApiProperty({ type: [CuttingBatchCandidateDto] })
  @Type(() => CuttingBatchCandidateDto)
  items!: CuttingBatchCandidateDto[];
  /// Tổ hợp hệ thống tự đề xuất - FE tick sẵn để KHSX chỉ việc xem lại rồi xác nhận, vẫn sửa được. Từ 2026-10-24 = đúng 1 SKU:
  /// đơn có mốc cần sắt SỚM NHẤT đang bị cảnh báo ở cây chuẩn; FE gọi cutting-batch-fix-options cho đợt đó rồi tự thêm các đơn
  /// gợi ý gộp (luật gộp ≤ N ngày, ≤ M SKU, ít hao hụt nhất).
  @Expose() @ApiProperty({ type: [String] }) recommendedItemIds!: string[];
  /// Ngân sách thời gian TỐI ĐA cho CẢ đợt tính (giây) - chính là SOLVER_TIMEOUT_SECONDS mà
  /// runSolverAndSave() so với `số loại sắt × time_limit` để quyết định chặn hay không (2026-09-23).
  /// Trả về đây để FE tự tính "tối đa bao nhiêu phút/loại" rồi chặn NGAY TẠI Ô NHẬP bằng tiếng
  /// Việt dễ hiểu, thay vì để KHSX gõ xong, gộp xong, chờ tới lúc Sếp duyệt mới nhận câu lỗi kỹ
  /// thuật ("vượt timeout HTTP client...") mà công nhân không thể tự hiểu để sửa.
  @Expose() @ApiProperty() solverTimeoutSeconds!: number;
  /// Mặc định công ty (SystemConfig.solverTimeLimitSeconds) - trả kèm để FE hiện gợi ý khi ô
  /// "Thời gian chạy tối đa" để trống. TRƯỚC ĐÂY FE gọi thẳng GET /system-config cho số này
  /// nhưng KHSX không có quyền SYSTEM_CONFIG:VIEW nên luôn 403 (gợi ý im lặng không hiện ra).
  @Expose() @ApiProperty() defaultTimeLimitSeconds!: number;

  constructor(partial: Partial<CuttingBatchCandidateListDto>) {
    Object.assign(this, partial);
  }
}

/**
 * Chiều dài cây KHSX đang chọn, gửi kèm cho 2 endpoint GET dựng bảng ở màn "Tối ưu cắt sắt".
 *
 * Vì sao 2 bảng danh sách cũng phải nhận: đổi ô chọn từ 6m sang 5m85 mà chip "hao hụt khi cắt
 * riêng" vẫn đứng yên thì màn hình tự mâu thuẫn - chip nói một cây, đợt cắt một cây khác. Và
 * chiều dài còn quyết định loại sắt nào ĐƯỢC COI LÀ vượt ngưỡng, tức đổi cả danh sách SKU hiện
 * ra lẫn tổ hợp gộp hệ thống tick sẵn, không chỉ đổi con số.
 */
export class BatchStockLengthsQueryDto {
  @ApiPropertyOptional({ example: { '5': 5850 } })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => coerceStockLengthsFromQuery(value))
  @IsStockLengthsByMaterial()
  stockLengthsByMaterial?: StockLengthsByMaterial;

  /// Máy cắt KHSX đang chọn cho đợt (2026-10-23) - đổi máy là đổi tề đầu/lưỡi nên đổi cả con số ước tính
  /// lẫn số xác minh bằng solver. Không gửi = máy mặc định của công ty (SystemConfig.solverMachine).
  @ApiPropertyOptional({ enum: SolverMachine })
  @IsOptional()
  @IsEnum(SolverMachine)
  solverMachine?: SolverMachine;

  /// CHỈ cutting-batch-candidates (2026-10-24): `true` = lượt KIỂM BÙ chạy nền sau lần tải trang - xác minh bằng solver cả các chip
  /// lần đầu chưa kịp (lâu hơn, tới 12 cỡ đoạn). Kết quả đã có được nhớ nên không giải lại. Bỏ trống = lượt nhanh như cũ.
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' || value === true ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  deepVerify?: boolean;
}

export class PreviewCuttingBatchDto {
  @ApiProperty({ type: [String], description: 'ProductionInvoiceItem.id được KHSX tick chọn' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  productionInvoiceItemIds!: string[];

  /// Chiều dài cây KHSX đang chọn trên màn "Tối ưu cắt sắt", theo từng quy cách. Gửi kèm để
  /// con số "Nếu gộp N SKU" tính THEO ĐÚNG cây sẽ cắt - không gửi thì tính theo cây chuẩn của
  /// công ty. Cùng shape với SolverOverrideDto.solverStockLengthsByMaterial để KHSX bấm "Xác
  /// nhận gộp" là gửi lại y nguyên thứ vừa xem, không phải map lại ở FE.
  @ApiPropertyOptional({ example: { '5': 5850 } })
  @IsOptional()
  @IsStockLengthsByMaterial()
  stockLengthsByMaterial?: StockLengthsByMaterial;

  /// Máy cắt KHSX đang chọn cho đợt - như BatchStockLengthsQueryDto.solverMachine.
  @ApiPropertyOptional({ enum: SolverMachine })
  @IsOptional()
  @IsEnum(SolverMachine)
  solverMachine?: SolverMachine;
}

/** Kết quả tính thử cho ĐÚNG tổ hợp KHSX đang chọn, mỗi loại sắt 1 dòng. */
@Exclude()
export class CuttingBatchPreviewLineDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() thresholdPct!: number;
  /// Chiều dài cây (mm) mà con số của dòng này được tính TRÊN đó - phản chiếu đúng lựa chọn KHSX
  /// gửi kèm trong stockLengthsByMaterial. null = không chọn riêng, đang dò trong danh sách chiều
  /// dài chuẩn của công ty nên không có một cây duy nhất để nêu.
  @Expose() @ApiPropertyOptional({ nullable: true }) stockLengthMm!: number | null;
  /// Mã SKU thực sự có dùng loại sắt này (tập con của tổ hợp được chọn).
  @Expose() @ApiProperty({ type: [String] }) contributingSkus!: string[];
  @Expose() @ApiProperty({ type: [Number] }) cutSizesMm!: number[];
  @Expose() @ApiProperty() minWastePct!: number;
  @Expose() @ApiProperty() minBars!: number;
  @Expose() @ApiProperty() barsSeparate!: number;
  /// barsSeparate − minBars. CÓ THỂ = 0 dù % giảm mạnh - xem CuttingBatchLevelDto.
  @Expose() @ApiProperty() barsSavedVsSeparate!: number;
  @Expose() @ApiProperty() meetsThreshold!: boolean;
  @Expose() @ApiPropertyOptional({ nullable: true }) daysCutEarly!: number | null;

  constructor(partial: Partial<CuttingBatchPreviewLineDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class CuttingBatchPreviewDto {
  @Expose()
  @ApiProperty({ type: [CuttingBatchPreviewLineDto] })
  @Type(() => CuttingBatchPreviewLineDto)
  lines!: CuttingBatchPreviewLineDto[];
  /// Tổng số cây bớt được trên MỌI loại sắt - con số duy nhất trả lời "gộp có đáng không".
  @Expose() @ApiProperty() totalBarsSaved!: number;
  /// Đơn hạn xa nhất phải cắt sớm bao nhiêu ngày so với đơn gấp nhất trong tổ hợp.
  @Expose() @ApiPropertyOptional({ nullable: true }) daysCutEarly!: number | null;

  constructor(partial: Partial<CuttingBatchPreviewDto>) {
    Object.assign(this, partial);
  }
}

/** 1 kết quả bộ giải gọn: hao hụt (%) + số cây (dùng cho các cách xử lý ở khối "Đợt đang chọn"). */
@Exclude()
export class CuttingBatchFixResultDto {
  @Expose() @ApiProperty() wastePct!: number;
  @Expose() @ApiProperty() bars!: number;
  /// Chiều dài cây (mm) của kết quả - với "đặt cây riêng" là cây hệ thống sẽ đặt.
  @Expose() @ApiProperty() lengthMm!: number;

  constructor(partial: Partial<CuttingBatchFixResultDto>) {
    Object.assign(this, partial);
  }
}

/** Gợi ý "gộp thêm đơn" cho 1 loại sắt vượt ngưỡng ở cây chuẩn - ít hao hụt nhất trong luật gộp. */
@Exclude()
export class CuttingBatchFixAddDto {
  /// ProductionInvoiceItem.id cần THÊM vào đợt
  @Expose() @ApiProperty({ type: [String] }) itemIds!: string[];
  /// hao hụt của loại sắt này ở cây chuẩn SAU khi thêm (số bộ giải thật)
  @Expose() @ApiProperty() wastePct!: number;
  @Expose() @ApiProperty() bars!: number;
  /// false = gộp hết đơn được phép vẫn chưa về ngưỡng (vẫn trả để KHSX thấy gộp giúp được bao nhiêu)
  @Expose() @ApiProperty() meetsThreshold!: boolean;
  /// khoảng mốc cần sắt (ngày) của đợt SAU khi thêm, null = không đủ 2 SKU có mốc
  @Expose() @ApiPropertyOptional({ nullable: true }) spanDaysAfter!: number | null;

  constructor(partial: Partial<CuttingBatchFixAddDto>) {
    Object.assign(this, partial);
  }
}

/** 1 loại sắt của đợt đang chọn: trạng thái ở cây chuẩn + các cách xử lý khi vượt ngưỡng. */
@Exclude()
export class CuttingBatchFixMaterialDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() thresholdPct!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) stockLengthMm!: number | null;
  /// ok = cắt chung ở cây chuẩn đạt ngưỡng; over = vượt; unknown = bộ giải chưa kịp/không kết luận được
  @Expose() @ApiProperty({ enum: ['ok', 'over', 'unknown'] }) status!: 'ok' | 'over' | 'unknown';
  /// hao hụt ở cây chuẩn (over + scan: "tốt nhất có thể" khi phá luật mỗi cây - chỉ để tham khảo)
  @Expose() @ApiPropertyOptional({ nullable: true }) wastePct!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) bars!: number | null;
  @Expose()
  @ApiPropertyOptional({ nullable: true, enum: ['fixed', 'scan'] })
  verifiedLengthSource!: 'fixed' | 'scan' | null;
  /// SKU (id) trong đợt có dùng loại này
  @Expose() @ApiProperty({ type: [String] }) itemIds!: string[];
  @Expose()
  @ApiPropertyOptional({ type: CuttingBatchFixAddDto, nullable: true })
  @Type(() => CuttingBatchFixAddDto)
  addSuggestion!: CuttingBatchFixAddDto | null;
  /// vì sao không có gợi ý gộp (vd không còn đơn nào trong N ngày, đã đủ M SKU)
  @Expose() @ApiPropertyOptional({ nullable: true }) addReason!: string | null;
  /// không gộp: chế độ Bình thường tự đặt cây riêng - null khi không tìm được / không cho đặt cây riêng
  @Expose()
  @ApiPropertyOptional({ type: CuttingBatchFixResultDto, nullable: true })
  @Type(() => CuttingBatchFixResultDto)
  customLength!: CuttingBatchFixResultDto | null;
  /// đơn gấp: vẫn mua cây chuẩn, không trần hao hụt
  @Expose()
  @ApiPropertyOptional({ type: CuttingBatchFixResultDto, nullable: true })
  @Type(() => CuttingBatchFixResultDto)
  urgent!: CuttingBatchFixResultDto | null;

  constructor(partial: Partial<CuttingBatchFixMaterialDto>) {
    Object.assign(this, partial);
  }
}

/**
 * Khối "Đợt đang chọn" ở màn Tối ưu cắt sắt (2026-10-24, người dùng: chỉ gộp khi đơn cắt riêng ở cây 6m vượt 1 % mà không muốn dùng
 * chế độ đơn gấp; Sếp Nhân: chỉ gom lệnh có mốc cần sắt cách nhau ≤ 3 ngày; người dùng: ít hao hụt nhất, tối đa M SKU).
 */
@Exclude()
export class CuttingBatchFixOptionsDto {
  @Expose() @ApiProperty() windowDays!: number;
  @Expose() @ApiProperty() maxSkus!: number;
  @Expose() @ApiProperty() count!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) spanDays!: number | null;
  /// đợt đang chọn có hợp luật gộp không (false = nút Tính bị chặn ở BE)
  @Expose() @ApiProperty() ruleOk!: boolean;
  @Expose() @ApiPropertyOptional({ nullable: true }) ruleReason!: string | null;
  @Expose()
  @ApiProperty({ type: [CuttingBatchFixMaterialDto] })
  @Type(() => CuttingBatchFixMaterialDto)
  materials!: CuttingBatchFixMaterialDto[];
  /// hợp các gợi ý gộp ĐẠT ngưỡng, còn hợp luật khi thêm cùng lúc - nút "Thêm tất cả đơn gợi ý"; null = không có / không hợp luật
  @Expose() @ApiPropertyOptional({ type: [String], nullable: true }) addAllItemIds!:
    string[] | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) addAllReason!: string | null;
  /// hết ngân sách thời gian trước khi tính xong mọi cách xử lý (phần còn thiếu để null)
  @Expose() @ApiProperty() incomplete!: boolean;

  constructor(partial: Partial<CuttingBatchFixOptionsDto>) {
    Object.assign(this, partial);
  }
}
