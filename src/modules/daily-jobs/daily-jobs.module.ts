import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { DataHealthModule } from '../data-health/data-health.module';
import { MaterialsDueModule } from '../materials-due/materials-due.module'; // Phần A – Đợt 4
import { MilestoneBoardModule } from '../milestone-board/milestone-board.module';
import { NotificationsModule } from '../notifications/notifications.module';
// Phần A – Đợt 3: cảnh báo sản lượng ngày (tin sáng) + đăng ký controller năng lực (không sửa app.module.ts).
import { ProductionCapacityModule } from '../production-capacity/production-capacity.module';
import { DailyJobsService } from './daily-jobs.service';

@Module({
  imports: [
    DataHealthModule,
    MilestoneBoardModule,
    NotificationsModule,
    ProductionCapacityModule,
    BookingsModule,
    MaterialsDueModule,
  ],
  providers: [DailyJobsService],
})
export class DailyJobsModule {}
