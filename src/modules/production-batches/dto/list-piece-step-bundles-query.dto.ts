import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PieceStepBundleStatus } from '../../../generated/prisma/client';

/** Query cho GET /piece-step-bundles (flat, không cần productionOrderId) - cùng lý do
 *  ListProductionBatchesQueryDto tồn tại: KCS_STAFF không tự resolve productionOrderId được. */
export class ListPieceStepBundlesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PieceStepBundleStatus, enumName: 'PieceStepBundleStatus' })
  @IsOptional()
  @IsEnum(PieceStepBundleStatus)
  status?: PieceStepBundleStatus;
}
