import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ProdApprovalStatus, ProdItemStageType } from '../../../generated/prisma/client';

class ItemStageDto {
  @Expose() @ApiProperty({ enum: ProdItemStageType }) stageType!: ProdItemStageType;
  @Expose() @ApiProperty() deadline!: Date;
}

@Exclude()
export class ProductionInvoiceItemResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() productionInvoiceId!: string;
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
  @Expose() @ApiPropertyOptional({ type: [ItemStageDto] }) stages!: ItemStageDto[];

  constructor(partial: Partial<ProductionInvoiceItemResponseDto>) {
    Object.assign(this, partial);
  }
}
