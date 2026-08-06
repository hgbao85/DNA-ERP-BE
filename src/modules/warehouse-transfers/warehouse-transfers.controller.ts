import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateWarehouseTransferDto } from './dto/create-warehouse-transfer.dto';
import { ListWarehouseTransfersQueryDto } from './dto/list-warehouse-transfers-query.dto';
import { RejectWarehouseTransferDto } from './dto/reject-warehouse-transfer.dto';
import { WarehouseTransfersService } from './warehouse-transfers.service';

const VIEW = { module: PERMISSION_MODULES.WAREHOUSE_TRANSFER, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.WAREHOUSE_TRANSFER, action: PermissionAction.CREATE };
const APPROVE = { module: PERMISSION_MODULES.WAREHOUSE_TRANSFER, action: PermissionAction.APPROVE };

@ApiTags('Warehouse Transfers')
@ApiBearerAuth()
@Controller({ path: 'warehouse-transfers', version: '1' })
export class WarehouseTransfersController {
  constructor(private readonly warehouseTransfersService: WarehouseTransfersService) {}

  @Post()
  @RequirePermissions(CREATE)
  create(
    @Body() dto: CreateWarehouseTransferDto,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.warehouseTransfersService.create(dto, warehouseScope);
  }

  @Get()
  @RequirePermissions(VIEW)
  findAll(
    @Query() query: ListWarehouseTransfersQueryDto,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.warehouseTransfersService.findAll(query, warehouseScope);
  }

  @Get(':id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string, @CurrentUser('warehouseScope') warehouseScope: string | null) {
    return this.warehouseTransfersService.findOne(id, warehouseScope);
  }

  // Kho đích xác nhận - ghi N bút toán stock_ledger, giải phóng reservation.
  @Post(':id/confirm')
  @RequirePermissions(APPROVE)
  confirm(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.warehouseTransfersService.confirm(id, userId, warehouseScope);
  }

  // Kho đích từ chối - không đụng tồn kho, chỉ giải phóng reservation.
  @Post(':id/reject')
  @RequirePermissions(APPROVE)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectWarehouseTransferDto,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.warehouseTransfersService.reject(id, dto.rejectionReason, warehouseScope);
  }
}
