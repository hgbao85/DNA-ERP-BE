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
import { RecheckProductionBatchDto } from './dto/recheck-production-batch.dto';
import { RejectReplenishRequestDto } from './dto/reject-replenish-request.dto';
import { ReportProductionBatchDoneDto } from './dto/report-production-batch-done.dto';
import { ReportSegmentDoneDto } from './dto/report-segment-done.dto';
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

  /** Duyệt theo TỪNG ĐỢT CẮT (2026-09-05) - thay route theo lô nhận ở trên cho luồng mới, xem
   *  QcReviewsService.reviewCutBundle(). Route cũ giữ nguyên cho các lô đang dở trên production. */
  @Post('cut-bundles/:id/qc-review')
  @RequirePermissions(CREATE)
  @RequireMfgRole(MfgRole.KCS)
  reviewCutBundle(
    @Param('id') id: string,
    @Body() dto: CreateSteelIssueQcReviewDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.qcReviewsService.reviewCutBundle(id, dto, userId);
  }

  /** Duyệt 1 "đợt gửi KCS" theo công đoạn PHỤ (Uốn/Dập/Tán/..., 2026-09-07) - xem StepBundle doc
   *  comment BE tại sao KHÔNG ràng buộc thứ tự với Cắt/công đoạn khác. */
  @Post('step-bundles/:id/qc-review')
  @RequirePermissions(CREATE)
  @RequireMfgRole(MfgRole.KCS)
  reviewStepBundle(
    @Param('id') id: string,
    @Body() dto: CreateSteelIssueQcReviewDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.qcReviewsService.reviewStepBundle(id, dto, userId);
  }

  // ─── Tổ Phôi (mfgRole = PHOI) - tự báo đã bù đủ cho cỡ đoạn không đạt ────────

  @Post('steel-issues/:id/qc-segments/:segmentSpecId/report-done')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  reportSegmentDone(
    @Param('id') id: string,
    @Param('segmentSpecId') segmentSpecId: string,
    @Body() dto: ReportSegmentDoneDto,
  ) {
    return this.qcReviewsService.reportSegmentDone(id, segmentSpecId, dto);
  }

  /** Cùng report-done nhưng scope theo ĐÚNG đợt cắt (2026-09-05) - dùng cho luồng mới. */
  @Post('cut-bundles/:id/qc-segments/:segmentSpecId/report-done')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  reportSegmentDoneForBundle(
    @Param('id') id: string,
    @Param('segmentSpecId') segmentSpecId: string,
    @Body() dto: ReportSegmentDoneDto,
  ) {
    return this.qcReviewsService.reportSegmentDoneForBundle(id, segmentSpecId, dto);
  }

  /** Cùng report-done nhưng scope theo ĐÚNG StepBundle (2026-09-07, công đoạn phụ). */
  @Post('step-bundles/:id/qc-segments/:segmentSpecId/report-done')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  reportSegmentDoneForStepBundle(
    @Param('id') id: string,
    @Param('segmentSpecId') segmentSpecId: string,
    @Body() dto: ReportSegmentDoneDto,
  ) {
    return this.qcReviewsService.reportSegmentDoneForStepBundle(id, segmentSpecId, dto);
  }

  // ─── KCS - duyệt lại các cỡ đoạn Phôi đã báo bù đủ ────────────────────────────

  @Post('steel-issues/:id/qc-recheck')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.KCS)
  recheck(@Param('id') id: string, @Body() dto: QcRecheckDto) {
    return this.qcReviewsService.recheck(id, dto);
  }

  /** Cùng qc-recheck nhưng scope theo ĐÚNG đợt cắt (2026-09-05) - dùng cho luồng mới. */
  @Post('cut-bundles/:id/qc-recheck')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.KCS)
  recheckForBundle(@Param('id') id: string, @Body() dto: QcRecheckDto) {
    return this.qcReviewsService.recheckForBundle(id, dto);
  }

  /** Cùng qc-recheck nhưng scope theo ĐÚNG StepBundle (2026-09-07, công đoạn phụ). */
  @Post('step-bundles/:id/qc-recheck')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.KCS)
  recheckForStepBundle(@Param('id') id: string, @Body() dto: QcRecheckDto) {
    return this.qcReviewsService.recheckForStepBundle(id, dto);
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

  /**
   * "Bù đủ" cho lô Hàn/Sơn/VTTP (2026-09-07) - endpoint dùng chung cho cả 3 mfgRole (backend
   * không phân biệt stage), FE hiện TẠM chỉ bật UI cho VTTP (xem KcsVatTuThanhPhamPage.tsx).
   */
  @Post('production-batches/:id/qc-report-done')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI, MfgRole.HAN, MfgRole.SON)
  reportProductionBatchDone(@Param('id') id: string, @Body() dto: ReportProductionBatchDoneDto) {
    return this.qcReviewsService.reportProductionBatchDone(id, dto);
  }

  @Post('production-batches/:id/qc-recheck')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.KCS)
  recheckProductionBatch(@Param('id') id: string, @Body() dto: RecheckProductionBatchDto) {
    return this.qcReviewsService.recheckProductionBatch(id, dto);
  }

  // ─── KCS - duyệt theo TỪNG CÔNG ĐOẠN (PieceStepBundle, 2026-09-07) ────────────
  // Vật tư thành phẩm - mỗi công đoạn (Cắt/Tán/Uốn...) tự gửi KCS riêng, không chờ công đoạn khác
  // (xem PieceStepBundle doc comment BE tại sao KHÔNG ràng buộc thứ tự nữa).

  @Post('piece-step-bundles/:id/qc-review')
  @RequirePermissions(CREATE)
  @RequireMfgRole(MfgRole.KCS)
  reviewPieceStep(
    @Param('id') id: string,
    @Body() dto: CreateQcReviewDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.qcReviewsService.reviewPieceStep(id, dto, userId);
  }

  @Post('piece-step-bundles/:id/qc-report-done')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  reportPieceStepDone(@Param('id') id: string, @Body() dto: ReportProductionBatchDoneDto) {
    return this.qcReviewsService.reportPieceStepDone(id, dto);
  }

  @Post('piece-step-bundles/:id/qc-recheck')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.KCS)
  recheckPieceStep(@Param('id') id: string, @Body() dto: RecheckProductionBatchDto) {
    return this.qcReviewsService.recheckPieceStep(id, dto);
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
