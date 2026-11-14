import { Module } from '@nestjs/common';
import { SegmentOveragesController } from './segment-overages.controller';
import { SegmentOveragesService } from './segment-overages.service';

@Module({
  controllers: [SegmentOveragesController],
  providers: [SegmentOveragesService],
})
export class SegmentOveragesModule {}
