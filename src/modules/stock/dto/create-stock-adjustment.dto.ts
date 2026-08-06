import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

/** POST /stock-ledger/adjust - ngoại lệ duy nhất được ghi stock_ledger trực tiếp qua HTTP. */
export class CreateStockAdjustmentDto {
  @ApiProperty()
  @IsString()
  fromWarehouseId!: string;

  @ApiProperty()
  @IsString()
  toWarehouseId!: string;

  @ApiPropertyOptional({ description: 'Đúng 1 trong 4 chân hàng bên dưới phải có giá trị' })
  @IsOptional()
  @IsString()
  materialId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  segmentSpecId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pieceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productVariantId?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  qty!: number;

  @ApiPropertyOptional({ description: 'Lý do điều chỉnh - nên ghi rõ để tra soát sau này' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  note?: string;
}
