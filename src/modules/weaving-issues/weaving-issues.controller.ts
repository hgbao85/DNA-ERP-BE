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
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateWeavingIssueDto } from './dto/create-weaving-issue.dto';
import { CreateWeavingReceiptDto } from './dto/create-weaving-receipt.dto';
import { WeavingIssuesService } from './weaving-issues.service';

const VIEW = { module: PERMISSION_MODULES.WEAVING_ISSUE, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.WEAVING_ISSUE, action: PermissionAction.CREATE };
const UPDATE = { module: PERMISSION_MODULES.WEAVING_ISSUE, action: PermissionAction.UPDATE };

@ApiTags('Weaving Issues')
@ApiBearerAuth()
@Controller({ version: '1' })
export class WeavingIssuesController {
  constructor(private readonly weavingIssuesService: WeavingIssuesService) {}

  // ─── Thủ kho vật tư-TP - xuất/nhận hàng đan ─────────────────────────────────

  @Post('production-orders/:id/weaving-issues')
  @RequirePermissions(CREATE)
  create(
    @Param('id') id: string,
    @Body() dto: CreateWeavingIssueDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    return this.weavingIssuesService.create(id, dto, userId, warehouseScope, idempotencyKey);
  }

  @Get('production-orders/:id/weaving-issues')
  @RequirePermissions(VIEW)
  findAllForOrder(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.weavingIssuesService.findAllForOrder(id, query);
  }

  @Get('production-orders/:id/weaving-issue-plan')
  @RequirePermissions(VIEW)
  getIssuePlan(@Param('id') id: string) {
    return this.weavingIssuesService.getIssuePlan(id);
  }

  /**
   * Gộp nhiều ProductionOrder 1 lần - "Bảng thống kê" (ThongKePagePlan.tsx).
   *
   * Path 1 segment 'weaving-issue-plan-batch' ĐÃ TỪNG đụng 'production-orders/:id'
   * (ProductionOrdersController.findOne) - Nest khớp theo thứ tự đăng ký module, không ưu tiên
   * route tĩnh, :id nuốt mất chuỗi làm id → 400 (phát hiện qua browser thật 2026-08-31). Đổi sang
   * 2 segment 'weaving-issue-plan/batch' - segment 2 'batch' không trùng literal segment-2 nào
   * sau ':id/' đã có (vd 'weaving-issue-plan' của getIssuePlan) nên hết khớp nhầm.
   */
  @Get('production-orders/weaving-issue-plan/batch')
  @RequirePermissions(VIEW)
  getIssuePlanBatch(@Query('ids') idsParam?: string) {
    if (!idsParam) {
      throw new BadRequestException('Query ids là bắt buộc (phân tách bởi dấu phẩy)');
    }
    const ids = idsParam
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    return this.weavingIssuesService.getIssuePlanBatch(ids);
  }

  // ─── Quản lý điểm đan - đọc gộp qua mọi PO ──────────────────────────────────
  // Đặt TRƯỚC 'weaving-issues/:id' - route tĩnh phải khai trước route có tham số cùng tiền tố,
  // nếu không Nest sẽ khớp "by-point" vào :id trước (findOne('by-point') sẽ 400/404 sai).

  @Get('weaving-issues/by-point')
  @RequirePermissions(VIEW)
  findAllGroupedByPoint() {
    return this.weavingIssuesService.findAllGroupedByPoint();
  }

  @Get('weaving-issues/:id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.weavingIssuesService.findOne(id);
  }

  @Post('production-orders/:id/weaving-receipts')
  @RequirePermissions(UPDATE)
  receive(
    @Param('id') id: string,
    @Body() dto: CreateWeavingReceiptDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    return this.weavingIssuesService.receive(id, dto, userId, warehouseScope, idempotencyKey);
  }

  @Get('production-orders/:id/weaving-receipts')
  @RequirePermissions(VIEW)
  findAllReceiptsForOrder(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.weavingIssuesService.findAllReceiptsForOrder(id, query);
  }

  @Get('weaving-receipts/:id')
  @RequirePermissions(VIEW)
  findOneReceipt(@Param('id') id: string) {
    return this.weavingIssuesService.findOneReceipt(id);
  }
}
