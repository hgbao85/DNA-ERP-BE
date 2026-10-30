import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DataHealthService } from './data-health.service';

/**
 * "Kiểm tra dữ liệu" (2026-10-28, changelog 2026-09-25 mục 32.19-32.20). Dùng quyền SYSTEM_CONFIG có sẵn thay vì thêm quyền mới -
 * quyền mới phải chạy seed tay trên production. Xem: ai có SYSTEM_CONFIG VIEW (Admin, và cả Sếp trên production - người dùng
 * chốt giữ nguyên, 32.27); bấm chạy: SYSTEM_CONFIG UPDATE (chỉ Admin).
 */
@ApiTags('Data Health')
@Controller({ path: 'data-health', version: '1' })
export class DataHealthController {
  constructor(private readonly dataHealthService: DataHealthService) {}

  @Get()
  @ApiBearerAuth()
  @RequirePermissions({ module: PERMISSION_MODULES.SYSTEM_CONFIG, action: PermissionAction.VIEW })
  getReport() {
    return this.dataHealthService.getReport();
  }

  /** Admin bấm "Kiểm ngay". */
  @Post('run')
  @HttpCode(200)
  @ApiBearerAuth()
  @RequirePermissions({ module: PERMISSION_MODULES.SYSTEM_CONFIG, action: PermissionAction.UPDATE })
  run(@CurrentUser('id') userId: string) {
    return this.dataHealthService.run('MANUAL', userId);
  }
  // Lần tự chạy hằng ngày do DailyJobsService gọi thẳng service (hẹn giờ trong app, 2026-10-29) - không có route công khai.
}
