import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { ProductionBatchesController } from './production-batches.controller';
import { ProductionBatchesService } from './production-batches.service';

@Module({
  imports: [StockModule],
  controllers: [ProductionBatchesController],
  providers: [ProductionBatchesService],
  exports: [ProductionBatchesService],
})
export class ProductionBatchesModule {}
