import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SteelIssuesController } from './steel-issues.controller';
import { SteelIssuesService } from './steel-issues.service';

@Module({
  imports: [StockModule, NotificationsModule],
  controllers: [SteelIssuesController],
  providers: [SteelIssuesService],
  exports: [SteelIssuesService],
})
export class SteelIssuesModule {}
