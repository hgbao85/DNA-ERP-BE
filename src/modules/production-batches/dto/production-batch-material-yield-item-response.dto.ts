import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/** Vật tư thành phẩm KHÔNG gắn mảnh (vd chân nhôm, MaterialYieldRecipe) trong kế hoạch Phôi của 1 SKU.
 *  Không phải Piece nên không nằm trong ProductionBatchPlanItemResponseDto. Tiến độ lấy từ đợt KCS công
 *  đoạn cuối của recipe theo PI, phân bổ cho SKU theo tỷ lệ nhu cầu (xem ProductionBatchesService). */
@Exclude()
export class ProductionBatchMaterialYieldItemResponseDto {
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() materialName!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialSpec!: string | null;
  /** Mốc đợt KCS công đoạn cuối gần nhất của PI (ISO), null nếu chưa có đợt nào. */
  @Expose() @ApiPropertyOptional({ nullable: true }) lastUpdatedAt!: string | null;
  @Expose() @ApiProperty() plannedQty!: number;
  @Expose() @ApiProperty() awaitingQcQty!: number;
  @Expose() @ApiProperty() passedQty!: number;

  constructor(partial: Partial<ProductionBatchMaterialYieldItemResponseDto>) {
    Object.assign(this, partial);
  }
}
