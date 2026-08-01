import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class UpdateProductionInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deadline?: string;
}
