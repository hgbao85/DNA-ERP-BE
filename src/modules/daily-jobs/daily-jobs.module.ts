import { Module } from '@nestjs/common';
import { DataHealthModule } from '../data-health/data-health.module';
import { MilestoneBoardModule } from '../milestone-board/milestone-board.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DailyJobsService } from './daily-jobs.service';

@Module({
  imports: [DataHealthModule, MilestoneBoardModule, NotificationsModule],
  providers: [DailyJobsService],
})
export class DailyJobsModule {}
