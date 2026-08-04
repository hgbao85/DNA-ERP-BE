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

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  shippedQty?: number;

  @ApiPropertyOptional({ enum: SalesOrderItemStatus })
  @IsOptional()
  @IsEnum(SalesOrderItemStatus)
  status?: SalesOrderItemStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;
}
