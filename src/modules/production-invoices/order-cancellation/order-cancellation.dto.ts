import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ProductionOrderCancelStatus } from '../../../generated/prisma/client';

/** KHSX đề nghị huỷ 1 SKU (1 lệnh sản xuất) - huỷ lệnh theo SKU đợt 1 (23/11/2026). */
export class CreateOrderCancelRequestDto {
  @ApiProperty({ description: 'Id lệnh sản xuất (ProductionOrder) của SKU cần huỷ' })
  @IsString()
  @Matches(/^\d+$/)
  productionOrderId!: string;

  @ApiProperty()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
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
