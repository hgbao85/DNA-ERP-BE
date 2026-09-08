import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { StepBundleStatus } from '../../../generated/prisma/client';

/** Query cho GET /step-bundles (flat, không cần productionInvoiceId) - cùng lý do
 *  ListSteelIssuesQueryDto/ListPieceStepBundlesQueryDto tồn tại: KCS_STAFF không tự resolve
 *  productionInvoiceId được. */
export class ListStepBundlesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: StepBundleStatus, enumName: 'StepBundleStatus' })
  @IsOptional()
  @IsEnum(StepBundleStatus)
  status?: StepBundleStatus;
}
