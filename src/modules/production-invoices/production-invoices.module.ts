import { Module } from '@nestjs/common';
import { CuttingProposalsModule } from '../cutting-proposals/cutting-proposals.module';
import { ProductionBatchesModule } from '../production-batches/production-batches.module';
import { ProductionOrdersModule } from '../production-orders/production-orders.module';
import { ConsumableMaterialPurchaseService } from './consumable-material-purchase.service';
import { PieceMaterialYieldPurchaseService } from './piece-material-yield-purchase.service';
import { ProductionInvoicesController } from './production-invoices.controller';
import { ProductionInvoicesService } from './production-invoices.service';

@Module({
  imports: [ProductionOrdersModule, CuttingProposalsModule, ProductionBatchesModule],
  controllers: [ProductionInvoicesController],
  providers: [
    ProductionInvoicesService,
    PieceMaterialYieldPurchaseService,
    ConsumableMaterialPurchaseService,
  ],
  exports: [ProductionInvoicesService],
})
export class ProductionInvoicesModule {}
