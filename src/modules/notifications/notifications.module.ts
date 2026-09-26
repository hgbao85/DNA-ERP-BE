import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RecipientResolverService } from './recipient-resolver.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, RecipientResolverService],
  // NotificationsService: các module nghiệp vụ khác gọi .emit()/.resolve() (vd
  // CuttingProposalsModule) - phải import NotificationsModule để inject được.
  exports: [NotificationsService],
})
export class NotificationsModule {}
