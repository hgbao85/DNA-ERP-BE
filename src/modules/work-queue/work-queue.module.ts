import { Module } from '@nestjs/common';
import { CuttingProposalsModule } from '../cutting-proposals/cutting-proposals.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { WorkQueueController } from './work-queue.controller';
import { WorkQueueService } from './work-queue.service';

@Module({
  imports: [CuttingProposalsModule, SalesOrdersModule],
  controllers: [WorkQueueController],
  providers: [WorkQueueService],
})
export class WorkQueueModule {}
