import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { SteelIssuesController } from './steel-issues.controller';
import { SteelIssuesService } from './steel-issues.service';

@Module({
  imports: [StockModule],
  controllers: [SteelIssuesController],
  providers: [SteelIssuesService],
  exports: [SteelIssuesService],
})
export class SteelIssuesModule {}
