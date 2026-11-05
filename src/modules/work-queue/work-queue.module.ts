import { Module } from '@nestjs/common';
import { CuttingProposalsModule } from '../cutting-proposals/cutting-proposals.module';
import { MaterialsDueModule } from '../materials-due/materials-due.module'; // Phần A – Đợt 4
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { WorkQueueController } from './work-queue.controller';
import { WorkQueueService } from './work-queue.service';

@Module({
  imports: [CuttingProposalsModule, SalesOrdersModule, MaterialsDueModule],
  controllers: [WorkQueueController],
  providers: [WorkQueueService],
})
export class WorkQueueModule {}
