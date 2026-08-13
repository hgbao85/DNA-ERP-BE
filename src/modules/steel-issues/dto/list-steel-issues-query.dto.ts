import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SteelIssueStatus } from '../../../generated/prisma/client';

/**
 * Query cho GET /steel-issues (flat, không cần productionOrderId) - PHOI_STAFF/KCS_STAFF chỉ có
 * STEEL_ISSUE:VIEW (KHÔNG có PRODUCTION_ORDER:VIEW/SKU:VIEW - xem role-permissions.constant.ts)
 * nên không thể tự resolve productionOrderId như FE phía kho (WAREHOUSE_STAFF, master-detail theo
 * SKU/PO). Cùng idiom ListMaterialIssuesQueryDto/ListProductionBatchesQueryDto.
 */
export class ListSteelIssuesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SteelIssueStatus, enumName: 'SteelIssueStatus' })
  @IsOptional()
  @IsEnum(SteelIssueStatus)
  status?: SteelIssueStatus;
}
