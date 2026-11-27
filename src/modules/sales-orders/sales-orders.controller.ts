import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { CreateSalesOrderItemDto } from './dto/create-sales-order-item.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { UpdateSalesOrderItemDto } from './dto/update-sales-order-item.dto';
import { CancelSalesOrderItemDto } from './dto/cancel-sales-order-item.dto';
import { SalesOrdersService } from './sales-orders.service';

@ApiTags('Sales Orders')
@ApiBearerAuth()
@Controller({ path: 'sales-orders', version: '1' })
export class SalesOrdersController {
  constructor(private readonly salesOrdersService: SalesOrdersService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.CREATE })
  @RequireRole(BUSINESS_ROLES.SALES_STAFF, DEFAULT_ROLES.ADMIN)
  create(@Body() dto: CreateSalesOrderDto) {
    return this.salesOrdersService.create(dto);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.VIEW })
  findAll(@Query() query: PaginationQueryDto) {
    return this.salesOrdersService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.VIEW })
  findOne(@Param('id') id: string) {
    return this.salesOrdersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.UPDATE })
  @RequireRole(BUSINESS_ROLES.SALES_STAFF, DEFAULT_ROLES.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateSalesOrderDto) {
    return this.salesOrdersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.DELETE })
  @RequireRole(BUSINESS_ROLES.SALES_STAFF, DEFAULT_ROLES.ADMIN)
  remove(@Param('id') id: string) {
    return this.salesOrdersService.remove(id);
  }

  // ─── Nested: SalesOrderItem ─────────────────────────────────────────────────

  @Post(':id/items')
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.UPDATE })
  @RequireRole(BUSINESS_ROLES.SALES_STAFF, DEFAULT_ROLES.ADMIN)
  addItem(@Param('id') id: string, @Body() dto: CreateSalesOrderItemDto) {
    return this.salesOrdersService.addItem(id, dto);
  }

  @Patch(':id/items/:itemId')
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.UPDATE })
  @RequireRole(BUSINESS_ROLES.SALES_STAFF, DEFAULT_ROLES.ADMIN)
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateSalesOrderItemDto,
  ) {
    return this.salesOrdersService.updateItem(id, itemId, dto);
  }

  /** Huỷ lệnh câu 2 (nghiệp vụ 24/11/2026): khách huỷ hẳn - Sales huỷ 1 dòng đơn (kèm lý do). */
  @Post(':id/items/:itemId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.UPDATE })
  @RequireRole(BUSINESS_ROLES.SALES_STAFF, DEFAULT_ROLES.ADMIN)
  cancelItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: CancelSalesOrderItemDto,
  ) {
    return this.salesOrdersService.cancelItem(id, itemId, dto);
  }

  // Đợt 10b (5.7): bỏ nút "Xuất giao" - mọi lần xuất hàng đi qua booking (POST /booking-shipments/:id/ship).
  // 2026-11-19 (lỗi C1): mọi route GHI của sales-orders chỉ Sales + Admin. WAREHOUSE_STAFF (vai nền của mọi
  // tài khoản văn phòng) vẫn giữ SALES_ORDER:UPDATE cho /booking-shipments nên phải chặn theo vai trò ở đây.
  // Route đọc (GET) giữ nguyên, chỉ cần SALES_ORDER:VIEW.
}
