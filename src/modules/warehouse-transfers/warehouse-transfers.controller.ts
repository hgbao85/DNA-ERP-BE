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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreatePieceWarehouseTransferDto } from './dto/create-piece-warehouse-transfer.dto';
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
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    // Vấn đề #7/#11 audit 26/08 - trước đây create() không nhận userId (không lưu được ai tạo)
    // và không có Idempotency-Key nào (khác material-issues/packaging-issues/steel-issues).
    if (!idempotencyKey) {
      throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    }
    return this.warehouseTransfersService.create(dto, warehouseScope, userId, idempotencyKey);
  }

  // Piece-only (mảnh/vật tư thành phẩm) - tách khỏi create() (vật tư tiêu hao), mục 7.5.
  @Post('piece-transfer')
  @RequirePermissions(CREATE)
  createPieceTransfer(
    @Body() dto: CreatePieceWarehouseTransferDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    }
    return this.warehouseTransfersService.createPieceTransfer(
      dto,
      warehouseScope,
      userId,
      idempotencyKey,
    );
  }

  // Đặt TRƯỚC @Get(':id') - "piece-transfer-plan" phải khớp route cố định này, không rơi vào :id.
  @Get('piece-transfer-plan')
  @RequirePermissions(VIEW)
  getPieceTransferPlan(@Query('productionOrderIds') productionOrderIds?: string) {
    if (!productionOrderIds) {
      throw new BadRequestException(
        'Query productionOrderIds là bắt buộc (phân tách bởi dấu phẩy)',
      );
    }
    const ids = productionOrderIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    return this.warehouseTransfersService.getPieceTransferPlan(ids);
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
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.warehouseTransfersService.reject(id, dto.rejectionReason, warehouseScope, userId);
  }
}
