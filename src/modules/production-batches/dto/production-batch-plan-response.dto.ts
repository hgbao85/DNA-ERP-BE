import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { ProductionBatchPlanItemResponseDto } from './production-batch-plan-item-response.dto';

/**
 * Header PO + toàn bộ mảnh (Piece) của BOM cho 1 stage (HAN|SON) - cho HAN_STAFF/SON_STAFF chọn
 * pieceId thật để báo sản lượng mà không cần SKU:VIEW/PRODUCTION_ORDER:VIEW/BOM_REVISION:VIEW
 * (chỉ cần biết trước productionOrderId, xem PRODUCTION_ORDER:VIEW mới cấp cho 2 role này để list
 * được GET /production-orders). Cố ý KHÔNG có deadline - ProductionOrder không có cột này
 * (deadline nằm ở SalesOrder/ProductionInvoiceItem, HAN/SON không có quyền đọc).
 */
@Exclude()
export class ProductionBatchPlanResponseDto {
  @Expose() @ApiProperty() poNumber!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) salesOrderCode!: string | null;
  @Expose() @ApiProperty() productName!: string;
  @Expose() @ApiProperty() quantity!: number;
  @Expose()
  @Type(() => ProductionBatchPlanItemResponseDto)
  @ApiProperty({ type: [ProductionBatchPlanItemResponseDto] })
  items!: ProductionBatchPlanItemResponseDto[];

  constructor(partial: Partial<ProductionBatchPlanResponseDto>) {
    Object.assign(this, partial);
  }
}
