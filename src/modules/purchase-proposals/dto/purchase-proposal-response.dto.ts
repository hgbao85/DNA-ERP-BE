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
  /// Tồn thật (kho phoi-son-han) chụp lúc CuttingProposalsService.approve() tạo dòng này -
  /// FE dùng để hiển thị + suy ra required = actualStock + buyQty (xem purchasing-api.ts).
  @Expose() @ApiProperty() actualStock!: number;
  @Expose() @ApiProperty() buyQty!: number;
  @Expose() @ApiProperty() receivedQty!: number;
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
  @Expose() @ApiProperty() cuttingProposalId!: string;
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
