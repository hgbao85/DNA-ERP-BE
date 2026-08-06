import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ProductionOrdersService } from './production-orders.service';

const VIEW = { module: PERMISSION_MODULES.PRODUCTION_ORDER, action: PermissionAction.VIEW };

/**
 * Chỉ đọc - ProductionOrder tự sinh khi Sếp duyệt PI item (xem
 * ProductionInvoicesService.approveItem), không có endpoint tạo/release thủ công ở bản này.
 */
@ApiTags('Production Orders')
@ApiBearerAuth()
@Controller({ path: 'production-orders', version: '1' })
export class ProductionOrdersController {
  constructor(private readonly productionOrdersService: ProductionOrdersService) {}

  @Get()
  @RequirePermissions(VIEW)
  findAll(@Query() query: PaginationQueryDto) {
    return this.productionOrdersService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.productionOrdersService.findOne(id);
  }
}
