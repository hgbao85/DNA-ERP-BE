import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** 4 nhóm vật tư "phẳng theo mảnh" (không có khái niệm cắt) có thể xuất hiện trong 1 mảnh,
 *  cạnh Sắt (segments). Tag tường minh trên từng dòng vì 1 mảnh giờ nhận vật tư từ nhiều
 *  nhóm cùng lúc trong 1 payload duy nhất - không còn suy nhóm từ route như DAY/DINH cũ. */
export const PIECE_MATERIAL_LINE_GROUPS = ['WIRE', 'NAIL', 'RIVET', 'PLASTIC_BUTTON'] as const;
export type PieceMaterialLineGroup = (typeof PIECE_MATERIAL_LINE_GROUPS)[number];

/** 7 công đoạn phôi chi tiết có thể áp dụng cho 1 đoạn sắt - đa chọn (vd 1 thanh vừa tán vừa
 *  dập), khớp enum ProcessStep trong schema.prisma. */
export const PROCESS_STEPS = ['CAT', 'UON', 'DAP', 'DUC_LO', 'TAN', 'TOP_DAU', 'XE'] as const;
export type ProcessStepValue = (typeof PROCESS_STEPS)[number];

/** 1 đoạn sắt cấu thành 1 mảnh (nhóm SAT) - resolve-or-create SegmentSpec theo (materialId, cutLengthMm). */
export class QuotaSegmentDto {
  @ApiProperty({ description: 'Material phải thuộc nhóm vật tư Sắt (systemKey=STEEL_BAR)' })
  @IsString()
  materialId!: string;

  /// Decimal(7,1) ở DB (2026-08-19) - dữ liệu thật có chiều dài lẻ 1 chữ số thập phân (vd
  /// 590.5mm), IsInt() cũ sẽ chặn nhầm giá trị hợp lệ.
  @ApiProperty({ description: 'vd 930 hoặc 590.5 (tối đa 1 chữ số thập phân)' })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  cutLengthMm!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qtyPerPiece!: number;

  @ApiPropertyOptional({ description: 'Ghi chú riêng cho đoạn sắt này (vd "mạ kẽm")' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    enum: PROCESS_STEPS,
    isArray: true,
    description: 'Công đoạn phôi chi tiết của đoạn sắt này (cắt/uốn/dập/đục lỗ/tán) - đa chọn',
  })
  @IsOptional()
  @IsArray()
  @IsIn(PROCESS_STEPS, { each: true })
  processSteps?: ProcessStepValue[];
}

/** 1 dòng vật tư Dây/Đinh/Tán rút/Nút nhựa cấu thành 1 mảnh - resolve-or-assign nhóm vật tư
 *  của material theo `group` (xem PieceMaterialItem, KHÔNG dùng PieceBom/SegmentSpec vì đó
 *  là khái niệm "đoạn cắt" chỉ đúng cho Sắt). */
export class QuotaPieceMaterialLineDto {
  @ApiProperty({ enum: PIECE_MATERIAL_LINE_GROUPS })
  @IsIn(PIECE_MATERIAL_LINE_GROUPS)
  group!: PieceMaterialLineGroup;

  @ApiProperty({ description: 'Material phải thuộc đúng nhóm vật tư khai báo ở `group`' })
  @IsString()
  materialId!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  qtyPerPiece!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

/** 1 mảnh (nhóm SAT) - resolve-or-create Piece theo tên trong phạm vi sản phẩm. Chứa cả 5
 *  nhóm vật tư: Sắt (`segments`, phân cấp đoạn cắt) và Dây/Đinh/Tán rút/Nút nhựa
 *  (`materialLines`, phẳng theo mảnh, không có khái niệm cắt). */
export class QuotaPieceDto {
  @ApiProperty({ description: 'Tên mảnh - resolve-or-create Piece theo tên (case-insensitive)' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ description: 'Số lượng mảnh này trên 1 SKU' })
  @IsInt()
  @Min(1)
  qtyPerUnit!: number;

  @ApiPropertyOptional({ default: true, description: 'Mảnh này có cần routing sang Hàn' })
  @IsOptional()
  @IsBoolean()
  needsHan?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Mảnh này có cần routing sang Sơn' })
  @IsOptional()
  @IsBoolean()
  needsSon?: boolean;

  @ApiProperty({ type: [QuotaSegmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotaSegmentDto)
  segments!: QuotaSegmentDto[];

  @ApiPropertyOptional({
    type: [QuotaPieceMaterialLineDto],
    description: 'Dây/Đinh/Tán rút/Nút nhựa của mảnh này',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotaPieceMaterialLineDto)
  materialLines?: QuotaPieceMaterialLineDto[];
}

/** 1 dòng vật tư phẳng - materialId chọn thẳng từ catalog Material có sẵn. Vẫn dùng làm shape
 *  tham số nội bộ của replaceConsumableLines/replaceAccessoryItems (xem skus.service.ts). */
export class QuotaMaterialLineDto {
  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  qtyPerUnit!: number;
}

/** 3 nhóm định mức chi tiết - Sơn/Phụ kiện/Bao bì đều nhập/duyệt chung 1 lần (1 account, 1
 *  trang, 1 quyết định duyệt) dù lưu ở 2 bảng khác nhau (ConsumableBom cho Sơn, BomAccessoryItem
 *  cho Phụ kiện/Bao bì) - tag `group` tường minh trên từng dòng để service biết ghi vào bảng nào. */
export const DETAIL_LINE_GROUPS = ['DAY_SON', 'VAT_TU_PHU_KIEN', 'BAO_BI_DONG_GOI'] as const;
export type DetailLineGroup = (typeof DETAIL_LINE_GROUPS)[number];

export class QuotaDetailLineDto {
  @ApiProperty({ enum: DETAIL_LINE_GROUPS })
  @IsIn(DETAIL_LINE_GROUPS)
  group!: DetailLineGroup;

  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  qtyPerUnit!: number;
}

/**
 * Body của POST /:id/manh-quota (luôn dùng `pieces` - mảnh giờ chứa cả 5 nhóm vật tư) và
 * /:id/detail-quota (luôn dùng `detailLines` - chi tiết giờ chứa cả 3 nhóm Sơn/Phụ kiện/Bao bì) -
 * service validate field nào bắt buộc theo endpoint, không polymorphic ở tầng DTO.
 */
export class UpdateQuotaDto {
  @ApiPropertyOptional({ type: [QuotaPieceDto], description: 'Dùng cho manh-quota' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotaPieceDto)
  pieces?: QuotaPieceDto[];

  @ApiPropertyOptional({
    type: [QuotaDetailLineDto],
    description: 'Dùng cho detail-quota (Sơn/Phụ kiện/Bao bì)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotaDetailLineDto)
  detailLines?: QuotaDetailLineDto[];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  enteredBy!: string;
}
