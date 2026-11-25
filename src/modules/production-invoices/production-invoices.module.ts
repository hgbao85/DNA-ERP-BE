import { CancelledGoodsService } from './order-cancellation/cancelled-goods.service';
import { SegmentStockModule } from '../segment-stock/segment-stock.module';
import { WarehouseTransfersModule } from '../warehouse-transfers/warehouse-transfers.module';
import { Module } from '@nestjs/common';
import { CuttingProposalsModule } from '../cutting-proposals/cutting-proposals.module';
import { MaterialYieldRecipesModule } from '../material-yield-recipes/material-yield-recipes.module';
import { ProductionBatchesModule } from '../production-batches/production-batches.module';
import { ProductionOrdersModule } from '../production-orders/production-orders.module';
import { StockModule } from '../stock/stock.module';
import { WorkshopsModule } from '../workshops/workshops.module';
import { UploadsModule } from '../uploads/uploads.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeadlineChangesController } from './deadline-changes/deadline-changes.controller';
import { DeadlineChangesPort } from './deadline-changes/deadline-changes.port';
import { DeadlineChangesService } from './deadline-changes/deadline-changes.service';
import { DeadlinePlanController } from './deadline-changes/deadline-plan.controller';
import { DeadlinePlanExcelService } from './deadline-changes/deadline-plan-excel.service';
import { ItemDeadlineWriter } from './item-deadline-writer.service';
import { ConsumableMaterialPurchaseService } from './consumable-material-purchase.service';
import { MaterialYieldRecipePurchaseService } from './material-yield-recipe-purchase.service';
import { PieceMaterialYieldPurchaseService } from './piece-material-yield-purchase.service';
import { ProductionInvoicesController } from './production-invoices.controller';
import { ProductionInvoicesService } from './production-invoices.service';
import { OrderCancellationController } from './order-cancellation/order-cancellation.controller';
import { OrderCancellationService } from './order-cancellation/order-cancellation.service';

@Module({
  imports: [
    ProductionOrdersModule,
    CuttingProposalsModule,
    ProductionBatchesModule,
    MaterialYieldRecipesModule,
    UploadsModule,
    StockModule,
    NotificationsModule,
    WorkshopsModule, // Phần A – Đợt 2
    WarehouseTransfersModule, // Người B – đổi xưởng (10/11/2026)
    SegmentStockModule, // Huỷ lệnh đợt 2 - Q2: đoạn của SKU huỷ vào dư
  ],
  // Phần A – Đợt 9 (YC2): lõi đổi mốc + Excel kế hoạch
  controllers: [
    ProductionInvoicesController,
    DeadlineChangesController,
    DeadlinePlanController,
    // Huỷ lệnh theo SKU - đợt 1 (23/11/2026)
    OrderCancellationController,
  ],
  providers: [
    CancelledGoodsService, // Huỷ lệnh đợt 2 - Q5/Q6
    ProductionInvoicesService,
    PieceMaterialYieldPurchaseService,
    ConsumableMaterialPurchaseService,
    MaterialYieldRecipePurchaseService,
    // Phần A – Đợt 9 (YC2)
    ItemDeadlineWriter,
    DeadlineChangesService,
    { provide: DeadlineChangesPort, useExisting: DeadlineChangesService },
    DeadlinePlanExcelService,
    OrderCancellationService,
  ],
  exports: [ProductionInvoicesService, DeadlineChangesService, DeadlineChangesPort],
})
export class ProductionInvoicesModule {}
