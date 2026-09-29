import { Module } from '@nestjs/common';
import { BomRevisionsModule } from '../bom-revisions/bom-revisions.module';
import { UploadsModule } from '../uploads/uploads.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SkusController } from './skus.controller';
import { SkusService } from './skus.service';

@Module({
  imports: [BomRevisionsModule, UploadsModule, NotificationsModule],
  controllers: [SkusController],
  providers: [SkusService],
  exports: [SkusService],
})
export class SkusModule {}
