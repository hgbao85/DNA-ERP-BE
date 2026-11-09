import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingAlertsService } from './booking-alerts.service';
import { BookingShipmentsController } from './booking-shipments.controller';
import { BookingShipmentsService } from './booking-shipments.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

/** Phần A – Đợt 10a (YC5): Booking / Lịch xuất hàng (phần Sales). Không import SalesOrdersModule / DailyJobsModule (tránh vòng). */
@Module({
  imports: [NotificationsModule],
  controllers: [BookingsController, BookingShipmentsController],
  providers: [BookingsService, BookingAlertsService, BookingShipmentsService],
  exports: [BookingsService, BookingAlertsService],
})
export class BookingsModule {}
