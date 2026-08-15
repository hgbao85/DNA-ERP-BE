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
  @Expose() @ApiProperty() receivedQty!: number;
  /// Cộng dồn số lượng thực nhận theo purchaseUnit - chỉ để đối chiếu/audit, xem
  /// PurchaseProposalItem.receivedQtyPurchaseUnit.
  @Expose() @ApiPropertyOptional({ nullable: true }) receivedQtyPurchaseUnit!: number | null;
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
  @Expose() @ApiProperty({ enum: PurchaseProposalStatus }) status!: PurchaseProposalStatus;
  /// PO nội bộ (ProductionOrder.poNumber, vd "PO-9") - KHÁC mã đơn hàng khách, vì đường đi rút
  /// gọn (CuttingProposal -> ProductionOrder) không đi qua Sku/ExportOrder.
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiProperty() mfgProductCode!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) mfgProductName!: string | null;
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
