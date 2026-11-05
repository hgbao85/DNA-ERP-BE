import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Phần A – Đợt 10a (YC5): HỢP ĐỒNG với FE `src/types/booking.ts` - đổi 2 bên cùng lúc.
 * Ngày chỉ-ngày (`pickupDate`, `etd`) gửi dạng 'YYYY-MM-DD'; ngày giờ (`cutSiAt`, `cutOffAt`) gửi ISO 8601 (FE đổi giờ VN -> ISO).
 * PATCH: bỏ field = giữ nguyên, `null` = xoá (field tuỳ chọn).
 */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 1 dòng hàng xếp vào booking: lấy từ 1 lệnh SX của 1 SKU (dòng ProductionInvoiceItem). */
export class BookingLineInputDto {
  @ApiProperty({
    description:
      'id dòng lệnh SX (ProductionInvoiceItem) - phải thuộc đơn hàng của đúng khách của booking',
  })
  @IsString()
  productionInvoiceItemId!: string;

  @ApiProperty({ description: 'Số bộ xếp (≥ 1, ≤ còn được xếp)' })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty!: number;
}

/** File/ảnh booking của hãng tàu - url lấy từ POST /uploads/document. */
export class BookingAttachmentInputDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiProperty()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  url!: string;
}

export class CreateBookingDto {
  @ApiProperty({ description: 'Số booking của hãng tàu - không trùng với booking chưa huỷ' })
  @IsString()
  @MinLength(1, { message: 'Số booking không được để trống' })
  @MaxLength(60)
  bookingNo!: string;

  @ApiProperty()
  @IsString()
  customerId!: string;

  @ApiPropertyOptional({ default: '40HC' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  containerType?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  containerQty?: number;

  @ApiProperty({ description: 'Cảng đến (POD)' })
  @IsString()
  @MinLength(1, { message: 'POD (cảng đến) không được để trống' })
  @MaxLength(60)
  pod!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Cắt SI - ISO 8601' })
  @IsOptional()
  @IsDateString()
  cutSiAt?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Ngày lấy cont - YYYY-MM-DD' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'Ngày lấy cont phải dạng YYYY-MM-DD' })
  pickupDate?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'CUT OFF - ISO 8601' })
  @IsOptional()
  @IsDateString()
  cutOffAt?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'ETD - YYYY-MM-DD' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'ETD phải dạng YYYY-MM-DD' })
  etd?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  pickupPlace?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  vesselVoyage?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Kho thành phẩm gom hàng (Warehouse.code họ thanh-pham)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  warehouseCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @ApiPropertyOptional({ type: [BookingAttachmentInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BookingAttachmentInputDto)
  attachments?: BookingAttachmentInputDto[];

  @ApiPropertyOptional({
    type: [BookingLineInputDto],
    description: 'Hàng xếp (có thể rỗng khi mới tạo)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BookingLineInputDto)
  lines?: BookingLineInputDto[];
}
