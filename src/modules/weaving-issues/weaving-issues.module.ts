import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { WeavingIssuesController } from './weaving-issues.controller';
import { WeavingIssuesService } from './weaving-issues.service';

@Module({
  imports: [StockModule],
  controllers: [WeavingIssuesController],
  providers: [WeavingIssuesService],
  exports: [WeavingIssuesService],
})
export class WeavingIssuesModule {}
