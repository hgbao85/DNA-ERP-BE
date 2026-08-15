import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { CreateSkuDto } from './dto/create-sku.dto';
import { RejectBossDto } from './dto/reject-boss.dto';
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

  // ─── Manh quota (mảnh - Sắt/Dây/Đinh/Tán rút/Nút nhựa, nhập bởi acc Sắt, duyệt bởi KHSX) ──

  @Post(':id/manh-quota')
  @RequirePermissions(UPDATE)
  updateManhQuota(@Param('id') id: string, @Body() dto: UpdateQuotaDto) {
    return this.skusService.updateManhQuota(id, dto);
  }

  @Post(':id/manh-quota/review')
  @RequirePermissions(APPROVE)
  reviewManhQuota(@Param('id') id: string, @Body() dto: ReviewQuotaDto) {
    return this.skusService.reviewManhQuota(id, dto);
  }

  @Post(':id/approve-parts')
  @RequirePermissions(APPROVE)
  approveParts(@Param('id') id: string) {
    return this.skusService.approveParts(id);
  }

  // ─── Detail quota (chi tiết - Sơn/Phụ kiện/Bao bì, nhập bởi acc chi tiết, duyệt bởi KHSX) ──

  @Post(':id/detail-quota')
  @RequirePermissions(UPDATE)
  updateDetailQuota(@Param('id') id: string, @Body() dto: UpdateQuotaDto) {
    return this.skusService.updateDetailQuota(id, dto);
  }

  @Post(':id/detail-quota/review')
  @RequirePermissions(APPROVE)
  reviewDetailQuota(@Param('id') id: string, @Body() dto: ReviewQuotaDto) {
    return this.skusService.reviewDetailQuota(id, dto);
  }

  @Post(':id/approve-detail')
  @RequirePermissions(APPROVE)
  approveDetail(@Param('id') id: string) {
    return this.skusService.approveDetail(id);
  }

  // ─── Sếp (role BOSS) - duyệt cuối, mirror assertBossRole() trong mock ───────
  // Bước QLSX duyệt cục bộ (qlsx-review/request-boss-approval/reject-qlsx) đã bị bỏ khỏi
  // pipeline - approveDetail() ở trên chuyển thẳng KHSX -> Sếp.

  @Post(':id/approve')
  @RequirePermissions(APPROVE)
  @RequireRole(BUSINESS_ROLES.BOSS)
  approve(@Param('id') id: string, @Headers('idempotency-key') idempotencyKey: string | undefined) {
    if (!idempotencyKey) {
      throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    }
    return this.skusService.approve(id, idempotencyKey);
  }

  @Post(':id/reject-boss')
  @RequirePermissions(APPROVE)
  @RequireRole(BUSINESS_ROLES.BOSS)
  rejectByBoss(@Param('id') id: string, @Body() dto: RejectBossDto) {
    return this.skusService.rejectByBoss(id, dto.reason);
  }
}
