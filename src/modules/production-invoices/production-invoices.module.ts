import { Module } from '@nestjs/common';
import { SkusModule } from '../skus/skus.module';
import { ProductionInvoicesController } from './production-invoices.controller';
import { ProductionInvoicesService } from './production-invoices.service';

@Module({
  imports: [SkusModule],
  controllers: [ProductionInvoicesController],
  providers: [ProductionInvoicesService],
  exports: [ProductionInvoicesService],
})
export class ProductionInvoicesModule {}
