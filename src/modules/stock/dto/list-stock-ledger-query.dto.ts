import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { StockLedgerRefType } from '../../../generated/prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListStockLedgerQueryDto extends PaginationQueryDto {
  /** Khớp cả fromWarehouseId lẫn toWarehouseId - "mọi bút toán chạm tới kho này". */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({ enum: StockLedgerRefType })
  @IsOptional()
  @IsEnum(StockLedgerRefType)
  refType?: StockLedgerRefType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  materialId?: string;

  @ApiPropertyOptional({ description: 'Cỡ cây sắt (mm) - chỉ có ý nghĩa kèm materialId' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stockLengthMm?: number;

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

  @ApiPropertyOptional({ description: 'createdAt >= fromDate' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'createdAt <= toDate' })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}
