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
import { MfgRole, PermissionAction, ProcessStep } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RecordCutBatchDto } from './dto/record-cut-batch.dto';
import { CompleteStepDto } from './dto/complete-step.dto';
import { CreateSteelIssueDto } from './dto/create-steel-issue.dto';
import { ListSteelIssuesQueryDto } from './dto/list-steel-issues-query.dto';
import { RecordStepBatchDto } from './dto/record-step-batch.dto';
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
    // Vấn đề #11 audit 26/08 - trước đây header này chỉ tuỳ chọn dù service đã hỗ trợ dedupe theo
    // key, nên 1 request gửi lặp (mất mạng rồi gửi lại...) mà thiếu header vẫn tạo 2 bản ghi riêng
    // biệt. FE đã gửi kèm ở mọi lần gọi thật (xem withIdempotencyKey() trong steel-issues-api.ts).
    if (!idempotencyKey) {
      throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    }
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
   * Gộp nhiều PI 1 lần - "Bảng thống kê" (ThongKePagePlan.tsx) cần tiến độ Phôi cho nhiều SKU
   * cùng lúc, nhiều SKU có thể chung 1 PI - cùng mẫu GET /packaging-issues/plan.
   *
   * Path 'production-invoices/steel-issues-batch' (1 segment) ĐÃ TỪNG đụng route
   * 'production-invoices/:id' (ProductionInvoicesController.findOne, controller khác nhưng cùng
   * tiền tố) - Nest khớp route theo THỨ TỰ ĐĂNG KÝ module (không ưu tiên route tĩnh), :id nuốt
   * mất chuỗi "steel-issues-batch" làm id, ném 400 khi parseBigIntId (phát hiện qua browser thật
   * 2026-08-31: cả 5 endpoint batch đều 400). Đổi sang 2 segment 'steel-issues/batch' - segment 2
   * là 'batch', KHÔNG trùng bất kỳ literal segment-2 nào sau ':id/' đã có (vd 'steel-issues' của
   * findAllForInvoice) nên không còn khớp nhầm route ':id/<literal>' nào, bất kể thứ tự đăng ký.
   */
  @Get('production-invoices/steel-issues/batch')
  @RequirePermissions(VIEW)
  findAllForInvoiceBatch(@Query('ids') idsParam?: string) {
    if (!idsParam) {
      throw new BadRequestException('Query ids là bắt buộc (phân tách bởi dấu phẩy)');
    }
    const ids = idsParam
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    return this.steelIssuesService.findAllForInvoiceBatch(ids);
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

  /**
   * Tiến độ 1 công đoạn chi tiết SAU Cắt (Uốn/Dập/...) - cùng khuôn dạng "Cần/Đã.../Còn lại" như
   * phoi-progress, khác nguồn `done` (StepBatchSegment thay vì CutPatternSegment). `step` trong
   * path phải khớp enum ProcessStep (vd UON/DAP/DUC_LO/TAN/TOP_DAU/XE) - không nhận CAT, dùng
   * phoi-progress cho CAT.
   */
  @Get('production-invoices/:id/step-progress/:step')
  @RequirePermissions(VIEW)
  getStepProgress(@Param('id') id: string, @Param('step') step: ProcessStep) {
    return this.steelIssuesService.getStepProgress(id, step);
  }

  /**
   * Danh sách PO/SKU (ProductionOrder) thuộc 1 PI - khối "tham khảo" cho màn Lệnh sản xuất Phôi,
   * KHÔNG mang số liệu tiến độ. Đặt ở đây (không phải ProductionInvoicesController) để dùng
   * STEEL_ISSUE:VIEW - PHOI_STAFF không có PRODUCTION_INVOICE:VIEW.
   */
  @Get('production-invoices/:id/order-summary')
  @RequirePermissions(VIEW)
  getOrderSummary(@Param('id') id: string) {
    return this.steelIssuesService.getOrderSummary(id);
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

  /** Nhập 1 đợt "đã gia công" cho công đoạn chi tiết SAU Cắt (cộng dồn) - mirror cut-batches,
   *  không đổi trạng thái. Xem RecordStepBatchDto. */
  @Post('steel-issues/:id/step-batches')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  recordStepBatch(@Param('id') id: string, @Body() dto: RecordStepBatchDto) {
    return this.steelIssuesService.recordStepBatch(id, dto);
  }

  @Post('steel-issues/:id/complete-step')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  completeStep(@Param('id') id: string, @Body() dto: CompleteStepDto) {
    return this.steelIssuesService.completeStep(id, dto);
  }
}
