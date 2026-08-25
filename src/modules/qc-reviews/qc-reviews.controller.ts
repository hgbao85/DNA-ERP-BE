import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { CreateQcReviewDto } from './dto/create-qc-review.dto';
import { CreateSteelIssueQcReviewDto } from './dto/create-steel-issue-qc-review.dto';
import { FulfillReplenishRequestDto } from './dto/fulfill-replenish-request.dto';
import { ListQcReviewsQueryDto } from './dto/list-qc-reviews-query.dto';
import { ListReplenishRequestsQueryDto } from './dto/list-replenish-requests-query.dto';
import { QcRecheckDto } from './dto/qc-recheck.dto';
import { RejectReplenishRequestDto } from './dto/reject-replenish-request.dto';
import { QcReviewsService } from './qc-reviews.service';

const VIEW = { module: PERMISSION_MODULES.QC_REVIEW, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.QC_REVIEW, action: PermissionAction.CREATE };
const UPDATE = { module: PERMISSION_MODULES.QC_REVIEW, action: PermissionAction.UPDATE };

@ApiTags('QC Reviews')
@ApiBearerAuth()
@Controller({ version: '1' })
export class QcReviewsController {
  constructor(private readonly qcReviewsService: QcReviewsService) {}

  // ─── KCS (mfgRole = KCS) - duyệt lô Phôi / Hàn / Sơn ──────────────────────────

  @Post('steel-issues/:id/qc-review')
  @RequirePermissions(CREATE)
  @RequireMfgRole(MfgRole.KCS)
  review(
    @Param('id') id: string,
    @Body() dto: CreateSteelIssueQcReviewDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.qcReviewsService.review(id, dto, userId);
  }

  // ─── Tổ Phôi (mfgRole = PHOI) - tự báo đã bù đủ cho cỡ đoạn không đạt ────────

  @Post('steel-issues/:id/qc-segments/:segmentSpecId/report-done')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  reportSegmentDone(@Param('id') id: string, @Param('segmentSpecId') segmentSpecId: string) {
    return this.qcReviewsService.reportSegmentDone(id, segmentSpecId);
  }

  // ─── KCS - duyệt lại các cỡ đoạn Phôi đã báo bù đủ ────────────────────────────

  @Post('steel-issues/:id/qc-recheck')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.KCS)
  recheck(@Param('id') id: string, @Body() dto: QcRecheckDto) {
    return this.qcReviewsService.recheck(id, dto);
  }

  @Post('production-batches/:id/qc-review')
  @RequirePermissions(CREATE)
  @RequireMfgRole(MfgRole.KCS)
  reviewProductionBatch(
    @Param('id') id: string,
    @Body() dto: CreateQcReviewDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.qcReviewsService.reviewProductionBatch(id, dto, userId);
  }

  @Get('qc-reviews')
  @RequirePermissions(VIEW)
  findAll(@Query() query: ListQcReviewsQueryDto) {
    return this.qcReviewsService.findAll(query);
  }

  // ─── Thủ kho trung tâm (WAREHOUSE_STAFF) - cấp bù sắt phế ────────────────────

  @Get('replenish-requests')
  @RequirePermissions(VIEW)
  findAllReplenishRequests(@Query() query: ListReplenishRequestsQueryDto) {
    return this.qcReviewsService.findAllReplenishRequests(query);
  }

  @Post('replenish-requests/:id/fulfill')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.WAREHOUSE_STAFF)
  fulfillReplenishRequest(
    @Param('id') id: string,
    @Body() dto: FulfillReplenishRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.qcReviewsService.fulfillReplenishRequest(id, dto, userId);
  }

  @Post('replenish-requests/:id/reject')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.WAREHOUSE_STAFF)
  rejectReplenishRequest(@Param('id') id: string, @Body() dto: RejectReplenishRequestDto) {
    return this.qcReviewsService.rejectReplenishRequest(id, dto);
  }
}
