import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** mfgProductId comes from the route param, never the body - see ProductsController. */
export class CreateProductVariantDto {
  @ApiPropertyOptional({ description: 'Khách mà biến thể này làm riêng cho' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  colorCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
