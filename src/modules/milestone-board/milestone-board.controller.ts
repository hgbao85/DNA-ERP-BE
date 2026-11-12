import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MilestoneBoardService } from './milestone-board.service';

/**
 * "Bảng mốc" (2026-10-29, changelog 2026-09-25 mục 32.24) - dùng quyền PRODUCTION_INVOICE:VIEW sẵn có (KHSX, QLSX, Sếp đều
 * có, cùng nhóm người xem "Tổng hợp lệnh SX") nên không phải chạy seed quyền mới trên production.
 */
@ApiTags('Milestone Board')
@Controller({ path: 'milestone-board', version: '1' })
export class MilestoneBoardController {
  constructor(private readonly milestoneBoardService: MilestoneBoardService) {}

  @Get()
  @ApiBearerAuth()
  @RequirePermissions({
    module: PERMISSION_MODULES.PRODUCTION_INVOICE,
    action: PermissionAction.VIEW,
  })
  getBoard(@CurrentUser('id') userId: string) {
    return this.milestoneBoardService.getBoard(new Date(), userId);
  }
}
