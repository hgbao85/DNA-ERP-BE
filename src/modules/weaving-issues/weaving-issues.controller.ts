import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
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
