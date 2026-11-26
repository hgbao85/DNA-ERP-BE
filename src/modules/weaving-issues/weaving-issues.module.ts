import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StockModule } from '../stock/stock.module';
import { WovenStockModule } from '../woven-stock/woven-stock.module';
import { WeavingIssuesController } from './weaving-issues.controller';
import { WeavingIssuesService } from './weaving-issues.service';

@Module({
  imports: [StockModule, NotificationsModule, WovenStockModule],
  controllers: [WeavingIssuesController],
  providers: [WeavingIssuesService],
  exports: [WeavingIssuesService],
})
export class WeavingIssuesModule {}
