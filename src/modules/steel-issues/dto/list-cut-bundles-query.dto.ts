import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CutBundleStatus } from '../../../generated/prisma/client';

/** Query của GET /cut-bundles (19/11/2026): status lạ -> 400 thay vì 500 ở Prisma. */
export class ListCutBundlesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productionInvoiceId?: string;

  @ApiPropertyOptional({ enum: CutBundleStatus, enumName: 'CutBundleStatus' })
  @IsOptional()
  @IsEnum(CutBundleStatus, {
    message: 'Trạng thái đợt cắt không hợp lệ (CUTTING, AWAITING_QC, QC_PASSED)',
  })
  status?: CutBundleStatus;
}
