import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MfgStage } from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import type { NotificationType } from '../notifications/notification-types';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CutAllocationService,
  type CutAutoPullResult,
  type CutMachineProgressInfo,
} from './cut-allocation.service';
import { CutSnapshotCache } from './cut-allocation-snapshot';
import { FloorAdminService } from './floor-admin.service';
import { FloorWorkerStage } from './dto/floor-worker.dto';

type CutMachineAlertType = 'CUT_MACHINE_LOW_WORK' | 'CUT_MACHINE_IDLE';
const CUT_MACHINE_ALERT_TYPES: CutMachineAlertType[] = ['CUT_MACHINE_LOW_WORK', 'CUT_MACHINE_IDLE'];

/**
 * Đợt công nhân đã báo mà QLSX chưa gửi KCS quá bấy nhiêu giờ thì nhắc (FE cũng tô ⚠ cùng ngưỡng
 * này).
 */
export const STALE_HOURS = 4;
/**
 * Quét định kỳ - bổ sung cho kiểm tra ngay sau mỗi thao tác ghi (bắt cả báo từ màn thống kê cũ và
 * sự kiện lỡ).
 */
const CHECK_INTERVAL_MS = 10 * 60_000;
/** Gom các thao tác ghi dồn dập (công nhân báo liên tục) thành 1 lần kiểm tra. */
const DEBOUNCE_MS = 3_000;
/**
 * Mỗi lượt quét dựng snapshot nhiều xưởng: yêu cầu từ thao tác ghi chỉ chạy tối đa 1 lần mỗi khoảng
 * này.
 */
export const MIN_EVALUATE_GAP_MS = 30_000;
/** Lượt quét chậm hơn ngưỡng này thì log warn kèm thời gian từng bước. */
const SLOW_EVALUATE_MS = 2_000;
const STAGES: FloorWorkerStage[] = ['PHOI', 'HAN', 'SON'];

/**
 * Công tắc máy rảnh tự kéo lệnh : đặt CUT_AUTO_PULL=off để tắt (như FLOOR_ALERTS, đọc mỗi lần để
 * đổi nóng được).
 */
function autoPullEnabled(): boolean {
  return process.env.CUT_AUTO_PULL !== 'off';
}

/**
 * Nhắc QLSX: (1) tổ Hàn/Sơn báo ĐỦ số cần của PI đang chạy -> kiểm + "Chuyển PI tiếp"; (2) đợt chờ
 * gửi KCS quá STALE_HOURS giờ. Chỉ là nhắc - không chặn, không tự chuyển PI. (3) Tổ PHÔI không còn
 * nhắc: lệnh xong Phôi khi mọi dòng tổ Phôi đã KCS đạt đủ thì hệ thống TỰ đóng
 * (FloorAdminService.autoCompletePhoi) rồi báo FLOOR_PHOI_DONE. (4) Máy cắt còn ≤ 20 cây / đã cắt
 * hết việc được chia thì báo KHSX + QLSX.
 *
 * Mỗi nhắc chỉ phát MỘT lần cho tới khi được xử lý: NotificationsService.emit() với dedupeKey đang
 * mở sẽ GỘP vào thông báo cũ và đánh dấu CHƯA ĐỌC lại (mergeIntoExisting), nên quét định kỳ mà gọi
 * emit() mãi thì QLSX bị nhắc lại mỗi 10 phút. Vì vậy tự kiểm tra thông báo đang mở trước, có rồi
 * thì bỏ qua. Thông báo tự đóng (resolve) khi hết lý do: PI không còn chạy / hết đợt quá hạn.
 */
@Injectable()
export class FloorAlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FloorAlertsService.name);
  private interval: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private catchUp: NodeJS.Timeout | null = null;
  private running = false;
  /** Lúc bắt đầu lượt gần nhất (ms); null = chưa chạy lượt nào. */
  private lastStartAt: number | null = null;
  /** Có yêu cầu urgent đang chờ debounce. */
  private urgentWaiting = false;
  /**
   * Có yêu cầu đến giữa lúc đang chạy: chạy 1 lượt ngay sau khi xong (urgent thì bỏ qua khoảng 30
   * giây).
   */
  private rerunQueued: { urgent: boolean } | null = null;

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly admin: FloorAdminService,
    private readonly notifications: NotificationsService,
    private readonly cutAllocation: CutAllocationService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.FLOOR_ALERTS === 'off') return;
    this.interval = setInterval(() => void this.evaluate(), CHECK_INTERVAL_MS);
    this.interval.unref();
    this.first = setTimeout(() => void this.evaluate(), 60_000);
    this.first.unref();
  }

  onModuleDestroy(): void {
    for (const t of [this.interval, this.first, this.debounce, this.catchUp]) {
      if (t) clearTimeout(t);
    }
    this.interval = this.first = this.debounce = this.catchUp = null;
  }

  /**
   * Gọi sau mỗi thao tác ghi của /floor/* (FloorRealtimeInterceptor) và khi có việc cần báo gấp -
   * gom lại, không chặn request. Thường: chạy tối đa 1 lần mỗi MIN_EVALUATE_GAP_MS, quá sớm thì
   * chạy bù cuối khoảng. `urgent`: vẫn gom 3 giây nhưng bỏ qua khoảng đó. Không bao giờ làm rơi yêu
   * cầu.
   */
  requestEvaluate(opts?: { urgent?: boolean }): void {
    if (opts?.urgent) this.urgentWaiting = true;
    if (this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      const urgent = this.urgentWaiting;
      this.urgentWaiting = false;
      this.dispatch(urgent);
    }, DEBOUNCE_MS);
    this.debounce.unref();
  }

  /** Chạy ngay, hoặc xếp hàng nếu đang chạy, hoặc hẹn chạy bù khi chưa đủ khoảng giữa 2 lượt. */
  private dispatch(urgent: boolean): void {
    if (this.running) {
      this.rerunQueued = { urgent: urgent || (this.rerunQueued?.urgent ?? false) };
      return;
    }
    const wait = urgent ? 0 : this.msUntilNextAllowed();
    if (wait <= 0) {
      if (this.catchUp) clearTimeout(this.catchUp);
      this.catchUp = null;
      void this.evaluate();
      return;
    }
    if (this.catchUp) return;
    this.catchUp = setTimeout(() => {
      this.catchUp = null;
      this.dispatch(false);
    }, wait);
    this.catchUp.unref();
  }

  private msUntilNextAllowed(): number {
    return this.lastStartAt == null ? 0 : this.lastStartAt + MIN_EVALUATE_GAP_MS - Date.now();
  }

  /** Không bao giờ throw (chạy nền) và không chạy chồng nhau. */
  async evaluate(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();
    this.lastStartAt = startedAt;
    const steps: Array<[string, number]> = [];
    // Mỗi xưởng chỉ dựng snapshot đọc 1 lần trong lượt (dùng chung cho tiến độ máy và thiếu sắt).
    const cache = new CutSnapshotCache();
    const timed = async (name: string, fn: () => Promise<void>): Promise<void> => {
      const t = Date.now();
      try {
        await fn();
      } finally {
        steps.push([name, Date.now() - t]);
      }
    };
    try {
      await timed('stageComplete', () => this.checkStageComplete());
      await timed('stale', () => this.checkStale(now));
      await timed('cutMachines', () => this.checkCutMachines(cache));
      await timed('pullSteelIssued', () => this.checkPullSteelIssued(cache));
    } catch (e) {
      this.logger.error(`Floor alerts evaluate failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
      this.logTimings(Date.now() - startedAt, steps);
      this.runQueued();
    }
  }

  private logTimings(totalMs: number, steps: Array<[string, number]>): void {
    const detail = steps.map(([name, ms]) => `${name}=${ms}ms`).join(', ');
    if (totalMs > SLOW_EVALUATE_MS) {
      this.logger.warn(`Floor alerts evaluate chậm: ${totalMs}ms (${detail})`);
    } else {
      this.logger.debug(`Floor alerts evaluate: ${totalMs}ms (${detail})`);
    }
  }

  private runQueued(): void {
    const queued = this.rerunQueued;
    if (!queued) return;
    this.rerunQueued = null;
    this.dispatch(queued.urgent);
  }

  private async checkStageComplete(): Promise<void> {
    // PHÔI: cả dòng đang chạy lẫn đang chờ (đủ số thì tự đóng); Hàn/Sơn: chỉ dòng đang chạy.
    const entries = await this.prisma.floorQueueEntry.findMany({
      where: { status: { in: ['RUNNING', 'QUEUED'] } },
      include: { productionInvoice: { select: { code: true } } },
    });
    const running = entries.filter((e) => e.stage !== MfgStage.PHOI && e.status === 'RUNNING');
    for (const e of entries) {
      if (e.stage === MfgStage.PHOI) {
        await this.checkPhoiDone(e);
        continue;
      }
      if (e.status !== 'RUNNING') continue;
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
    // Đóng nhắc của PI không còn chạy (QLSX đã "Chuyển PI tiếp"); nhắc cũ của tổ Phôi cũng đóng
    // (Phôi tự tính, không ai bấm).
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

  /**
   * "Xong Phôi" tự tính: tiến độ tổ Phôi của PI có `required > 0 && passed >= required` (passed đã
   * chặn trần từng dòng nên bằng required nghĩa là MỌI dòng - cỡ đoạn × công đoạn, kể cả mảnh Phôi
   * - đã KCS đạt đủ) thì tự đóng dòng hàng đợi, báo QLSX.
   */
  private async checkPhoiDone(e: {
    id: bigint;
    productionInvoiceId: bigint;
    productionInvoice: { code: string };
  }): Promise<void> {
    const progress = await this.admin
      .computeProgress(MfgStage.PHOI, e.productionInvoiceId)
      .catch(() => null);
    if (!progress || !(progress.required > 0 && progress.passed >= progress.required)) return;
    try {
      const r = await this.admin.autoCompletePhoi(e.id);
      if (!r.closed) return;
      // Màn hàng đợi tổ Phôi của QLSX tự tải lại (dòng vừa đóng / lệnh kế vừa chạy).
      this.publishFloorChanged('phoi-auto-complete');
      await this.emitOnce('FLOOR_PHOI_DONE', `floor-phoi-done:${e.id}`, e.id.toString(), {
        piCode: e.productionInvoice.code,
        nextPiCode: r.nextPiCode,
      });
    } catch (err) {
      this.logger.error(
        `Auto-close Phôi ${e.productionInvoice.code} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Máy cắt sắp hết / đã hết việc được chia: LOW (còn 1..20 cây ước) và IDLE (cắt hết). Mỗi máy tối
   * đa 1 nhắc đang mở cho mỗi loại (chia thêm vài cây mà máy vẫn LOW thì không nhắc chồng). LOW
   * đóng khi máy hết LOW; IDLE chỉ đóng khi máy CÓ việc mới (LOW/BUSY) - máy rảnh mà lệnh đã xong
   * Phôi (dòng chia biến mất -> EMPTY) thì vẫn là máy rảnh. Máy ngưng dùng / bỏ xưởng thì đóng cả
   * 2. Lỗi chỉ ghi log, không làm hỏng evaluate.
   */
  private async checkCutMachines(cache: CutSnapshotCache): Promise<void> {
    try {
      const machines = await this.prisma.workstation.findMany({
        where: { kind: 'CUT', isActive: true, workshopId: { not: null } },
        select: { workshopId: true },
        distinct: ['workshopId'],
      });
      const seen = new Set<string>();
      let allLoaded = true;
      for (const w of machines) {
        if (w.workshopId == null) continue;
        try {
          let progress = await this.cutAllocation.machineProgressByWorkshop(w.workshopId, cache);
          // Máy rảnh (IDLE) hoặc chưa có việc (EMPTY) thì tự kéo lệnh kế tiếp; có kéo được thì tính
          // lại tiến độ để máy vừa nhận việc không bị nhắc "máy rảnh".
          if (autoPullEnabled()) {
            const idle = progress
              .filter((m) => m.status === 'IDLE' || m.status === 'EMPTY')
              .map((m) => m.workstationId);
            if (idle.length > 0 && (await this.tryAutoPull(w.workshopId, idle, cache))) {
              progress = await this.cutAllocation.machineProgressByWorkshop(w.workshopId, cache);
            }
          }
          for (const m of progress) {
            seen.add(m.workstationId);
            await this.checkCutMachine(m);
          }
        } catch (e) {
          allLoaded = false;
          this.logger.error(
            `Cut machine alerts (xưởng ${w.workshopId}) failed: ${(e as Error).message}`,
          );
        }
      }
      // Có xưởng dựng lỗi thì không dọn (khỏi đóng nhầm nhắc của máy thuộc xưởng đó).
      if (allLoaded) await this.resolveGoneMachines(seen);
    } catch (e) {
      this.logger.error(`Cut machine alerts failed: ${(e as Error).message}`);
    }
  }

  private async checkCutMachine(m: CutMachineProgressInfo): Promise<void> {
    const params = {
      workshopId: m.workshopId,
      workshopName: m.workshopName,
      machineName: m.name,
      barsLeft: m.barsLeft,
      autoPull: autoPullEnabled(),
    };
    if (m.status === 'LOW') {
      if (!(await this.hasOpenMachineAlert('CUT_MACHINE_LOW_WORK', m.workstationId))) {
        await this.emitOnce(
          'CUT_MACHINE_LOW_WORK',
          `cut-machine-low:${m.workstationId}:${m.signature}`,
          m.workstationId,
          params,
        );
      }
    } else {
      await this.resolveMachine(m.workstationId, ['CUT_MACHINE_LOW_WORK']);
    }
    if (m.status === 'IDLE') {
      if (!(await this.hasOpenMachineAlert('CUT_MACHINE_IDLE', m.workstationId))) {
        await this.emitOnce(
          'CUT_MACHINE_IDLE',
          `cut-machine-idle:${m.workstationId}:${m.signature}`,
          m.workstationId,
          params,
        );
      }
    } else if (m.status !== 'EMPTY') {
      await this.resolveMachine(m.workstationId, ['CUT_MACHINE_IDLE']);
    }
  }

  /**
   * Gọi kéo lệnh cho các máy rảnh của 1 xưởng rồi báo: thêm lệnh vào hàng đợi Phôi, báo KHSX/QLSX
   * (CUT_ORDER_PULLED), báo thủ kho xuất sắt nếu sắt còn trong kho (CUT_PULL_STEEL_TO_ISSUE), phát
   * realtime. Trả true khi đã kéo (dòng chia đã ghi). Lỗi chỉ ghi log.
   */
  private async tryAutoPull(
    workshopId: bigint,
    idleMachineIds: string[],
    cache: CutSnapshotCache,
  ): Promise<boolean> {
    let result: CutAutoPullResult | null;
    try {
      result = await this.cutAllocation.autoPull(workshopId, idleMachineIds);
    } catch (e) {
      this.logger.error(`Cut auto-pull (xưởng ${workshopId}) failed: ${(e as Error).message}`);
      return false;
    }
    if (!result) return false;
    // Đã ghi dòng chia mới: snapshot đã dựng của xưởng này không còn đúng.
    cache.invalidate(workshopId);
    try {
      await this.admin.ensurePhoiQueued(result.orders.map((o) => BigInt(o.productionInvoiceId)));
    } catch (e) {
      this.logger.error(`Queue pulled orders to Phôi failed: ${(e as Error).message}`);
    }
    for (const o of result.orders) {
      const machineNames = (
        o.idleMachineNames.length > 0 ? o.idleMachineNames : result.machines.map((m) => m.name)
      ).join(', ');
      const summary = o.lines
        .map(
          (l) =>
            `${l.materialLabel}: ${l.bars} cây (${l.machines.map((m) => `${m.name} ${m.bars}`).join(', ')})`,
        )
        .join('; ');
      await this.emitOnce(
        'CUT_ORDER_PULLED',
        `cut-order-pulled:${o.productionInvoiceId}:${o.firstAllocationId}`,
        o.productionInvoiceId,
        {
          piCode: o.piCode,
          workshopId: result.workshopId,
          workshopName: result.workshopName,
          machineNames,
          summary,
          steelPending: o.steelGaps.length > 0,
        },
      );
      if (o.steelGaps.length > 0) {
        // Gọi emit() thẳng (không emitOnce): thông báo cũ của lệnh còn mở thì emit cùng dedupeKey
        // sẽ GỘP và cập nhật nội dung theo các loại sắt mới (mergeIntoExisting).
        const dedupeKey = `cut-pull-steel:${o.productionInvoiceId}`;
        try {
          await this.notifications.emit('CUT_PULL_STEEL_TO_ISSUE', {
            entityId: o.productionInvoiceId,
            dedupeKey,
            params: {
              piCode: o.piCode,
              workshopId: result.workshopId,
              lines: o.steelGaps
                .map((g) => `${g.materialLabel}: còn ${g.missingBars} cây`)
                .join('; '),
              warehouseCodes: [...new Set(o.steelGaps.flatMap((g) => g.warehouseCodes))],
            },
          });
        } catch (e) {
          this.logger.error(
            `Failed to emit CUT_PULL_STEEL_TO_ISSUE (${dedupeKey}): ${(e as Error).message}`,
          );
        }
      }
    }
    this.publishFloorChanged('cut-auto-pull');
    return true;
  }

  /**
   * Thông báo "xuất sắt" của thủ kho đang mở mà lệnh đã xuất đủ sắt (hoặc không còn dòng chia) ->
   * đóng. Chỉ truy vấn khi có thông báo mở.
   */
  private async checkPullSteelIssued(cache: CutSnapshotCache): Promise<void> {
    try {
      const open = await this.prisma.notification.findMany({
        where: { type: 'CUT_PULL_STEEL_TO_ISSUE', recipients: { some: { resolvedAt: null } } },
        select: { entityId: true, data: true },
      });
      if (open.length === 0) return;
      const byWorkshop = new Map<string, string[]>();
      for (const n of open) {
        const wid = (n.data as { workshopId?: unknown } | null)?.workshopId;
        if (!n.entityId || typeof wid !== 'string' || !/^\d+$/.test(wid)) continue;
        byWorkshop.set(wid, [...(byWorkshop.get(wid) ?? []), n.entityId]);
      }
      for (const [wid, piIds] of byWorkshop) {
        try {
          const gaps = await this.cutAllocation.steelGapsByPi(BigInt(wid), cache);
          for (const piId of new Set(piIds)) {
            if (gaps.has(piId)) continue;
            await this.notifications.resolve({
              entityType: 'PRODUCTION_INVOICE',
              entityId: piId,
              types: ['CUT_PULL_STEEL_TO_ISSUE'],
            });
          }
        } catch (e) {
          this.logger.error(`Pull-steel check (xưởng ${wid}) failed: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.error(`Pull-steel check failed: ${(e as Error).message}`);
    }
  }

  /**
   * Báo màn QLSX tự tải lại (cùng topic với FloorRealtimeInterceptor). Realtime là phần phụ - lỗi
   * chỉ ghi log.
   */
  private publishFloorChanged(entityId: string): void {
    try {
      this.realtime.publishEntityChanged({
        entity: 'FLOOR_REPORT',
        entityId,
        action: 'UPDATED',
        actorId: null,
      });
    } catch (e) {
      this.logger.error(`Publish floor realtime failed: ${(e as Error).message}`);
    }
  }

  private async hasOpenMachineAlert(
    type: CutMachineAlertType,
    workstationId: string,
  ): Promise<boolean> {
    const open = await this.prisma.notification.findFirst({
      where: {
        type,
        entityType: 'WORKSTATION',
        entityId: workstationId,
        recipients: { some: { resolvedAt: null } },
      },
      select: { id: true },
    });
    return open != null;
  }

  /**
   * Nhắc của máy không còn trong danh sách máy cắt đang dùng có xưởng (ngưng dùng / bỏ xưởng / đổi
   * loại) -> đóng.
   */
  private async resolveGoneMachines(seen: Set<string>): Promise<void> {
    const open = await this.prisma.notification.findMany({
      where: {
        type: { in: CUT_MACHINE_ALERT_TYPES },
        entityType: 'WORKSTATION',
        recipients: { some: { resolvedAt: null } },
      },
      select: { entityId: true },
    });
    const gone = new Set(
      open.map((n) => n.entityId).filter((id): id is string => !!id && !seen.has(id)),
    );
    for (const id of gone) await this.resolveMachine(id, CUT_MACHINE_ALERT_TYPES);
  }

  private async resolveMachine(workstationId: string, types: CutMachineAlertType[]): Promise<void> {
    await this.notifications.resolve({
      entityType: 'WORKSTATION',
      entityId: workstationId,
      types,
    });
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
   * Số đợt chưa gửi KCS mà lần báo CÒN HIỆU LỰC (chưa bị đảo) đầu tiên đã quá `threshold` - cùng
   * cách tính "chờ x giờ" ở màn QLSX. Đợt cũ không có sổ báo không được tính.
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
    type: Extract<
      NotificationType,
      | 'FLOOR_STAGE_COMPLETE'
      | 'FLOOR_BATCH_STALE'
      | 'FLOOR_PHOI_DONE'
      | 'CUT_MACHINE_LOW_WORK'
      | 'CUT_MACHINE_IDLE'
      | 'CUT_ORDER_PULLED'
    >,
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
