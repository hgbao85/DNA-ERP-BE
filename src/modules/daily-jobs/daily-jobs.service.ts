import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { VN_OFFSET_MS, vnDayKey, vnDayStart } from '../../common/utils/floor-stats.util';
import { DataHealthService } from '../data-health/data-health.service';
import {
  MilestoneBoard,
  MilestoneBoardService,
  MilestoneCell,
  MilestoneRow,
  MissingMaterial,
} from '../milestone-board/milestone-board.service';
import { MilestoneKey } from '../milestone-board/milestone-board.rules';
import {
  DeliveryAtRiskNotificationParams,
  MaterialsDigestNotificationParams,
  ProductionDigestNotificationParams,
} from '../notifications/notification-types';
import { NotificationsService } from '../notifications/notifications.service';

const CHECK_INTERVAL_MS = 10 * 60_000;
/** Lần kiểm đầu sau khi máy chủ lên - chờ app ổn định, không chen vào lúc deploy/khởi động. */
const FIRST_DELAY_MS = 60_000;
/** Tin sáng gửi từ giờ này (giờ VN) trở đi, 1 lần/ngày. */
export const DIGEST_HOUR_VN = 7;
/** Số dòng tiêu biểu ghi trong 1 tin. */
const MAX_LINES = 5;

const DIGEST_ENTITY = 'MORNING_DIGEST';
const LOCK_KEY = 'daily-jobs';
/** Đủ cho 1 lần kiểm cả "Kiểm tra dữ liệu" (transaction riêng tối đa 60 s) + bảng mốc + gửi tin. */
const LOCK_TIMEOUT_MS = 10 * 60_000;
const DELIVERY_ENTITY = 'PRODUCTION_INVOICE_ITEM';

export function vnHour(d: Date): number {
  return new Date(d.getTime() + VN_OFFSET_MS).getUTCHours();
}

const ddmmyyyy = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const fmt = (n: number) => Number(n.toFixed(2)).toLocaleString('vi-VN');
const cellOf = (r: MilestoneRow, key: MilestoneKey): MilestoneCell | undefined =>
  r.milestones.find((m) => m.key === key);
const lateText = (d: number) => (d < 0 ? `trễ ${-d} ngày` : d === 0 ? 'hôm nay' : `còn ${d} ngày`);
const joinLines = (lines: string[]) =>
  lines.slice(0, MAX_LINES).join('; ') +
  (lines.length > MAX_LINES ? `; +${lines.length - MAX_LINES} dòng khác` : '') +
  '.';

/**
 * Việc hằng ngày bằng hẹn giờ TRONG APP (2026-10-29, changelog 2026-09-25 mục 32.24) - thay lịch GitHub Actions + khoá
 * `DATA_HEALTH_CRON_KEY`. Cùng kiểu FloorAlertsService: 10 phút kiểm 1 lần khi máy chủ đang thức (Render gói free ngủ khi không
 * ai dùng - dữ liệu cũng chỉ đổi khi có người dùng, nên kiểm lúc thức là đủ). Tắt bằng `DAILY_JOBS=off`; không chạy khi test.
 *
 * Mỗi lần kiểm:
 *  1. "Kiểm tra dữ liệu": nếu hôm nay (giờ VN) chưa có lần tự chạy nào thì chạy 1 lần.
 *  2. Cảnh báo CRITICAL "nguy cơ trễ hạn giao" theo Bảng mốc: mở cho dòng mới có nguy cơ, cập nhật khi số ngày/số đã đóng
 *     gói đổi, đóng khi hết nguy cơ hoặc lệnh đã Kết thúc.
 *  3. Từ 07:00 giờ VN: tin sáng (vật tư cho Mua hàng + thủ kho; tiến độ cho KHSX + QLSX), 1 lần/ngày, tin hôm trước tự đóng.
 * Mỗi bước bắt lỗi riêng - 1 bước lỗi không chặn bước sau.
 */
@Injectable()
export class DailyJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DailyJobsService.name);
  private interval: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private running = false;
  /** Ngày VN đã xử lý xong tin sáng (kể cả khi không có gì để gửi) - khỏi tính lại mỗi 10 phút. Khởi động lại thì tra DB. */
  private digestDoneDay: string | null = null;

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly dataHealth: DataHealthService,
    private readonly milestoneBoard: MilestoneBoardService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.DAILY_JOBS === 'off') return;
    this.first = setTimeout(() => void this.tick(), FIRST_DELAY_MS);
    this.interval = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    // Như FloorAlertsService: hẹn giờ không giữ tiến trình sống khi app đang tắt.
    this.first.unref();
    this.interval.unref();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.interval) clearInterval(this.interval);
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Nhiều tiến trình cùng chạy (deploy chồng nhau / sau này chạy nhiều instance - review 32.26): chỉ 1 nơi làm việc hằng
      // ngày tại 1 thời điểm. Khoá advisory gắn với 1 transaction mở suốt lần kiểm (các bước ghi bằng kết nối khác, khoá tự nhả
      // khi transaction kết thúc); nơi không lấy được khoá thì bỏ qua lần này. Không có khoá này thì 2 nơi cùng thấy "hôm nay
      // chưa chạy" -> chạy đôi kiểm tra dữ liệu (đụng unique), gửi đôi tin sáng / cảnh báo CRITICAL.
      await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})::bigint) AS locked`;
          if (!locked) return;
          await this.runSteps(now);
        },
        { timeout: LOCK_TIMEOUT_MS, maxWait: 10_000 },
      );
    } catch (err) {
      this.logger.error(`Việc hằng ngày lỗi: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async runSteps(now: Date): Promise<void> {
    await this.step('kiểm tra dữ liệu', () => this.runDataHealthIfDue(now));
    let board: MilestoneBoard | null = null;
    await this.step('bảng mốc', async () => {
      board = await this.milestoneBoard.getBoard(now);
    });
    if (board) {
      const b: MilestoneBoard = board;
      await this.step('cảnh báo hạn giao', () => this.syncDeliveryAlerts(b));
      await this.step('tin sáng', () => this.sendDigestsIfDue(b, now));
    }
  }

  private async step(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(`Việc hằng ngày - ${label} lỗi: ${(err as Error).message}`);
    }
  }

  async runDataHealthIfDue(now: Date): Promise<void> {
    const start = vnDayStart(vnDayKey(now))!;
    const ran = await this.prisma.dataHealthRun.findFirst({
      // Chỉ tính lần đã CHẠY XONG - lần lỗi giữa chừng (vd đồng bộ phát hiện quá thời gian) để lại dòng chưa có finishedAt, tính
      // cả nó thì cả ngày không kiểm lại (review 32.26).
      where: { trigger: 'CRON', startedAt: { gte: start }, finishedAt: { not: null } },
      select: { id: true },
    });
    if (ran) return;
    try {
      await this.dataHealth.run('CRON');
    } catch (err) {
      // Admin đang bấm "Kiểm ngay" cùng lúc - lần sau kiểm lại.
      if (!(err instanceof ConflictException)) throw err;
    }
  }

  /** Dòng có Hạn giao Trễ / Sắp tới hạn (đã có hạn, chưa đóng gói đủ). Mốc "Chưa biết" (nguồn đóng gói lỗi) không tính. */
  static deliveryAtRisk(board: MilestoneBoard): { row: MilestoneRow; cell: MilestoneCell }[] {
    return board.rows.flatMap((row) => {
      const cell = cellOf(row, 'HAN_GIAO');
      return cell && (cell.status === 'LATE' || cell.status === 'DUE_SOON') ? [{ row, cell }] : [];
    });
  }

  async syncDeliveryAlerts(board: MilestoneBoard): Promise<void> {
    const risky = DailyJobsService.deliveryAtRisk(board);
    const open = await this.prisma.notification.findMany({
      where: { type: 'DELIVERY_AT_RISK', recipients: { some: { resolvedAt: null } } },
      select: { entityId: true, data: true },
    });
    const openData = new Map(
      open.map((n) => [
        n.entityId ?? '',
        (n.data ?? {}) as Partial<DeliveryAtRiskNotificationParams>,
      ]),
    );

    for (const { row, cell } of risky) {
      const dong = cellOf(row, 'DONG_GOI');
      const params: DeliveryAtRiskNotificationParams = {
        piCode: row.piCode,
        skuCode: row.skuCode,
        deliveryDate: ddmmyyyy(cell.deadline!),
        daysLeft: cell.daysLeft!,
        packed: dong?.done ?? 0,
        total: dong?.need ?? row.quantity,
      };
      const prev = openData.get(row.itemId);
      // Gộp vào thông báo đang mở sẽ đặt lại "chưa đọc" cho cả Sếp/KHSX/QLSX -> chỉ gửi lại khi sang ngày mới (số ngày còn lại
      // đổi), KHÔNG gửi lại mỗi lần đóng thêm thùng (review 32.26: ngày đóng gói sẽ bị báo lại mỗi 10 phút). Số đã đóng trong
      // tin có thể cũ trong ngày - Bảng mốc luôn là số mới nhất.
      if (prev && prev.daysLeft === params.daysLeft) continue;
      await this.notifications.emit('DELIVERY_AT_RISK', {
        entityId: row.itemId,
        dedupeKey: `DELIVERY_AT_RISK:${row.itemId}`,
        params: params as unknown as Record<string, unknown>,
      });
    }

    // Đóng cảnh báo hết nguy cơ: đã đóng gói đủ, hết hạn mức nguy cơ, hoặc lệnh Kết thúc (không còn trên bảng). Dòng còn trên bảng
    // mà Hạn giao "Chưa biết" (nguồn lỗi) thì giữ nguyên - không đủ căn cứ để đóng.
    const stillRisky = new Set(risky.map((r) => r.row.itemId));
    const unknown = new Set(
      board.rows.filter((r) => cellOf(r, 'HAN_GIAO')?.status === 'UNKNOWN').map((r) => r.itemId),
    );
    for (const itemId of openData.keys()) {
      if (!itemId || stillRisky.has(itemId) || unknown.has(itemId)) continue;
      await this.notifications.resolve({
        entityType: DELIVERY_ENTITY,
        entityId: itemId,
        types: ['DELIVERY_AT_RISK'],
      });
    }
  }

  async sendDigestsIfDue(board: MilestoneBoard, now: Date): Promise<void> {
    const today = vnDayKey(now);
    if (vnHour(now) < DIGEST_HOUR_VN || this.digestDoneDay === today) return;
    const materialsPrefix = `MORNING_MATERIALS_DIGEST:${today}`;
    const productionKey = `MORNING_PRODUCTION_DIGEST:${today}`;
    const sent = new Set(
      (
        await this.prisma.notification.findMany({
          where: {
            OR: [{ dedupeKey: { startsWith: materialsPrefix } }, { dedupeKey: productionKey }],
          },
          select: { dedupeKey: true },
        })
      ).map((n) => n.dedupeKey ?? ''),
    );

    // Tin vật tư: mỗi người nhận 1 tin chỉ gồm vật tư của mình (NV mua theo vật tư phụ trách, thủ kho theo kho nhận).
    // Đóng tin hôm trước chỉ ở lần gửi ĐẦU TIÊN trong ngày - khởi động lại giữa chừng thì không đóng nhầm tin hôm nay đã gửi.
    if (![...sent].some((k) => k.startsWith(materialsPrefix))) {
      await this.notifications.resolve({
        entityType: DIGEST_ENTITY,
        entityId: 'materials',
        types: ['MORNING_MATERIALS_DIGEST'],
      });
    }
    for (const d of DailyJobsService.materialsDigests(board)) {
      const key = `${materialsPrefix}:${d.recipientKey}`;
      if (sent.has(key)) continue;
      await this.notifications.emit('MORNING_MATERIALS_DIGEST', {
        entityId: 'materials',
        dedupeKey: key,
        params: d.params as unknown as Record<string, unknown>,
      });
    }

    if (!sent.has(productionKey)) {
      await this.notifications.resolve({
        entityType: DIGEST_ENTITY,
        entityId: 'production',
        types: ['MORNING_PRODUCTION_DIGEST'],
      });
      const params = DailyJobsService.productionDigest(board);
      if (params) {
        await this.notifications.emit('MORNING_PRODUCTION_DIGEST', {
          entityId: 'production',
          dedupeKey: productionKey,
          params: params as unknown as Record<string, unknown>,
        });
      }
    }
    this.digestDoneDay = today;
  }

  /**
   * Tin "vật tư cần về" cho TỪNG người nhận (review 32.26): vật tư có mốc mua đã trễ hoặc tới hạn HÔM NAY mà chưa về đủ.
   * Dòng mua gộp theo PI nên 1 dòng chung (sắt, đinh...) có ở mọi SKU của PI - gộp theo DÒNG MUA (id), lấy hạn gấp nhất, để
   * không đếm/ghi lặp; 2 dòng cùng vật tư khác chiều dài cây / quy cách nệm vẫn là 2 dòng (test thật 32.27). Mỗi NV mua
   * (`buyerId`) và mỗi kho nhận (`warehouseCode`) nhận 1 tin chỉ gồm vật tư của mình.
   */
  static materialsDigests(
    board: MilestoneBoard,
  ): { recipientKey: string; params: MaterialsDigestNotificationParams }[] {
    type Entry = MissingMaterial & { piCode: string; daysLeft: number };
    const byLine = new Map<string, Entry>();
    for (const row of board.rows) {
      for (const key of ['MUA_VT_KHUNG', 'MUA_VT_CON_LAI'] as const) {
        const cell = cellOf(row, key);
        if (!cell || cell.daysLeft === null || cell.daysLeft > 0) continue;
        if (cell.status !== 'LATE' && cell.status !== 'DUE_SOON') continue;
        for (const m of row.missing[key]) {
          const prev = byLine.get(m.lineId);
          if (!prev || cell.daysLeft < prev.daysLeft)
            byLine.set(m.lineId, { ...m, piCode: row.piCode, daysLeft: cell.daysLeft });
        }
      }
    }
    const entries = [...byLine.values()];
    const digestOf = (mine: Entry[]): MaterialsDigestNotificationParams => {
      // 1 câu cho mỗi (PI, số ngày): "PI-… (trễ 2 ngày): Sắt 0/67 cây, Sơn 0/100 kg".
      const groups = new Map<string, Entry[]>();
      for (const e of [...mine].sort((a, b) => a.daysLeft - b.daysLeft)) {
        const g = `${e.piCode}|${e.daysLeft}`;
        groups.set(g, [...(groups.get(g) ?? []), e]);
      }
      const lines = [...groups.values()].map(
        (es) =>
          `${es[0].piCode} (${lateText(es[0].daysLeft)}): ` +
          es.map((e) => `${e.name} ${fmt(e.receivedQty)}/${fmt(e.buyQty)} ${e.unit}`).join(', '),
      );
      return {
        dueToday: mine.filter((e) => e.daysLeft === 0).length,
        late: mine.filter((e) => e.daysLeft < 0).length,
        lines: joinLines(lines),
        buyerIds: [],
        warehouseCodes: [],
      };
    };
    const out: { recipientKey: string; params: MaterialsDigestNotificationParams }[] = [];
    for (const buyerId of new Set(entries.flatMap((e) => (e.buyerId ? [e.buyerId] : [])))) {
      out.push({
        recipientKey: `u:${buyerId}`,
        params: { ...digestOf(entries.filter((e) => e.buyerId === buyerId)), buyerIds: [buyerId] },
      });
    }
    for (const code of new Set(
      entries.flatMap((e) => (e.warehouseCode ? [e.warehouseCode] : [])),
    )) {
      out.push({
        recipientKey: `w:${code}`,
        params: {
          ...digestOf(entries.filter((e) => e.warehouseCode === code)),
          warehouseCodes: [code],
        },
      });
    }
    return out;
  }

  /** Mốc trễ / sắp tới hạn (mọi mốc, gồm cả mua vật tư - KHSX cần biết vì nó chặn sản xuất) + lệnh tới ngày Phôi mà chưa
   *  "Bắt đầu". null = không có gì để báo. */
  static productionDigest(board: MilestoneBoard): ProductionDigestNotificationParams | null {
    let late = 0;
    let dueSoon = 0;
    let notStarted = 0;
    const lines: string[] = [];
    for (const row of board.rows) {
      const bad = row.milestones.filter((m) => m.status === 'LATE' || m.status === 'DUE_SOON');
      late += bad.filter((m) => m.status === 'LATE').length;
      dueSoon += bad.filter((m) => m.status === 'DUE_SOON').length;
      const phoi = cellOf(row, 'PHOI');
      const waiting =
        row.floorStage === 'PENDING' &&
        phoi?.daysLeft != null &&
        phoi.daysLeft <= 0 &&
        phoi.status !== 'DONE';
      if (waiting) notStarted += 1;
      if (bad.length === 0 && !waiting) continue;
      const parts = bad.map((m) => `${m.label} ${lateText(m.daysLeft!)}`);
      if (waiting) parts.unshift('chưa bấm Bắt đầu');
      lines.push(`${row.piCode} · ${row.skuCode}: ${parts.join(', ')}`);
    }
    if (late + dueSoon + notStarted === 0) return null;
    return { late, dueSoon, notStarted, lines: joinLines(lines) };
  }
}
