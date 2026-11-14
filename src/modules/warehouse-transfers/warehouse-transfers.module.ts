import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SegmentStockModule } from '../segment-stock/segment-stock.module';
import { StockModule } from '../stock/stock.module';
import { WarehouseTransfersController } from './warehouse-transfers.controller';
import { WarehouseTransfersService } from './warehouse-transfers.service';
import { WorkshopMoveService } from './workshop-move.service';

@Module({
  imports: [StockModule, NotificationsModule, SegmentStockModule],
  controllers: [WarehouseTransfersController],
  providers: [WarehouseTransfersService, WorkshopMoveService],
  // Đổi xưởng (10/11/2026): ProductionInvoicesService.changeWorkshop() gọi WorkshopMoveService.afterWorkshopChanged().
  exports: [WorkshopMoveService],
})
export class WarehouseTransfersModule {}
