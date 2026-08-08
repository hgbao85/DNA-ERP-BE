import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { PurchaseProposalsController } from './purchase-proposals.controller';
import { PurchaseProposalsService } from './purchase-proposals.service';

@Module({
  imports: [StockModule],
  controllers: [PurchaseProposalsController],
  providers: [PurchaseProposalsService],
  exports: [PurchaseProposalsService],
})
export class PurchaseProposalsModule {}
