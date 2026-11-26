import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAssignedWarehouse } from '../../common/decorators/require-assigned-warehouse.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BookingLoadService } from './booking-load.service';
import { ViTriKhoService } from './vi-tri-kho.service';
import {
  BulkCreateLocationsDto,
  CreateContainerDto,
  CreateLocationDto,
  FloorLocationScanQueryDto,
  ListMovementsQueryDto,
  MoveStockDto,
  PickDto,
  PutawayDto,
  SetLocationActiveDto,
  UnpickDto,
  UpdateContainerDto,
  ViTriKhoWarehouseQueryDto,
} from './dto/vi-tri-kho.dto';

// Kho Thành phẩm: cùng quyền các màn Chuyền kiểm / Đóng gói của kho (PRODUCTION_INVOICE VIEW xem, UPDATE ghi).
const PI_VIEW = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.VIEW };
const PI_UPDATE = {
  module: PERMISSION_MODULES.PRODUCTION_INVOICE,
  action: PermissionAction.UPDATE,
};
// Soạn hàng / cont theo booking: cùng quyền màn xuất booking (BookingShipmentsController) - chỉ thủ kho + Admin ghi.
const SO_VIEW = { module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.VIEW };
const SO_UPDATE = { module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.UPDATE };
const floorView = { module: PERMISSION_MODULES.FLOOR_REPORT, action: PermissionAction.VIEW };

/**
 * Vị trí kho Thành phẩm + soạn hàng theo booking + load từng cont (25/11/2026, docs THIET-KE-VI-TRI-KHO-LOAD-CONT, công tắc
 * VI_TRI_KHO_ENABLED). Mọi route đọc có `enabled`; route ghi trả 400 khi tắt.
 *  - `vi-tri-kho/locations*`, `stock`, `movements`, `move`, `putaway`: thủ kho Thành phẩm (tài khoản gắn kho; tổng kho xem theo warehouseCode).
 *  - `vi-tri-kho/floor/scan/:token`: công nhân Đóng gói quét tem ô ở màn /floor (báo đóng gói ghi qua ck-dg/scan/:ws/packing).
 *  - `vi-tri-kho/bookings/:id/*`, `vi-tri-kho/containers/:id/*`: thủ kho Thành phẩm của kho gom hàng soạn hàng, load cont.
 */
@ApiTags('Vị trí kho Thành phẩm / load cont')
@ApiBearerAuth()
@Controller({ path: 'vi-tri-kho', version: '1' })
export class ViTriKhoController {
  constructor(
    private readonly service: ViTriKhoService,
    private readonly load: BookingLoadService,
  ) {}

  /** Công tắc cho FE (mọi tài khoản đăng nhập). */
  @Get('config')
  config() {
    return this.service.getConfig();
  }

  // ─── Công nhân Đóng gói ──────────────────────────────────────────────────────────────────

  @Get('floor/scan/:token')
  @RequirePermissions(floorView)
  @RequireMfgRole(MfgRole.DONG_GOI)
  floorScan(
    @Param('token') token: string,
    @Query() query: FloorLocationScanQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.floorScan(token, user, query.ws, query.itemId);
  }

  // ─── Thủ kho Thành phẩm: ô, tồn, chuyển ô ──────────────────────────────────────────────────

  @Get('locations')
  @RequirePermissions(PI_VIEW)
  locations(
    @Query() query: ViTriKhoWarehouseQueryDto,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.listLocations(scope, query.warehouseCode);
  }

  /** Tra ô theo tem quét (token hoặc nguyên link tem). Đặt TRƯỚC 'locations/:id'. */
  @Get('locations/by-token/:token')
  @RequirePermissions(PI_VIEW)
  byToken(@Param('token') token: string, @CurrentUser('warehouseScope') scope: string | null) {
    return this.service.lookupByToken(token, scope);
  }

  @Post('locations')
  @RequireAssignedWarehouse()
  @RequirePermissions(PI_UPDATE)
  createLocation(
    @Body() dto: CreateLocationDto,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.createLocation(dto, scope);
  }

  @Post('locations/bulk')
  @RequireAssignedWarehouse()
  @RequirePermissions(PI_UPDATE)
  bulkCreate(
    @Body() dto: BulkCreateLocationsDto,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.bulkCreate(dto, scope);
  }

  @Patch('locations/:id')
  @RequireAssignedWarehouse()
  @RequirePermissions(PI_UPDATE)
  setActive(
    @Param('id') id: string,
    @Body() dto: SetLocationActiveDto,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.setActive(id, dto.isActive, scope);
  }

  /** V4 "Tồn kho thùng": theo bộ 3 + dòng tổng, chỉ phần còn lại. */
  @Get('stock')
  @RequirePermissions(PI_VIEW)
  stock(
    @Query() query: ViTriKhoWarehouseQueryDto,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.stockByTriple(scope, query.warehouseCode);
  }

  @Get('movements')
  @RequirePermissions(PI_VIEW)
  movements(
    @Query() query: ListMovementsQueryDto,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.movements(query, scope);
  }

  @Post('move')
  @HttpCode(HttpStatus.OK)
  @RequireAssignedWarehouse()
  @RequirePermissions(PI_UPDATE)
  move(
    @Body() dto: MoveStockDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.move(dto, user.id, user.warehouseScope, idempotencyKey);
  }

  @Post('putaway')
  @HttpCode(HttpStatus.OK)
  @RequireAssignedWarehouse()
  @RequirePermissions(PI_UPDATE)
  putaway(
    @Body() dto: PutawayDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.putaway(dto, user.id, user.warehouseScope, idempotencyKey);
  }

  // ─── Soạn hàng theo booking + cont ───────────────────────────────────────────────────────

  @Get('bookings/:id/pick-list')
  @RequirePermissions(SO_VIEW)
  pickList(@Param('id') id: string, @CurrentUser('warehouseScope') scope: string | null) {
    return this.load.pickList(id, scope);
  }

  @Post('bookings/:id/pick')
  @HttpCode(HttpStatus.OK)
  @RequireAssignedWarehouse()
  @RequirePermissions(SO_UPDATE)
  @RequireRole(BUSINESS_ROLES.WAREHOUSE_STAFF, DEFAULT_ROLES.ADMIN)
  pick(
    @Param('id') id: string,
    @Body() dto: PickDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.load.pick(id, dto, user.id, user.warehouseScope, idempotencyKey);
  }

  @Post('bookings/:id/containers')
  @RequireAssignedWarehouse()
  @RequirePermissions(SO_UPDATE)
  @RequireRole(BUSINESS_ROLES.WAREHOUSE_STAFF, DEFAULT_ROLES.ADMIN)
  createContainer(
    @Param('id') id: string,
    @Body() dto: CreateContainerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.load.createContainer(id, dto, user.id, user.warehouseScope);
  }

  @Patch('containers/:id')
  @RequireAssignedWarehouse()
  @RequirePermissions(SO_UPDATE)
  @RequireRole(BUSINESS_ROLES.WAREHOUSE_STAFF, DEFAULT_ROLES.ADMIN)
  updateContainer(
    @Param('id') id: string,
    @Body() dto: UpdateContainerDto,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.load.updateContainer(id, dto, scope);
  }

  @Delete('containers/:id')
  @RequireAssignedWarehouse()
  @RequirePermissions(SO_UPDATE)
  @RequireRole(BUSINESS_ROLES.WAREHOUSE_STAFF, DEFAULT_ROLES.ADMIN)
  deleteContainer(@Param('id') id: string, @CurrentUser('warehouseScope') scope: string | null) {
    return this.load.deleteContainer(id, scope);
  }

  @Post('containers/:id/return')
  @HttpCode(HttpStatus.OK)
  @RequireAssignedWarehouse()
  @RequirePermissions(SO_UPDATE)
  @RequireRole(BUSINESS_ROLES.WAREHOUSE_STAFF, DEFAULT_ROLES.ADMIN)
  unpick(
    @Param('id') id: string,
    @Body() dto: UnpickDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.load.unpick(id, dto, user.id, user.warehouseScope, idempotencyKey);
  }

  @Post('containers/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequireAssignedWarehouse()
  @RequirePermissions(SO_UPDATE)
  @RequireRole(BUSINESS_ROLES.WAREHOUSE_STAFF, DEFAULT_ROLES.ADMIN)
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.load.closeContainer(id, user.id, user.warehouseScope);
  }

  @Post('containers/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @RequireAssignedWarehouse()
  @RequirePermissions(SO_UPDATE)
  @RequireRole(BUSINESS_ROLES.WAREHOUSE_STAFF, DEFAULT_ROLES.ADMIN)
  reopen(@Param('id') id: string, @CurrentUser('warehouseScope') scope: string | null) {
    return this.load.reopenContainer(id, scope);
  }
}
