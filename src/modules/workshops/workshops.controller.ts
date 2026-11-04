import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { WorkshopsService } from './workshops.service';

@ApiTags('Workshops')
@ApiBearerAuth()
@Controller({ path: 'workshops', version: '1' })
export class WorkshopsController {
  constructor(private readonly workshopsService: WorkshopsService) {}

  @Get()
  @RequirePermissions({
    module: PERMISSION_MODULES.PRODUCTION_INVOICE,
    action: PermissionAction.VIEW,
  })
  findAll() {
    return this.workshopsService.findActive();
  }
}
