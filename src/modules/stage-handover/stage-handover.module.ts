import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SegmentStockModule } from '../segment-stock/segment-stock.module';
import { StockModule } from '../stock/stock.module';
import { StageHandoverController } from './stage-handover.controller';
import { StageHandoverService } from './stage-handover.service';

/**
 * Giao nhận giữa tổ (24/11/2026 - docs THIET-KE-GIAO-NHAN-GIUA-TO-2026-11-24), bật bằng STAGE_HANDOVER_ENABLED. Chỉ phụ
 * thuộc tồn đoạn / sổ kho / thông báo - phiếu XK (IssueSlipsModule), báo sản lượng (ProductionBatchesModule) và màn quét
 * (FloorModule) import module này, không ngược lại.
 */
@Module({
  imports: [StockModule, SegmentStockModule, NotificationsModule],
  controllers: [StageHandoverController],
  providers: [StageHandoverService],
  exports: [StageHandoverService],
})
export class StageHandoverModule {}
