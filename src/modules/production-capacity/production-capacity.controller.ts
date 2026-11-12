import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CapacityCheckDto } from './dto/capacity-check.dto';
import { CapacityQueryDto } from './dto/capacity-query.dto';
import { ProductionCapacityService } from './production-capacity.service';

/**
 * Phần A – Đợt 3 (YC10): năng lực 1,3 cont/ngày - CHỈ CẢNH BÁO. Dùng quyền PRODUCTION_INVOICE:VIEW sẵn có (như Bảng mốc) nên
 * không phải chạy seed quyền mới.
 */
@ApiTags('Production Capacity')
@ApiBearerAuth()
@Controller({ path: 'production-capacity', version: '1' })
export class ProductionCapacityController {
  constructor(private readonly capacity: ProductionCapacityService) {}

  @Get()
  @RequirePermissions({
    module: PERMISSION_MODULES.PRODUCTION_INVOICE,
    action: PermissionAction.VIEW,
  })
  getBoard(@Query() query: CapacityQueryDto, @CurrentUser('id') userId: string) {
    return this.capacity.getBoard(query.from, query.to, undefined, userId);
  }

  @Post('check')
  @HttpCode(200)
  @RequirePermissions({
    module: PERMISSION_MODULES.PRODUCTION_INVOICE,
    action: PermissionAction.VIEW,
  })
  check(@Body() dto: CapacityCheckDto, @CurrentUser('id') userId: string) {
    return this.capacity.check(dto.items, userId);
  }
}
