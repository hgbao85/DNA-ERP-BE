import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString } from 'class-validator';
import { ProdApprovalStatus } from '../../../generated/prisma/client';

/** Một loại sắt của MỘT SKU, kèm hao hụt khi SKU đó cắt một mình. */
@Exclude()
export class CandidateMaterialDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  /// Hao hụt tốt nhất có thể khi CHỈ SKU này cắt loại sắt này. Hiển thị kèm dấu "≥".
  @Expose() @ApiProperty() standaloneWastePct!: number;
  /// Cận dưới số cây khi cắt MỘT MÌNH SKU này (best-fill.util.ts - giả định nguồn đoạn vô hạn).
  /// Nhu cầu nhỏ (ít cây) khiến cận dưới lệch xa thực tế NHẤT: pattern lý tưởng không có đủ cây để
  /// lặp lại, cây cuối chi phối toàn bộ %. FE nên cảnh báo "cận dưới không đáng tin" khi số này
  /// thấp thay vì trình bày standaloneWastePct như con số chắc chắn - xem changelog 2026-08-15
  /// mục 15.6-7.
  @Expose() @ApiProperty() standaloneMinBars!: number;
  @Expose() @ApiProperty() thresholdPct!: number;
  @Expose() @ApiProperty() overThreshold!: boolean;
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
  /// Tổ hợp hệ thống tự đề xuất - FE tick sẵn để KHSX chỉ việc xem lại rồi xác nhận, vẫn sửa
  /// được. Lấy từ getBatchSuggestions(): các SKU của mức gộp TỐI THIỂU đủ đạt ngưỡng, gom lại.
  @Expose() @ApiProperty({ type: [String] }) recommendedItemIds!: string[];

  constructor(partial: Partial<CuttingBatchCandidateListDto>) {
    Object.assign(this, partial);
  }
}

export class PreviewCuttingBatchDto {
  @ApiProperty({ type: [String], description: 'ProductionInvoiceItem.id được KHSX tick chọn' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  productionInvoiceItemIds!: string[];
}

/** Kết quả tính thử cho ĐÚNG tổ hợp KHSX đang chọn, mỗi loại sắt 1 dòng. */
@Exclude()
export class CuttingBatchPreviewLineDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() thresholdPct!: number;
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
