import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { OfficeSupplyLedgerReason } from '../../../generated/prisma/client';

@Exclude()
export class OfficeSupplyResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() warehouseId!: string;
  /** Denormalized từ Warehouse.code/name - cùng lý do MaterialResponseDto, để FE hiện tên/lọc
   *  theo kho mà không cần gọi riêng GET /warehouses theo id. */
  @Expose() @ApiProperty() warehouseCode!: string;
  @Expose() @ApiProperty() warehouseName!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) code!: string | null;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty() unit!: string;
  @Expose() @ApiProperty() quantity!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiProperty() isActive!: boolean;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;

  constructor(partial: Partial<OfficeSupplyResponseDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class OfficeSupplyLedgerEntryResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() officeSupplyId!: string;
  @Expose() @ApiProperty() changeQty!: number;
  @Expose() @ApiProperty() quantityAfter!: number;
  @Expose() @ApiProperty({ enum: OfficeSupplyLedgerReason }) reason!: OfficeSupplyLedgerReason;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) createdByUserId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) createdByUserName!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;

  constructor(partial: Partial<OfficeSupplyLedgerEntryResponseDto>) {
    Object.assign(this, partial);
  }
}
