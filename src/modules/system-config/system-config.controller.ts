import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { SystemConfigService } from './system-config.service';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { UpdateMaxWasteDto } from './dto/update-max-waste.dto';

@ApiTags('System Config')
@ApiBearerAuth()
@Controller({ path: 'system-config', version: '1' })
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.SYSTEM_CONFIG, action: PermissionAction.VIEW })
  findOne() {
    return this.systemConfigService.findOne();
  }

  /**
   * Ngưỡng hao hụt mặc định cho cắt sắt - KHSX đọc/đổi ngay ở "Tối ưu cắt sắt" (2026-09-30). Dùng
   * quyền CUTTING_PROPOSAL (KHSX có sẵn) thay vì SYSTEM_CONFIG (chỉ Admin): cấp SYSTEM_CONFIG:UPDATE
   * cho KHSX sẽ mở luôn PUT / (sửa cả thông tin công ty, chiều dài cây, thời gian solver...).
   */
  @Get('cutting-defaults')
  @RequirePermissions({
    module: PERMISSION_MODULES.CUTTING_PROPOSAL,
    action: PermissionAction.VIEW,
  })
  getCuttingDefaults() {
    return this.systemConfigService.getCuttingDefaults();
  }

  @Put('cutting-defaults/max-waste')
  @RequirePermissions({
    module: PERMISSION_MODULES.CUTTING_PROPOSAL,
    action: PermissionAction.CREATE,
  })
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER, DEFAULT_ROLES.ADMIN)
  updateMaxWaste(@Body() dto: UpdateMaxWasteDto, @CurrentUser('id') userId: string) {
    return this.systemConfigService.updateMaxWastePercentage(dto, userId);
  }

  @Put()
  @RequirePermissions({
    module: PERMISSION_MODULES.SYSTEM_CONFIG,
    action: PermissionAction.UPDATE,
  })
  update(@Body() dto: UpdateSystemConfigDto) {
    return this.systemConfigService.update(dto);
  }
}
