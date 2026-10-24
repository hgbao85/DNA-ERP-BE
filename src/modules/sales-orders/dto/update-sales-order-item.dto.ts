import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { SalesOrderItemStatus } from '../../../generated/prisma/client';

export class UpdateSalesOrderItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  skuName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  totalQty?: number;

  @ApiPropertyOptional({ enum: SalesOrderItemStatus })
  @IsOptional()
  @IsEnum(SalesOrderItemStatus)
  status?: SalesOrderItemStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  // Đổi loại dây/nệm - chỉ được khi lệnh sản xuất của dòng này CHƯA được Sếp duyệt (sau đó lệnh
  // đã chốt lựa chọn, xem ProductionOrder.wireMaterialId).
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  wireMaterialId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cushionMaterialId?: string;
}
