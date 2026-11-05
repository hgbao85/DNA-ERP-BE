import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { MaterialsDueQueryDto } from './dto/materials-due-query.dto';
import { MaterialsDueService } from './materials-due.service';
import type { MaterialsDueResponse } from './materials-due.types';

/**
 * Phần A – Đợt 4 (YC6): "Vật tư cần về". Dùng quyền PURCHASE_PROPOSAL:VIEW sẵn có (Mua hàng, thủ kho, KHSX, QLSX, Sếp đều có)
 * nên không phải chạy seed quyền mới trên production. view = date thiếu / sai `date` → 400 (kiểm trong service).
 */
@ApiTags('Materials Due')
@Controller({ path: 'materials-due', version: '1' })
export class MaterialsDueController {
  constructor(private readonly materialsDueService: MaterialsDueService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Vật tư cần về: dòng mua chưa về đủ số chốt mua của các lệnh đang chạy, kèm hạn chót và ngày được về sớm nhất',
  })
  @RequirePermissions({
    module: PERMISSION_MODULES.PURCHASE_PROPOSAL,
    action: PermissionAction.VIEW,
  })
  list(
    @Query() query: MaterialsDueQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MaterialsDueResponse> {
    return this.materialsDueService.list(user, query);
  }
}
