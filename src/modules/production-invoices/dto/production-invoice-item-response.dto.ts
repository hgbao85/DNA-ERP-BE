import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import {
  CuttingProposalStatus,
  ProdApprovalStatus,
  ProdItemStageType,
} from '../../../generated/prisma/client';

class ItemStageDto {
  @Expose() @ApiProperty({ enum: ProdItemStageType }) stageType!: ProdItemStageType;
  @Expose() @ApiProperty() deadline!: Date;
}

@Exclude()
export class ProductionInvoiceItemResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionInvoiceId!: string;
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
  @Expose() @ApiPropertyOptional({ type: [ItemStageDto] }) stages!: ItemStageDto[];

  constructor(partial: Partial<ProductionInvoiceItemResponseDto>) {
    Object.assign(this, partial);
  }
}
