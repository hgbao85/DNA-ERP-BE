import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StockModule } from '../stock/stock.module';
import { WarehouseTransfersController } from './warehouse-transfers.controller';
import { WarehouseTransfersService } from './warehouse-transfers.service';

@Module({
  imports: [StockModule, NotificationsModule],
  controllers: [WarehouseTransfersController],
  providers: [WarehouseTransfersService],
})
export class WarehouseTransfersModule {}
