import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import {
  ProdItemStageType,
  ProductionOrderFloorStage,
  ProductionOrderStatus,
} from '../../../generated/prisma/client';

/// Mốc kế hoạch của SKU cha (ProductionInvoiceItem.stages, LenhSXPage "Sửa thời hạn") - lặp lại
/// đúng shape `ItemStageDto` bên production-invoices (không import chéo module, cùng idiom DTO
/// nội bộ từng module tự khai riêng đã dùng trong codebase).
class ProductionOrderStageDto {
  @Expose() @ApiProperty({ enum: ProdItemStageType }) stageType!: ProdItemStageType;
  @Expose() @ApiProperty() deadline!: Date;
}

@Exclude()
export class ProductionOrderResponseDto {
  @Expose() @ApiProperty() id!: string;
  /// Mã nội bộ (ProductionOrder.poNumber) - CHỈ để hệ thống tra cứu, KHÔNG hiển thị cho người
  /// dùng. FE dùng `salesOrderCode` bên dưới thay thế (xem trao đổi 2026-08-18).
  @Expose() @ApiProperty() poNumber!: string;
  /// Mã đơn hàng Sales gốc (SalesOrder.orderCode, Sales tự nhập tay - 2026-09-10, trước đó là
  /// SalesOrder.code tự sinh PO-{id}) - đây mới là mã "PO" người dùng cần thấy. null khi SKU
  /// không gắn đơn Sales nào (tạo tay).
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  /// Id PI cha (ProductionInvoice.id) - dùng để gọi các endpoint gộp theo PI (vd
  /// POST /production-invoices/:id/steel-issues, xem changelog 2026-08-18-xuat-sat-po-pi-vat-tu.md).
  @Expose() @ApiProperty() productionInvoiceId!: string;
  /// Mã PI cha (ProductionInvoice.code, vd "PI-2026-003") - để phân biệt PO (đơn hàng) và PI
  /// (lệnh sản xuất nội bộ), vì 1 PO có thể ứng nhiều PI/SKU (xem PI gộp isMerged).
  @Expose() @ApiProperty() piCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) deliveryDeadline!: Date | null;
  /// Kho thành phẩm QLSX chọn làm điểm cuối trước khi gửi Sếp duyệt (ProductionInvoiceItem.
  /// warehouseCode) - warehouseScope cụ thể (vd 'thanh-pham-2'), KHÔNG phải cả gia đình. null nếu
  /// item được duyệt qua luồng cũ chưa từng gán kho (hiếm, xem comment schema.prisma).
  @Expose() @ApiPropertyOptional({ nullable: true }) warehouseCode!: string | null;
  @Expose() @ApiProperty() productionInvoiceItemId!: string;
  @Expose() @ApiProperty() mfgProductId!: string;
  @Expose() @ApiProperty() bomRevisionId!: string;
  @Expose() @ApiProperty() quantity!: number;
  @Expose() @ApiProperty({ enum: ProductionOrderStatus }) status!: ProductionOrderStatus;
  @Expose() @ApiPropertyOptional({ nullable: true }) releasedAt!: Date | null;
  /// QLSX kiểm soát qua nút Bắt đầu/Kết thúc ở "Bảng thống kê" - ĐỘC LẬP với `status` ở trên.
  /// Hàn/Sơn chỉ thấy lệnh này khi ACTIVE (xem ProductionOrderFloorStage).
  @Expose()
  @ApiProperty({ enum: ProductionOrderFloorStage })
  floorStage!: ProductionOrderFloorStage;
  @Expose() @ApiPropertyOptional({ nullable: true }) floorStartedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) floorFinishedAt!: Date | null;
  @Expose() @ApiProperty() createdAt!: Date;
  /// true nếu `bomRevisionId` ở trên KHÔNG còn là bản BOM đang ACTIVE của `mfgProductId` (định
  /// mức sản phẩm đã được sửa/duyệt lại SAU KHI lệnh này được tạo - xem changelog
  /// 2026-09-11-bom-revision-ghim-cu-canh-bao.md). Vật tư mới khai ở bản BOM mới sẽ KHÔNG áp
  /// dụng cho lệnh này (getIssuePlan các module xuất kho đều đọc theo bomRevisionId đã ghim) -
  /// FE dùng cờ này để cảnh báo, KHÔNG tự động đổi bomRevisionId (rủi ro sai lệch số liệu đã
  /// xuất/đã cắt theo định mức cũ).
  @Expose() @ApiProperty() bomOutOfDate!: boolean;
  /// Mốc kế hoạch của SKU cha (Khung cơ khí/Phôi/Hàn/Sơn/Đan/Đóng gói) - thêm 2026-09-12 để màn
  /// Hàn/Sơn (core.tsx fetchHanSonRows()) hiện được "Deadline" thật thay vì hard-code '—'. Đọc
  /// đúng `stageType` cần dùng (FRAME_HAN cho Hàn, FRAME_SON cho Sơn) ở phía FE.
  @Expose() @ApiProperty({ type: [ProductionOrderStageDto] }) stages!: ProductionOrderStageDto[];

  constructor(partial: Partial<ProductionOrderResponseDto>) {
    Object.assign(this, partial);
  }
}
