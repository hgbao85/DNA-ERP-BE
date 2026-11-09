import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { BookingStatus } from '../../../generated/prisma/client';

/**
 * Phần A – Đợt 10a (YC5): response của module bookings. HỢP ĐỒNG với FE `src/types/booking.ts` - đổi 2 bên cùng lúc.
 *
 * Số liệu 1 dòng đơn (SalesOrderItem) - tính ở BookingsService, KHÔNG lưu:
 * - orderQty         = SalesOrderItem.totalQty (= ProductionInvoiceItem.quantity, đã ghim từ lúc sinh dòng lệnh).
 * - orderShippedQty  = "đã xuất" của dòng đơn = SalesOrderItem.shippedQty (nút "Xuất giao" cũ; 10b sẽ ghi qua booking). ĐỌC Ở 1
 *                      CHỖ DUY NHẤT trong service để người B đổi nguồn khi làm 10b.
 * - bookedOtherQty   = Σ phần CHƯA XUẤT (qty − shippedQty) của các dòng cùng dòng đơn ở booking KHÁC đang DRAFT/CONFIRMED.
 * - availableQty     = max(0, orderQty − orderShippedQty − bookedOtherQty) = số tối đa booking này được giữ cho dòng đó.
 * - packedQty        = Σ PackagingRecord.boxesPacked của dòng lệnh (đơn vị BỘ - V4-11).
 * - readyQty         = max(0, packedQty − orderShippedQty) - "đã đóng gói − đã xuất" (5.8).
 * - shortQty (dòng booking) = phần chưa xuất của dòng này không có hàng sẵn sau khi chia hàng sẵn (readyQty) cho các booking
 *                      DRAFT/CONFIRMED cùng dòng đơn theo "ngày hạn" = ngày SỚM HƠN giữa ngày lấy cont và ngày (giờ VN) của
 *                      CUT OFF (booking không có cả 2 ngày xếp cuối; cùng ngày thì id nhỏ trước). Chỉ 1 booking thì
 *                      = max(0, qty − shippedQty − readyQty).
 */

@Exclude()
export class BookingAttachmentDto {
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty() url!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) uploadedAt!: string | null;

  constructor(partial: Partial<BookingAttachmentDto>) {
    Object.assign(this, partial);
  }
}

/** Phần dùng chung của 1 dòng hàng (dòng booking và dòng ứng viên). */
@Exclude()
export class BookingItemInfoDto {
  @Expose() @ApiProperty() productionInvoiceItemId!: string;
  @Expose() @ApiProperty() salesOrderItemId!: string;
  @Expose() @ApiProperty() salesOrderId!: string;
  /** Mã PO của khách = SalesOrder.orderCode (5.2). */
  @Expose() @ApiProperty() orderCode!: string;
  @Expose() @ApiProperty() mfgProductId!: string;
  @Expose() @ApiProperty() factoryCode!: string;
  /** SalesOrderItem.skuName ?? MfgProduct.name. */
  @Expose() @ApiProperty() skuName!: string;
  /** Hạn giao của dòng đơn (SalesOrderItem.deliveryDate). */
  @Expose() @ApiPropertyOptional({ nullable: true }) deliveryDate!: Date | null;
  /** Mã lệnh của DÒNG: số LSX của dòng ?? mã PI ?? null (dòng chưa được KHSX gom lệnh) - cùng luật FE `lineCode`. */
  @Expose() @ApiPropertyOptional({ nullable: true }) lenhCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) productionInvoiceId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) piCode!: string | null;
  /** Kho thành phẩm QLSX chọn cho dòng (nơi đóng gói) - để Sales thấy hàng đang ở kho nào so với kho gom của booking (5.6). */
  @Expose() @ApiPropertyOptional({ nullable: true }) itemWarehouseCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) itemWarehouseName!: string | null;
  @Expose() @ApiProperty() orderQty!: number;
  @Expose() @ApiProperty() orderShippedQty!: number;
  @Expose() @ApiProperty() bookedOtherQty!: number;
  @Expose() @ApiProperty() availableQty!: number;
  @Expose() @ApiProperty() packedQty!: number;
  @Expose() @ApiProperty() readyQty!: number;
  /** Thể tích 1 thùng (m³, MfgProduct.boxVolumeM3 - Đợt 1). null = SKU chưa có kích thước thùng. */
  @Expose() @ApiPropertyOptional({ nullable: true }) boxVolumeM3!: number | null;
  @Expose() @ApiProperty() boxesPerSet!: number;
  /** Thể tích 1 bộ = boxVolumeM3 × boxesPerSet (4 số lẻ). null khi thiếu kích thước. */
  @Expose() @ApiPropertyOptional({ nullable: true }) setVolumeM3!: number | null;
  /** Load cont hiệu lực (MfgProduct.loadCont). */
  @Expose() @ApiPropertyOptional({ nullable: true }) loadCont!: number | null;
}

@Exclude()
export class BookingLineResponseDto extends BookingItemInfoDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() qty!: number;
  /** Số thực xuất (10b ghi). */
  @Expose() @ApiProperty() shippedQty!: number;
  /** qty × setVolumeM3 (3 số lẻ); null khi SKU thiếu kích thước. */
  @Expose() @ApiPropertyOptional({ nullable: true }) lineM3!: number | null;
  /** Số bộ còn thiếu hàng sẵn cho dòng này (xem đầu file). 0 = đủ. */
  @Expose() @ApiProperty() shortQty!: number;

  constructor(partial: Partial<BookingLineResponseDto>) {
    super();
    Object.assign(this, partial);
  }
}

/** Dòng ứng viên cho bảng chọn hàng (GET /bookings/candidates). */
@Exclude()
export class BookingCandidateDto extends BookingItemInfoDto {
  /** Số đang xếp trong booking `bookingId` của query (0 nếu không truyền / chưa có). */
  @Expose() @ApiProperty() currentQty!: number;
  @Expose()
  @ApiPropertyOptional({ nullable: true, enum: ['PLANNING', 'PRODUCING', 'DONE'] })
  piStatus!: string | null;

  constructor(partial: Partial<BookingCandidateDto>) {
    super();
    Object.assign(this, partial);
  }
}

@Exclude()
export class BookingTotalsDto {
  /** Σ qty các dòng. */
  @Expose() @ApiProperty() qty!: number;
  /** Σ lineM3 của dòng tính được (3 số lẻ). */
  @Expose() @ApiProperty() totalM3!: number;
  /** containerVolumeM3 (SystemConfig) × containerQty. */
  @Expose() @ApiProperty() capacityM3!: number;
  /** totalM3 ÷ capacityM3 × 100 (1 số lẻ); null khi capacity = 0. */
  @Expose() @ApiPropertyOptional({ nullable: true }) fillPct!: number | null;
  /** Mã SKU (factoryCode) chưa có kích thước thùng -> "chưa tính được m³ của SKU …". */
  @Expose() @ApiProperty({ type: [String] }) missingVolumeSkus!: string[];
  /** Σ shortQty các dòng. */
  @Expose() @ApiProperty() shortQty!: number;
  /** Số dòng có shortQty > 0. */
  @Expose() @ApiProperty() shortLines!: number;

  constructor(partial: Partial<BookingTotalsDto>) {
    Object.assign(this, partial);
  }
}

@Exclude()
export class BookingResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() bookingNo!: string;
  @Expose() @ApiProperty() customerId!: string;
  @Expose() @ApiProperty() customerName!: string;
  @Expose() @ApiProperty() containerType!: string;
  @Expose() @ApiProperty() containerQty!: number;
  @Expose() @ApiProperty() pod!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) cutSiAt!: Date | null;
  /** 'YYYY-MM-DD' */
  @Expose() @ApiPropertyOptional({ nullable: true }) pickupDate!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) cutOffAt!: Date | null;
  /** 'YYYY-MM-DD' */
  @Expose() @ApiPropertyOptional({ nullable: true }) etd!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) pickupPlace!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) vesselVoyage!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) warehouseCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) warehouseName!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose()
  @Type(() => BookingAttachmentDto)
  @ApiProperty({ type: [BookingAttachmentDto] })
  attachments!: BookingAttachmentDto[];
  @Expose() @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  /** Mã PO của khách (khác nhau) từ các dòng, giữ thứ tự dòng - cột "Tên PI" của bảng booking. */
  @Expose() @ApiProperty({ type: [String] }) orderCodes!: string[];
  /** Mã lệnh (khác nhau, khác null) từ các dòng. */
  @Expose() @ApiProperty({ type: [String] }) lenhCodes!: string[];
  @Expose() @ApiProperty() createdById!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) createdByName!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;
  @Expose() @ApiPropertyOptional({ nullable: true }) confirmedAt!: Date | null;
  /** Đợt 10b: kho thành phẩm xác nhận đã xuất. */
  @Expose() @ApiPropertyOptional({ nullable: true }) shippedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) shipSlipCode!: string | null;
  @Expose() @ApiProperty({ type: [String] }) shipSlipUrls!: string[];
  @Expose() @ApiPropertyOptional({ nullable: true }) cancelledAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) cancelReason!: string | null;
  @Expose()
  @Type(() => BookingTotalsDto)
  @ApiProperty({ type: BookingTotalsDto })
  totals!: BookingTotalsDto;
  @Expose()
  @Type(() => BookingLineResponseDto)
  @ApiProperty({ type: [BookingLineResponseDto] })
  lines!: BookingLineResponseDto[];

  constructor(partial: Partial<BookingResponseDto>) {
    Object.assign(this, partial);
  }
}

/** GET /bookings/meta - dữ liệu phụ cho form (Sales không có quyền WAREHOUSE:VIEW / SYSTEM_CONFIG:VIEW). */
@Exclude()
export class BookingMetaDto {
  /** Kho thành phẩm đang dùng (Warehouse họ 'thanh-pham', isActive, !isVirtual, chưa xoá), xếp theo code. */
  @Expose() @ApiProperty() finishedWarehouses!: { code: string; name: string }[];
  /** SystemConfig.containerVolumeM3 (mặc định 68). */
  @Expose() @ApiProperty() containerVolumeM3!: number;

  constructor(partial: Partial<BookingMetaDto>) {
    Object.assign(this, partial);
  }
}
