import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { MfgStage, ProductionBatchStatus } from '../../../generated/prisma/client';

/**
 * Query cho GET /production-batches (flat, không cần productionOrderId) - cùng lý do
 * ListMaterialIssuesQueryDto tồn tại: KCS_STAFF chỉ có PRODUCTION_BATCH:VIEW (mới cấp thêm), không
 * có PRODUCTION_ORDER:VIEW/SKU:VIEW/BOM_REVISION:VIEW nên không tự resolve productionOrderId được
 * như phía kho. Đây là endpoint DUY NHẤT cho KCS xem "lô đang chờ duyệt của công đoạn Hàn/Sơn" mà
 * không cần biết trước PO nào - cùng vai trò với GET /material-issues?stage= cho HAN/SON.
 */
export class ListProductionBatchesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MfgStage, enumName: 'MfgStage' })
  @IsOptional()
  @IsEnum(MfgStage)
  stage?: MfgStage;

  @ApiPropertyOptional({ enum: ProductionBatchStatus, enumName: 'ProductionBatchStatus' })
  @IsOptional()
  @IsEnum(ProductionBatchStatus)
  status?: ProductionBatchStatus;
}
