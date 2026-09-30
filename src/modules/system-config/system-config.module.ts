import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SystemConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';

@Module({
  imports: [NotificationsModule],
  controllers: [SystemConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
