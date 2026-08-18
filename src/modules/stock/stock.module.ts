import { Module } from '@nestjs/common';
import { StockLedgerController } from './stock-ledger.controller';
import { StockLedgerService } from './stock-ledger.service';
import { StockQuantController } from './stock-quant.controller';
import { StockQuantService } from './stock-quant.service';
import { StockReservationsService } from './stock-reservations.service';

@Module({
  controllers: [StockLedgerController, StockQuantController],
  providers: [StockLedgerService, StockQuantService, StockReservationsService],
  // StockLedgerService.postEntry() is the shared write path every later phase (Purchasing,
  // Phôi/Hàn/Sơn/KCS, Weaving, WarehouseTransfers) injects to post ledger entries.
  // StockReservationsService.reserve()/getAvailableQty() - xem thiết kế B4, mục 13 changelog
  // 2026-08-15 - CuttingProposalsService là caller đầu tiên (Đợt 1).
  exports: [StockLedgerService, StockReservationsService],
})
export class StockModule {}
