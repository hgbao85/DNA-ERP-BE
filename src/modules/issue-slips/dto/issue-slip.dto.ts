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

const MAX_FILES = 20;

export class IssueSlipLineDto {
  @ApiProperty({ enum: IssueSlipLineKind })
  @IsEnum(IssueSlipLineKind)
  kind!: IssueSlipLineKind;

  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiPropertyOptional({ description: 'STEEL: lệnh (PI)' })
  @IsOptional()
  @IsString()
  productionInvoiceId?: string;

  @ApiPropertyOptional({ description: 'CONSUMABLE: SKU (lệnh sản xuất)' })
  @IsOptional()
  @IsString()
  productionOrderId?: string;

  @ApiPropertyOptional({ enum: MfgStage, description: 'CONSUMABLE: HAN / SON' })
  @IsOptional()
  @IsEnum(MfgStage)
  stage?: MfgStage;

  @ApiPropertyOptional({ description: 'STEEL: chiều dài cây (mm)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  barLengthMm?: number;

  @ApiProperty({ description: 'STEEL: số cây (nguyên). Khác: số lượng theo đơn vị vật tư.' })
  @IsNumber()
  @IsPositive()
  qty!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
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
