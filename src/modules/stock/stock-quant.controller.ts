import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ListStockQuantQueryDto } from './dto/list-stock-quant-query.dto';
import { StockQuantService } from './stock-quant.service';

@ApiTags('Stock Quant')
@ApiBearerAuth()
@Controller({ path: 'stock-quant', version: '1' })
export class StockQuantController {
  constructor(private readonly stockQuantService: StockQuantService) {}

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.STOCK, action: PermissionAction.VIEW })
  findAll(@Query() query: ListStockQuantQueryDto) {
    return this.stockQuantService.findAll(query);
  }
}
