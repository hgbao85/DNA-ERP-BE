import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { vnDayKey } from '../../common/utils/floor-stats.util';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DataHealthNotificationParams,
  NOTIFICATION_TYPES,
} from '../notifications/notification-types';
import {
  DATA_HEALTH_CHECKS,
  DataHealthCheck,
  DataHealthColumn,
  DataHealthSeverity,
  ROW_LIMIT,
} from './data-health.checks';

/** CRON = lần tự chạy hằng ngày (DailyJobsService, hẹn giờ trong app), MANUAL = Admin bấm "Kiểm ngay". */
export type DataHealthTrigger = 'CRON' | 'MANUAL';

/** entityType/entityId của thông báo "bất thường mới" - resolve() đóng nó khi không còn dòng nào mở. */
export const DATA_HEALTH_ENTITY = { entityType: 'DATA_HEALTH', entityId: 'open' } as const;

const BUSY_MESSAGE = 'Đang kiểm tra dữ liệu - thử lại sau ít phút';
const LOCK_KEY = 'data-health';
/** Đủ cho cả các phép kiểm + ghi phát hiện (mỗi phép kiểm transaction riêng tối đa 60 s). Lần chưa xong quá mốc này coi như
 *  đã dừng (tiến trình chết giữa chừng). */
const RUN_TIMEOUT_MS = 10 * 60_000;

type DetailValue = string | number | boolean | null;
type Detail = Record<string, DetailValue>;

export interface DataHealthFindingView {
  id: string;
  entityKey: string;
  detail: Detail;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Thấy lần đầu (hoặc thấy lại sau khi đã hết) ở lần chạy gần nhất. */
  isNew: boolean;
}

export interface DataHealthCheckView {
  code: string;
  title: string;
  severity: DataHealthSeverity;
  description: string;
  hint: string;
  columns: DataHealthColumn[];
  /** Số dòng của lần chạy gần nhất; -1 = phép kiểm lỗi; null = chưa chạy lần nào. */
  lastCount: number | null;
  /** Lần chạy gần nhất chạm trần ROW_LIMIT - còn dòng chưa hiện. */
  truncated: boolean;
  findings: DataHealthFindingView[];
}

export interface DataHealthRunView {
  id: string;
  trigger: DataHealthTrigger;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

export interface DataHealthReport {
  /** Lần đã chạy xong gần nhất - số liệu các thẻ theo lần này. */
  lastRun: DataHealthRunView | null;
  /** Lần mới hơn `lastRun` mà chưa xong: đang chạy (error null) hoặc đã dừng giữa chừng (có error). */
  pendingRun: DataHealthRunView | null;
  totalOpen: number;
  newCount: number;
  checks: DataHealthCheckView[];
}

/**
 * "Kiểm tra dữ liệu" mỗi ngày (2026-10-28, changelog 2026-09-25 mục 32.19-32.20; từ 32.24 tự chạy bằng DailyJobsService - lần
 * đầu máy chủ thức trong ngày - thay lịch GitHub Actions): chạy lần lượt các phép kiểm CHỈ ĐỌC ở
 * data-health.checks.ts, gom kết quả thành phát hiện theo (checkCode, entityKey) để biết dòng nào mới / đã có / đã hết, rồi báo
 * Admin khi có dòng MỚI. Không sửa dữ liệu nghiệp vụ nào.
 *
 * Phép kiểm lỗi SQL không làm hỏng các phép kiểm khác: ghi -1 vào summary + lý do vào run.error, và KHÔNG đóng các phát hiện cũ
 * của nó (không chạy được thì không biết chúng đã hết hay chưa).
 */
@Injectable()
export class DataHealthService {
  private readonly logger = new Logger(DataHealthService.name);
  private running = false;
  /** Danh sách phép kiểm - test thay bằng bộ giả qua thuộc tính này (không qua DI). */
  checks: DataHealthCheck[] = DATA_HEALTH_CHECKS;

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly notifications: NotificationsService,
  ) {}

  async run(trigger: DataHealthTrigger, triggeredById?: string): Promise<DataHealthReport> {
    if (this.running) {
      throw new ConflictException(BUSY_MESSAGE);
    }
    this.running = true;
    try {
      // Khoá cho MỌI tiến trình (test thật 32.27, L1): cờ `running` chỉ chặn trong 1 tiến trình - "Kiểm ngay" trúng tiến trình B
      // lúc tiến trình A đang tự chạy thì 2 lần cùng tạo phát hiện, đụng unique và bỏ dở. Khoá theo transaction như DailyJobs
      // (vẫn đúng khi DB đi qua bộ gộp kết nối); các bước ghi dùng kết nối khác, khoá nhả khi transaction kết thúc.
      await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})::bigint) AS locked`;
          if (!locked) throw new ConflictException(BUSY_MESSAGE);
          await this.execute(trigger, triggeredById);
        },
        { timeout: RUN_TIMEOUT_MS, maxWait: 10_000 },
      );
      return this.getReport();
    } finally {
      this.running = false;
    }
  }

  private async execute(trigger: DataHealthTrigger, triggeredById?: string): Promise<void> {
    const run = await this.prisma.dataHealthRun.create({
      data: { trigger, triggeredById: triggeredById ?? null },
    });
    const now = run.startedAt;
    const summary: Record<string, number> = {};
    const errors: string[] = [];
    const failed: string[] = [];
    let newCount = 0;
    const newByCheck: { title: string; count: number }[] = [];
    const fail = (check: DataHealthCheck, what: string, e: unknown) => {
      summary[check.code] = -1;
      failed.push(check.title);
      errors.push(`${check.code}: ${what} - ${shortReason(e)}`);
      this.logger.error(`Data health check ${check.code} ${what} failed: ${(e as Error).message}`);
    };

    try {
      for (const check of this.checks) {
        let rows: Record<string, unknown>[];
        try {
          rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(check.sql);
        } catch (e) {
          fail(check, 'chạy SQL', e);
          continue;
        }
        summary[check.code] = rows.length;
        // Ghi phát hiện lỗi (quá thời gian transaction, đụng unique...) cũng chỉ hỏng phép kiểm đó (test thật 32.27, L2): trước
        // đây lỗi văng khỏi cả lần chạy - các phép kiểm trước đã ghi dòng mới nhưng không ai được báo, lần sau thành dòng cũ.
        try {
          const added = await this.syncFindings(check.code, rows, now, rows.length >= ROW_LIMIT);
          if (added > 0) {
            newCount += added;
            newByCheck.push({ title: check.title, count: added });
          }
        } catch (e) {
          fail(check, 'ghi phát hiện', e);
        }
      }

      await this.prisma.dataHealthRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          summary,
          error: errors.length > 0 ? errors.join('\n') : null,
        },
      });
    } catch (e) {
      // Lỗi ngoài từng phép kiểm (mất kết nối DB...): ghi lý do để trang không hiện lần dở như "chưa kiểm"; KHÔNG đặt finishedAt
      // để việc hằng ngày còn chạy lại trong ngày.
      await this.prisma.dataHealthRun
        .update({
          where: { id: run.id },
          data: {
            summary,
            error: [...errors, `Dừng giữa chừng: ${shortReason(e)}`].join('\n'),
          },
        })
        .catch(() => undefined);
      // Dòng mới các phép kiểm trước đã ghi: lần chạy lại sau sẽ coi là dòng cũ - báo ngay bây giờ (cố gắng, lỗi thì thôi).
      if (newCount > 0) {
        const open = await this.prisma.dataHealthFinding
          .count({ where: { resolvedAt: null } })
          .catch(() => newCount);
        await this.notify({
          newCount,
          newByCheck,
          failed,
          totalOpen: open,
          now,
          actorId: triggeredById,
        });
      }
      throw e;
    }

    const totalOpen = await this.prisma.dataHealthFinding.count({ where: { resolvedAt: null } });
    await this.notify({ newCount, newByCheck, failed, totalOpen, now, actorId: triggeredById });
  }

  /**
   * Đồng bộ phát hiện của 1 phép kiểm với kết quả vừa chạy. Trả về số dòng MỚI (chưa từng thấy, hoặc thấy lại sau khi đã hết).
   * Dòng cũ không còn thấy -> resolvedAt, TRỪ khi kết quả chạm trần ROW_LIMIT (`truncated`): lúc đó dòng vắng có thể chỉ bị đẩy
   * ra ngoài 500 dòng chứ chưa hết - đóng nó thì lần sau quay vào lại thành "mới" giả (test thật 32.27, L3). Gói trong 1
   * transaction để lần chạy giữa chừng hỏng không để lại nửa vời.
   */
  private async syncFindings(
    checkCode: string,
    rows: Record<string, unknown>[],
    now: Date,
    truncated = false,
  ): Promise<number> {
    const seen = new Map<string, Detail>();
    for (const row of rows) {
      const { entity_key: key, ...rest } = row;
      if (typeof key !== 'string' || key === '') continue;
      seen.set(key, toDetail(rest));
    }
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.dataHealthFinding.findMany({
          where: { checkCode },
          select: { id: true, entityKey: true, resolvedAt: true },
        });
        const byKey = new Map(existing.map((f) => [f.entityKey, f]));
        // Chạm trần mà phép kiểm vốn đã có dòng mở: khoá chưa từng lưu có thể chỉ là dòng CŨ trước đây nằm ngoài 500 dòng, nay
        // lọt vào cửa sổ - vẫn lưu nhưng không tính "mới" để không báo giả (test thật vòng 2, R2-1). Lần đầu chạm trần (chưa có
        // dòng mở nào) thì vẫn tính đủ để Admin được báo.
        const countBrandNew = !(truncated && existing.some((f) => f.resolvedAt === null));
        let added = 0;
        const toCreate: Prisma.DataHealthFindingCreateManyInput[] = [];
        for (const [entityKey, detail] of seen) {
          const prev = byKey.get(entityKey);
          if (!prev) {
            toCreate.push({ checkCode, entityKey, detail, firstSeenAt: now, lastSeenAt: now });
          } else if (prev.resolvedAt) {
            await tx.dataHealthFinding.update({
              where: { id: prev.id },
              data: { detail, firstSeenAt: now, lastSeenAt: now, resolvedAt: null },
            });
            added++;
          } else {
            await tx.dataHealthFinding.update({
              where: { id: prev.id },
              data: { detail, lastSeenAt: now },
            });
          }
        }
        if (toCreate.length > 0) {
          // Phòng hờ: khoá ở run() đã chặn 2 lần chạy chồng; dòng lỡ trùng thì bỏ qua và không tính là mới.
          const created = await tx.dataHealthFinding.createMany({
            data: toCreate,
            skipDuplicates: true,
          });
          if (countBrandNew) added += created.count;
        }
        const gone = truncated
          ? []
          : existing
              .filter((f) => f.resolvedAt === null && !seen.has(f.entityKey))
              .map((f) => f.id);
        if (gone.length > 0) {
          await tx.dataHealthFinding.updateMany({
            where: { id: { in: gone } },
            data: { resolvedAt: now },
          });
        }
        return added;
      },
      { timeout: 60_000 },
    );
  }

  /**
   * Có dòng mới hoặc phép kiểm lỗi -> báo Admin (gộp 1 thông báo/ngày). Hết sạch dòng mở và không phép kiểm nào lỗi -> đóng
   * thông báo đang mở. Lỗi báo không làm hỏng lần chạy.
   *  - Số "mới" CỘNG DỒN với thông báo đang mở hôm nay (trước đây lần sau ghi đè: "10 mới" thành "1 mới", test thật 32.27).
   *  - Phép kiểm lỗi lấy theo lần chạy này (là tình trạng, không phải sự kiện) - người dùng chốt Q5 có báo (32.27).
   */
  private async notify(input: {
    newCount: number;
    newByCheck: { title: string; count: number }[];
    failed: string[];
    totalOpen: number;
    now: Date;
    actorId?: string;
  }): Promise<void> {
    const { newCount, newByCheck, failed, totalOpen, now, actorId } = input;
    try {
      if (totalOpen === 0 && failed.length === 0) {
        await this.notifications.resolve(DATA_HEALTH_ENTITY);
        return;
      }
      const dedupeKey = `DATA_HEALTH_NEW_FINDINGS:${vnDate(now)}`;
      const prev = await this.prisma.notification.findFirst({
        where: { dedupeKey, recipients: { some: { resolvedAt: null } } },
        select: { id: true, data: true },
      });
      const prevParams = (prev?.data ?? {}) as Partial<DataHealthNotificationParams>;
      const byCheck: Record<string, number> = { ...prevParams.byCheck };
      for (const c of newByCheck) byCheck[c.title] = (byCheck[c.title] ?? 0) + c.count;
      const params: DataHealthNotificationParams = {
        newCount: Object.values(byCheck).reduce((a, n) => a + n, 0),
        totalOpen,
        breakdown: Object.entries(byCheck)
          .map(([title, count]) => `${title}: ${count}`)
          .join('; '),
        byCheck,
        failedCount: failed.length,
        failed: failed.join('; '),
      };
      if (newCount === 0) {
        // Không có dòng mới (test thật vòng 2, R2-2 / R2-4):
        //  - phép kiểm đã hết lỗi -> sửa lại nội dung thông báo đang mở cho khỏi ghi "phép kiểm lỗi", KHÔNG đặt lại "chưa đọc";
        //  - vẫn lỗi y như thông báo đang mở -> không gửi lại (mỗi lần "Kiểm ngay" sẽ bật "chưa đọc" cho mọi Admin);
        //  - không có gì để báo -> thôi.
        if (prev && (prevParams.failedCount ?? 0) > 0 && failed.length === 0) {
          const def = NOTIFICATION_TYPES.DATA_HEALTH_NEW_FINDINGS;
          await this.prisma.notification.update({
            where: { id: prev.id },
            data: {
              title: def.title(params),
              message: def.message(params),
              data: params as unknown as Prisma.InputJsonValue,
            },
          });
          return;
        }
        if (failed.length === 0 || (prev && prevParams.failed === params.failed)) return;
      }
      await this.notifications.emit('DATA_HEALTH_NEW_FINDINGS', {
        entityId: DATA_HEALTH_ENTITY.entityId,
        dedupeKey,
        actorId: actorId ?? null,
        params: params as unknown as Record<string, unknown>,
      });
    } catch (e) {
      this.logger.error(`Data health notify failed: ${(e as Error).message}`);
    }
  }

  async getReport(now: Date = new Date()): Promise<DataHealthReport> {
    // Số liệu theo lần ĐÃ CHẠY XONG gần nhất (test thật 32.27, L2): trước đây lấy lần mới nhất kể cả lần dở, nên 1 lần hỏng giữa
    // chừng làm mọi thẻ hiện "chưa kiểm". Lần mới hơn mà chưa xong (đang chạy / dừng giữa chừng) trả riêng ở `pendingRun`.
    const lastRun = await this.prisma.dataHealthRun.findFirst({
      where: { finishedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
    });
    const pending = await this.prisma.dataHealthRun.findFirst({
      where: { finishedAt: null, ...(lastRun ? { startedAt: { gt: lastRun.startedAt } } : {}) },
      orderBy: { startedAt: 'desc' },
    });
    const open = await this.prisma.dataHealthFinding.findMany({
      where: { resolvedAt: null },
      orderBy: [{ firstSeenAt: 'desc' }, { entityKey: 'asc' }],
    });
    const summary = (lastRun?.summary ?? null) as Record<string, number> | null;
    const runStarted = lastRun?.startedAt.getTime() ?? null;
    let newCount = 0;
    const checks: DataHealthCheckView[] = this.checks.map((check) => {
      const findings = open
        .filter((f) => f.checkCode === check.code)
        .map((f) => {
          const isNew = runStarted !== null && f.firstSeenAt.getTime() >= runStarted;
          if (isNew) newCount++;
          return {
            id: f.id.toString(),
            entityKey: f.entityKey,
            detail: f.detail as Detail,
            firstSeenAt: f.firstSeenAt,
            lastSeenAt: f.lastSeenAt,
            isNew,
          };
        });
      const lastCount = summary && check.code in summary ? summary[check.code] : null;
      return {
        code: check.code,
        title: check.title,
        severity: check.severity,
        description: check.description,
        hint: check.hint,
        columns: check.columns,
        lastCount,
        truncated: lastCount === ROW_LIMIT,
        findings,
      };
    });
    const view = (r: NonNullable<typeof lastRun>): DataHealthRunView => ({
      id: r.id.toString(),
      trigger: r.trigger as DataHealthTrigger,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      error: r.error,
    });
    // Lần chưa xong quá thời hạn chạy mà vẫn không có lý do: tiến trình đã chết giữa chừng (deploy, mất điện) - hiện "dừng giữa
    // chừng" thay vì "đang chạy" mãi tới lần sau (review 32.27, N5).
    const pendingView = pending ? view(pending) : null;
    if (
      pendingView &&
      !pendingView.error &&
      now.getTime() - pendingView.startedAt.getTime() > RUN_TIMEOUT_MS
    ) {
      pendingView.error =
        'Không thấy lần kiểm kết thúc - máy chủ có thể đã khởi động lại giữa chừng.';
    }
    return {
      lastRun: lastRun ? view(lastRun) : null,
      pendingRun: pendingView,
      totalOpen: open.length,
      newCount,
      checks,
    };
  }
}

/** Ngày theo giờ Việt Nam (UTC+7) - lần chạy lúc 0h-7h sáng VN vẫn là ngày hôm trước theo UTC, gộp thông báo theo ngày UTC
 *  sẽ dồn nhầm sang hôm trước. */
const vnDate = vnDayKey;

/** Lý do ngắn lưu cho Admin xem: thông điệp Prisma nhiều dòng kèm đường dẫn máy chủ + trích đoạn code - chỉ giữ dòng cuối (lý
 *  do thật, vd "Unique constraint failed on the fields: …"). Log máy chủ vẫn ghi đủ (test thật vòng 2, R2-3). */
function shortReason(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? 'Lỗi không rõ';
  return last.length > 300 ? `${last.slice(0, 300)}…` : last;
}

/** Kết quả $queryRaw -> JSON lưu được: Decimal -> số, BigInt -> chuỗi, Date -> 'YYYY-MM-DD'. */
export function toDetail(row: Record<string, unknown>): Detail {
  const out: Detail = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === 'bigint') out[k] = v.toString();
    else if (v instanceof Date) out[k] = v.toISOString().slice(0, 10);
    else if (Prisma.Decimal.isDecimal(v)) out[k] = v.toNumber();
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}
