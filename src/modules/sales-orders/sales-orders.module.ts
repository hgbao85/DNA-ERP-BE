import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';

@Module({
  // Phần A – Đợt 10a: đăng ký controller bookings theo module nghiệp vụ Sales.
  imports: [BookingsModule],
  controllers: [SalesOrdersController],
  providers: [SalesOrdersService],
  exports: [SalesOrdersService],
})
export class SalesOrdersModule {}
