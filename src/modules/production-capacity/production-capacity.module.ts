import { Module } from '@nestjs/common';
import { ProductionBatchesModule } from '../production-batches/production-batches.module';
import { ProductionInvoicesModule } from '../production-invoices/production-invoices.module';
import { SteelIssuesModule } from '../steel-issues/steel-issues.module';
import { WeavingIssuesModule } from '../weaving-issues/weaving-issues.module';
import { DailyOutputService } from './daily-output.service';
import { ProductionCapacityController } from './production-capacity.controller';
import { ProductionCapacityService } from './production-capacity.service';

/**
 * Phần A – Đợt 3 (YC10): năng lực + cảnh báo sản lượng ngày. KHÔNG đăng ký ở app.module.ts (file đang có thay đổi dở ở thư mục
 * chính): DailyJobsModule import module này nên controller vẫn được đăng ký. Không import vào ProductionInvoicesModule được vì
 * module này cần ProductionInvoicesService (tiến độ Chuyền kiểm) - sẽ thành vòng.
 */
@Module({
  imports: [
    SteelIssuesModule,
    ProductionBatchesModule,
    WeavingIssuesModule,
    ProductionInvoicesModule,
  ],
  controllers: [ProductionCapacityController],
  providers: [ProductionCapacityService, DailyOutputService],
  exports: [ProductionCapacityService, DailyOutputService],
})
export class ProductionCapacityModule {}
