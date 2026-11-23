import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  MfgStage,
  Prisma,
  ProductionBatchStatus,
  ProductionInvoiceStatus,
  ProductionOrderFloorStage,
} from '../../generated/prisma/client';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { CutAllocationService } from './cut-allocation.service';
import { FloorAdminService } from './floor-admin.service';
import { queueWorkshopIdsOfPis } from './floor-queue-workshop.util';
import { type FloorProgress, progressFrom } from './floor-stage-progress';
import type { FloorWorkerStage } from './dto/floor-worker.dto';

/** Lệnh đã đủ / xong còn hiện ở "Sản lượng theo lệnh" trong ngần này ngày (D5, 23/11/2026). */
export const STAGE_PROGRESS_RECENT_DAYS = 7;

const DAY_MS = 24 * 3_600_000;

const PI_SELECT = { id: true, code: true, deadline: true, phoiDoneAt: true } as const;
type PiRow = { id: bigint; code: string; deadline: Date | null; phoiDoneAt: Date | null };

/** Lệnh tổ Hàn / Sơn làm được (D2) - theo thứ tự hạn giao tăng dần, rồi mã lệnh. */
export interface StagePi {
  productionInvoiceId: bigint;
  code: string;
  deadline: Date | null;
  missingPieces: number;
}

/** 1 dòng của GET /floor/stage-progress. */
export interface StageProgressRow {
  productionInvoiceId: string;
  code: string;
  deadline: string | null;
  percent: number;
  missingPieces: number;
  complete: boolean;
  phoiDoneAt: string | null;
}

/** So sánh theo hạn giao tăng dần (không có hạn thì cuối), rồi mã lệnh. */
export function compareStagePi(
  a: { deadline: Date | null; code: string },
  b: { deadline: Date | null; code: string },
): number {
  const x = a.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
  const y = b.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
  if (x !== y) return x < y ? -1 : 1;
  return a.code.localeCompare(b.code);
}

/** Số mảnh còn thiếu của tổ trên 1 lệnh = cần − đã báo (đã chặn trần từng dòng). */
export function missingPiecesOf(p: Pick<FloorProgress, 'required' | 'reported'>): number {
  return Math.max(0, p.required - p.reported);
}

/**
 * Lệnh theo tổ (23/11/2026, bỏ hàng đợi xưởng): tập lệnh Hàn / Sơn công nhân tự chọn trên màn quét (spec 4.1 / 4.2 + D2) và
 * sản lượng theo lệnh cho QLSX (GET /floor/stage-progress). Không ghi gì vào DB.
 */
@Injectable()
export class FloorStageService {
  private readonly logger = new Logger(FloorStageService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly steelIssues: SteelIssuesService,
    private readonly productionBatches: ProductionBatchesService,
    private readonly cutAllocation: CutAllocationService,
    private readonly workshopScope: WorkshopScopeService,
    private readonly admin: FloorAdminService,
  ) {}

  // ─── Tập lệnh Hàn / Sơn (D2) ─────────────────────────────────────────────────

  /**
   * Lệnh L tổ `stage` (HAN / SON) của xưởng `workshopId` thấy khi đủ CẢ:
   * 1. L chưa DONE / CANCELLED; 2. có ≥ 1 SKU floorStage ACTIVE; 3. xưởng của tổ đó làm lệnh = xưởng (Hàn: xưởng của lệnh;
   *    Sơn: NƠI SƠN = Workshop.paintWorkshopId ?? xưởng của lệnh - Phước An không có tổ Sơn, lệnh Phước An sơn ở Phú An, chốt 23/11);
   * 4. upstream đạt KCS (Hàn: có mảnh Phôi đạt; Sơn: có khung Hàn đạt) HOẶC tổ đã từng báo cho L;
   * 5. tổ chưa báo đủ số (`complete` thì ẩn; KCS chấm lỗi làm số tụt thì tự hiện lại).
   * `workshopId` null = mọi xưởng. Thứ tự: hạn giao tăng dần, rồi mã lệnh.
   */
  async listReportablePis(
    stage: MfgStage,
    workshopId: bigint | null,
    onlyPiIds?: bigint[],
  ): Promise<StagePi[]> {
    const rows = await this.listEligible(stage, workshopId, onlyPiIds);
    const progress = await this.progressMap(
      stage,
      rows.map((r) => r.id),
    );
    return rows
      .map((r) => ({ r, p: progress.get(r.id.toString()) ?? null }))
      .filter(({ p }) => !p?.complete)
      .map(({ r, p }) => ({
        productionInvoiceId: r.id,
        code: r.code,
        deadline: r.deadline,
        missingPieces: p ? missingPiecesOf(p) : 0,
      }))
      .sort(compareStagePi);
  }

  /** Lệnh đạt điều kiện 1-4 (chưa xét "đủ số"). */
  private async listEligible(stage: MfgStage, workshopId: bigint | null, onlyPiIds?: bigint[]) {
    const candidates = await this.prisma.productionInvoice.findMany({
      where: {
        ...(onlyPiIds ? { id: { in: onlyPiIds } } : {}),
        status: { notIn: [ProductionInvoiceStatus.DONE, ProductionInvoiceStatus.CANCELLED] },
        items: { some: { productionOrder: { floorStage: ProductionOrderFloorStage.ACTIVE } } },
      },
      select: PI_SELECT,
    });
    const inWorkshop = await this.filterByWorkshop(candidates, workshopId, stage);
    if (inWorkshop.length === 0) return [];
    const scopeIds = inWorkshop.map((c) => c.id);
    const [upstream, reported] = await Promise.all([
      this.pisWithUpstreamPassed(stage, scopeIds),
      this.pisWithOwnReports(stage, scopeIds),
    ]);
    return inWorkshop.filter((c) => upstream.has(c.id.toString()) || reported.has(c.id.toString()));
  }

  /** Lệnh tổ đã báo từ `since` (kể cả lệnh đã đủ số / đã xong / dừng) - để xem lại ở "Sản lượng theo lệnh". */
  private async listRecentlyReported(stage: MfgStage, workshopId: bigint | null, since: Date) {
    const batches = await this.prisma.productionBatch.findMany({
      where: { stage, reportedAt: { gte: since } },
      distinct: ['productionOrderId'],
      select: {
        productionOrder: {
          select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
        },
      },
    });
    const ids = [
      ...new Set(
        batches.flatMap((b) => {
          const id = b.productionOrder.productionInvoiceItem.productionInvoiceId;
          return id != null ? [id.toString()] : [];
        }),
      ),
    ].map((id) => BigInt(id));
    if (ids.length === 0) return [];
    const pis = await this.prisma.productionInvoice.findMany({
      where: { id: { in: ids }, status: { not: ProductionInvoiceStatus.CANCELLED } },
      select: PI_SELECT,
    });
    return this.filterByWorkshop(pis, workshopId, stage);
  }

  /**
   * Xưởng tổ `stage` làm lệnh: Phôi / Hàn = xưởng của SKU (lệnh chưa có xưởng = xưởng mặc định);
   * Sơn = nơi sơn (Workshop.paintWorkshopId ?? xưởng của lệnh), vd lệnh Phước An hiện ở tổ Sơn Phú An.
   */
  private async filterByWorkshop<T extends { id: bigint }>(
    pis: T[],
    workshopId: bigint | null,
    stage: MfgStage,
  ): Promise<T[]> {
    if (workshopId == null || pis.length === 0) return pis;
    const wsOf = await queueWorkshopIdsOfPis(
      this.prisma,
      stage,
      pis.map((p) => p.id),
    );
    return pis.filter((p) => wsOf.get(p.id.toString()) === workshopId);
  }

  /** Lệnh đã có đợt tổ TRƯỚC chấm KCS xong và số đạt > 0 (spec 4.1 / 4.2 điều kiện 4). */
  private async pisWithUpstreamPassed(stage: MfgStage, piIds: bigint[]): Promise<Set<string>> {
    const out = new Set<string>();
    const orderPi = {
      productionOrder: { productionInvoiceItem: { productionInvoiceId: { in: piIds } } },
    };
    const piOfOrder = {
      productionOrder: {
        select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
      },
    };
    // Khung Hàn đạt (Sơn) hoặc mảnh Phôi tự báo đạt (Hàn): reportedQty đã bị KCS ghi đè = số đạt.
    const batches = await this.prisma.productionBatch.findMany({
      where: {
        stage: stage === MfgStage.SON ? MfgStage.HAN : MfgStage.PHOI,
        status: ProductionBatchStatus.QC_DONE,
        reportedQty: { gt: 0 },
        ...orderPi,
      },
      distinct: ['productionOrderId'],
      select: piOfOrder,
    });
    for (const b of batches) {
      const id = b.productionOrder.productionInvoiceItem.productionInvoiceId;
      if (id != null) out.add(id.toString());
    }
    if (stage === MfgStage.SON) return out;

    // Điều kiện "tồn tại đợt đã chấm xong mà số đạt > 0": gộp ở DB (EXISTS theo từng nguồn), KHÔNG tải dòng về.
    // Đạt của 1 đợt = số đã báo - Σ(lỗi + thiếu) của các phiếu chấm.
    const ids = Prisma.join(piIds);
    const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
      SELECT si."productionInvoiceId" AS id
      FROM cut_bundles cb JOIN steel_issues si ON si.id = cb."steelIssueId"
      WHERE cb.status::text = 'QC_PASSED' AND si."productionInvoiceId" IN (${ids})
        AND COALESCE((SELECT SUM(s.qty) FROM cut_pattern_segments s WHERE s."cutBundleId" = cb.id), 0)
          - COALESCE((SELECT SUM(r."failedQty" + r."shortQty") FROM qc_reviews r WHERE r."cutBundleId" = cb.id), 0) > 0
      UNION
      SELECT sb."productionInvoiceId" AS id
      FROM step_bundles sb
      WHERE sb.status::text = 'QC_PASSED' AND sb."productionInvoiceId" IN (${ids})
        AND COALESCE((SELECT SUM(g.qty) FROM step_batches b JOIN step_batch_segments g ON g."stepBatchId" = b.id
                      WHERE b."stepBundleId" = sb.id), 0)
          - COALESCE((SELECT SUM(r."failedQty" + r."shortQty") FROM qc_reviews r WHERE r."stepBundleId" = sb.id), 0) > 0
      UNION
      SELECT it."productionInvoiceId" AS id
      FROM piece_step_bundles pb
      JOIN production_orders po ON po.id = pb."productionOrderId"
      JOIN production_invoice_items it ON it.id = po."productionInvoiceItemId"
      WHERE pb.status::text = 'QC_PASSED' AND it."productionInvoiceId" IN (${ids})
        AND pb.qty - COALESCE((SELECT SUM(r."failedQty" + r."shortQty") FROM qc_reviews r WHERE r."pieceStepBundleId" = pb.id), 0) > 0
      UNION
      SELECT mb."productionInvoiceId" AS id
      FROM material_yield_step_bundles mb
      WHERE mb.status::text = 'QC_PASSED' AND mb."productionInvoiceId" IN (${ids})
        AND mb.qty - COALESCE((SELECT SUM(r."failedQty" + r."shortQty") FROM qc_reviews r WHERE r."materialYieldStepBundleId" = mb.id), 0) > 0`;
    for (const r of rows) out.add(r.id.toString());
    return out;
  }

  /** Lệnh mà tổ đã từng báo (có ProductionBatch của tổ) - lệnh cũ làm dở theo hàng đợi không biến mất khỏi màn quét. */
  private async pisWithOwnReports(
    stage: MfgStage,
    piIds: bigint[],
    since?: Date,
  ): Promise<Set<string>> {
    const rows = await this.prisma.productionBatch.findMany({
      where: {
        stage,
        ...(since ? { reportedAt: { gte: since } } : {}),
        productionOrder: { productionInvoiceItem: { productionInvoiceId: { in: piIds } } },
      },
      distinct: ['productionOrderId'],
      select: {
        productionOrder: {
          select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
        },
      },
    });
    return new Set(
      rows.flatMap((r) => {
        const id = r.productionOrder.productionInvoiceItem.productionInvoiceId;
        return id != null ? [id.toString()] : [];
      }),
    );
  }

  // ─── Tiến độ theo lệnh ───────────────────────────────────────────────────────

  /**
   * Tiến độ của tổ trên nhiều lệnh, tải gộp (vài truy vấn cho cả lô). Khoá = id lệnh dạng chuỗi. Lệnh tính lỗi bị BỎ khỏi kết
   * quả (người gọi coi là "không biết", không coi là đủ).
   */
  async progressMap(stage: MfgStage, piIds: bigint[]): Promise<Map<string, FloorProgress>> {
    const out = new Map<string, FloorProgress>();
    if (piIds.length === 0) return out;
    try {
      const orders = await this.prisma.productionOrder.findMany({
        where: { productionInvoiceItem: { productionInvoiceId: { in: piIds } } },
        select: { id: true, productionInvoiceItem: { select: { productionInvoiceId: true } } },
        orderBy: { id: 'asc' },
      });
      const plans =
        orders.length > 0
          ? await this.productionBatches.getBatchPlanBatch(
              orders.map((o) => o.id.toString()),
              stage,
            )
          : {};
      const phoi =
        stage === MfgStage.PHOI
          ? await this.steelIssues.getPhoiProgressBatch(piIds.map((id) => id.toString()))
          : null;
      const plansByPi = new Map<string, typeof plans>();
      for (const o of orders) {
        const plan = plans[o.id.toString()];
        if (!plan) continue;
        const piId = o.productionInvoiceItem.productionInvoiceId;
        if (piId == null) continue;
        const key = piId.toString();
        const bucket = plansByPi.get(key) ?? {};
        bucket[o.id.toString()] = plan;
        plansByPi.set(key, bucket);
      }
      for (const id of piIds) {
        const key = id.toString();
        if (phoi && !phoi[key]) continue;
        out.set(
          key,
          progressFrom({
            phoi: phoi ? phoi[key] : null,
            plans: plansByPi.get(key) ?? {},
            orders: [],
          }),
        );
      }
    } catch (e) {
      this.logger.error(`Không tính được tiến độ ${stage}: ${(e as Error).message}`);
    }
    return out;
  }

  // ─── GET /floor/stage-progress ───────────────────────────────────────────────

  /** Chỉ QLSX / BOSS / ADMIN, hoặc tài khoản tổ đúng tổ đang xem (KCS và tổ khác không xem được). */
  assertCanViewStage(user: AuthenticatedUser, stage: FloorWorkerStage): void {
    const roles = user.roles ?? [];
    const manager =
      roles.includes(BUSINESS_ROLES.PRODUCTION_MANAGER) ||
      roles.includes(BUSINESS_ROLES.BOSS) ||
      roles.includes(DEFAULT_ROLES.ADMIN);
    if (manager || user.mfgRole === stage) return;
    throw new ForbiddenException('Bạn không xem được sản lượng của tổ này');
  }

  /** QLSX gắn xưởng chỉ xem xưởng mình (truyền xưởng khác -> 403); người khác tuỳ chọn, không truyền = mọi xưởng. */
  private async resolveWorkshop(userId: string, requested?: string): Promise<bigint | null> {
    const scope = await this.workshopScope.getScope(userId);
    const asked = requested ? parseBigIntId(requested) : null;
    if (scope.workshopId != null) {
      this.workshopScope.assertCanManage(scope, [asked], 'sản lượng này');
      return scope.workshopId;
    }
    return asked;
  }

  async listProgress(
    user: AuthenticatedUser,
    stage: FloorWorkerStage,
    workshopIdRaw?: string,
    now: Date = new Date(),
    productionInvoiceIds?: string,
  ): Promise<StageProgressRow[]> {
    this.assertCanViewStage(user, stage);
    const workshopId = await this.resolveWorkshop(user.id, workshopIdRaw);
    const since = new Date(now.getTime() - STAGE_PROGRESS_RECENT_DAYS * DAY_MS);
    const mfg = MfgStage[stage];

    const base = new Map<string, PiRow>();
    const wanted = (productionInvoiceIds ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x !== '');
    if (wanted.length > 0) {
      // Hỏi đích danh các lệnh: không áp cửa sổ 7 ngày, vẫn lọc xưởng (QLSX gắn xưởng không thấy lệnh xưởng khác).
      const ids = [...new Set(wanted)].slice(0, 200).map((id) => parseBigIntId(id));
      const found = await this.prisma.productionInvoice.findMany({
        where: { id: { in: ids } },
        select: PI_SELECT,
      });
      for (const r of await this.filterByWorkshop(found, workshopId, mfg))
        base.set(r.id.toString(), r);
    } else {
      await this.collectScope(base, stage, mfg, workshopId, since);
    }
    const rows = [...base.values()].sort(compareStagePi);
    const progress = await this.progressMap(
      mfg,
      rows.map((r) => r.id),
    );
    return rows.map((r) => {
      const p = progress.get(r.id.toString()) ?? null;
      return {
        productionInvoiceId: r.id.toString(),
        code: r.code,
        deadline: r.deadline?.toISOString() ?? null,
        percent: p?.percent ?? 0,
        missingPieces: p ? missingPiecesOf(p) : 0,
        complete: p?.complete ?? false,
        phoiDoneAt: r.phoiDoneAt?.toISOString() ?? null,
      };
    });
  }

  /** Phạm vi mặc định: lệnh đang thấy (Hàn / Sơn) hoặc đang trong bảng chia (Phôi) + lệnh đã đủ / xong trong 7 ngày gần nhất. */
  private async collectScope(
    base: Map<string, PiRow>,
    stage: FloorWorkerStage,
    mfg: MfgStage,
    workshopId: bigint | null,
    since: Date,
  ): Promise<void> {
    if (stage === 'PHOI') {
      const wsIds =
        workshopId != null
          ? [workshopId]
          : (
              await this.prisma.workshop.findMany({
                where: { isActive: true },
                select: { id: true },
              })
            ).map((w) => w.id);
      const wanted = new Set<string>();
      for (const w of wsIds) {
        for (const p of await this.cutAllocation.getWorkshopAllocationPis(w)) {
          wanted.add(p.productionInvoiceId);
        }
      }
      const recentDone = await this.prisma.productionInvoice.findMany({
        where: { phoiDoneAt: { gte: since } },
        select: PI_SELECT,
      });
      for (const r of await this.filterByWorkshop(recentDone, workshopId, MfgStage.PHOI)) {
        base.set(r.id.toString(), r);
      }
      const inBoard = await this.prisma.productionInvoice.findMany({
        where: { id: { in: [...wanted].map((id) => BigInt(id)) } },
        select: PI_SELECT,
      });
      for (const r of inBoard) base.set(r.id.toString(), r);
      return;
    }
    for (const r of await this.listEligible(mfg, workshopId)) base.set(r.id.toString(), r);
    for (const r of await this.listRecentlyReported(mfg, workshopId, since)) {
      base.set(r.id.toString(), r);
    }
  }

  // ─── GET /floor/stage-progress/:stage/:productionInvoiceId ───────────────────

  /** Thân y hệt GET /floor/queue/:stage/detail/:pi cũ (FloorAdminService.stageDetail), chặn theo vai và xưởng. */
  async detail(user: AuthenticatedUser, stage: FloorWorkerStage, productionInvoiceId: string) {
    this.assertCanViewStage(user, stage);
    const scope = await this.workshopScope.getScope(user.id);
    if (scope.workshopId != null) {
      const piId = parseBigIntId(productionInvoiceId);
      // Sơn: QLSX nơi sơn (Phú An) xem được lệnh Phước An sơn nhờ.
      const wsOf = await queueWorkshopIdsOfPis(this.prisma, MfgStage[stage], [piId]);
      this.workshopScope.assertCanManage(scope, [wsOf.get(piId.toString())], 'lệnh này');
    }
    return this.admin.stageDetail(stage, productionInvoiceId);
  }
}
