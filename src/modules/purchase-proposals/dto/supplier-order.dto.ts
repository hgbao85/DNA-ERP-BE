import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Người mua gom các dòng chờ duyệt vào 1 đơn đặt hàng NCC (bản v8 mục 4.10) - hệ thống cấp số đơn. */
export class CreateSupplierOrderDto {
  @ApiProperty({ description: 'Nhà cung cấp (bắt buộc) - Supplier.id' })
  @IsString()
  @MinLength(1)
  supplierId!: string;

  @ApiProperty({ type: [String], description: 'PurchaseProposalItem.id các dòng đưa vào đơn' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  itemIds!: string[];
}

export class CancelSupplierOrderDto {
  @ApiProperty({ description: 'Lý do huỷ - số đơn vẫn giữ, không cấp lại' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

/** "Đóng phần thiếu" (Đợt 5e, bản v8 7.13) - các dòng của đơn đã duyệt mà NCC không giao nốt. */
export class CloseShortageDto {
  @ApiProperty({ type: [String], description: 'Dòng vật tư trong đơn cần đóng (đang chờ nhận)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  itemIds!: string[];

  @ApiProperty({ description: 'Lý do NCC không giao nốt' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/** THAY PHIẾU (bản v8 mục 7.11) - lý do bắt buộc, lưu trên đơn và audit. */
export class ReviseSupplierOrderDto {
  @ApiProperty({ description: 'Lý do thay phiếu (gỡ dòng nào, sửa số mua nào...)' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class ListSupplierOrdersQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'APPROVED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'APPROVED', 'CANCELLED'])
  status?: 'DRAFT' | 'APPROVED' | 'CANCELLED';
}

/** Admin nạp số đơn cuối cùng đã dùng của 1 NCC trong 1 năm (bản v8 mục 4.13). */
export class SetSupplierOrderCounterDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  year!: number;

  @ApiProperty({ description: 'Số đơn cuối cùng đã dùng - đơn tạo tiếp theo nhận số này + 1' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lastSeq!: number;
}

export class SupplierOrderItemDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() proposalId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiProperty() unit!: string;
  @Expose() @ApiProperty() buyQty!: number;
  @Expose() @ApiProperty() purchaseQty!: number;
  @Expose() @ApiProperty() status!: string;
  @Expose() @ApiProperty() receivedQty!: number;
  /// Mã lệnh sản xuất của dòng (mã PI; số LSX khi người A làm xong Đợt 2).
  @Expose() @ApiPropertyOptional({ nullable: true }) orderCode!: string | null;
  /// "Đóng phần thiếu" (7.13): số đặt − đã nhận lúc đóng, lý do, lúc đóng. null = chưa đóng.
  @Expose() @ApiPropertyOptional({ nullable: true }) shortClosedQty!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) shortCloseReason!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) shortClosedAt!: Date | null;

  constructor(partial: Partial<SupplierOrderItemDto>) {
    Object.assign(this, partial);
  }
}

export class SupplierOrderResponseDto {
  @Expose() @ApiProperty() id!: string;
  /// "52/2026"
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiProperty() year!: number;
  @Expose() @ApiProperty() seq!: number;
  @Expose() @ApiProperty() status!: string;
  @Expose() @ApiProperty() supplierId!: string;
  @Expose() @ApiProperty() supplierName!: string;
  @Expose() @ApiProperty() createdById!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) createdByName!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiPropertyOptional({ nullable: true }) approvalFileUrl!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) approvedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) cancelledAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) cancelReason!: string | null;
  /// Số lần THAY PHIẾU (0 = phiếu gốc).
  @Expose() @ApiProperty() revision!: number;
  @Expose() @ApiPropertyOptional({ nullable: true }) revisedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) reviseReason!: string | null;
  @Expose() @ApiProperty({ type: [SupplierOrderItemDto] }) items!: SupplierOrderItemDto[];

  constructor(partial: Partial<SupplierOrderResponseDto>) {
    Object.assign(this, partial);
  }
}

export class SupplierOrderCounterDto {
  @Expose() @ApiProperty() supplierId!: string;
  @Expose() @ApiProperty() supplierName!: string;
  @Expose() @ApiProperty() year!: number;
  /// Số đơn cuối cùng (đã nạp hoặc đã cấp) - đơn tiếp theo = lastSeq + 1.
  @Expose() @ApiProperty() lastSeq!: number;
  /// Số lớn nhất hệ thống đã thực sự cấp cho 1 đơn - không được nạp lastSeq thấp hơn số này.
  @Expose() @ApiProperty() maxIssuedSeq!: number;

  constructor(partial: Partial<SupplierOrderCounterDto>) {
    Object.assign(this, partial);
  }
}
