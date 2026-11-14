import { Module } from '@nestjs/common';
import { MaterialYieldIssuesModule } from '../material-yield-issues/material-yield-issues.module';
import { StockModule } from '../stock/stock.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SegmentStockModule } from '../segment-stock/segment-stock.module';
import { ProductionBatchesController } from './production-batches.controller';
import { ProductionBatchesService } from './production-batches.service';
import { SegmentLegacyConversionController } from './segment-legacy-conversion.controller';
import { SegmentLegacyConversionService } from './segment-legacy-conversion.service';

@Module({
  // MaterialYieldIssuesModule cho recordPieceStepBatch()/create() chặn "chưa nhận vật tư thì chưa
  // báo được" (2026-09-04) - xem MaterialYieldIssuesService.sumReceived().
  imports: [StockModule, MaterialYieldIssuesModule, NotificationsModule, SegmentStockModule],
  controllers: [ProductionBatchesController, SegmentLegacyConversionController],
  // Chuyển đổi tồn đoạn cũ (13/11/2026) - cần phía trừ (service này) + phía cộng (SegmentStockModule).
  providers: [ProductionBatchesService, SegmentLegacyConversionService],
  exports: [ProductionBatchesService],
})
export class ProductionBatchesModule {}
