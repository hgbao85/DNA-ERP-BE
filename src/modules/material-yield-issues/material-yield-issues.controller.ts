import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateMaterialYieldIssueDto } from './dto/create-material-yield-issue.dto';
import { ListMaterialYieldIssuesQueryDto } from './dto/list-material-yield-issues-query.dto';
import { ReceiveMaterialYieldIssueDto } from './dto/receive-material-yield-issue.dto';
import { MaterialYieldIssuesService } from './material-yield-issues.service';

const VIEW = { module: PERMISSION_MODULES.MATERIAL_YIELD_ISSUE, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.MATERIAL_YIELD_ISSUE, action: PermissionAction.CREATE };
const UPDATE = { module: PERMISSION_MODULES.MATERIAL_YIELD_ISSUE, action: PermissionAction.UPDATE };

@ApiTags('Material Yield Issues')
@ApiBearerAuth()
@Controller({ version: '1' })
export class MaterialYieldIssuesController {
  constructor(private readonly materialYieldIssuesService: MaterialYieldIssuesService) {}

  // ─── Thủ kho - xuất Sắt La/thanh nhôm cho Phôi ──────────────────────────────

  @Post('production-orders/:id/material-yield-issues')
  @RequirePermissions(CREATE)
  create(
    @Param('id') id: string,
    @Body() dto: CreateMaterialYieldIssueDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    }
    return this.materialYieldIssuesService.create(id, dto, userId, warehouseScope, idempotencyKey);
  }

  @Get('production-orders/:id/material-yield-issues')
  @RequirePermissions(VIEW)
  findAllForOrder(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.materialYieldIssuesService.findAllForOrder(id, query);
  }

  @Get('production-orders/:id/material-yield-issue-plan')
  @RequirePermissions(VIEW)
  getIssuePlan(@Param('id') id: string) {
    return this.materialYieldIssuesService.getIssuePlan(id);
  }

  @Get('material-yield-issues/:id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.materialYieldIssuesService.findOne(id);
  }

  // ─── Phôi (mfgRole = PHOI) - xem đợt chờ/đã nhận + xác nhận đã nhận ─────────

  /** Flat, không cần biết productionOrderId - xem ListMaterialYieldIssuesQueryDto. */
  @Get('material-yield-issues')
  @RequirePermissions(VIEW)
  findAll(@Query() query: ListMaterialYieldIssuesQueryDto) {
    return this.materialYieldIssuesService.findAll(query);
  }

  @Post('material-yield-issues/:id/receive')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  receive(
    @Param('id') id: string,
    @Body() dto: ReceiveMaterialYieldIssueDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('mfgRole') mfgRole: string | null,
  ) {
    return this.materialYieldIssuesService.receive(id, dto, userId, mfgRole);
  }
}
