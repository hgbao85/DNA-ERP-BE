import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** 1 đoạn sắt cấu thành 1 mảnh (nhóm SAT) - resolve-or-create SegmentSpec theo (materialId, cutLengthMm). */
export class QuotaSegmentDto {
  @ApiProperty({ description: 'Material phải thuộc nhóm vật tư Sắt (systemKey=STEEL_BAR)' })
  @IsString()
  materialId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  cutLengthMm!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qtyPerPiece!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  needsHan?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  needsSon?: boolean;

  @ApiPropertyOptional({ description: 'Ghi chú riêng cho đoạn sắt này (vd "mạ kẽm")' })
  @IsOptional()
  @IsString()
  note?: string;
}

/** 1 mảnh (nhóm SAT) - resolve-or-create Piece theo tên trong phạm vi sản phẩm. */
export class QuotaPieceDto {
  @ApiProperty({ description: 'Tên mảnh - resolve-or-create Piece theo tên (case-insensitive)' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ description: 'Số lượng mảnh này trên 1 SKU' })
  @IsInt()
  @Min(1)
  qtyPerUnit!: number;

  @ApiProperty({ type: [QuotaSegmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotaSegmentDto)
  segments!: QuotaSegmentDto[];
}

/** 1 dòng vật tư phẳng (nhóm DAY/DINH/DAY_SON/VAT_TU_PHU_KIEN/BAO_BI_DONG_GOI) - materialId chọn thẳng từ catalog Material có sẵn. */
export class QuotaMaterialLineDto {
  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  qtyPerUnit!: number;
}

/**
 * Body của POST /:id/manh-quota/:group và /:id/detail-quota/:group. Đúng 1 trong 2 field
 * `pieces` (group=SAT, phân cấp mảnh->đoạn sắt) / `items` (mọi group phẳng còn lại) được gửi
 * theo route - service validate field nào bắt buộc theo group, không polymorphic ở tầng DTO.
 */
export class UpdateQuotaDto {
  @ApiPropertyOptional({ type: [QuotaPieceDto], description: 'Chỉ dùng cho group=SAT' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotaPieceDto)
  pieces?: QuotaPieceDto[];

  @ApiPropertyOptional({ type: [QuotaMaterialLineDto], description: 'Dùng cho mọi group trừ SAT' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotaMaterialLineDto)
  items?: QuotaMaterialLineDto[];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  enteredBy!: string;
}
