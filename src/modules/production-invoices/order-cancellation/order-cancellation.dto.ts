import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CancelledGoodsKind,
  ProductionOrderCancelStatus,
  ProductionOrderCutDecision,
} from '../../../generated/prisma/client';

/** KHSX đề nghị huỷ 1 SKU (1 lệnh sản xuất) - huỷ lệnh theo SKU đợt 1 (23/11/2026). */
export class CreateOrderCancelRequestDto {
  @ApiProperty({ description: 'Id lệnh sản xuất (ProductionOrder) của SKU cần huỷ' })
  @IsString()
  @Matches(/^\d+$/)
  productionOrderId!: string;

  @ApiProperty()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class DecideOrderCancelRequestDto {
  @ApiProperty({ description: 'true = duyệt huỷ, false = từ chối (bắt buộc ghi note)' })
  @IsBoolean()
  approve!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** 1 dòng cây nhập trả: loại sắt + chiều dài (cây nguyên = dài cây xuất; cây lẻ = phần còn lại) + số cây. */
export class SteelReturnLineDto {
  @ApiProperty()
  @IsString()
  @Matches(/^\d+$/)
  materialId!: string;

  @ApiProperty({ description: 'Chiều dài cây trả (mm)' })
  @IsInt()
  @Min(1)
  @Max(20000)
  lengthMm!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(10000)
  bars!: number;
}

/** Huỷ lệnh đợt 2 - Q3 (anh Nhân 24/11/2026): QLSX quyết sắt đã xuất chưa cắt của SKU đã huỷ. */
export class DecideCutDto {
  @ApiProperty({ enum: ProductionOrderCutDecision })
  @IsEnum(ProductionOrderCutDecision)
  decision!: ProductionOrderCutDecision;

  @ApiPropertyOptional({
    type: [SteelReturnLineDto],
    description: 'Chỉ khi STOP: cây nhập trả kho Phôi',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SteelReturnLineDto)
  returns?: SteelReturnLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Huỷ lệnh đợt 2 - Q5/Q6: KHSX chuyển hàng của SKU đã huỷ sang 1 dòng SKU đang chạy. */
export class TransferCancelledGoodsDto {
  @ApiProperty({ enum: CancelledGoodsKind })
  @IsEnum(CancelledGoodsKind)
  kind!: CancelledGoodsKind;

  @ApiProperty({ description: 'Dòng SKU (ProductionInvoiceItem) nhận hàng' })
  @IsString()
  @Matches(/^\d+$/)
  targetItemId!: string;

  @ApiPropertyOptional({ description: 'Chỉ WOVEN: mảnh khung đan' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  pieceId?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(100000)
  qty!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListOrderCancelRequestsQueryDto {
  @ApiPropertyOptional({ enum: ProductionOrderCancelStatus })
  @IsOptional()
  @IsEnum(ProductionOrderCancelStatus)
  status?: ProductionOrderCancelStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d+$/)
  productionInvoiceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d+$/)
  productionOrderId?: string;
}
