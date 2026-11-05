import { Module } from '@nestjs/common';
import { DataHealthModule } from '../data-health/data-health.module';
import { MilestoneBoardModule } from '../milestone-board/milestone-board.module';
import { NotificationsModule } from '../notifications/notifications.module';
// Phần A – Đợt 3: cảnh báo sản lượng ngày (tin sáng) + đăng ký controller năng lực (không sửa app.module.ts).
import { ProductionCapacityModule } from '../production-capacity/production-capacity.module';
import { DailyJobsService } from './daily-jobs.service';

@Module({
  imports: [DataHealthModule, MilestoneBoardModule, NotificationsModule, ProductionCapacityModule],
  providers: [DailyJobsService],
})
export class DailyJobsModule {}
