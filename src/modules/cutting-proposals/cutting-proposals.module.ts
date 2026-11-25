import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { SegmentStockModule } from '../segment-stock/segment-stock.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CuttingProposalsController } from './cutting-proposals.controller';
import { CuttingProposalsService } from './cutting-proposals.service';
import { SolverClientService } from './solver-client.service';

@Module({
  imports: [StockModule, NotificationsModule, SegmentStockModule],
  controllers: [CuttingProposalsController],
  providers: [CuttingProposalsService, SolverClientService],
  exports: [CuttingProposalsService],
})
export class CuttingProposalsModule {}
