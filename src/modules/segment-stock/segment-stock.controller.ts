import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { SegmentBalanceQueryDto } from './dto/segment-balance-query.dto';
import { SegmentBalanceResponseDto } from './dto/segment-balance-response.dto';
import { SegmentOrderHoldingsResponseDto } from './dto/segment-order-holdings-response.dto';
import { SegmentStockService } from './segment-stock.service';

/** Chỉ đọc: tồn đoạn kho Phôi theo mã đoạn + giữ đoạn theo lệnh (13/11/2026). Ghi đi qua SegmentStockService / KCS / báo sản lượng. */
@ApiTags('Segment Stock')
@ApiBearerAuth()
@Controller({ path: 'segment-stock', version: '1' })
export class SegmentStockController {
  constructor(private readonly segmentStockService: SegmentStockService) {}

  @Get('balances')
  @RequirePermissions({ module: PERMISSION_MODULES.STOCK, action: PermissionAction.VIEW })
  getBalances(@Query() query: SegmentBalanceQueryDto): Promise<SegmentBalanceResponseDto[]> {
    return this.segmentStockService.getBalances({
      warehouseId: query.warehouseId ? parseBigIntId(query.warehouseId) : undefined,
      materialId: query.materialId ? parseBigIntId(query.materialId) : undefined,
      segmentSpecId: query.segmentSpecId ? parseBigIntId(query.segmentSpecId) : undefined,
    });
  }

  @Get('orders/:productionInvoiceId')
  @RequirePermissions({ module: PERMISSION_MODULES.STOCK, action: PermissionAction.VIEW })
  getOrderHoldings(
    @Param('productionInvoiceId') productionInvoiceId: string,
  ): Promise<SegmentOrderHoldingsResponseDto> {
    return this.segmentStockService.getOrderHoldings(parseBigIntId(productionInvoiceId));
  }
}
