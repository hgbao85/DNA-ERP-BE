import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DataHealthController } from './data-health.controller';
import { DataHealthService } from './data-health.service';

@Module({
  imports: [NotificationsModule],
  controllers: [DataHealthController],
  providers: [DataHealthService],
  // DailyJobsService gọi run('CRON') mỗi ngày 1 lần (hẹn giờ trong app, 2026-10-29).
  exports: [DataHealthService],
})
export class DataHealthModule {}
