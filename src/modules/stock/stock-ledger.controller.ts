import { BadRequestException, Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { ListStockLedgerQueryDto } from './dto/list-stock-ledger-query.dto';
import { StockLedgerService } from './stock-ledger.service';

const VIEW = { module: PERMISSION_MODULES.STOCK, action: PermissionAction.VIEW };
const UPDATE = { module: PERMISSION_MODULES.STOCK, action: PermissionAction.UPDATE };

@ApiTags('Stock Ledger')
@ApiBearerAuth()
@Controller({ path: 'stock-ledger', version: '1' })
export class StockLedgerController {
  constructor(private readonly stockLedgerService: StockLedgerService) {}

  @Get()
  @RequirePermissions(VIEW)
  findAll(@Query() query: ListStockLedgerQueryDto) {
    return this.stockLedgerService.findAll(query);
  }

  // Ngoại lệ duy nhất được ghi stock_ledger qua HTTP công khai - mọi bút toán khác đi qua
  // StockLedgerService.postEntry() nội bộ, gọi từ service nghiệp vụ tương ứng.
  @Post('adjust')
  @RequirePermissions(UPDATE)
  adjust(
    @Body() dto: CreateStockAdjustmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    }
    return this.stockLedgerService.adjust(dto, idempotencyKey, userId, warehouseScope);
  }
}
