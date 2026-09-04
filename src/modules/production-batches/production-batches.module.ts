import { Module } from '@nestjs/common';
import { MaterialYieldIssuesModule } from '../material-yield-issues/material-yield-issues.module';
import { StockModule } from '../stock/stock.module';
import { ProductionBatchesController } from './production-batches.controller';
import { ProductionBatchesService } from './production-batches.service';

@Module({
  // MaterialYieldIssuesModule cho recordPieceStepBatch()/create() chặn "chưa nhận vật tư thì chưa
  // báo được" (2026-09-04) - xem MaterialYieldIssuesService.sumReceived().
  imports: [StockModule, MaterialYieldIssuesModule],
  controllers: [ProductionBatchesController],
  providers: [ProductionBatchesService],
  exports: [ProductionBatchesService],
})
export class ProductionBatchesModule {}
