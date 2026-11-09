import { Module } from '@nestjs/common';
import { MaterialIssuesModule } from '../material-issues/material-issues.module';
import { SteelIssuesModule } from '../steel-issues/steel-issues.module';
import { StockModule } from '../stock/stock.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WeavingIssuesModule } from '../weaving-issues/weaving-issues.module';
import { IssueSlipsController } from './issue-slips.controller';
import { IssueSlipsService } from './issue-slips.service';

@Module({
  imports: [
    StockModule,
    SteelIssuesModule,
    MaterialIssuesModule,
    WeavingIssuesModule,
    NotificationsModule,
  ],
  controllers: [IssueSlipsController],
  providers: [IssueSlipsService],
})
export class IssueSlipsModule {}
