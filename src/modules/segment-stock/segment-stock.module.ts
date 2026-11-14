import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { SegmentProductionController } from './segment-production.controller';
import { SegmentProductionService } from './segment-production.service';
import { SegmentStockController } from './segment-stock.controller';
import { SegmentStockService } from './segment-stock.service';
import { SegmentStocktakeController } from './segment-stocktake.controller';
import { SegmentStocktakeService } from './segment-stocktake.service';

/**
 * Tồn đoạn kho Phôi theo MÃ ĐOẠN và giữ đoạn theo LỆNH (13/11/2026, anh Nhân trả lời 11 câu tồn đoạn) - xem
 * segment-stock.types.ts (mô hình tồn / còn giữ / dư) và migration 20261113180000_segment_stock_by_order.
 *  - SegmentStockService: giữ đoạn theo lệnh, cột dư, chia dư, nhả khi lệnh kết thúc, đọc số dư. Phía trừ (Hàn/Sơn) gọi
 *    consumeForOrder().
 *  - SegmentProductionService: phía cộng - sau KCS tính đoạn đủ công đoạn của lệnh rồi ghi phần chênh.
 * Chỉ phụ thuộc StockModule (ghi sổ kho) - module khác (KCS, lệnh sản xuất, báo sản lượng) import module này, không ngược lại.
 */
@Module({
  imports: [StockModule],
  controllers: [SegmentStockController, SegmentProductionController, SegmentStocktakeController],
  providers: [SegmentStockService, SegmentProductionService, SegmentStocktakeService],
  exports: [SegmentStockService, SegmentProductionService],
})
export class SegmentStockModule {}
