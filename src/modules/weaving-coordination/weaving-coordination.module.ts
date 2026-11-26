import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { WeavingCoordinationController } from './weaving-coordination.controller';
import { WeavingCoordinationService } from './weaving-coordination.service';
import { WeavingFollowUpReminderService } from './weaving-follow-up-reminder.service';

/**
 * Điều phối đan (25/11/2026), bật bằng DIEU_PHOI_DAN_ENABLED. Phụ thuộc Prisma + NotificationsModule. Chỉ đọc
 * weaving_issues / weaving_receipts - không đụng luồng xuất đan / nhập đan.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [WeavingCoordinationController],
  providers: [WeavingCoordinationService, WeavingFollowUpReminderService],
  exports: [WeavingCoordinationService, WeavingFollowUpReminderService],
})
export class WeavingCoordinationModule {}
