import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WeavingFollowUpPromiseStatus } from '../../generated/prisma/client';
import { vnDayKey } from '../../common/utils/floor-stats.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isDieuPhoiDanEnabled } from './weaving-coordination.config';
import { dbDayKey, weavingRowSums } from './weaving-coordination.read';
import { promiseAction } from './weaving-coordination.rules';
import {
  WEAVING_FOLLOW_UP_ENTITY,
  WEAVING_PROMISE_NOTIFICATION,
} from './weaving-coordination.service';

/** Lượt nhắc nền: 10 phút (cùng nhịp floor-alerts), lượt đầu 60 giây sau khi khởi động. */
const CHECK_INTERVAL_MS = 10 * 60_000;
const FIRST_RUN_MS = 60_000;

const fmtDay = (day: string) => {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
};

/**
 * Nhắc lời hẹn trả của điểm đan (Đ2, 25/11/2026). Mỗi lượt xét mọi lời hẹn OPEN / REMINDED:
 *  - về thêm từ lúc ghi (tổng đã trả bây giờ − tổng đã trả lúc ghi) ≥ số hẹn, hoặc điểm đan không còn giữ gì -> KEPT, đóng tin nhắc;
 *  - chưa đủ mà đã tới ngày hẹn (giờ VN) và chưa nhắc -> phát WEAVING_PROMISE_DUE cho người ghi rồi đánh REMINDED (nhắc 1 lần, tin mở
 *    tới khi hàng về đủ hoặc có lời hẹn mới).
 * Phát TRƯỚC rồi mới đánh dấu: phát lỗi thì lượt sau thử lại (dedupeKey theo id ghi chú nên không ra 2 tin).
 * Công tắc DIEU_PHOI_DAN_ENABLED tắt: không làm gì (đọc mỗi lượt). NODE_ENV=test hoặc FLOOR_ALERTS=off: không chạy nền (test gọi
 * thẳng syncAll()).
 */
@Injectable()
export class WeavingFollowUpReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeavingFollowUpReminderService.name);
  private interval: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.FLOOR_ALERTS === 'off') return;
    this.interval = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    this.interval.unref();
    this.first = setTimeout(() => void this.tick(), FIRST_RUN_MS);
    this.first.unref();
  }

  onModuleDestroy(): void {
    for (const t of [this.interval, this.first]) if (t) clearTimeout(t);
    this.interval = this.first = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.syncAll();
    } catch (e) {
      this.logger.error(`Weaving promise reminders failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** 1 lượt nhắc. Trả số lời hẹn vừa nhắc / vừa đóng (để test). Lỗi từng lời hẹn chỉ ghi log. */
  async syncAll(now = new Date()): Promise<{ reminded: number; closed: number }> {
    const result = { reminded: 0, closed: 0 };
    if (!isDieuPhoiDanEnabled()) return result;
    const today = vnDayKey(now);
    const open = await this.prisma.weavingFollowUp.findMany({
      where: {
        promiseStatus: {
          in: [WeavingFollowUpPromiseStatus.OPEN, WeavingFollowUpPromiseStatus.REMINDED],
        },
      },
      orderBy: { id: 'asc' },
      include: {
        weavingPoint: { select: { code: true, fullName: true } },
        productionOrder: {
          select: {
            poNumber: true,
            productionInvoiceItem: { select: { salesOrder: { select: { orderCode: true } } } },
          },
        },
        piece: { select: { name: true } },
      },
    });
    for (const f of open) {
      try {
        if (f.promisedQty == null || !f.promisedDate) continue;
        const sums = await weavingRowSums(
          this.prisma,
          f.productionOrderId,
          f.pieceId,
          f.weavingPointId,
        );
        const returnedSince = Math.max(0, sums.returned - f.returnedAtCreate);
        const promisedDay = dbDayKey(f.promisedDate);
        const action = promiseAction({
          status: f.promiseStatus === WeavingFollowUpPromiseStatus.OPEN ? 'OPEN' : 'REMINDED',
          promisedQty: f.promisedQty,
          promisedDay,
          returnedSince,
          heldNow: sums.held,
          today,
        });
        if (action === 'CLOSE_KEPT') {
          const done = await this.prisma.weavingFollowUp.updateMany({
            where: { id: f.id, promiseStatus: f.promiseStatus },
            data: { promiseStatus: WeavingFollowUpPromiseStatus.KEPT, closedAt: now },
          });
          await this.notifications.resolve({
            entityType: WEAVING_FOLLOW_UP_ENTITY,
            entityId: f.id.toString(),
            types: [WEAVING_PROMISE_NOTIFICATION],
          });
          if (done.count > 0) result.closed += 1;
        } else if (action === 'REMIND') {
          await this.notifications.emit(WEAVING_PROMISE_NOTIFICATION, {
            entityId: f.id.toString(),
            dedupeKey: `${WEAVING_PROMISE_NOTIFICATION}:${f.id}`,
            params: {
              followUpId: f.id.toString(),
              weavingPointId: f.weavingPointId.toString(),
              weavingPointName: f.weavingPoint.fullName?.trim() || f.weavingPoint.code,
              poNumber:
                f.productionOrder.productionInvoiceItem.salesOrder?.orderCode ??
                f.productionOrder.poNumber,
              pieceName: f.piece.name,
              promisedQty: f.promisedQty,
              promisedDate: fmtDay(promisedDay),
              returnedSince,
              heldQty: sums.held,
              createdById: f.createdById,
            },
          });
          const marked = await this.prisma.weavingFollowUp.updateMany({
            where: { id: f.id, promiseStatus: WeavingFollowUpPromiseStatus.OPEN },
            data: { promiseStatus: WeavingFollowUpPromiseStatus.REMINDED, remindedAt: now },
          });
          if (marked.count > 0) result.reminded += 1;
        }
      } catch (e) {
        this.logger.error(`Weaving promise ${f.id} reminder failed: ${(e as Error).message}`);
      }
    }
    return result;
  }
}
