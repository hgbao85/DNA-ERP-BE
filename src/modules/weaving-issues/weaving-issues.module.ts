import { Module } from '@nestjs/common';
import { WeavingIssuesController } from './weaving-issues.controller';
import { WeavingIssuesService } from './weaving-issues.service';

@Module({
  controllers: [WeavingIssuesController],
  providers: [WeavingIssuesService],
  exports: [WeavingIssuesService],
})
export class WeavingIssuesModule {}
