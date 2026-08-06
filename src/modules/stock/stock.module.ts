import { Module } from '@nestjs/common';
import { StockLedgerController } from './stock-ledger.controller';
import { StockLedgerService } from './stock-ledger.service';
import { StockQuantController } from './stock-quant.controller';
import { StockQuantService } from './stock-quant.service';

@Module({
  controllers: [StockLedgerController, StockQuantController],
  providers: [StockLedgerService, StockQuantService],
  // StockLedgerService.postEntry() is the shared write path every later phase (Purchasing,
  // Phôi/Hàn/Sơn/KCS, Weaving, WarehouseTransfers) injects to post ledger entries.
  exports: [StockLedgerService],
})
export class StockModule {}
