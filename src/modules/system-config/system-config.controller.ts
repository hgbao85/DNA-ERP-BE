import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SystemConfigService } from './system-config.service';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';

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

  @Put()
  @RequirePermissions({
    module: PERMISSION_MODULES.SYSTEM_CONFIG,
    action: PermissionAction.UPDATE,
  })
  update(@Body() dto: UpdateSystemConfigDto) {
    return this.systemConfigService.update(dto);
  }
}
