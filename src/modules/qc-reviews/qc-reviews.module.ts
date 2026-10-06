import { Module } from '@nestjs/common';
import { MaterialYieldRecipesModule } from '../material-yield-recipes/material-yield-recipes.module';
import { ProductionBatchesModule } from '../production-batches/production-batches.module';
import { SteelIssuesModule } from '../steel-issues/steel-issues.module';
import { UploadsModule } from '../uploads/uploads.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QcReviewsController } from './qc-reviews.controller';
import { QcReviewsService } from './qc-reviews.service';

@Module({
  imports: [
    SteelIssuesModule,
    ProductionBatchesModule,
    MaterialYieldRecipesModule,
    UploadsModule,
    NotificationsModule,
  ],
  controllers: [QcReviewsController],
  providers: [QcReviewsService],
})
export class QcReviewsModule {}
