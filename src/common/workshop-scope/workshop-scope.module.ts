import { Global, Module } from '@nestjs/common';
import { WorkshopScopeService } from './workshop-scope.service';

/** Dùng chung cho mọi module cần lọc/chặn theo xưởng phụ trách của tài khoản (QLSX theo xưởng). */
@Global()
@Module({
  providers: [WorkshopScopeService],
  exports: [WorkshopScopeService],
})
export class WorkshopScopeModule {}
