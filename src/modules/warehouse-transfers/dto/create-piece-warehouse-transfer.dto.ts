import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CreateWarehouseTransferPieceItemDto } from './create-warehouse-transfer-piece-item.dto';

/** Tách riêng khỏi CreateWarehouseTransferDto (vật tư tiêu hao) - quyết định "không gộp" mục 7.5
 *  docs/review-2026-08-17-sanxuat-stage-v16-va-chuyen-kho-manh.md. */
export class CreatePieceWarehouseTransferDto {
  @ApiProperty()
  @IsString()
  fromWarehouseId!: string;

  @ApiProperty()
  @IsString()
  toWarehouseId!: string;

  @ApiPropertyOptional({ description: 'Chuẩn hoá từ pi_code hiện tại - trỏ tới SKU (PlanForm)' })
  @IsOptional()
  @IsString()
  planFormId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ type: [CreateWarehouseTransferPieceItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateWarehouseTransferPieceItemDto)
  pieceItems!: CreateWarehouseTransferPieceItemDto[];
}
