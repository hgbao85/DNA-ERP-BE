import { Module } from '@nestjs/common';
import { BomRevisionsModule } from '../bom-revisions/bom-revisions.module';
import { PlanFormsController } from './plan-forms.controller';
import { PlanFormsService } from './plan-forms.service';

@Module({
  imports: [BomRevisionsModule],
  controllers: [PlanFormsController],
  providers: [PlanFormsService],
  exports: [PlanFormsService],
})
export class PlanFormsModule {}
