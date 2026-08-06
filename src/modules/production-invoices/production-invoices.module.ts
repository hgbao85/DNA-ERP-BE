import { Module } from '@nestjs/common';
import { CuttingProposalsModule } from '../cutting-proposals/cutting-proposals.module';
import { ProductionOrdersModule } from '../production-orders/production-orders.module';
import { SkusModule } from '../skus/skus.module';
import { ProductionInvoicesController } from './production-invoices.controller';
import { ProductionInvoicesService } from './production-invoices.service';

@Module({
  imports: [SkusModule, ProductionOrdersModule, CuttingProposalsModule],
  controllers: [ProductionInvoicesController],
  providers: [ProductionInvoicesService],
  exports: [ProductionInvoicesService],
})
export class ProductionInvoicesModule {}
