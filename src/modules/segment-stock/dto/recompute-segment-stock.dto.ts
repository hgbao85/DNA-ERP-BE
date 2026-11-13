import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

/** POST /segment-stock/recompute - tính lại tồn đoạn phía cộng của 1 lệnh (QLSX / admin sửa lệch hoặc backfill). */
export class RecomputeSegmentStockDto {
  @ApiProperty({ description: 'Id lệnh sản xuất (ProductionInvoice), chuỗi số' })
  @IsString()
  @Matches(/^\d+$/, { message: 'productionInvoiceId phải là chuỗi số' })
  productionInvoiceId!: string;

  @ApiPropertyOptional({
    description: 'true = chỉ tính và trả số (xem thử), không khoá, không ghi sổ kho',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
