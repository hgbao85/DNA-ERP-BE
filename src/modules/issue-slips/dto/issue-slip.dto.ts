import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IssueSlipLineKind, IssueSlipStatus, MfgStage } from '../../../generated/prisma/client';
import { IsSystemUploadUrl } from '../../../common/validators/system-upload-url.validator';

const MAX_FILES = 20;

export class IssueSlipLineDto {
  @ApiProperty({ enum: IssueSlipLineKind })
  @IsEnum(IssueSlipLineKind)
  kind!: IssueSlipLineKind;

  @ApiPropertyOptional({ description: 'Bắt buộc, trừ dòng mảnh xuất đan (WEAVING_PIECE)' })
  @IsOptional()
  @IsString()
  materialId?: string;

  @ApiPropertyOptional({
    description: 'MATERIAL_YIELD_RECIPE: công thức (cùng productionInvoiceId)',
  })
  @IsOptional()
  @IsString()
  recipeId?: string;

  @ApiPropertyOptional({ description: 'WEAVING_PIECE / WEAVING_MATERIAL / FRAME_HANDOVER: mảnh' })
  @IsOptional()
  @IsString()
  pieceId?: string;

  @ApiPropertyOptional({
    description: 'SEGMENT_HANDOVER: cỡ đoạn (mã đoạn = cỡ đoạn + bộ công đoạn)',
  })
  @IsOptional()
  @IsString()
  segmentSpecId?: string;

  @ApiPropertyOptional({
    description: "SEGMENT_HANDOVER: bộ công đoạn đã chuẩn hoá ('' = trơn, vd 'UON,DAP')",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  segmentSteps?: string;

  @ApiPropertyOptional({ description: 'STEEL / SEGMENT_HANDOVER: lệnh (PI)' })
  @IsOptional()
  @IsString()
  productionInvoiceId?: string;

  @ApiPropertyOptional({
    description: 'CONSUMABLE / WEAVING_* / FRAME_HANDOVER: SKU (lệnh sản xuất)',
  })
  @IsOptional()
  @IsString()
  productionOrderId?: string;

  @ApiPropertyOptional({
    enum: MfgStage,
    description: 'CONSUMABLE: HAN / SON. SEGMENT_HANDOVER: tổ nhận HAN / SON',
  })
  @IsOptional()
  @IsEnum(MfgStage)
  stage?: MfgStage;

  @ApiPropertyOptional({ description: 'STEEL: chiều dài cây (mm)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  barLengthMm?: number;

  // XK10 (rà soát 14/11): tối đa 4 số lẻ - cột Decimal(·,4); trước đây 0,00004 lưu thành 0 (phiếu không xác nhận được),
  // 2,00005 kiểm theo số gửi nhưng lưu 2,0001.
  @ApiProperty({
    description: 'STEEL: số cây (nguyên). Khác: số lượng theo đơn vị vật tư (tối đa 4 số lẻ).',
  })
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'Số lượng tối đa 4 chữ số thập phân' })
  @IsPositive()
  qty!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'WEAVING_PIECE (pallet Sơn, 24/11/2026): pallet Sơn xong quét vào dòng - cùng SKU + mảnh; qty ≤ tổng số đã sơn của các pallet',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  palletIds?: string[];
}

/** Tạo phiếu xuất XK (bước 1): cấp số, chưa trừ tồn. */
export class CreateIssueSlipDto {
  @ApiProperty({ type: [IssueSlipLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => IssueSlipLineDto)
  lines!: IssueSlipLineDto[];

  @ApiPropertyOptional({ description: 'Người nhận (tên ghi trên phiếu)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ description: 'Phiếu mảnh xuất đan (WEAVING_PIECE): điểm đan nhận' })
  @IsOptional()
  @IsString()
  weavingPointId?: string;

  @ApiPropertyOptional({
    description: 'Phiếu vật tư kèm đan (WEAVING_MATERIAL): phiếu mảnh cùng chuyến',
  })
  @IsOptional()
  @IsString()
  pairedSlipId?: string;
}

/** "Xác nhận xuất" (bước 2): ảnh phiếu đã ký bắt buộc (khoá cứng, V4-1). */
export class ConfirmIssueSlipDto {
  @ApiProperty({
    type: [String],
    description: 'Ảnh phiếu xuất đã có chữ ký người nhận (ít nhất 1)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FILES)
  @IsString({ each: true })
  @IsSystemUploadUrl({ each: true })
  signedSlipUrls!: string[];
}

export class CancelIssueSlipDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ListIssueSlipsQueryDto {
  @ApiPropertyOptional({ enum: IssueSlipStatus })
  @IsOptional()
  @IsEnum(IssueSlipStatus)
  status?: IssueSlipStatus;

  @ApiPropertyOptional({ description: 'Lọc phiếu có dòng thuộc lệnh (PI) này' })
  @IsOptional()
  @IsString()
  productionInvoiceId?: string;
}
