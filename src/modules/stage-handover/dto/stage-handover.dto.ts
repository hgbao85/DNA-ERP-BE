import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MfgStage } from '../../../generated/prisma/client';

/** Loại kế hoạch giao: SEGMENT = kho Phôi giao đoạn (Hàn / Sơn), FRAME = kho Hàn giao mảnh đã hàn cho Sơn. */
export const HandoverKind = { SEGMENT: 'SEGMENT', FRAME: 'FRAME' } as const;
export type HandoverKind = (typeof HandoverKind)[keyof typeof HandoverKind];

/** Kế hoạch giao của thủ kho (kho đang làm): SEGMENT = kho Phôi giao đoạn, FRAME = kho Hàn giao mảnh cho Sơn. */
export class StageHandoverPlanQueryDto {
  @ApiProperty({ enum: HandoverKind })
  @IsEnum(HandoverKind)
  kind!: HandoverKind;

  @ApiPropertyOptional({ description: 'Có: chi tiết 1 lệnh. Không: danh sách lệnh có hàng ở kho' })
  @IsOptional()
  @IsString()
  productionInvoiceId?: string;

  @ApiPropertyOptional({
    description: 'Chỉ cho tài khoản không gắn kho đang làm (tổng kho / Admin)',
  })
  @IsOptional()
  @IsString()
  warehouseCode?: string;
}

export class StageHandoverBoardQueryDto {
  @ApiPropertyOptional({ description: 'Có: chi tiết 1 lệnh. Không: tóm tắt các lệnh đang chạy' })
  @IsOptional()
  @IsString()
  productionInvoiceId?: string;
}

export class ListStageHandoverOverridesQueryDto {
  @ApiProperty()
  @IsString()
  productionInvoiceId!: string;
}

/** QLSX mở chặn có lý do (3.3b). HAN / SON: theo SKU + mảnh, qty = số mảnh. PHOI: theo loại sắt, qty = số mm. */
export class CreateStageHandoverOverrideDto {
  @ApiProperty()
  @IsString()
  productionInvoiceId!: string;

  @ApiProperty({ enum: MfgStage })
  @IsEnum(MfgStage)
  stage!: MfgStage;

  @ApiPropertyOptional({ description: 'HAN / SON: SKU (lệnh sản xuất)' })
  @IsOptional()
  @IsString()
  productionOrderId?: string;

  @ApiPropertyOptional({ description: 'HAN / SON: mảnh' })
  @IsOptional()
  @IsString()
  pieceId?: string;

  @ApiPropertyOptional({ description: 'PHOI: loại sắt' })
  @IsOptional()
  @IsString()
  materialId?: string;

  @ApiProperty({ description: 'HAN / SON: số mảnh (nguyên). PHOI: số mm đoạn được báo thêm.' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  qty!: number;

  @ApiProperty({ description: 'Lý do (bắt buộc) - ghi nhật ký, báo Sếp + QLSX' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
