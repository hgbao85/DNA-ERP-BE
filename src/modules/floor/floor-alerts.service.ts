import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MfgStage } from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  NOTIFICATION_TYPES,
  type KcsBatchStaleParams,
  type NotificationType,
} from '../notifications/notification-types';
import { NotificationsService } from '../notifications/notifications.service';
import { PaintTransferReminderService } from '../warehouse-transfers/paint-transfer-reminder.service';
import {
  CutAllocationService,
  type CutAutoPullResult,
  type CutMachineProgressInfo,
} from './cut-allocation.service';
import {
  buildPullSteelParams,
  CutAllocationFollowUpService,
} from './cut-allocation-follow-up.service';
import { CutSnapshotCache } from './cut-allocation-snapshot';
import type { SteelGap } from './cut-allocation-types';
import { FloorAdminService } from './floor-admin.service';
import { FloorStageService } from './floor-stage.service';
import { KCS_STALE_HOURS, listKcsPendingItems } from './kcs-pending.util';
import { groupStaleByQueueWorkshop, staleBucketKey, type StaleBucket } from './floor-stale.util';

type CutMachineAlertType = 'CUT_MACHINE_LOW_WORK' | 'CUT_MACHINE_IDLE';
const CUT_MACHINE_ALERT_TYPES: CutMachineAlertType[] = ['CUT_MACHINE_LOW_WORK', 'CUT_MACHINE_IDLE'];

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

/**
 * Công tắc máy rảnh tự kéo lệnh : đặt CUT_AUTO_PULL=off để tắt (như FLOOR_ALERTS, đọc mỗi lần để
 * đổi nóng được).
 */
function autoPullEnabled(): boolean {
  return process.env.CUT_AUTO_PULL !== 'off';
}

/**
 * Việc nền của sàn xưởng (23/11/2026: hàng đợi xưởng đã bỏ nên không còn nhắc "tổ báo đủ số" / "Chuyển PI tiếp"):
 * (1) lệnh xong Phôi (mọi dòng tổ Phôi đã KCS đạt đủ) thì TỰ ghi `phoiDoneAt` (checkPhoiDone), không gửi tin;
 * (2) đợt công nhân đã báo mà KCS chưa chấm quá KCS_STALE_HOURS giờ (KCS_BATCH_STALE, chỉ gửi KCS); (3) máy cắt còn ≤ 20 cây /
 * đã cắt hết việc được chia thì báo KHSX + QLSX, máy rảnh tự kéo lệnh (CUT_AUTO_PULL) và báo thủ kho xuất sắt.
 *
 * Mỗi nhắc chỉ phát MỘT lần cho tới khi được xử lý: NotificationsService.emit() với dedupeKey đang
 * mở sẽ GỘP vào thông báo cũ và đánh dấu CHƯA ĐỌC lại (mergeIntoExisting), nên quét định kỳ mà gọi
 * emit() mãi thì người nhận bị nhắc lại mỗi 10 phút. Vì vậy tự kiểm tra thông báo đang mở trước, có rồi
 * thì bỏ qua. Thông báo tự đóng (resolve) khi hết lý do.
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
    private readonly stages: FloorStageService,
    private readonly notifications: NotificationsService,
    private readonly cutAllocation: CutAllocationService,
    private readonly realtime: RealtimeService,
    private readonly followUp: CutAllocationFollowUpService,
    private readonly paintReminder: PaintTransferReminderService,
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
   * cầu. FLOOR_ALERTS=off tắt cả lượt do thao tác lẫn lượt gấp (đọc mỗi lần gọi), để công tắc tắt
   * hẳn nhắc nền xưởng: không tự đóng lệnh Phôi, không kéo lệnh, không gửi thông báo.
   */
  requestEvaluate(opts?: { urgent?: boolean }): void {
    if (process.env.FLOOR_ALERTS === 'off') return;
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
      await timed('phoiDone', () => this.checkPhoiDone());
      await timed('stale', () => this.checkStale(now));
      await timed('cutMachines', () => this.checkCutMachines(cache));
      await timed('pullSteelIssued', () => this.checkPullSteelIssued(cache));
      await timed('pullSteelReconcile', () => this.reconcilePullSteel(cache));
      // Cuối cùng: lỗi bước này (đã tự bắt) không được cản các bước trên.
      await timed('paintTransfer', () => this.syncPaintTransfer());
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

  /**
   * "Xong Phôi" tự tính (23/11/2026, bỏ hàng đợi): duyệt lệnh chưa DONE / CANCELLED, chưa có `phoiDoneAt`, có dòng chia máy cắt
   * hoặc đã có ≥ 1 đợt cắt. Tiến độ tổ Phôi có `required > 0 && passed >= required` (passed đã chặn trần từng dòng nên bằng
   * required nghĩa là MỌI dòng - cỡ đoạn × công đoạn, kể cả mảnh Phôi - đã KCS đạt đủ) thì ghi `phoiDoneAt` và phát realtime
   * 'floor' để bảng chia / màn quét tải lại. Không gửi tin. Lệnh tính tiến độ lỗi thì bỏ qua (không coi là xong).
   */
  private async checkPhoiDone(): Promise<void> {
    try {
      const candidates = await this.prisma.productionInvoice.findMany({
        where: {
          phoiDoneAt: null,
          status: { notIn: ['DONE', 'CANCELLED'] },
          OR: [
            { cutAllocations: { some: {} } },
            { steelIssues: { some: { bundles: { some: {} } } } },
          ],
        },
        select: { id: true, code: true },
      });
      if (candidates.length === 0) return;
      const progress = await this.stages.progressMap(
        MfgStage.PHOI,
        candidates.map((c) => c.id),
      );
      let closed = 0;
      for (const c of candidates) {
        const p = progress.get(c.id.toString());
        if (!p || !(p.required > 0 && p.passed >= p.required)) continue;
        try {
          if (await this.admin.autoCompletePhoi(c.id)) closed += 1;
        } catch (err) {
          this.logger.error(`Auto-close Phôi ${c.code} failed: ${(err as Error).message}`);
        }
      }
      if (closed > 0) this.publishFloorChanged('phoi-auto-complete');
    } catch (e) {
      this.logger.error(`Check Phôi done failed: ${(e as Error).message}`);
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
   * Gọi kéo lệnh cho các máy rảnh của 1 xưởng rồi báo: báo KHSX/QLSX
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
    // Báo thủ kho xuất sắt (follow-up không bao giờ ném lỗi).
    await this.followUp.afterAllocated({
      workshopId: result.workshopId,
      orders: result.orders.map((o) => ({
        productionInvoiceId: o.productionInvoiceId,
        piCode: o.piCode,
        steelGaps: o.steelGaps,
      })),
      source: 'AUTO_PULL',
    });
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
   * Đối soát tin xuất sắt (chỉ chạy trong lượt nền, tức khi FLOOR_ALERTS bật): với mỗi xưởng có máy
   * cắt, lệnh đã chia cho máy cắt, đang chạy (có SKU ACTIVE ở xưởng), không chờ KHSX kiểm lại phương
   * án cắt, còn thiếu sắt mà có kho giữ chỗ thì phải có 1 tin mở cho thủ kho. Chưa có thì phát
   * (source RECONCILE); có rồi mà thêm kho mới thì emit gộp (thêm người nhận); chỉ danh sách loại sắt
   * đổi thì cập nhật nội dung, giữ trạng thái đã đọc. Phần đóng tin nằm ở checkPullSteelIssued. Lỗi
   * từng xưởng / từng lệnh chỉ ghi log.
   */
  private async reconcilePullSteel(cache: CutSnapshotCache): Promise<void> {
    try {
      const machines = await this.prisma.workstation.findMany({
        where: { kind: 'CUT', isActive: true, workshopId: { not: null } },
        select: { workshopId: true },
        distinct: ['workshopId'],
      });
      for (const w of machines) {
        if (w.workshopId == null) continue;
        try {
          await this.reconcilePullSteelWorkshop(w.workshopId, cache);
        } catch (e) {
          this.logger.error(
            `Pull-steel reconcile (xưởng ${w.workshopId}) failed: ${(e as Error).message}`,
          );
        }
      }
    } catch (e) {
      this.logger.error(`Pull-steel reconcile failed: ${(e as Error).message}`);
    }
  }

  private async reconcilePullSteelWorkshop(
    workshopId: bigint,
    cache: CutSnapshotCache,
  ): Promise<void> {
    const gapsByPi = await this.cutAllocation.steelGapsByPi(workshopId, cache);
    const withKho = [...gapsByPi].filter(([, gaps]) =>
      gaps.some((g) => g.warehouseCodes.length > 0),
    );
    if (withKho.length === 0) return;
    const started = new Set(
      (await this.cutAllocation.startedAllocationPiIds(workshopId, cache)).map(String),
    );
    const candidates = withKho.filter(([piId]) => started.has(piId));
    if (candidates.length === 0) return;
    const pis = await this.prisma.productionInvoice.findMany({
      where: { id: { in: candidates.map(([piId]) => BigInt(piId)) } },
      select: { id: true, code: true, cuttingRecheckRequired: true },
    });
    const byId = new Map(pis.map((p) => [p.id.toString(), p]));
    for (const [piId, gaps] of candidates) {
      const pi = byId.get(piId);
      if (!pi || pi.cuttingRecheckRequired) continue;
      try {
        await this.reconcilePullSteelOrder(piId, pi.code, workshopId, gaps);
      } catch (e) {
        this.logger.error(`Pull-steel reconcile (lệnh ${piId}) failed: ${(e as Error).message}`);
      }
    }
  }

  private async reconcilePullSteelOrder(
    piId: string,
    piCode: string,
    workshopId: bigint,
    gaps: SteelGap[],
  ): Promise<void> {
    const type = 'CUT_PULL_STEEL_TO_ISSUE';
    const dedupeKey = `cut-pull-steel:${piId}`;
    const base = { piCode, workshopId: String(workshopId), gaps };
    const open = await this.prisma.notification.findFirst({
      where: { type, dedupeKey, recipients: { some: { resolvedAt: null } } },
      select: { data: true },
    });
    if (!open) {
      const params = buildPullSteelParams({ ...base, source: 'RECONCILE' });
      await this.notifications.emit(type, { entityId: piId, dedupeKey, params: { ...params } });
      return;
    }
    // Tin đang mở: giữ nguồn cũ (câu chữ đã hiện cho người đọc), chỉ làm tươi danh sách / kho.
    const shown =
      (open.data as { lines?: unknown; warehouseCodes?: unknown; source?: unknown } | null) ?? {};
    const src = shown.source;
    const params = buildPullSteelParams({
      ...base,
      source: src === 'MANUAL' || src === 'AUTO_PULL' || src === 'RECONCILE' ? src : undefined,
    });
    const oldCodes = Array.isArray(shown.warehouseCodes) ? (shown.warehouseCodes as unknown[]) : [];
    if (params.warehouseCodes.some((c) => !oldCodes.includes(c))) {
      // Kho mới: emit gộp để thêm người nhận (thủ kho kho mới).
      await this.notifications.emit(type, { entityId: piId, dedupeKey, params: { ...params } });
      return;
    }
    if (shown.lines === params.lines) return;
    const ok = await this.notifications.updateOpenContent(type, dedupeKey, { ...params });
    if (!ok) {
      await this.notifications.emit(type, { entityId: piId, dedupeKey, params: { ...params } });
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

  /** Nhắc nền chuyển mảnh Hàn -> Sơn (xưởng không có kho Sơn). Lỗi chỉ ghi log. */
  private async syncPaintTransfer(): Promise<void> {
    try {
      await this.paintReminder.syncAll();
    } catch (e) {
      this.logger.error(`Paint transfer reminders failed: ${(e as Error).message}`);
    }
  }

  /**
   * Đợt công nhân đã báo mà KCS chưa chấm (đang mở + đã chốt chưa chấm xong) quá KCS_STALE_HOURS giờ: mỗi (tổ,
   * xưởng của tổ - Sơn theo nơi sơn) 1 tin KCS_BATCH_STALE; người nhận chỉ là KCS (bỏ QLSX từ 23/11/2026),
   * params.workshopId ghi xưởng. Dòng bị chặn (lệnh dừng / chưa gắn SKU) không tính. Cuối lượt đóng mọi tin
   * FLOOR_BATCH_STALE còn mở (ngừng phát từ P1, kể cả entityId kiểu cũ).
   */
  private async checkStale(now: Date): Promise<void> {
    const items = await listKcsPendingItems(this.prisma, {
      staleBefore: new Date(now.getTime() - KCS_STALE_HOURS * 3_600_000),
    });
    const buckets = await groupStaleByQueueWorkshop(
      this.prisma,
      items.filter((i) => !i.blockedReason),
    );
    await this.syncStageWorkshopAlerts('KCS_BATCH_STALE', buckets);
    await this.syncStageWorkshopAlerts('FLOOR_BATCH_STALE', []);
  }

  /**
   * Hàm dùng chung (P1 gọi lại với loại tin chờ lâu của KCS): mỗi nhóm count > 0 có đúng 1 tin
   * entityId = '<tổ>:<id xưởng | none>', dedupeKey = '<type>:<khoá>'. Chưa có tin mở thì phát; có rồi
   * mà số đổi thì cập nhật nội dung GIỮ trạng thái đã đọc (không nhắc lại); tin mở của loại này mà khoá
   * không còn nhóm nào (hết đợt quá hạn, hoặc tin kiểu cũ entityId 'PHOI' / 'HAN' / 'SON') thì đóng.
   */
  protected async syncStageWorkshopAlerts(
    type: Extract<NotificationType, 'FLOOR_BATCH_STALE' | 'KCS_BATCH_STALE'>,
    buckets: StaleBucket[],
  ): Promise<void> {
    const wsIds = [
      ...new Set(buckets.filter((b) => b.workshopId != null).map((b) => b.workshopId!)),
    ];
    const names = new Map<string, string>();
    if (wsIds.length > 0) {
      const rows = await this.prisma.workshop.findMany({
        where: { id: { in: wsIds } },
        select: { id: true, name: true },
      });
      for (const w of rows) names.set(w.id.toString(), w.name);
    }
    const active = new Set<string>();
    for (const b of buckets) {
      if (b.count <= 0) continue;
      const key = staleBucketKey(b.stage, b.workshopId);
      active.add(key);
      const wsName = b.workshopId != null ? names.get(b.workshopId.toString()) : undefined;
      const params: KcsBatchStaleParams = {
        stage: b.stage,
        count: b.count,
        hours: KCS_STALE_HOURS,
        // Dòng hàng đợi cũ không có xưởng (null) thì không thêm workshopId vào params.
        ...(b.workshopId != null ? { workshopId: b.workshopId.toString() } : {}),
        ...(wsName ? { workshopName: wsName } : {}),
      };
      const dedupeKey = `${type}:${key}`;
      const open = await this.prisma.notification.findFirst({
        where: { type, dedupeKey, recipients: { some: { resolvedAt: null } } },
        select: { id: true, data: true },
      });
      if (!open) {
        await this.emitOnce(type, dedupeKey, key, params as unknown as Record<string, unknown>);
        continue;
      }
      const shown = (open.data as { count?: unknown; workshopName?: unknown } | null) ?? {};
      if (shown.count === b.count && (shown.workshopName ?? undefined) === wsName) continue;
      try {
        const ok = await this.notifications.updateOpenContent(
          type,
          dedupeKey,
          params as unknown as Record<string, unknown>,
        );
        if (!ok) {
          await this.emitOnce(type, dedupeKey, key, params as unknown as Record<string, unknown>);
        }
      } catch (e) {
        this.logger.error(`Failed to update ${type} (${dedupeKey}): ${(e as Error).message}`);
      }
    }
    const openAll = await this.prisma.notification.findMany({
      where: { type, recipients: { some: { resolvedAt: null } } },
      select: { entityId: true },
    });
    const entityType = NOTIFICATION_TYPES[type].entityType;
    for (const id of new Set(openAll.map((n) => n.entityId))) {
      if (!id || active.has(id)) continue;
      await this.notifications.resolve({ entityType, entityId: id, types: [type] });
    }
  }

  private async emitOnce(
    type: Extract<
      NotificationType,
      | 'FLOOR_BATCH_STALE'
      | 'KCS_BATCH_STALE'
      | 'CUT_MACHINE_LOW_WORK'
      | 'CUT_MACHINE_IDLE'
      | 'CUT_ORDER_PULLED'
    >,
    dedupeKey: string,
    entityId: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.prisma.notification.findFirst({
      where: { type, dedupeKey, recipients: { some: { resolvedAt: null } } },
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
