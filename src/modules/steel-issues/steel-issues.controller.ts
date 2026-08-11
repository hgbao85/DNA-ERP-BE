import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CompleteCuttingDto } from './dto/complete-cutting.dto';
import { CreateSteelIssueDto } from './dto/create-steel-issue.dto';
import { SteelIssuesService } from './steel-issues.service';

const VIEW = { module: PERMISSION_MODULES.STEEL_ISSUE, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.STEEL_ISSUE, action: PermissionAction.CREATE };
const UPDATE = { module: PERMISSION_MODULES.STEEL_ISSUE, action: PermissionAction.UPDATE };

@ApiTags('Steel Issues')
@ApiBearerAuth()
@Controller({ version: '1' })
export class SteelIssuesController {
  constructor(private readonly steelIssuesService: SteelIssuesService) {}

  // ─── Thủ kho trung tâm (WAREHOUSE_STAFF) - xuất sắt cho Phôi ────────────────

  @Post('production-orders/:id/steel-issues')
  @RequirePermissions(CREATE)
  create(
    @Param('id') id: string,
    @Body() dto: CreateSteelIssueDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    return this.steelIssuesService.create(id, dto, userId, warehouseScope, idempotencyKey);
  }

  @Get('production-orders/:id/steel-issues')
  @RequirePermissions(VIEW)
  findAllForOrder(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.steelIssuesService.findAllForOrder(id, query);
  }

  @Get('production-orders/:id/steel-issue-plan')
  @RequirePermissions(VIEW)
  getIssuePlan(@Param('id') id: string) {
    return this.steelIssuesService.getIssuePlan(id);
  }

  @Get('steel-issues/:id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.steelIssuesService.findOne(id);
  }

  @Get('steel-issues/:id/bundles')
  @RequirePermissions(VIEW)
  getBundles(@Param('id') id: string) {
    return this.steelIssuesService.getBundles(id);
  }

  // ─── Tổ Phôi (mfgRole = PHOI) - nhận sắt, báo cắt xong ───────────────────────

  @Post('steel-issues/:id/receive')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  receive(@Param('id') id: string) {
    return this.steelIssuesService.receive(id);
  }

  @Post('steel-issues/:id/complete-cutting')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  completeCutting(@Param('id') id: string, @Body() dto: CompleteCuttingDto) {
    return this.steelIssuesService.completeCutting(id, dto);
  }
}
