import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { MaterialYieldIssueStatus } from '../../../generated/prisma/client';

/**
 * Query cho GET /material-yield-issues (flat, không cần productionOrderId) - PHOI_STAFF chỉ có
 * MATERIAL_YIELD_ISSUE:VIEW (không có PRODUCTION_ORDER:VIEW đủ để tự resolve mọi order) nên đây là
 * endpoint duy nhất xem "đợt chờ/đã nhận của mình" mà không cần biết trước productionOrderId nào -
 * cùng idiom ListMaterialIssuesQueryDto, không có field `stage` (luôn PHÔI).
 */
export class ListMaterialYieldIssuesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MaterialYieldIssueStatus, enumName: 'MaterialYieldIssueStatus' })
  @IsOptional()
  @IsEnum(MaterialYieldIssueStatus)
  status?: MaterialYieldIssueStatus;
}
