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
export class PurchaseReceiptLogResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() unitRateQty!: number;
  @Expose() @ApiProperty() supplierUnitQty!: number;
  @Expose() @ApiProperty() receivedQty!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) receiptFileUrl!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) receivedByName!: string | null;
  @Expose() @ApiProperty() receivedAt!: Date;
  /// Phiếu nhận chứa lần nhận này (Đợt 5d) - null với lịch sử trước Đợt 5d.
  @Expose() @ApiPropertyOptional({ nullable: true }) receiptId!: string | null;
  /// Tổng của cả phiếu (đơn gộp: lần nhận của dòng này chỉ là 1 phần chia).
  @Expose() @ApiPropertyOptional({ nullable: true }) receiptTotalQty!: number | null;
  /// Số phiếu nhập NK-yymmdd-NNN của phiếu chứa lần nhận này (11/11/2026 - hiện ở "Lịch sử nhận hàng").
  @Expose() @ApiPropertyOptional({ nullable: true, type: String }) receiptCode!: string | null;
  @Expose() @ApiProperty() allocationAdjusted!: boolean;
  /// 4 ô chứng từ của phiếu (YC4): (1) phiếu giao NCC, (2) phiếu đề xuất Giám đốc ký, (3) phiếu nhập kho, (4) phiếu cân xe.
  @Expose() @ApiProperty() supplierSlipUrls!: string[];
  @Expose() @ApiProperty() approvalFileUrls!: string[];
  @Expose() @ApiProperty() receiptSlipUrls!: string[];
  @Expose() @ApiProperty() weighSlipUrls!: string[];
  /// Nhận vượt của cả phiếu (Đợt 5e, 4.12): số vượt, lý do, ảnh bằng chứng.
  @Expose() @ApiProperty() overQty!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) overReason!: string | null;
  @Expose() @ApiProperty() overFileUrls!: string[];

  constructor(partial: Partial<PurchaseReceiptLogResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class PurchaseProposalItemResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  /// Quy cách vật tư (Material.spec, vd "10x29x0.8") - Thủ kho đối chiếu hàng về đúng quy cách đã
  /// đặt, nhất là vật tư trùng tên khác kích cỡ (2026-09-15).
  @Expose() @ApiPropertyOptional({ nullable: true }) materialSpec!: string | null;
  @Expose() @ApiProperty() unit!: string;
  /// 13/11/2026: ưu tiên % ĐÃ DÙNG lúc tính dòng này (PurchaseProposalItem.appliedWastePct); dòng cũ chưa lưu thì như dưới.
  /// % dự trù hao hụt khi mua (Material.purchaseWastePercentage) - LIVE theo Material HIỆN TẠI,
  /// KHÔNG snapshot lúc tạo dòng. Đã được cộng vào
  /// `buyQty` dưới đây ngay lúc tính đề xuất (2026-10-08, xem Consumable/PieceMaterialYield/
  /// MaterialYieldRecipePurchaseService) - field này CHỈ để FE hiển thị giải thích vì sao buyQty
  /// cao hơn nhu cầu gốc, không dùng để tính lại gì. null = vật tư chưa cấu hình % (hoặc Sắt
  /// phần mềm, luôn null - xem MaterialsService.resolveWasteFields).
  @Expose() @ApiPropertyOptional({ nullable: true }) purchaseWastePercentage!: number | null;
  /// Vật tư nhóm Sắt (STEEL_BAR) - nhận hàng bắt buộc ảnh phiếu cân xe (Đợt 5d, bản v8 4.6).
  @Expose() @ApiProperty() isSteel!: boolean;
  /// Kho nhận hàng THẬT của riêng vật tư này - nguồn xác thực để Thủ kho nhận hàng (xem
  /// PurchaseProposalsService.receiveItem()). Thường = Material.warehouseId -> Warehouse.code,
  /// TRỪ vật tư có kho MẶC ĐỊNH đã thuộc họ "thanh-pham" (2026-09-04, vd Bì zipper/Nhãn): khi đó
  /// = kho thành phẩm mà QLSX đã chọn cho PI, ghi đè (xem
  /// PurchaseProposalItem.receiveWarehouseCode) - vật tư mặc định về vat-tu-tp/phoi-son-han (vd
  /// Nút vặn/Sắt) KHÔNG bị ghi đè, luôn nhận vào đúng kho trung chuyển như cũ. KHÔNG dùng
  /// PurchaseProposalResponseDto.warehouseCode cấp đề xuất (nay chỉ là tóm tắt/hiển thị) - 1 đề
  /// xuất có thể gồm nhiều vật tư khác kho nhau.
  @Expose() @ApiPropertyOptional({ nullable: true }) warehouseCode!: string | null;
  /// Tồn thật (kho của vật tư, xem warehouseCode ở trên) chụp lúc CuttingProposalsService.
  /// approve() tạo dòng này - FE dùng để hiển thị + suy ra required = actualStock + buyQty
  /// (xem purchasing-api.ts).
  @Expose() @ApiProperty() actualStock!: number;
  @Expose() @ApiProperty() buyQty!: number;
  /// "Số mua" người mua đã chốt (2026-11-04, YC7 mục 7.2) - null = mua đúng buyQty ("cần mua").
  @Expose() @ApiPropertyOptional({ nullable: true }) orderQty!: number | null;
  /// Số thực mua = max(buyQty, orderQty) - số in trên phiếu đề xuất và mốc để dòng đóng hồ sơ khi
  /// nhận đủ. Mua dư = purchaseQty − buyQty.
  @Expose() @ApiProperty() purchaseQty!: number;
  /// Đơn đặt hàng NCC chứa dòng này (2026-11-04, bản v8 mục 4.10) - null = chưa vào đơn nào.
  @Expose() @ApiPropertyOptional({ nullable: true }) supplierOrderId!: string | null;
  /// "Số đơn đặt hàng" dạng "52/2026" - đánh riêng theo từng NCC, đánh lại từ 1 mỗi năm.
  @Expose() @ApiPropertyOptional({ nullable: true }) supplierOrderCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) supplierOrderStatus!: string | null;
  /// File phiếu đề xuất Giám đốc ký của đơn đặt hàng - Nhập kho tự dùng làm chứng từ (2) (Đợt 5d).
  @Expose() @ApiPropertyOptional({ nullable: true }) supplierOrderApprovalFileUrl!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) supplierName!: string | null;
  /// Chiều dài cây phải đặt (mm) - CHỈ có ở nhánh sắt (copy từ CuttingProposalLine.
  /// bestStockLengthMm lúc CuttingProposalsService.approve(), 2026-08-26). null cho nhánh kiểm
  /// tra vật tư (InspectionKhoResultItem) - không có khái niệm chiều dài cây. buyQty vô nghĩa
  /// nếu người mua không biết đặt cây dài bao nhiêu, nhất là từ khi solver có thể đề xuất cây
  /// KHÁC 6000mm mặc định (auto_scan mở lại, xem CuttingProposalLine.lengthSource).
  @Expose() @ApiPropertyOptional({ nullable: true }) stockLengthMm!: number | null;
  /// Hạn hàng phải về của RIÊNG dòng này theo nhóm vật tư (VT khung & đan / VT còn lại) - cùng hàm `purchaseDeadlineOf` với
  /// Bảng mốc (2026-10-29, changelog 2026-09-25 mục 32.27). Dây/nệm chỉ theo SKU đã chọn nó; vật tư chung theo SKU gấp nhất.
  @Expose() @ApiPropertyOptional({ nullable: true }) deadline!: Date | null;
  @Expose() @ApiProperty() receivedQty!: number;
  /// Cộng dồn "Ô2" (supplierUnitQty) của từng lần nhận - chỉ để đối chiếu/audit tổng số lượng
  /// theo đơn vị bên bán, xem receiptLogs bên dưới để xem chi tiết từng lô.
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
  /// Lịch sử từng lần nhận hàng (2026-10-16) - 1 dòng/1 lần gọi receiveItem(), mới nhất trước.
  /// Thay cho hệ số quy đổi cố định Material.purchaseUnit/khoUnitFactor đã xoá: Ô1/Ô2 nhập tay
  /// mỗi lô, xem PurchaseReceiptLog.
  @Expose()
  @ApiProperty({ type: [PurchaseReceiptLogResponseDto] })
  @Type(() => PurchaseReceiptLogResponseDto)
  receiptLogs!: PurchaseReceiptLogResponseDto[];

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
  /// Mã đơn hàng Sales gốc (SalesOrder.orderCode, Sales tự nhập tay - 2026-09-10, trước đó là
  /// SalesOrder.code tự sinh PO-{id}) - đây mới là mã "PO" người dùng cần thấy. null khi SKU
  /// không gắn đơn Sales nào (tạo tay). Nhánh PI gộp có thể trả về NHIỀU mã nối bằng ", " nếu
  /// các SKU trong nhóm thuộc nhiều đơn Sales khác nhau (hiếm).
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  /// Mã ProductionInvoice ("PI-2026-001") mà lệnh SX/PI gộp phía trên thuộc về - tách riêng khỏi
  /// poNumber vì 2 bộ đếm độc lập nhau (ProductionOrder vs ProductionInvoice), dễ nhầm là cùng 1
  /// mã do cùng đứng cạnh nhau trên UI Mua hàng (xem LenhMuaNCCPage/TheoDoiMuaHangPage FE).
  @Expose() @ApiProperty() piCode!: string;
  /// Mã lệnh hiển thị (2026-11-05): số LSX nhà máy (vd MY-313, lệnh gộp "MY-313 + GP-176"); lệnh
  /// cũ chưa có LSX thì bằng piCode. FE hiện field này ở mọi màn Mua hàng / Nhập kho.
  @Expose() @ApiProperty() lenhCode!: string;
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
