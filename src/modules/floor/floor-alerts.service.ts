import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MfgStage } from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FloorAdminService } from './floor-admin.service';
import { FloorWorkerStage } from './dto/floor-worker.dto';

/** Đợt công nhân đã báo mà QLSX chưa gửi KCS quá bấy nhiêu giờ thì nhắc (FE cũng tô ⚠ cùng ngưỡng này). */
export const STALE_HOURS = 4;
/** Quét định kỳ - bổ sung cho kiểm tra ngay sau mỗi thao tác ghi (bắt cả báo từ màn thống kê cũ và sự kiện lỡ). */
const CHECK_INTERVAL_MS = 10 * 60_000;
/** Gom các thao tác ghi dồn dập (công nhân báo liên tục) thành 1 lần kiểm tra. */
const DEBOUNCE_MS = 3_000;
const STAGES: FloorWorkerStage[] = ['PHOI', 'HAN', 'SON'];

/**
 * Nhắc QLSX (2026-10-13, mục 19/24/26 plan QR): (1) tổ báo ĐỦ số cần của PI đang chạy -> kiểm + "Chuyển PI tiếp";
 * (2) đợt chờ gửi KCS quá STALE_HOURS giờ. Chỉ là nhắc - không chặn, không tự chuyển PI.
 *
 * Mỗi nhắc chỉ phát MỘT lần cho tới khi được xử lý: NotificationsService.emit() với dedupeKey đang mở sẽ GỘP vào thông báo cũ và
 * đánh dấu CHƯA ĐỌC lại (mergeIntoExisting) - nếu quét định kỳ cứ gọi emit() thì QLSX bị nhắc lại mỗi 10 phút. Nên tự kiểm tra
 * thông báo đang mở trước, có rồi thì bỏ qua. Thông báo tự đóng (resolve) khi hết lý do: PI không còn chạy / hết đợt quá hạn.
 */
@Injectable()
export class FloorAlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FloorAlertsService.name);
  private interval: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly admin: FloorAdminService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.FLOOR_ALERTS === 'off') return;
    this.interval = setInterval(() => void this.evaluate(), CHECK_INTERVAL_MS);
    this.interval.unref();
    this.first = setTimeout(() => void this.evaluate(), 60_000);
    this.first.unref();
  }

  onModuleDestroy(): void {
    for (const t of [this.interval, this.first, this.debounce]) if (t) clearTimeout(t);
    this.interval = this.first = this.debounce = null;
  }

  /** Gọi sau mỗi thao tác ghi của /floor/* (FloorRealtimeInterceptor) - gom lại, không chặn request. */
  requestEvaluate(): void {
    if (this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.evaluate();
    }, DEBOUNCE_MS);
    this.debounce.unref();
  }

  /** Không bao giờ throw (chạy nền) và không chạy chồng nhau. */
  async evaluate(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.checkStageComplete();
      await this.checkStale(now);
    } catch (e) {
      this.logger.error(`Floor alerts evaluate failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async checkStageComplete(): Promise<void> {
    const running = await this.prisma.floorQueueEntry.findMany({
      where: { status: 'RUNNING' },
      include: { productionInvoice: { select: { code: true } } },
    });
    for (const e of running) {
      const progress = await this.admin
        .computeProgress(e.stage, e.productionInvoiceId)
        .catch(() => null);
      if (progress?.complete) {
        await this.emitOnce(
          'FLOOR_STAGE_COMPLETE',
          `floor-stage-complete:${e.id}`,
          e.id.toString(),
          {
            stage: e.stage,
            piCode: e.productionInvoice.code,
          },
        );
      }
    }
    // Đóng nhắc của PI không còn chạy (QLSX đã "Chuyển PI tiếp").
    const open = await this.prisma.notification.findMany({
      where: { type: 'FLOOR_STAGE_COMPLETE', recipients: { some: { resolvedAt: null } } },
      select: { entityId: true },
    });
    const runningIds = new Set(running.map((e) => e.id.toString()));
    for (const n of open) {
      if (n.entityId && !runningIds.has(n.entityId)) {
        await this.notifications.resolve({
          entityType: 'FLOOR_QUEUE_ENTRY',
          entityId: n.entityId,
          types: ['FLOOR_STAGE_COMPLETE'],
        });
      }
    }
  }

  private async checkStale(now: Date): Promise<void> {
    const counts = await this.countStaleByStage(new Date(now.getTime() - STALE_HOURS * 3_600_000));
    for (const stage of STAGES) {
      if (counts[stage] > 0) {
        await this.emitOnce('FLOOR_BATCH_STALE', `floor-batch-stale:${stage}`, stage, {
          stage,
          count: counts[stage],
          hours: STALE_HOURS,
        });
      } else {
        await this.notifications.resolve({
          entityType: 'FLOOR_STAGE',
          entityId: stage,
          types: ['FLOOR_BATCH_STALE'],
        });
      }
    }
  }

  /**
   * Số đợt chưa gửi KCS mà lần báo CÒN HIỆU LỰC (chưa bị đảo) đầu tiên đã quá `threshold` - cùng cách tính "chờ x giờ" ở màn QLSX.
   * Đợt cũ không có sổ báo (trước 2026-10-12) không được tính.
   */
  async countStaleByStage(threshold: Date): Promise<Record<FloorWorkerStage, number>> {
    const old = {
      some: { createdAt: { lt: threshold }, reversalOfId: null, reversedBy: { is: null } },
    };
    const [cut, steps, pieces] = await Promise.all([
      this.prisma.cutBundle.count({ where: { status: 'CUTTING', floorReports: old } }),
      this.prisma.stepBatch.findMany({
        where: { stepBundleId: null, floorReports: old },
        distinct: [
          'productionInvoiceId',
          'materialId',
          'step',
          'productionOrderId',
          'reportedById',
        ],
        select: { id: true },
      }),
      this.prisma.productionBatch.groupBy({
        by: ['stage'],
        where: { status: 'OPEN', floorReports: old },
        _count: { _all: true },
      }),
    ]);
    const piece = (s: MfgStage) => pieces.find((p) => p.stage === s)?._count._all ?? 0;
    return {
      PHOI: cut + steps.length + piece(MfgStage.PHOI),
      HAN: piece(MfgStage.HAN),
      SON: piece(MfgStage.SON),
    };
  }

  private async emitOnce(
    type: 'FLOOR_STAGE_COMPLETE' | 'FLOOR_BATCH_STALE',
    dedupeKey: string,
    entityId: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.prisma.notification.findFirst({
      where: { dedupeKey, recipients: { some: { resolvedAt: null } } },
      select: { id: true },
    });
    if (existing) return;
    try {
      await this.notifications.emit(type, { entityId, dedupeKey, params });
    } catch (e) {
      this.logger.error(`Failed to emit ${type} (${dedupeKey}): ${(e as Error).message}`);
    }
  }
}
