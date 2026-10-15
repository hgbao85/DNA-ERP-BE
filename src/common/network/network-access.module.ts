import { Global, Module } from '@nestjs/common';
import { NetworkAccessGuard } from './network-access.guard';
import { NetworkAccessService } from './network-access.service';

/** Giới hạn mạng công ty (2026-10-13) - @Global để AuthService/SystemConfigService inject được mà không phải import ở từng module. */
@Global()
@Module({
  providers: [NetworkAccessService, NetworkAccessGuard],
  exports: [NetworkAccessService, NetworkAccessGuard],
})
export class NetworkAccessModule {}
