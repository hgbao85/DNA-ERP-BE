import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { PurchaseProposalStatus } from '../../../generated/prisma/client';

@Exclude()
export class PurchaseProposalQuoteResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) supplierId!: string | null;
  @Expose() @ApiProperty() supplierName!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) unitPrice!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) expectedDate!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiProperty() isChosen!: boolean;

  constructor(partial: Partial<PurchaseProposalQuoteResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class PurchaseProposalItemResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() unit!: string;
  /// Đơn vị mua hàng từ NCC (vd "kg") khi khác unit - null nếu vật tư chỉ có 1 đơn vị.
  @Expose() @ApiPropertyOptional({ nullable: true }) purchaseUnit!: string | null;
  /// Số lượng unit / 1 purchaseUnit (vd 250 = 250 cái/kg) - FE dùng để gợi ý quy đổi lúc nhập kho.
  @Expose() @ApiPropertyOptional({ nullable: true }) khoUnitFactor!: number | null;
  /// Kho nhận hàng THẬT của riêng vật tư này (Material.warehouseId -> Warehouse.code) - nguồn
  /// xác thực để Thủ kho nhận hàng (xem PurchaseProposalsService.receiveItem()). KHÔNG dùng
  /// PurchaseProposalResponseDto.warehouseCode cấp đề xuất (nay chỉ là tóm tắt/hiển thị) - 1 đề
  /// xuất có thể gồm nhiều vật tư khác kho nhau.
  @Expose() @ApiPropertyOptional({ nullable: true }) warehouseCode!: string | null;
  /// Tồn thật (kho của vật tư, xem warehouseCode ở trên) chụp lúc CuttingProposalsService.
  /// approve() tạo dòng này - FE dùng để hiển thị + suy ra required = actualStock + buyQty
  /// (xem purchasing-api.ts).
  @Expose() @ApiProperty() actualStock!: number;
  @Expose() @ApiProperty() buyQty!: number;
  /// Chiều dài cây phải đặt (mm) - CHỈ có ở nhánh sắt (copy từ CuttingProposalLine.
  /// bestStockLengthMm lúc CuttingProposalsService.approve(), 2026-08-26). null cho nhánh kiểm
  /// tra vật tư (InspectionKhoResultItem) - không có khái niệm chiều dài cây. buyQty vô nghĩa
  /// nếu người mua không biết đặt cây dài bao nhiêu, nhất là từ khi solver có thể đề xuất cây
  /// KHÁC 6000mm mặc định (auto_scan mở lại, xem CuttingProposalLine.lengthSource).
  @Expose() @ApiPropertyOptional({ nullable: true }) stockLengthMm!: number | null;
  @Expose() @ApiProperty() receivedQty!: number;
  /// Cộng dồn số lượng thực nhận theo purchaseUnit - chỉ để đối chiếu/audit, xem
  /// PurchaseProposalItem.receivedQtyPurchaseUnit.
  @Expose() @ApiPropertyOptional({ nullable: true }) receivedQtyPurchaseUnit!: number | null;
  /// State machine THẬT, ĐỘC LẬP theo từng dòng (2026-08-25, "duyệt riêng từng người mua hàng").
  /// Từ 2026-08-27 rút còn NEW -> PURCHASING -> PURCHASED; QUOTING/SUBMITTED/REJECTED chỉ còn
  /// trong dữ liệu cũ. PurchaseProposalResponseDto.status (cấp đề xuất) chỉ là ROLLUP suy ra từ
  /// các dòng này, KHÔNG dùng để quyết định 1 dòng cụ thể đang làm được thao tác gì.
  @Expose() @ApiProperty({ enum: PurchaseProposalStatus }) status!: PurchaseProposalStatus;
  @Expose() @ApiPropertyOptional({ nullable: true }) submittedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) approvedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) rejectedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) purchasedAt!: Date | null;
  /// File phiếu Sếp đã ký tay duyệt lô mua này (2026-08-27) - FE hiện link "Xem file Sếp duyệt"
  /// ở màn Mua hàng và màn Nhập kho. null = dòng duyệt theo luồng cũ (qua màn So sánh giá).
  @Expose() @ApiPropertyOptional({ nullable: true }) approvalFileUrl!: string | null;
  /// Báo giá NCC của luồng CŨ - chỉ còn để TRA CỨU LỊCH SỬ (2026-08-27 gỡ hết đường ghi). Đơn
  /// duyệt theo luồng mới luôn rỗng: giá và NCC nằm trong file `approvalFileUrl`.
  @Expose()
  @ApiProperty({ type: [PurchaseProposalQuoteResponseDto] })
  @Type(() => PurchaseProposalQuoteResponseDto)
  quotes!: PurchaseProposalQuoteResponseDto[];

  constructor(partial: Partial<PurchaseProposalItemResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class PurchaseProposalResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) cuttingProposalId!: string | null;
  /// Kho TÓM TẮT của cả đề xuất (kho của dòng vật tư đầu tiên lúc tạo) - CHỈ để hiển thị nhanh,
  /// KHÔNG dùng để nhận hàng. Nguồn xác thực thật là từng PurchaseProposalItem.warehouseCode ở
  /// trên, vì 1 đề xuất có thể gồm nhiều vật tư khác kho nhau.
  @Expose() @ApiProperty() warehouseCode!: string;
  /// ROLLUP (2026-08-25) - suy ra từ status của TỪNG DÒNG (PurchaseProposalItemResponseDto.status,
  /// xem recomputeProposalStatus()), không còn là nguồn sự thật cho gate nghiệp vụ. Dùng để lọc
  /// hàng-đợi (activeOnly) và hiển thị tổng quát (màn Admin) - KHÔNG dùng để biết 1 dòng vật tư cụ
  /// thể đang làm được thao tác gì, vì 1 đề xuất gộp có thể có dòng PURCHASING cạnh dòng QUOTING.
  @Expose() @ApiProperty({ enum: PurchaseProposalStatus }) status!: PurchaseProposalStatus;
  /// PO nội bộ (ProductionOrder.poNumber) - CHỈ để hệ thống tra cứu/debug, không còn ý nghĩa hiển
  /// thị cho người dùng (xem trao đổi 2026-08-18) - FE dùng `salesOrderCode` bên dưới thay thế
  /// cho cột "PO" trên UI Mua hàng. Trước đó từng đổi sang mã PI theo chốt của Sếp (2026-08-17),
  /// nay tách riêng thành `salesOrderCode`/`piCode` nên field này quay về vai trò tra cứu nội bộ.
  @Expose() @ApiProperty() poNumber!: string;
  /// Mã đơn hàng Sales gốc (SalesOrder.code, vd "PO-31") - đây mới là mã "PO" người dùng cần
  /// thấy. null khi SKU không gắn đơn Sales nào (tạo tay). Nhánh PI gộp có thể trả về NHIỀU mã
  /// nối bằng ", " nếu các SKU trong nhóm thuộc nhiều đơn Sales khác nhau (hiếm).
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  /// Mã ProductionInvoice ("PI-2026-001") mà lệnh SX/PI gộp phía trên thuộc về - tách riêng khỏi
  /// poNumber vì 2 bộ đếm độc lập nhau (ProductionOrder vs ProductionInvoice), dễ nhầm là cùng 1
  /// mã do cùng đứng cạnh nhau trên UI Mua hàng (xem LenhMuaNCCPage/TheoDoiMuaHangPage FE).
  @Expose() @ApiProperty() piCode!: string;
  @Expose() @ApiProperty() mfgProductCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) mfgProductName!: string | null;
  /// Hạn Mua hàng nên ưu tiên - nhánh lệnh SX đơn: materialDeadline -> mốc Khung cơ khí -> hạn cả
  /// PI của chính SKU đó; nhánh PI gộp: hạn SỚM NHẤT trong cả nhóm SKU (xem
  /// PurchaseProposalsService.frameDeadlineOf). null nếu không SKU nào trong đề xuất có hạn nào.
  @Expose() @ApiPropertyOptional({ nullable: true }) deadline!: Date | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiPropertyOptional({ nullable: true }) submittedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) approvedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) rejectedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) purchasedAt!: Date | null;
  @Expose()
  @ApiPropertyOptional({ type: [PurchaseProposalItemResponseDto] })
  @Type(() => PurchaseProposalItemResponseDto)
  items?: PurchaseProposalItemResponseDto[];

  constructor(partial: Partial<PurchaseProposalResponseDto>) {
    Object.assign(this, partial);
  }
}
