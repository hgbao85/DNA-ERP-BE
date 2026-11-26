import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ID = /^[1-9]\d*$/;
const ID_MESSAGE = 'Mã phải là số nguyên dương';
const URL_OPTS = { protocols: ['https', 'http'], require_protocol: true };

/** Kho Thành phẩm đang xem - thủ kho gắn kho bỏ qua (dùng kho của mình); tổng kho / Admin chọn kho. */
export class ViTriKhoWarehouseQueryDto {
  @ApiPropertyOptional({ description: 'Mã kho Thành phẩm (Warehouse.code)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  warehouseCode?: string;
}

/** V1: khai 1 ô. Mã ô = khu-dãy-ô (dãy, ô 2 chữ số). */
export class CreateLocationDto extends ViTriKhoWarehouseQueryDto {
  @ApiProperty({ example: 'A' })
  @IsString()
  @MaxLength(4)
  zone!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(99)
  aisle!: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Max(99)
  slot!: number;
}

/** V1: khai hàng loạt - khu A, dãy 01-03, ô 01-10. Ô đã có thì bỏ qua. */
export class BulkCreateLocationsDto extends ViTriKhoWarehouseQueryDto {
  @ApiProperty({ example: 'A' })
  @IsString()
  @MaxLength(4)
  zone!: string;

  @ApiProperty() @IsInt() @Min(1) @Max(99) aisleFrom!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(99) aisleTo!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(99) slotFrom!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(99) slotTo!: number;
}

export class SetLocationActiveDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

/** Màn công nhân đóng gói quét ô: kèm tem khu đóng gói (cùng kho) + lệnh đang chọn để nhắc trộn hàng. */
export class FloorLocationScanQueryDto {
  @ApiPropertyOptional({ description: 'qrToken tem khu đóng gói đang báo' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  ws?: string;

  @ApiPropertyOptional({ description: 'Id dòng SKU đang báo' })
  @IsOptional()
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  itemId?: string;
}

/** V4: chuyển ô - quét ô đi rồi ô đến. Header Idempotency-Key bắt buộc. */
export class MoveStockDto {
  @ApiProperty({ description: 'qrToken tem ô lấy ra' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fromToken!: string;

  @ApiProperty({ description: 'qrToken tem ô cất vào' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  toToken!: string;

  @ApiProperty({ description: 'Id dòng SKU (bộ 3 SKU - LSX - PO)' })
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  itemId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Thủ kho cất hàng đã đóng gói nhưng chưa có ô (đóng trước khi bật / nhập tay). Header Idempotency-Key bắt buộc. */
export class PutawayDto {
  @ApiProperty({ description: 'qrToken tem ô cất vào' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  locationToken!: string;

  @ApiProperty({ description: 'Id dòng SKU (bộ 3 SKU - LSX - PO)' })
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  itemId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty!: number;
}

export class ListMovementsQueryDto extends ViTriKhoWarehouseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  itemId?: string;
}

// ─── Booking: soạn hàng + cont ─────────────────────────────────────────────────────────────

export class CreateContainerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) containerNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) sealNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** Sửa cont đang load (OPEN): số cont, seal, ảnh (thay cả danh sách), ghi chú. */
export class UpdateContainerDto extends CreateContainerDto {
  @ApiPropertyOptional({ type: [String], description: 'Ảnh load cont (POST /uploads/image)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl(URL_OPTS, { each: true })
  photoUrls?: string[];
}

/** V6: lấy hàng ở ô (quét tem) cho 1 dòng booking vào 1 cont đang load. Header Idempotency-Key bắt buộc. */
export class PickDto {
  @ApiProperty() @IsString() @Matches(ID, { message: ID_MESSAGE }) containerId!: string;
  @ApiProperty() @IsString() @Matches(ID, { message: ID_MESSAGE }) bookingLineId!: string;

  @ApiProperty({ description: 'qrToken tem ô vừa quét' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  locationToken!: string;

  @ApiPropertyOptional({
    description: 'Ô của dòng danh sách lấy hàng đang làm - quét ô khác thì báo sai vị trí',
  })
  @IsOptional()
  @IsString()
  @Matches(ID, { message: ID_MESSAGE })
  expectedLocationId?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty!: number;
}

/** Trả hàng từ cont (chưa đóng) về 1 ô (quét tem). Header Idempotency-Key bắt buộc. */
export class UnpickDto {
  @ApiProperty() @IsString() @Matches(ID, { message: ID_MESSAGE }) bookingLineId!: string;

  @ApiProperty({ description: 'qrToken tem ô cất lại' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  locationToken!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty!: number;
}
