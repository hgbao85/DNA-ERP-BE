import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SegmentOveragesController } from './segment-overages.controller';
import { SegmentOveragesService } from './segment-overages.service';

@Module({
  imports: [NotificationsModule],
  controllers: [SegmentOveragesController],
  providers: [SegmentOveragesService],
})
export class SegmentOveragesModule {}
