import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { ProductionOrdersService } from './production-orders.service';

const VIEW = { module: PERMISSION_MODULES.PRODUCTION_ORDER, action: PermissionAction.VIEW };
const UPDATE = { module: PERMISSION_MODULES.PRODUCTION_ORDER, action: PermissionAction.UPDATE };

/**
 * ProductionOrder tự sinh khi Sếp duyệt PI item (xem ProductionInvoicesService.approveItem),
 * không có endpoint tạo/release thủ công ở bản này. 2 route floor-start/floor-finish (2026-08-31)
 * KHÔNG phải "release" - chỉ đổi floorStage (hiển thị bên Hàn/Sơn/Phôi), độc lập với `status`.
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

  /** QLSX bấm "Bắt đầu" (PENDING) hoặc "Tiếp tục" (PAUSED) ở "Bảng thống kê" -> ACTIVE, xem
   *  ProductionOrdersService.startFloor(). */
  @Post(':id/floor-start')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_MANAGER)
  startFloor(@Param('id') id: string) {
    return this.productionOrdersService.startFloor(id);
  }

  /** QLSX bấm "Tạm dừng" - bất kỳ trạng thái nào -> PAUSED, xem ProductionOrdersService.pauseFloor(). */
  @Post(':id/floor-pause')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_MANAGER)
  pauseFloor(@Param('id') id: string) {
    return this.productionOrdersService.pauseFloor(id);
  }

  /** QLSX bấm "Kết thúc" - bất kỳ trạng thái nào -> FINISHED, không kiểm tra tiến độ. */
  @Post(':id/floor-finish')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_MANAGER)
  finishFloor(@Param('id') id: string) {
    return this.productionOrdersService.finishFloor(id);
  }
}
