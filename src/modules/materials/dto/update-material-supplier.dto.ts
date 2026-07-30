import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

/**
 * supplierId is intentionally not editable here - the link is keyed by
 * (materialId, supplierId); to point at a different supplier, delete this row and create
 * a new one instead of mutating the junction key in place.
 */
export class UpdateMaterialSupplierDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;
}
