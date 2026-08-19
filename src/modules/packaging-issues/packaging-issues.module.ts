import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { PackagingIssuesController } from './packaging-issues.controller';
import { PackagingIssuesService } from './packaging-issues.service';

@Module({
  imports: [StockModule],
  controllers: [PackagingIssuesController],
  providers: [PackagingIssuesService],
  exports: [PackagingIssuesService],
})
export class PackagingIssuesModule {}
