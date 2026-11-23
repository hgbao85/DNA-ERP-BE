import { Module } from '@nestjs/common';
import { MaterialYieldRecipesModule } from '../material-yield-recipes/material-yield-recipes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductionBatchesModule } from '../production-batches/production-batches.module';
import { SteelIssuesModule } from '../steel-issues/steel-issues.module';
import { WarehouseTransfersModule } from '../warehouse-transfers/warehouse-transfers.module';
import { CutAllocationFollowUpService } from './cut-allocation-follow-up.service';
import { CutAllocationService } from './cut-allocation.service';
import { CutMachineStatsService } from './cut-machine-stats.service';
import { FloorAdminService } from './floor-admin.service';
import { FloorAlertsService } from './floor-alerts.service';
import { FloorController } from './floor.controller';
import { FloorRealtimeInterceptor } from './floor-realtime.interceptor';
import { FloorReviewService } from './floor-review.service';
import { FloorScanService } from './floor-scan.service';
import { FloorStageService } from './floor-stage.service';
import { FloorStatsService } from './floor-stats.service';

/** QR tại máy - xem FloorController. */
@Module({
  imports: [
    SteelIssuesModule,
    ProductionBatchesModule,
    // P1: KCS chốt nhóm chân nhôm (MaterialYieldRecipeProductionService.submitStep). Module này chỉ import Stock / Notifications -> không vòng.
    MaterialYieldRecipesModule,
    NotificationsModule,
    WarehouseTransfersModule,
  ],
  controllers: [FloorController],
  providers: [
    FloorAdminService,
    CutAllocationService,
    CutAllocationFollowUpService,
    CutMachineStatsService,
    FloorScanService,
    FloorStageService,
    FloorReviewService,
    FloorStatsService,
    FloorRealtimeInterceptor,
    FloorAlertsService,
  ],
  // IssueSlipsModule gọi requestEvaluate sau khi thủ kho xuất sắt.
  exports: [FloorAlertsService],
})
export class FloorModule {}
