import { Module } from '@nestjs/common';
import { PlanFormsModule } from '../plan-forms/plan-forms.module';
import { ProductionInvoicesController } from './production-invoices.controller';
import { ProductionInvoicesService } from './production-invoices.service';

@Module({
  imports: [PlanFormsModule],
  controllers: [ProductionInvoicesController],
  providers: [ProductionInvoicesService],
  exports: [ProductionInvoicesService],
})
export class ProductionInvoicesModule {}
