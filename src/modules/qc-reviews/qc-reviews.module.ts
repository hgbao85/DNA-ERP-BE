import { Module } from '@nestjs/common';
import { ProductionBatchesModule } from '../production-batches/production-batches.module';
import { SteelIssuesModule } from '../steel-issues/steel-issues.module';
import { QcReviewsController } from './qc-reviews.controller';
import { QcReviewsService } from './qc-reviews.service';

@Module({
  imports: [SteelIssuesModule, ProductionBatchesModule],
  controllers: [QcReviewsController],
  providers: [QcReviewsService],
})
export class QcReviewsModule {}
