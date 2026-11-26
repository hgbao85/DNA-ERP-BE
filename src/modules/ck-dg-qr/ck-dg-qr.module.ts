import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductionInvoicesModule } from '../production-invoices/production-invoices.module';
import { ViTriKhoModule } from '../vi-tri-kho/vi-tri-kho.module';
import { CkDgQrController } from './ck-dg-qr.controller';
import { CkDgQrService } from './ck-dg-qr.service';

/**
 * Chuyền kiểm + Đóng gói bằng quét QR (24/11/2026), bật bằng CK_DG_QR_ENABLED. Phụ thuộc ProductionInvoicesModule (ghi đóng gói
 * qua recordPackagingEntry) + thông báo; không module nào khác phụ thuộc ngược (work-queue đếm qua CkDgQrService).
 */
@Module({
  imports: [ProductionInvoicesModule, NotificationsModule, ViTriKhoModule],
  controllers: [CkDgQrController],
  providers: [CkDgQrService],
  exports: [CkDgQrService],
})
export class CkDgQrModule {}
