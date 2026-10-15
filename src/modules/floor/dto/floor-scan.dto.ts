import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ScanSegmentDto {
  @ApiProperty()
  @IsString()
  segmentSpecId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}

/**
 * 1 lần báo qua mã QR tại máy (2026-10-13). Máy quyết định báo gì:
 * - CUT/STEP (Phôi): `materialId` + `segments` (số ĐOẠN theo cỡ - Sếp chọn Phôi nhập số đoạn).
 * - PIECE (Hàn/Sơn): `pieceId` + `qty` (số MẢNH).
 * `productionInvoiceId` phải là PI đang chạy của tổ, hoặc PI cũ của tổ còn SKU đang chạy (mục "Bù lỗi").
 */
export class ScanReportDto {
  @ApiProperty()
  @IsString()
  productionInvoiceId!: string;

  @ApiProperty({ description: 'SKU (lệnh sản xuất) trong PI' })
  @IsString()
  productionOrderId!: string;

  @ApiPropertyOptional({ description: 'CUT/STEP - loại sắt' })
  @IsOptional()
  @IsString()
  materialId?: string;

  @ApiPropertyOptional({ type: [ScanSegmentDto], description: 'CUT/STEP - số đoạn theo cỡ' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ScanSegmentDto)
  segments?: ScanSegmentDto[];

  @ApiPropertyOptional({ description: 'PIECE - mảnh' })
  @IsOptional()
  @IsString()
  pieceId?: string;

  @ApiPropertyOptional({ description: 'PIECE - số mảnh' })
  @IsOptional()
  @IsInt()
  @Min(1)
  qty?: number;
}

export class ScanReceiveSteelDto {
  @ApiPropertyOptional({ description: 'Số cây đếm được - bỏ trống = đủ số kho xuất' })
  @IsOptional()
  @IsInt()
  @Min(0)
  receivedBarCount?: number;
}

export class ReverseFloorReportDto {
  @ApiProperty({ description: 'Lý do đảo - bắt buộc, công nhân xem được' })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class MyOutputQueryDto {
  @ApiPropertyOptional({ description: 'ISO date, mặc định 7 ngày trước' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date, mặc định bây giờ' })
  @IsOptional()
  @IsString()
  to?: string;
}
