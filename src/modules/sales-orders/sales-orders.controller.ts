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
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { CreateSalesOrderItemDto } from './dto/create-sales-order-item.dto';
import { ShipSalesOrderItemDto } from './dto/ship-sales-order-item.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { UpdateSalesOrderItemDto } from './dto/update-sales-order-item.dto';
import { SalesOrdersService } from './sales-orders.service';

@ApiTags('Sales Orders')
@ApiBearerAuth()
@Controller({ path: 'sales-orders', version: '1' })
export class SalesOrdersController {
  constructor(private readonly salesOrdersService: SalesOrdersService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.CREATE })
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
  update(@Param('id') id: string, @Body() dto: UpdateSalesOrderDto) {
    return this.salesOrdersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.DELETE })
  remove(@Param('id') id: string) {
    return this.salesOrdersService.remove(id);
  }

  // ─── Nested: SalesOrderItem ─────────────────────────────────────────────────

  @Post(':id/items')
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.UPDATE })
  addItem(@Param('id') id: string, @Body() dto: CreateSalesOrderItemDto) {
    return this.salesOrdersService.addItem(id, dto);
  }

  @Patch(':id/items/:itemId')
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.UPDATE })
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateSalesOrderItemDto,
  ) {
    return this.salesOrdersService.updateItem(id, itemId, dto);
  }

  @Post(':id/items/:itemId/ship')
  @RequirePermissions({ module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.UPDATE })
  shipItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ShipSalesOrderItemDto,
  ) {
    return this.salesOrdersService.shipItem(id, itemId, dto);
  }
}
