import { Module } from '@nestjs/common';
import { MaterialIssuesModule } from '../material-issues/material-issues.module';
import { SteelIssuesModule } from '../steel-issues/steel-issues.module';
import { StockModule } from '../stock/stock.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WeavingIssuesModule } from '../weaving-issues/weaving-issues.module';
import { PackagingIssuesModule } from '../packaging-issues/packaging-issues.module';
import { MaterialYieldIssuesModule } from '../material-yield-issues/material-yield-issues.module';
import { MaterialYieldRecipesModule } from '../material-yield-recipes/material-yield-recipes.module';
import { IssueSlipsController } from './issue-slips.controller';
import { IssueSlipsService } from './issue-slips.service';

@Module({
  imports: [
    StockModule,
    SteelIssuesModule,
    MaterialIssuesModule,
    WeavingIssuesModule,
    NotificationsModule,
    PackagingIssuesModule,
    MaterialYieldIssuesModule,
    MaterialYieldRecipesModule,
  ],
  controllers: [IssueSlipsController],
  providers: [IssueSlipsService],
})
export class IssueSlipsModule {}
