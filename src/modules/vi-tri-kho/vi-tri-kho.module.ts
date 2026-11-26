import { Module } from '@nestjs/common';
import { BookingLoadService } from './booking-load.service';
import { ViTriKhoController } from './vi-tri-kho.controller';
import { ViTriKhoService } from './vi-tri-kho.service';

/**
 * Vị trí kho Thành phẩm + soạn hàng theo booking + load từng cont (25/11/2026), bật bằng VI_TRI_KHO_ENABLED. Chỉ phụ thuộc Prisma.
 * CkDgQrModule dùng ViTriKhoService (cất khi báo đóng gói); BookingsModule chỉ import hàm thuần booking-ship-guard.ts (không vòng).
 */
@Module({
  controllers: [ViTriKhoController],
  providers: [ViTriKhoService, BookingLoadService],
  exports: [ViTriKhoService],
})
export class ViTriKhoModule {}
