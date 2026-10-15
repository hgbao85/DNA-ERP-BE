import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductionBatchesModule } from '../production-batches/production-batches.module';
import { SteelIssuesModule } from '../steel-issues/steel-issues.module';
import { FloorAdminService } from './floor-admin.service';
import { FloorAlertsService } from './floor-alerts.service';
import { FloorController } from './floor.controller';
import { FloorRealtimeInterceptor } from './floor-realtime.interceptor';
import { FloorReviewService } from './floor-review.service';
import { FloorScanService } from './floor-scan.service';
import { FloorStatsService } from './floor-stats.service';

/** QR tại máy (2026-10-13) - xem FloorController. */
@Module({
  imports: [SteelIssuesModule, ProductionBatchesModule, NotificationsModule],
  controllers: [FloorController],
  providers: [
    FloorAdminService,
    FloorScanService,
    FloorReviewService,
    FloorStatsService,
    FloorRealtimeInterceptor,
    FloorAlertsService,
  ],
})
export class FloorModule {}
