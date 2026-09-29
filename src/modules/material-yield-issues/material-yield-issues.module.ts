import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { MaterialYieldIssuesController } from './material-yield-issues.controller';
import { MaterialYieldIssuesService } from './material-yield-issues.service';

@Module({
  imports: [StockModule],
  controllers: [MaterialYieldIssuesController],
  providers: [MaterialYieldIssuesService],
  exports: [MaterialYieldIssuesService],
})
export class MaterialYieldIssuesModule {}
