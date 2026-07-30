import { Module } from '@nestjs/common';
import { SegmentSpecsController } from './segment-specs.controller';
import { SegmentSpecsService } from './segment-specs.service';

@Module({
  controllers: [SegmentSpecsController],
  providers: [SegmentSpecsService],
  exports: [SegmentSpecsService],
})
export class SegmentSpecsModule {}
