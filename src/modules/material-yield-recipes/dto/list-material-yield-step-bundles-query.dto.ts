import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PieceStepBundleStatus } from '../../../generated/prisma/client';

/** Query cho GET /material-yield-step-bundles (flat, không cần productionInvoiceId) - mirror
 *  ListPieceStepBundlesQueryDto, cùng lý do: KCS không tự resolve productionInvoiceId được. */
export class ListMaterialYieldStepBundlesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PieceStepBundleStatus, enumName: 'PieceStepBundleStatus' })
  @IsOptional()
  @IsEnum(PieceStepBundleStatus)
  status?: PieceStepBundleStatus;
}
