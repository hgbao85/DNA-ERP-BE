import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkQueueService } from './work-queue.service';

/** `/me/work-queue` - không gắn `@RequirePermissions` (khác mọi controller khác trong repo) vì
 *  đây LÀ "việc chờ CHÍNH người gọi", không phải dữ liệu của người khác - PermissionsGuard tự bỏ
 *  qua (pass-through) khi handler không khai decorator đó, xem permissions.guard.ts. Vẫn qua
 *  JwtAuthGuard toàn cục như mọi route khác (bắt buộc đăng nhập). */
@ApiTags('Me')
@ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
export class WorkQueueController {
  constructor(private readonly workQueueService: WorkQueueService) {}

  @Get('work-queue')
  getWorkQueue(
    @CurrentUser('roles') roles: string[],
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.workQueueService.getWorkQueue({ roles, warehouseScope });
  }
}
