import { Module } from '@nestjs/common';
import { SteelIssuesModule } from '../steel-issues/steel-issues.module';
import { QcReviewsController } from './qc-reviews.controller';
import { QcReviewsService } from './qc-reviews.service';

@Module({
  imports: [SteelIssuesModule],
  controllers: [QcReviewsController],
  providers: [QcReviewsService],
})
export class QcReviewsModule {}
