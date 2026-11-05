import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingAlertsService } from './booking-alerts.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

/** Phần A – Đợt 10a (YC5): Booking / Lịch xuất hàng (phần Sales). Không import SalesOrdersModule / DailyJobsModule (tránh vòng). */
@Module({
  imports: [NotificationsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingAlertsService],
  exports: [BookingsService, BookingAlertsService],
})
export class BookingsModule {}
