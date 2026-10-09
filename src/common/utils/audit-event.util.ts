import { Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AuditAction, PrismaClient } from '../../generated/prisma/client';
import { writeAuditLog } from '../../prisma/extensions/audit-log.extension';
import { AppClsStore } from '../interfaces/cls-store.interface';

/**
 * Ghi AuditLog THỦ CÔNG cho 1 sự kiện nghiệp vụ mà bảng không nằm trong AUDITED_MODELS (hoặc ghi bằng
 * `updateMany`/raw SQL nên extension audit không thấy) - P2 mục 31 changelog notification: xuất giao hàng, nhánh vật tư
 * thành phẩm, mốc kế hoạch. Gọi SAU KHI việc chính đã commit; best-effort (lỗi chỉ log) để audit hỏng không chặn thao tác
 * của xưởng - khác các nơi ghi audit TRONG transaction nghiệp vụ.
 */
export async function auditEvent(
  prisma: unknown,
  cls: ClsService<AppClsStore>,
  logger: Logger,
  entry: {
    action: AuditAction;
    tableName: string;
    recordId: string | bigint;
    oldValue?: unknown;
    newValue?: unknown;
  },
): Promise<void> {
  try {
    await writeAuditLog(prisma as Pick<PrismaClient, 'auditLog'>, cls, {
      ...entry,
      recordId: entry.recordId.toString(),
    });
  } catch (error) {
    logger.error(
      `Không ghi được audit ${entry.tableName}#${entry.recordId.toString()}: ${(error as Error).message}`,
    );
  }
}
