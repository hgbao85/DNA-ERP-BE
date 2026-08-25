import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RecordCutBatchDto } from './dto/record-cut-batch.dto';
import { CompleteStepDto } from './dto/complete-step.dto';
import { CreateSteelIssueDto } from './dto/create-steel-issue.dto';
import { ListSteelIssuesQueryDto } from './dto/list-steel-issues-query.dto';
import { SteelIssuesService } from './steel-issues.service';

const VIEW = { module: PERMISSION_MODULES.STEEL_ISSUE, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.STEEL_ISSUE, action: PermissionAction.CREATE };
const UPDATE = { module: PERMISSION_MODULES.STEEL_ISSUE, action: PermissionAction.UPDATE };

@ApiTags('Steel Issues')
@ApiBearerAuth()
@Controller({ version: '1' })
export class SteelIssuesController {
  constructor(private readonly steelIssuesService: SteelIssuesService) {}

  // ─── Thủ kho trung tâm (WAREHOUSE_STAFF) - xuất sắt cho Phôi, gộp theo cả PI ─

  @Post('production-invoices/:id/steel-issues')
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

  @Get('production-invoices/:id/steel-issues')
  @RequirePermissions(VIEW)
  findAllForInvoice(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.steelIssuesService.findAllForInvoice(id, query);
  }

  @Get('production-invoices/:id/steel-issue-plan')
  @RequirePermissions(VIEW)
  getIssuePlan(@Param('id') id: string) {
    return this.steelIssuesService.getIssuePlan(id);
  }

  /**
   * Tiến độ cắt theo (loại sắt -> cỡ đoạn) - bảng "Cần / Đã cắt / Còn lại" ở màn Lệnh sản xuất
   * của Phôi. Đặt ở controller này (không phải ProductionInvoicesController) để dùng đúng quyền
   * STEEL_ISSUE:VIEW mà PHOI_STAFF đã có.
   */
  @Get('production-invoices/:id/phoi-progress')
  @RequirePermissions(VIEW)
  getPhoiProgress(@Param('id') id: string) {
    return this.steelIssuesService.getPhoiProgress(id);
  }

  // ─── Tổ Phôi / KCS - xem theo trạng thái, không cần biết trước productionInvoiceId ─

  /** Flat, không cần biết productionOrderId - xem ListSteelIssuesQueryDto. */
  @Get('steel-issues')
  @RequirePermissions(VIEW)
  findAll(@Query() query: ListSteelIssuesQueryDto) {
    return this.steelIssuesService.findAll(query);
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

  /**
   * Nhập 1 đợt cắt (cộng dồn) - KHÔNG đổi trạng thái. Thay `complete-cutting` cũ (2026-08-22):
   * route đó vừa nhận số liệu chép-từ-pattern vừa chuyển sang chờ KCS trong cùng 1 lần bấm.
   */
  @Post('steel-issues/:id/cut-batches')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  recordCutBatch(@Param('id') id: string, @Body() dto: RecordCutBatchDto) {
    return this.steelIssuesService.recordCutBatch(id, dto);
  }

  /** "Xong, mời KCS" - tín hiệu thuần, không mang số liệu (đã nhập ở các đợt trước đó). */
  @Post('steel-issues/:id/finish-cutting')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  finishCutting(@Param('id') id: string) {
    return this.steelIssuesService.finishCutting(id);
  }

  @Post('steel-issues/:id/complete-step')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  completeStep(@Param('id') id: string, @Body() dto: CompleteStepDto) {
    return this.steelIssuesService.completeStep(id, dto);
  }
}
