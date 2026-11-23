import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../../common/constants/roles.constant';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../../common/decorators/require-role.decorator';
import { AuthenticatedUser } from '../../../common/interfaces/jwt-payload.interface';
import {
  CreateOrderCancelRequestDto,
  DecideOrderCancelRequestDto,
  ListOrderCancelRequestsQueryDto,
} from './order-cancellation.dto';
import { OrderCancellationService } from './order-cancellation.service';

const VIEW = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.VIEW };
const UPDATE = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.UPDATE };
const APPROVE = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.APPROVE };

const actorOf = (user: AuthenticatedUser) => ({ id: user.id, roles: user.roles });

/**
 * Huỷ lệnh theo SKU - đợt 1 (23/11/2026): KHSX (hoặc Admin) đề nghị huỷ 1 lệnh sản xuất kèm lý do / rút lại; Sếp duyệt hoặc từ
 * chối. Cùng cách gác quyền với đổi mốc (DeadlineChangesController) - không cần quyền mới.
 */
@ApiTags('Production Order Cancellations')
@ApiBearerAuth()
@Controller({ path: 'production-order-cancellations', version: '1' })
export class OrderCancellationController {
  constructor(private readonly service: OrderCancellationService) {}

  @Get()
  @RequirePermissions(VIEW)
  list(@Query() query: ListOrderCancelRequestsQueryDto) {
    return this.service.list(query);
  }

  @Post()
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER, DEFAULT_ROLES.ADMIN)
  create(@Body() dto: CreateOrderCancelRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.request(actorOf(user), dto);
  }

  @Post(':id/withdraw')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER, DEFAULT_ROLES.ADMIN)
  withdraw(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.withdraw(actorOf(user), id);
  }

  @Post(':id/decide')
  @RequirePermissions(APPROVE)
  @RequireRole(BUSINESS_ROLES.BOSS)
  decide(
    @Param('id') id: string,
    @Body() dto: DecideOrderCancelRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.decide(actorOf(user), id, dto);
  }
}
