import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateProductionInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  salesOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deadline?: string;
}
