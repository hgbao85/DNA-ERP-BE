import { Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { CuttingProposalsService } from './cutting-proposals.service';

const VIEW = { module: PERMISSION_MODULES.CUTTING_PROPOSAL, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.CUTTING_PROPOSAL, action: PermissionAction.CREATE };
const APPROVE = { module: PERMISSION_MODULES.CUTTING_PROPOSAL, action: PermissionAction.APPROVE };

@ApiTags('Cutting Proposals')
@ApiBearerAuth()
@Controller({ version: '1' })
export class CuttingProposalsController {
  constructor(private readonly cuttingProposalsService: CuttingProposalsService) {}

  /** Nút "Tính lại" thủ công - lần tính đầu tiên tự động chạy ngầm khi Sếp duyệt PI item. */
  @Post('production-orders/:id/cutting-proposals')
  @RequirePermissions(CREATE)
  requestProposal(
    @Param('id') id: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    return this.cuttingProposalsService.requestForOrder(parseBigIntId(id), {
      idempotencyKey,
      requestedById: userId,
    });
  }

  @Get('production-orders/:id/cutting-proposals')
  @RequirePermissions(VIEW)
  findAllForOrder(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.cuttingProposalsService.findAllForOrder(id, query);
  }

  @Get('cutting-proposals/:id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.cuttingProposalsService.findOne(id);
  }

  @Post('cutting-proposals/:id/approve')
  @RequirePermissions(APPROVE)
  approve(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.cuttingProposalsService.approve(id, userId);
  }
}
