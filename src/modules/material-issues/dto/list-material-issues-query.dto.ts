import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { MaterialIssueStatus, MfgStage } from '../../../generated/prisma/client';

/**
 * Query cho GET /material-issues (flat, không cần productionOrderId) - tổ Hàn/Sơn chỉ có
 * MATERIAL_ISSUE:VIEW (KHÔNG có PRODUCTION_ORDER:VIEW/SKU:VIEW - xem role-permissions.constant.ts)
 * nên không thể tự resolve productionOrderId như FE phía kho (transfer-check/packaging/
 * weaving-issues/material-issues create). Đây là endpoint DUY NHẤT cho phép tổ Hàn/Sơn xem "đợt
 * chờ/đã nhận của công đoạn mình" mà không cần biết trước PO nào.
 */
export class ListMaterialIssuesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MfgStage, enumName: 'MfgStage' })
  @IsOptional()
  @IsEnum(MfgStage)
  stage?: MfgStage;

  @ApiPropertyOptional({ enum: MaterialIssueStatus, enumName: 'MaterialIssueStatus' })
  @IsOptional()
  @IsEnum(MaterialIssueStatus)
  status?: MaterialIssueStatus;
}
