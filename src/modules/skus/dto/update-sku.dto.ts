import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** Sửa tên/mã SKU (MfgProduct.factoryCode/name) và/hoặc khách hàng (PlanForm.customerName) khi
 *  SKU còn đang IN_PROGRESS - xem SkusService.update() cho ràng buộc chi tiết. */
export class UpdateSkuDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  factoryCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerName?: string;
}
