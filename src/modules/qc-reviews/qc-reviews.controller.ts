import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateQcReviewDto } from './dto/create-qc-review.dto';
import { CreateSteelIssueQcReviewDto } from './dto/create-steel-issue-qc-review.dto';
import { ListQcReviewsQueryDto } from './dto/list-qc-reviews-query.dto';
import { UpdateQcReviewPhotoDto } from './dto/update-qc-review-photo.dto';
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

  @Get('qc-reviews')
  @RequirePermissions(VIEW)
  findAll(@Query() query: ListQcReviewsQueryDto) {
    return this.qcReviewsService.findAll(query);
  }

  /**
   * Sửa/xóa ảnh bằng chứng khi lỡ chọn nhầm - 2026-09-11 lần 2 (theo Sếp Trương Văn Nhân: "cho
   * người nhập được sửa luôn"), mở cho CHÍNH người đã chấm review này, KHÔNG chỉ ADMIN như thiết
   * kế ban đầu. Bỏ hẳn `@RequireRole(ADMIN)`/`@RequireMfgRole(KCS)` - quyết định "actor này có phải
   * người nhập hay Admin không" cần đọc dữ liệu record (reviewedById) nên chuyển vào
   * QcReviewsService.updatePhoto(), decorator tĩnh không làm được. `@RequirePermissions(UPDATE)`
   * vẫn giữ - KCS_STAFF đã có QC_REVIEW:UPDATE sẵn (role-permissions.constant.ts), không cần cấp
   * thêm. CHỈ sửa được photoUrl - xem doc comment QcReviewsService.updatePhoto()/
   * UpdateQcReviewPhotoDto.
   */
  @Patch('qc-reviews/:id/photo')
  @RequirePermissions(UPDATE)
  updatePhoto(
    @Param('id') id: string,
    @Body() dto: UpdateQcReviewPhotoDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.qcReviewsService.updatePhoto(id, dto, userId, roles);
  }
}
