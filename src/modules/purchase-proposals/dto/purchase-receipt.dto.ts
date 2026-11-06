import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  IsDateString,
} from 'class-validator';

const MAX_FILES = 20;

/** Xem trước cách hệ thống tự chia 1 lần hàng về cho các lệnh (YC8) - chưa ghi gì. */
export class PreviewPurchaseReceiptDto {
  @ApiProperty({
    type: [String],
    description: 'PurchaseProposalItem.id - các dòng của cùng 1 vật tư trong 1 đơn đặt hàng',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  itemIds!: string[];

  @ApiProperty({ description: 'Tổng số thực nhận theo đơn vị kho (Ô1 × Ô2)' })
  @IsNumber()
  @Min(0.0001)
  qty!: number;
}

export class ReceiptAllocationDto {
  @ApiProperty() @IsString() itemId!: string;
  @ApiProperty() @IsNumber() @Min(0) qty!: number;
}

/** Nhận 1 lần hàng về (Đợt 5d - bản v8 YC8, YC4 4.3-4.6). Chứng từ bắt buộc ngay lúc nhập. */
export class CreatePurchaseReceiptDto {
  @ApiProperty({
    description:
      'Số phiếu nhập NK-yymmdd-NNN đã giữ lúc in phiếu (POST /purchase-receipts/slip-code) - Đợt 6, bản v8 4.8',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(40)
  slipCode!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  itemIds!: string[];

  @ApiProperty({
    description:
      'Ô1 - số lượng thực nhận (không quy đổi) hoặc tỷ lệ quy đổi của lô (vd 130 cái/kg)',
  })
  @IsNumber()
  @Min(0.0001)
  unitRateQty!: number;

  @ApiPropertyOptional({
    description: 'Ô2 - số lượng theo đơn vị bên bán (vd 50 kg); bỏ trống = 1',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  supplierUnitQty?: number;

  @ApiProperty({
    description:
      'SL theo phiếu giao của NCC - cùng đơn vị với ô đối chiếu (Ô2 khi có quy đổi, không thì Ô1). Phải bằng số thực nhận (4.5, không dung sai).',
  })
  @IsNumber()
  @Min(0.0001)
  deliveredQty!: number;

  @ApiProperty({ type: [String], description: '(1) Ảnh phiếu xuất kho/giao hàng của NCC' })
  @IsArray()
  @ArrayMaxSize(MAX_FILES)
  @IsString({ each: true })
  supplierSlipUrls!: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      '(2) Phiếu đề xuất Giám đốc ký - CHỈ cần khi đơn đặt hàng chưa có file ký (hệ thống tự lấy từ đơn)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILES)
  @IsString({ each: true })
  approvalFileUrls?: string[];

  @ApiProperty({ type: [String], description: '(3) Ảnh phiếu nhập kho của nhà máy' })
  @IsArray()
  @ArrayMaxSize(MAX_FILES)
  @IsString({ each: true })
  receiptSlipUrls!: string[];

  @ApiPropertyOptional({ type: [String], description: '(4) Ảnh phiếu cân xe - bắt buộc với sắt' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILES)
  @IsString({ each: true })
  weighSlipUrls?: string[];

  @ApiPropertyOptional({
    type: [ReceiptAllocationDto],
    description:
      'Phân bổ thủ kho đã chỉnh (8.2). Bỏ trống = theo hệ thống tự chia. Tổng phải bằng số thực nhận.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiptAllocationDto)
  allocation?: ReceiptAllocationDto[];

  @ApiPropertyOptional({
    description:
      'Lý do nhận vượt (4.12) - BẮT BUỘC khi số thực nhận vượt tổng số còn lại của đơn (số đặt − đã nhận).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  overReason?: string;

  @ApiPropertyOptional({ type: [String], description: 'Ảnh bằng chứng nhận vượt (không bắt buộc)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILES)
  @IsString({ each: true })
  overFileUrls?: string[];
}

/** "Từ chối nhận" (4.5): hàng lệch phiếu giao / không đạt - không cộng tồn, báo người mua phụ trách. */
export class RejectPurchaseReceiptDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  itemIds!: string[];

  @ApiProperty({ description: 'SL theo phiếu giao của NCC' })
  @IsNumber()
  @Min(0)
  deliveredQty!: number;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({ type: [String], description: 'Ảnh bằng chứng (ít nhất 1)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FILES)
  @IsString({ each: true })
  fileUrls!: string[];
}

/** Thống kê nhận vượt (4.12) - lọc theo ngày nhận (giờ VN, YYYY-MM-DD, cả 2 đầu). */
export class OverReceiptStatsQueryDto {
  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
