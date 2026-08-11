import { Module } from '@nestjs/common';
import { SteelIssuesController } from './steel-issues.controller';
import { SteelIssuesService } from './steel-issues.service';

@Module({
  controllers: [SteelIssuesController],
  providers: [SteelIssuesService],
  exports: [SteelIssuesService],
})
export class SteelIssuesModule {}
