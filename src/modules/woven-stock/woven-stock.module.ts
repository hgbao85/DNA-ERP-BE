import { Module } from '@nestjs/common';
import { WovenStockService } from './woven-stock.service';

/** Tồn khung đan của SKU đã huỷ (Q6 huỷ lệnh, 26/11/2026) - xem WovenStockService. */
@Module({
  providers: [WovenStockService],
  exports: [WovenStockService],
})
export class WovenStockModule {}
