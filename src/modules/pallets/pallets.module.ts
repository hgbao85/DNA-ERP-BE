import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StageHandoverModule } from '../stage-handover/stage-handover.module';
import { PalletsController } from './pallets.controller';
import { PalletsService } from './pallets.service';

/**
 * Pallet Sơn (24/11/2026 - docs THIET-KE-PALLET-SON-2026-11-24), bật bằng PALLET_SON_ENABLED. Chỉ phụ thuộc thông báo +
 * giao nhận giữa tổ (trần "Sơn đã nhận") - màn quét công nhân (FloorModule) và phiếu XK (IssueSlipsModule) import module này,
 * không ngược lại.
 */
@Module({
  imports: [NotificationsModule, StageHandoverModule],
  controllers: [PalletsController],
  providers: [PalletsService],
  exports: [PalletsService],
})
export class PalletsModule {}
