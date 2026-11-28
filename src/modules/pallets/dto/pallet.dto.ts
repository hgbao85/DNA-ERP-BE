import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  MinLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PalletStatus } from '../../../generated/prisma/client';
import { MAX_PALLETS_PER_CREATE } from '../pallet.util';

/** Danh sách pallet của kho Sơn. */
export class ListPalletsQueryDto {
  @ApiPropertyOptional({ description: 'Mã kho Sơn - chỉ khi tài khoản không gắn kho đang làm' })
  @IsOptional()
  @IsString()
  warehouseCode?: string;

  @ApiPropertyOptional({ enum: PalletStatus })
  @IsOptional()
  @IsEnum(PalletStatus)
  status?: PalletStatus;

  @ApiPropertyOptional({ description: 'Tìm theo mã pallet / mã lệnh / SKU / mảnh' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** Tạo pallet mới (cấp mã PL-NNN kế tiếp, tem QR riêng). */
export class CreatePalletsDto {
  @ApiProperty({ minimum: 1, maximum: MAX_PALLETS_PER_CREATE })
  @IsInt()
  @Min(1)
  @Max(MAX_PALLETS_PER_CREATE)
  count!: number;

  @ApiPropertyOptional({ description: 'Mã kho Sơn - chỉ khi tài khoản không gắn kho đang làm' })
  @IsOptional()
  @IsString()
  warehouseCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** Lệnh + mảnh xếp được lên pallet (không truyền lệnh: danh sách lệnh). */
export class PalletLoadOptionsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  warehouseCode?: string;

  @ApiPropertyOptional({ description: 'Lệnh sản xuất (PI)' })
  @IsOptional()
  @IsString()
  productionInvoiceId?: string;
}

/** Tra pallet theo mã tem (token trong link QR) hoặc mã in trên tem (PL-001). */
export class PalletLookupQueryDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  q!: string;
}

/** Xếp 1 pallet TRỐNG: 1 lệnh SX (SKU) + 1 mảnh + số mảnh. */
export class LoadPalletDto {
  @ApiProperty({ description: 'SKU (lệnh sản xuất)' })
  @IsString()
  productionOrderId!: string;

  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  qty!: number;
}

/** Sức chứa pallet của 1 mảnh (null = bỏ). Chỉ để cảnh báo. */
export class SetPieceCapacityDto {
  @ApiProperty()
  @IsString()
  pieceId!: string;

  @ApiPropertyOptional({ nullable: true, minimum: 1 })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100_000)
  capacity!: number | null;
}

/** Công nhân Sơn báo xong 1 pallet. Không gửi qty = đủ số trên pallet; qty nhỏ hơn = "Báo thiếu" (bắt buộc lý do). */
export class PaintPalletDto {
  @ApiPropertyOptional({ description: 'Số mảnh sơn xong - bỏ trống = đủ số trên pallet' })
  @IsOptional()
  @IsInt()
  @Min(1)
  qty?: number;

  @ApiPropertyOptional({ description: 'Lý do báo thiếu - bắt buộc khi qty < số trên pallet' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  shortReason?: string;
}

/** Câu 7a (25/11/2026): lý do thủ kho Sơn gỡ pallet đã sơn. */
export class ClearPaintedPalletDto {
  @ApiProperty()
  @IsString()
  @MinLength(3, { message: 'Ghi lý do gỡ pallet (ít nhất 3 ký tự)' })
  @MaxLength(500)
  reason!: string;
}
