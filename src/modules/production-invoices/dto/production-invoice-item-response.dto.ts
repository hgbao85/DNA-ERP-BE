import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import {
  CuttingProposalStatus,
  ProdApprovalStatus,
  ProdItemStageType,
  ProductionOrderFloorStage,
} from '../../../generated/prisma/client';

class ItemStageDto {
  @Expose() @ApiProperty({ enum: ProdItemStageType }) stageType!: ProdItemStageType;
  @Expose() @ApiProperty() deadline!: Date;
}

@Exclude()
export class ProductionInvoiceItemResponseDto {
  @Expose() @ApiProperty() id!: string;
  /**
   * Null = "chưa gom vào PI nào" - trạng thái ban đầu lúc Sales tạo PO, và cũng là trạng thái SKU
   * quay về sau khi Sếp từ chối (rejectItem/rejectBatch, 2026-08-24) để hiện lại được ở "Tối ưu
   * cắt sắt" (xem CuttingProposalsService.loadBatchContext()).
   */
  @Expose() @ApiPropertyOptional({ nullable: true }) productionInvoiceId!: string | null;
  /**
   * PO gốc của riêng SKU này. PHẢI đọc ở đây chứ không phải ở PI cha: PI gộp chứa SKU của nhiều
   * PO khác nhau nên PI cha không có salesOrder (null) - đây là thứ duy nhất cho biết SKU thuộc
   * đơn hàng nào khi hiện cây PI → PO → SKU.
   */
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty() mfgProductId!: string;
  @Expose() @ApiProperty() factoryCode!: string;
  @Expose() @ApiProperty() productName!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) productVariantId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) colorCode!: string | null;
  @Expose() @ApiProperty() quantity!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialDeadline!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) deliveryDeadline!: Date | null;
  @Expose()
  @ApiPropertyOptional({ enum: ProdApprovalStatus, nullable: true })
  prodApprovalStatus!: ProdApprovalStatus | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) requestedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) requestedById!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) warehouseCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) warehouseName!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) qlsxAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) qlsxById!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) decidedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) decidedById!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) rejectReason!: string | null;
  /**
   * Trạng thái phương án cắt MỚI NHẤT của SKU này - null nếu chưa từng tính (chưa duyệt).
   * Chỉ findAll/findOne (production-invoices.service.ts) mới nạp; các hàm ghi khác (approveItem,
   * sendItemToQlsx...) để undefined, KHÔNG bắt buộc set null tường minh - FE chỉ cần hiện "đang
   * tính" khi có giá trị CALCULATING, im lặng bỏ qua field còn lại là đúng ý.
   */
  @Expose()
  @ApiPropertyOptional({ enum: CuttingProposalStatus, nullable: true })
  cuttingProposalStatus?: CuttingProposalStatus | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) cuttingProposalRequestedAt?: Date | null;
  /**
   * ProductionOrder thật đã tạo cho SKU này - null nếu chưa duyệt HOẶC đã duyệt (APPROVED) nhưng
   * lệnh sản xuất tạo thất bại (race hiếm: BOM bị deactivate đúng khoảnh khắc giữa 2 lệnh, xem
   * ProductionInvoicesService.retryProductionOrder(), đính chính 2026-08-29). FE dùng để phát
   * hiện SKU "kẹt" (`prodApprovalStatus=APPROVED` mà `productionOrderId=null`) và hiện nút tạo lại
   * lệnh - không thể suy ra chỉ từ `prodApprovalStatus` vì cả 2 ca đều hiện "đã duyệt" như nhau.
   * Cùng idiom `cuttingProposalStatus` - chỉ findAll/findOne mới nạp, các hàm ghi khác để undefined.
   */
  @Expose() @ApiPropertyOptional({ nullable: true }) productionOrderId?: string | null;
  /** QLSX kiểm soát qua nút Bắt đầu/Kết thúc ở "Bảng thống kê" (2026-08-31) - null khi item chưa
   *  có ProductionOrder (chưa duyệt/kẹt). Cùng idiom `productionOrderId` - chỉ findAll/findOne
   *  mới nạp. */
  @Expose()
  @ApiPropertyOptional({ enum: ProductionOrderFloorStage, nullable: true })
  floorStage?: ProductionOrderFloorStage | null;
  @Expose() @ApiPropertyOptional({ type: [ItemStageDto] }) stages!: ItemStageDto[];

  constructor(partial: Partial<ProductionInvoiceItemResponseDto>) {
    Object.assign(this, partial);
  }
}
