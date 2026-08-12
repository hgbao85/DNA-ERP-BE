import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { MaterialIssuesController } from './material-issues.controller';
import { MaterialIssuesService } from './material-issues.service';

@Module({
  imports: [StockModule],
  controllers: [MaterialIssuesController],
  providers: [MaterialIssuesService],
  exports: [MaterialIssuesService],
})
export class MaterialIssuesModule {}
