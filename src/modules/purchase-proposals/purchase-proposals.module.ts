import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { UploadsModule } from '../uploads/uploads.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PurchaseProposalsController } from './purchase-proposals.controller';
import { PurchaseProposalsService } from './purchase-proposals.service';

@Module({
  imports: [StockModule, UploadsModule, NotificationsModule],
  controllers: [PurchaseProposalsController],
  providers: [PurchaseProposalsService],
  exports: [PurchaseProposalsService],
})
export class PurchaseProposalsModule {}
