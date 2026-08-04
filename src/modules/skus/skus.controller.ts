import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DetailGroup, ManhGroup, MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { CreateSkuDto } from './dto/create-sku.dto';
import { ReviewQuotaDto } from './dto/review-quota.dto';
import { UpdateQuotaDto } from './dto/update-quota.dto';
import { SkusService } from './skus.service';

const VIEW = { module: PERMISSION_MODULES.SKU, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.SKU, action: PermissionAction.CREATE };
const UPDATE = { module: PERMISSION_MODULES.SKU, action: PermissionAction.UPDATE };
const APPROVE = { module: PERMISSION_MODULES.SKU, action: PermissionAction.APPROVE };
const DELETE = { module: PERMISSION_MODULES.SKU, action: PermissionAction.DELETE };

@ApiTags('SKU')
@ApiBearerAuth()
@Controller({ path: 'skus', version: '1' })
export class SkusController {
  constructor(private readonly skusService: SkusService) {}

  @Post()
  @RequirePermissions(CREATE)
  create(@Body() dto: CreateSkuDto, @CurrentUser('id') userId: string) {
    return this.skusService.create(dto, userId);
  }

  @Get()
  @RequirePermissions(VIEW)
  findAll(@Query() query: PaginationQueryDto) {
    return this.skusService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.skusService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(DELETE)
  remove(@Param('id') id: string) {
    return this.skusService.remove(id);
  }

  // ─── Manh quota (Sắt/Dây/Đinh) - nhập bởi 4 account chuyên trách, duyệt bởi KHSX ────

  @Post(':id/manh-quota/:group')
  @RequirePermissions(UPDATE)
  updateManhQuota(
    @Param('id') id: string,
    @Param('group') group: ManhGroup,
    @Body() dto: UpdateQuotaDto,
  ) {
    return this.skusService.updateManhQuota(id, group, dto);
  }

  @Post(':id/manh-quota/:group/review')
  @RequirePermissions(APPROVE)
  reviewManhQuota(
    @Param('id') id: string,
    @Param('group') group: ManhGroup,
    @Body() dto: ReviewQuotaDto,
  ) {
    return this.skusService.reviewManhQuota(id, group, dto);
  }

  @Post(':id/approve-parts')
  @RequirePermissions(APPROVE)
  approveParts(@Param('id') id: string) {
    return this.skusService.approveParts(id);
  }

  // ─── Detail quota (Sơn/Phụ kiện/Bao bì) ─────────────────────────────────────

  @Post(':id/detail-quota/:group')
  @RequirePermissions(UPDATE)
  updateDetailQuota(
    @Param('id') id: string,
    @Param('group') group: DetailGroup,
    @Body() dto: UpdateQuotaDto,
  ) {
    return this.skusService.updateDetailQuota(id, group, dto);
  }

  @Post(':id/detail-quota/:group/review')
  @RequirePermissions(APPROVE)
  reviewDetailQuota(
    @Param('id') id: string,
    @Param('group') group: DetailGroup,
    @Body() dto: ReviewQuotaDto,
  ) {
    return this.skusService.reviewDetailQuota(id, group, dto);
  }

  @Post(':id/approve-detail')
  @RequirePermissions(APPROVE)
  approveDetail(@Param('id') id: string) {
    return this.skusService.approveDetail(id);
  }

  // ─── QLSX (mfgRole = PRODUCTION_MANAGER) ────────────────────────────────────

  @Post(':id/qlsx-review')
  @RequirePermissions(APPROVE)
  @RequireMfgRole(MfgRole.PRODUCTION_MANAGER)
  reviewQlsx(@Param('id') id: string) {
    return this.skusService.reviewQlsx(id);
  }

  @Post(':id/request-boss-approval')
  @RequirePermissions(APPROVE)
  @RequireMfgRole(MfgRole.PRODUCTION_MANAGER)
  requestBossApproval(@Param('id') id: string) {
    return this.skusService.requestBossApproval(id);
  }

  @Post(':id/reject-qlsx')
  @RequirePermissions(APPROVE)
  @RequireMfgRole(MfgRole.PRODUCTION_MANAGER)
  rejectByQlsx(@Param('id') id: string) {
    return this.skusService.rejectByQlsx(id);
  }

  // ─── Sếp (role BOSS) - duyệt cuối, mirror assertBossRole() trong mock ───────

  @Post(':id/approve')
  @RequirePermissions(APPROVE)
  @RequireRole(BUSINESS_ROLES.BOSS)
  approve(@Param('id') id: string) {
    return this.skusService.approve(id);
  }

  @Post(':id/reject-boss')
  @RequirePermissions(APPROVE)
  @RequireRole(BUSINESS_ROLES.BOSS)
  rejectByBoss(@Param('id') id: string) {
    return this.skusService.rejectByBoss(id);
  }
}
