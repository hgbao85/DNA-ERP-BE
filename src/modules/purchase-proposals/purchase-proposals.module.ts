import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { UploadsModule } from '../uploads/uploads.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PurchaseProposalsController } from './purchase-proposals.controller';
import { PurchaseProposalsService } from './purchase-proposals.service';
import { PurchaseReceiptsController } from './purchase-receipts.controller';
import { PurchaseReceiptsService } from './purchase-receipts.service';
import { SupplierOrdersController } from './supplier-orders.controller';
import { SupplierOrdersService } from './supplier-orders.service';

@Module({
  imports: [StockModule, UploadsModule, NotificationsModule],
  controllers: [PurchaseProposalsController, SupplierOrdersController, PurchaseReceiptsController],
  providers: [PurchaseProposalsService, SupplierOrdersService, PurchaseReceiptsService],
  exports: [PurchaseProposalsService],
})
export class PurchaseProposalsModule {}
