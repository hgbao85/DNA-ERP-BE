import { Module } from '@nestjs/common';
import { ProductionBatchesModule } from '../production-batches/production-batches.module';
import { ProductionInvoicesModule } from '../production-invoices/production-invoices.module';
import { SteelIssuesModule } from '../steel-issues/steel-issues.module';
import { WeavingIssuesModule } from '../weaving-issues/weaving-issues.module';
import { MilestoneBoardController } from './milestone-board.controller';
import { MilestoneBoardService } from './milestone-board.service';

@Module({
  imports: [
    SteelIssuesModule,
    ProductionBatchesModule,
    WeavingIssuesModule,
    ProductionInvoicesModule,
  ],
  controllers: [MilestoneBoardController],
  providers: [MilestoneBoardService],
  // DailyJobsService đọc bảng để gửi tin sáng + cảnh báo nguy cơ trễ hạn giao.
  exports: [MilestoneBoardService],
})
export class MilestoneBoardModule {}
