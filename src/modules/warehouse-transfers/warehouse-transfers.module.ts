import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { WarehouseTransfersController } from './warehouse-transfers.controller';
import { WarehouseTransfersService } from './warehouse-transfers.service';

@Module({
  imports: [StockModule],
  controllers: [WarehouseTransfersController],
  providers: [WarehouseTransfersService],
})
export class WarehouseTransfersModule {}
