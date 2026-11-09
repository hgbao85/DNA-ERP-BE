import { Module } from '@nestjs/common';
import { ProductionBatchesModule } from '../production-batches/production-batches.module';
import { SteelIssuesModule } from '../steel-issues/steel-issues.module';
import { PieceSyncBoardController } from './piece-sync-board.controller';
import { PieceSyncBoardService } from './piece-sync-board.service';

@Module({
  imports: [SteelIssuesModule, ProductionBatchesModule],
  controllers: [PieceSyncBoardController],
  providers: [PieceSyncBoardService],
})
export class PieceSyncBoardModule {}
