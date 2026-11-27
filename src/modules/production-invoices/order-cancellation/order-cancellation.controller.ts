import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../../common/constants/roles.constant';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../../common/decorators/require-role.decorator';
import { RequireAssignedWarehouse } from '../../../common/decorators/require-assigned-warehouse.decorator';
import { AuthenticatedUser } from '../../../common/interfaces/jwt-payload.interface';
import {
  ConfirmSteelReturnDto,
  ConfirmWovenReceivedDto,
  CreateOrderCancelRequestDto,
  DecideCutDto,
  TransferCancelledGoodsDto,
  DecideOrderCancelRequestDto,
  ListOrderCancelRequestsQueryDto,
} from './order-cancellation.dto';
import { OrderCancellationService } from './order-cancellation.service';
import { CancelledGoodsService } from './cancelled-goods.service';

const VIEW = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.VIEW };
const UPDATE = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.UPDATE };
/** Q3: QLSX chỉ có PRODUCTION_ORDER:UPDATE (không có PRODUCTION_INVOICE:UPDATE). */
const ORDER_UPDATE = {
  module: PERMISSION_MODULES.PRODUCTION_ORDER,
  action: PermissionAction.UPDATE,
};
const APPROVE = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.APPROVE };
const STOCK_VIEW = { module: PERMISSION_MODULES.STOCK, action: PermissionAction.VIEW };
const STOCK_UPDATE = { module: PERMISSION_MODULES.STOCK, action: PermissionAction.UPDATE };

const actorOf = (user: AuthenticatedUser) => ({ id: user.id, roles: user.roles });

/**
 * Huỷ lệnh theo SKU - đợt 1 (23/11/2026): KHSX (hoặc Admin) đề nghị huỷ 1 lệnh sản xuất kèm lý do / rút lại; Sếp duyệt hoặc từ
 * chối. Cùng cách gác quyền với đổi mốc (DeadlineChangesController) - không cần quyền mới.
 */
@ApiTags('Production Order Cancellations')
@ApiBearerAuth()
@Controller({ path: 'production-order-cancellations', version: '1' })
export class OrderCancellationController {
  constructor(
    private readonly service: OrderCancellationService,
    private readonly goods: CancelledGoodsService,
  ) {}

  @Get()
  @RequirePermissions(VIEW)
  list(@Query() query: ListOrderCancelRequestsQueryDto) {
    return this.service.list(query);
  }

  /**
   * Q5/Q6 (quản lý trả lời 24/11/2026): hàng đã đóng gói / khung đã đan của SKU đã huỷ còn chuyển được + dòng SKU nhận được.
   * 26/11/2026: Sếp (BOSS) được XEM danh sách (giám sát, chỉ đọc) - trước đây sếp mở màn "Hàng SKU đã huỷ" trong Kế hoạch SX bị
   * 403. Việc CHUYỂN hàng (transfer-goods bên dưới) vẫn chỉ KHSX và Admin.
   */
  @Get('goods')
  @RequirePermissions(VIEW)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER, BUSINESS_ROLES.BOSS, DEFAULT_ROLES.ADMIN)
  listGoods() {
    return this.goods.list();
  }

  @Post(':id/transfer-goods')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER, DEFAULT_ROLES.ADMIN)
  transferGoods(
    @Param('id') id: string,
    @Body() dto: TransferCancelledGoodsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.goods.transfer(user.id, id, dto);
  }

  /** Q3 (nghiệp vụ 24/11/2026): SKU đã huỷ còn sắt ở tổ cắt - QLSX quyết cắt tiếp hay ngưng + nhập trả cây. */
  /** Nghiệp vụ 26/11 câu 2: sắt tổ cắt trả về chờ thủ kho Phôi xác nhận. */
  @Get('steel-returns/pending')
  @RequirePermissions(STOCK_VIEW)
  pendingSteelReturns(@CurrentUser('warehouseScope') warehouseScope: string | null) {
    return this.service.listPendingSteelReturns(warehouseScope);
  }

  @Post('steel-returns/:id/confirm')
  @RequireAssignedWarehouse()
  @RequirePermissions(STOCK_UPDATE)
  confirmSteelReturn(
    @Param('id') id: string,
    @Body() dto: ConfirmSteelReturnDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.service.confirmSteelReturn(actorOf(user), id, dto.countedBars, warehouseScope);
  }

  /** Nghiệp vụ 26/11 câu 1: khung đan lấy khác kho thành phẩm - đang chuyển, chờ thủ kho nơi nhận xác nhận. */
  @Get('woven-transfers/pending')
  @RequirePermissions(STOCK_VIEW)
  wovenInTransit(@CurrentUser('warehouseScope') warehouseScope: string | null) {
    return this.goods.listWovenInTransit(warehouseScope);
  }

  @Post('woven-transfers/:id/receive')
  @RequireAssignedWarehouse()
  @RequirePermissions(STOCK_UPDATE)
  confirmWovenReceived(
    @Param('id') id: string,
    @Body() dto: ConfirmWovenReceivedDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.goods.confirmWovenReceived(
      userId,
      id,
      dto.signedSlipUrls,
      warehouseScope,
      dto.receivedQty,
    );
  }

  @Get('cut-steel')
  @RequirePermissions(VIEW)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_MANAGER, DEFAULT_ROLES.ADMIN)
  cutSteel() {
    return this.service.listCutSteel();
  }

  @Post(':id/cut-decision')
  @RequirePermissions(ORDER_UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_MANAGER, DEFAULT_ROLES.ADMIN)
  decideCut(
    @Param('id') id: string,
    @Body() dto: DecideCutDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.decideCut(actorOf(user), id, dto);
  }

  /** Câu 8 (nghiệp vụ 24/11/2026): sắt đã xuất, dòng mua đã ký (kèm tiền), hàng từng công đoạn - cho hộp duyệt của Sếp. */
  @Get(':id/impact')
  @RequirePermissions(VIEW)
  impact(@Param('id') id: string) {
    return this.service.impact(id);
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
