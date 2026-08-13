import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { ProdApprovalStatus } from '../../../generated/prisma/client';

/** Gộp có cứu được loại sắt này không - quyết định KHSX phải làm gì với nó. */
export enum CuttingBatchOutcome {
  /// Gộp thêm đơn là xuống dưới ngưỡng -> việc của KHSX.
  FIXED_BY_MERGE = 'FIXED_BY_MERGE',
  /// Gộp hết mọi đơn đang chờ vẫn không đạt -> KHÔNG phải bài toán gom. Hoặc chỉnh ngưỡng của
  /// vật tư cho đúng khả năng thật, hoặc sửa chiều dài đoạn ở khâu thiết kế. Ca điển hình: loại
  /// sắt chỉ đúng 1 sản phẩm dùng, và sản phẩm đó chỉ có 1 cỡ đoạn.
  UNFIXABLE_BY_MERGE = 'UNFIXABLE_BY_MERGE',
}

@Exclude()
export class CuttingBatchOrderDto {
  /// ProductionInvoiceItem.id - ứng viên gộp là ITEM của phiếu sản xuất, KHÔNG phải
  /// ProductionOrder (lệnh sản xuất chỉ sinh ra khi Sếp duyệt, mà gộp phải xong TRƯỚC lúc đó).
  @Expose() @ApiProperty() productionInvoiceItemId!: string;
  /// Mã đơn hàng của khách (SalesOrder.code, vd "PO-4") - đây là mã người dùng gọi là "PO".
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty() productionInvoiceCode!: string;
  @Expose() @ApiProperty() mfgProductCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) mfgProductName!: string | null;
  @Expose() @ApiProperty() quantity!: number;
  /// null (Sales vừa tạo, KHSX chưa gửi QLSX) | WAITING_QLSX | WAITING_BOSS - hiện ra để KHSX
  /// biết đơn nào còn có thể bị loại khỏi nhóm. Đơn APPROVED không bao giờ vào danh sách (solver
  /// đã chạy riêng cho nó rồi), REJECTED cũng không.
  @Expose()
  @ApiPropertyOptional({ enum: ProdApprovalStatus, nullable: true })
  prodApprovalStatus!: ProdApprovalStatus | null;
  /// Hạn công đoạn Khung cơ khí (stageType=FRAME, công đoạn chứa Phôi/cắt), rơi về
  /// ProductionInvoice.deadline rồi SalesOrderItem.deliveryDate. null = KHÔNG có hạn nào ->
  /// xếp CUỐI danh sách, không được coi là gấp nhất.
  @Expose() @ApiPropertyOptional({ nullable: true }) deadline!: Date | null;

  constructor(partial: Partial<CuttingBatchOrderDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class CuttingBatchLevelDto {
  /// Số đơn gộp ở mức này (cộng dồn theo thứ tự hạn gần nhất trước).
  @Expose() @ApiProperty() orderCount!: number;
  /// Mã SKU (MfgProduct.factoryCode) của từng đơn trong mức này - KHÔNG dùng mã đơn hàng vì 2 SKU
  /// cùng một đơn sẽ cho ra nhãn trùng nhau, không phân biệt được.
  @Expose() @ApiProperty({ type: [String] }) orderLabels!: string[];
  /// Các cỡ đoạn KHÁC NHAU có mặt khi gộp tới mức này - càng nhiều cỡ càng dễ lấp đầy cây.
  @Expose() @ApiProperty({ type: [Number] }) cutSizesMm!: number[];
  @Expose() @ApiProperty() stockLengthMm!: number;
  /// GIỚI HẠN DƯỚI của hao hụt (%). KHÔNG phải con số sẽ đạt được - hiển thị PHẢI kèm "≥".
  /// Xem best-fill.util.ts để biết vì sao thực tế có thể cao hơn.
  @Expose() @ApiProperty() minWastePct!: number;
  @Expose() @ApiProperty() minWastePerBarMm!: number;
  /// Cận dưới số cây phải mua khi cắt CHUNG cả nhóm này.
  @Expose() @ApiProperty() minBars!: number;
  /// Cận dưới số cây nếu cắt RIÊNG từng đơn trong nhóm (cộng lại).
  @Expose() @ApiProperty() barsSeparate!: number;
  /// barsSeparate − minBars = lợi ích THẬT của việc gộp. ĐÂY LÀ CHỈ SỐ CHÍNH cho KHSX, không
  /// phải %: trong 1 loại sắt, gộp đơn tốt với đơn xấu cho ra % NẰM GIỮA hai số, nên % của đơn
  /// đang tốt sẽ xấu đi dù TỔNG sắt mua vẫn giảm.
  ///
  /// CÓ THỂ BẰNG 0 dù % giảm mạnh: % là chất lượng của kiểu cắt, còn tiết kiệm được nguyên một
  /// cây hay không còn phụ thuộc SỐ LƯỢNG. Số lượng nhỏ thì cải thiện % chưa đủ để bớt trọn 1 cây.
  /// Đây là sự thật cần hiển thị trung thực, không phải lỗi.
  @Expose() @ApiProperty() barsSavedVsSeparate!: number;
  /// Đơn có hạn XA NHẤT trong mức này phải cắt sớm bao nhiêu ngày so với đơn gấp nhất. Đặt cạnh
  /// barsSavedVsAlone để KHSX cân "bớt mấy cây" với "ôm tồn bán thành phẩm sớm mấy ngày".
  /// null khi thiếu dữ liệu hạn.
  @Expose() @ApiPropertyOptional({ nullable: true }) daysCutEarly!: number | null;
  /// true = mức này đã xuống dưới ngưỡng của vật tư. Danh sách CẮT tại mức đầu tiên đạt - gộp
  /// thêm nữa chỉ tăng chi phí cắt sớm mà không cần thiết.
  @Expose() @ApiProperty() meetsThreshold!: boolean;

  constructor(partial: Partial<CuttingBatchLevelDto>) {
    Object.assign(this, partial);
  }
}

/**
 * Gợi ý gộp đợt cắt cho MỘT loại sắt đang vượt ngưỡng hao hụt.
 *
 * Chỉ loại sắt VƯỢT ngưỡng mới xuất hiện (yêu cầu Sếp 2026-08-12: "PO nào đã tối ưu <1% thì không
 * cần gộp"). Nhưng các đơn được gộp VÀO thì KHÔNG lọc theo ngưỡng - chính những đơn đang đạt
 * ngưỡng mới là nguồn cỡ đoạn cứu đơn đang vượt (J55 ở 1,88% được cứu nhờ Ghế tình yêu ở 0,17%).
 * Lọc cả hai đầu là tính năng chết ngay: không còn gì để gộp.
 */
@Exclude()
export class CuttingBatchSuggestionDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  /// Ngưỡng áp cho CHÍNH vật tư này: Material.maxCuttingWastePercentage, rơi về
  /// SystemConfig.solverMaxWastePercentage khi chưa đặt riêng. KHÔNG hardcode 1%.
  @Expose() @ApiProperty() thresholdPct!: number;
  @Expose() @ApiProperty({ enum: CuttingBatchOutcome }) outcome!: CuttingBatchOutcome;
  /// Đơn gấp nhất (hạn gần nhất) đang vượt ngưỡng - mốc neo của mọi mức gộp.
  @Expose()
  @ApiProperty({ type: CuttingBatchOrderDto })
  @Type(() => CuttingBatchOrderDto)
  anchor!: CuttingBatchOrderDto;
  /// Mọi đơn chưa duyệt có dùng loại sắt này, xếp theo hạn gần nhất trước (không hạn xếp cuối).
  @Expose()
  @ApiProperty({ type: [CuttingBatchOrderDto] })
  @Type(() => CuttingBatchOrderDto)
  orders!: CuttingBatchOrderDto[];
  /// Cộng dồn: mức N = N đơn đầu trong `orders`. Danh sách DỪNG ở mức đầu tiên đạt ngưỡng (gộp
  /// tối thiểu đủ đạt, không gộp tối đa) để không đẩy chi phí cắt sớm lên vô ích.
  @Expose()
  @ApiProperty({ type: [CuttingBatchLevelDto] })
  @Type(() => CuttingBatchLevelDto)
  levels!: CuttingBatchLevelDto[];

  constructor(partial: Partial<CuttingBatchSuggestionDto>) {
    Object.assign(this, partial);
  }
}
