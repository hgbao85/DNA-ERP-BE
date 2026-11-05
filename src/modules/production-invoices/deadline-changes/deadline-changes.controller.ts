import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../../common/constants/roles.constant';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../../common/decorators/require-role.decorator';
import { AuthenticatedUser } from '../../../common/interfaces/jwt-payload.interface';
import { DecideDeadlineBatchDto, ListDeadlineBatchesQueryDto } from './dto/deadline-change.dto';
import { DeadlineChangesService } from './deadline-changes.service';

const VIEW = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.VIEW };
const UPDATE = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.UPDATE };
const APPROVE = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.APPROVE };

const actorOf = (user: AuthenticatedUser) => ({ id: user.id, roles: user.roles });

/**
 * Phần A – Đợt 9 (YC2): lô yêu cầu đổi mốc của dòng SKU đã Sếp duyệt. KHSX xem lô của mình + huỷ yêu cầu; Sếp duyệt / từ chối; Sếp,
 * QLSX, Admin xem hết. Gửi lô là qua "Sửa thời hạn" (production-invoices) và Excel (deadline-plan), không có route tạo ở đây.
 */
@ApiTags('Deadline Changes')
@ApiBearerAuth()
@Controller({ path: 'deadline-changes', version: '1' })
export class DeadlineChangesController {
  constructor(private readonly deadlineChanges: DeadlineChangesService) {}

  @Get()
  @RequirePermissions(VIEW)
  list(@Query() query: ListDeadlineBatchesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.deadlineChanges.listBatches(actorOf(user), {
      status: query.status,
      mine: query.mine,
    });
  }

  // Khai TRƯỚC `:id` để 'items' không bị bắt thành id.
  @Get('items/:itemId/history')
  @RequirePermissions(VIEW)
  history(@Param('itemId') itemId: string) {
    return this.deadlineChanges.historyOf(itemId);
  }

  @Get(':id')
  @RequirePermissions(VIEW)
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.deadlineChanges.getBatch(actorOf(user), id);
  }

  @Post(':id/decide')
  @RequirePermissions(APPROVE)
  @RequireRole(BUSINESS_ROLES.BOSS)
  decide(
    @Param('id') id: string,
    @Body() dto: DecideDeadlineBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deadlineChanges.decide(actorOf(user), id, {
      approveRequestIds: dto.approveRequestIds,
      rejectReason: dto.rejectReason,
    });
  }

  @Post('requests/:requestId/cancel')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER, DEFAULT_ROLES.ADMIN)
  cancel(@Param('requestId') requestId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.deadlineChanges.cancelRequest(actorOf(user), requestId);
  }
}
