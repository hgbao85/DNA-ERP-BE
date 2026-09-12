import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { StockLedgerRefType } from '../../../generated/prisma/client';

/** Đúng 1 trong 4 cặp {xxxId, xxxLabel} khác null trên mỗi dòng - mirror XOR của chính bảng gốc. */
@Exclude()
export class StockLedgerResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() fromWarehouseId!: string;
  @Expose() @ApiProperty() fromWarehouseCode!: string;
  /// Tên kho hiển thị (vd "Kho Phôi Sơn Hàn") - thêm 2026-09-12 cho màn "Lịch sử kho": người dùng
  /// đọc "nhận từ Nhà cung cấp" dễ hơn "nhận từ SUPPLIER".
  @Expose() @ApiProperty() fromWarehouseName!: string;
  @Expose() @ApiProperty() toWarehouseId!: string;
  @Expose() @ApiProperty() toWarehouseCode!: string;
  @Expose() @ApiProperty() toWarehouseName!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialCode!: string | null;
  /// Tên + ĐVT vật tư - relation `material` vốn đã được load sẵn trong LEDGER_INCLUDE, chỉ là
  /// trước đây DTO không trả ra nên màn lịch sử chỉ hiện được mã trần, không biết "18" là 18 cây
  /// hay 18 kg (thêm 2026-09-12).
  @Expose() @ApiPropertyOptional({ nullable: true }) materialName!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialUnit!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) segmentSpecId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) segmentSpecLabel!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) pieceId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) pieceCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productVariantId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productVariantLabel!: string | null;
  @Expose() @ApiProperty() qty!: number;
  @Expose() @ApiProperty({ enum: StockLedgerRefType }) refType!: StockLedgerRefType;
  @Expose() @ApiPropertyOptional({ nullable: true }) refId!: string | null;
  /// Mã chứng từ đọc được của bản ghi nguồn (vd "CK-2026-010") - thêm 2026-09-12 cho cột "Chứng từ"
  /// ở màn Lịch sử kho. CHỈ `WarehouseTransfer` có cột `code`; mọi nguồn khác (xuất sắt, mua hàng,
  /// xuất bao bì, điều chỉnh...) không có mã người đọc được nên trả null - FE tự hiện nhãn loại
  /// chứng từ thay thế.
  @Expose() @ApiPropertyOptional({ nullable: true }) refCode!: string | null;
  /// Công đoạn/tổ gắn với bản ghi nguồn (MfgStage: PHOI/HAN/SON/DAN) - thêm 2026-09-12 để sổ kho
  /// ghi được "Đến: Tổ Phôi" thay vì chung chung "Xưởng sản xuất". Chỉ tra được với refType có
  /// cột stage thật (SEGMENT_CONSUME → ProductionBatch.stage, MATERIAL_ISSUE → MaterialIssue.stage);
  /// refType khác thì null và FE tự suy tổ cố định theo nghiệp vụ (vd STEEL_ISSUE luôn là Phôi).
  @Expose() @ApiPropertyOptional({ nullable: true }) refStage!: string | null;
  /// Mã đơn hàng Sales (SalesOrder.orderCode, vd "PO-KH-2026-014") của Lệnh sản xuất gắn với bản
  /// ghi nguồn - thêm 2026-09-12 theo yêu cầu Sếp (cột "Mã đơn hàng (PO)" ở màn Lịch sử kho). Chỉ
  /// tra được với refType đi qua 1 ProductionOrder/ProductionInvoice cụ thể (MATERIAL_ISSUE,
  /// SEGMENT_CONSUME, PACKAGING_ISSUE, MATERIAL_YIELD_CONSUME, WEAVING_ISSUE_MATERIAL, STEEL_ISSUE);
  /// null cho các refType không gắn đơn hàng nào (mua hàng, chuyển kho, KCS phế, điều chỉnh tay...)
  /// hoặc khi PI nguồn là PI gộp nhiều đơn (ProductionInvoice.salesOrderId = null, xem comment ở đó).
  @Expose() @ApiPropertyOptional({ nullable: true }) poCode!: string | null;
  /// Mã Lệnh sản xuất (ProductionInvoice.code, vd "PI-2026-005") gắn với bản ghi nguồn - cột
  /// "Lệnh sản xuất" ở màn Lịch sử kho (2026-09-12, theo yêu cầu Sếp). "Lệnh sản xuất" TRONG TOÀN
  /// HỆ THỐNG là ProductionInvoice/PI (nhãn "Lệnh sản xuất (PI)" ở Admin), KHÔNG phải
  /// ProductionOrder.poNumber (mã đó chỉ tra cứu nội bộ, không hiển thị - xem comment refCode).
  /// null cho refType không gắn Lệnh sản xuất nào (mua hàng, chuyển kho, KCS phế, điều chỉnh tay).
  @Expose() @ApiPropertyOptional({ nullable: true }) piCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiPropertyOptional({ nullable: true }) createdById!: string | null;
  /// Tên người ghi bút toán - trả sẵn thay vì để FE resolve qua GET /users (thủ kho không có
  /// USER:VIEW, xem comment LEDGER_INCLUDE). null với bút toán hệ thống/trước khi có cột này.
  @Expose() @ApiPropertyOptional({ nullable: true }) createdByName!: string | null;
  /// Chiều dài cây (mm) khi hàng là sắt cây bán theo chiều dài, 0 cho mọi loại khác - cùng 1 mã
  /// sắt nhưng khác chiều dài là 2 lô tồn RIÊNG (xem comment cột stockLengthMm ở schema), nên sổ
  /// kho phải hiện ra mới đọc đúng được (thêm 2026-09-12).
  @Expose() @ApiProperty() stockLengthMm!: number;

  constructor(partial: Partial<StockLedgerResponseDto>) {
    Object.assign(this, partial);
  }
}
