import { Module } from '@nestjs/common';
import { ExternalApiModule } from '../external/external-api.module';
import { StockModule } from '../stock/stock.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CuttingProposalsController } from './cutting-proposals.controller';
import { CuttingProposalsService } from './cutting-proposals.service';

@Module({
  imports: [ExternalApiModule, StockModule, NotificationsModule],
  controllers: [CuttingProposalsController],
  providers: [CuttingProposalsService],
  exports: [CuttingProposalsService],
})
export class CuttingProposalsModule {}
