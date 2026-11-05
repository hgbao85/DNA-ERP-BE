import { Inject, Injectable, Logger } from '@nestjs/common';
import { MfgStage } from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { vnDayKey, vnDayStart } from '../../common/utils/floor-stats.util';
import { addDays, isDayKey } from '../../common/utils/timeline-suggest.util';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { ProductionInvoicesService } from '../production-invoices/production-invoices.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { WeavingIssuesService } from '../weaving-issues/weaving-issues.service';
import { evaluateDailyOutput, unitsToCont, type OutputLine } from './daily-output.rules';
import { rangeCovers, stageRangesOf, type StageRange } from './production-capacity.ranges';
import { ProductionCapacityService } from './production-capacity.service';
import {
  DAILY_OUTPUT_REQUIRES_PHOI_START,
  type CapacityStage,
  type DailyOutputAlert,
} from './production-capacity.types';

/** Số đơn vị làm theo ngày VN của 1 khoá (đơn hàng / PI / dòng). */
type UnitsByDay = Map<string, Record<string, number>>;

const bump = (m: UnitsByDay, key: string, day: string, qty: number) => {
  const cur = m.get(key) ?? {};
  cur[day] = (cur[day] ?? 0) + qty;
  m.set(key, cur);
};

/**
 * Phần A – Đợt 3 (YC10 10.4, 10.15; V4-12, V4-13): cảnh báo "công đoạn làm chưa đủ 1 cont trong ngày" - tin sáng (daily-jobs)
 * chấm NGÀY HÔM QUA. Luật chấm ở `daily-output.rules.ts` (thuần); file này chỉ gom số đã làm theo lô (where `in`, 1 truy vấn
 * mỗi nguồn - không truy vấn từng dòng):
 *  - Hàn / Sơn: FloorReport PIECE (bỏ lần huỷ), Σ lines.qty ÷ Σ plannedQty (getBatchPlanBatch).
 *  - Nhập đan: WeavingReceipt.qty ÷ Σ totalQty (getIssuePlanBatch).
 *  - Chuyền kiểm: TransferCheckResult.checkedQty ÷ Σ totalQty (listTransferCheckPiecesBatch).
 *  - Đóng gói: PackagingRecord.boxesPacked ĐÃ là bộ -> bộ ÷ loadCont.
 *  - Phôi (ước tính): FloorReport CUT theo PI, Σ lines.qty ÷ Σ required các đoạn cắt (getPhoiProgressBatch); cont của PI chia
 *    cho các dòng có khoảng Phôi phủ ngày đó theo cont từng dòng.
 * Nguồn lỗi / tổng cần = 0 -> bỏ dòng đó ở công đoạn đó (không báo oan).
 */
@Injectable()
export class DailyOutputService {
  private readonly logger = new Logger(DailyOutputService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly capacity: ProductionCapacityService,
    private readonly steelIssues: SteelIssuesService,
    private readonly productionBatches: ProductionBatchesService,
    private readonly weavingIssues: WeavingIssuesService,
    private readonly productionInvoices: ProductionInvoicesService,
  ) {}

  async alertsForDay(day: string): Promise<DailyOutputAlert[]> {
    if (!isDayKey(day)) throw new Error('Ngày không hợp lệ: ' + String(day));
    const params = await this.capacity.loadParams();
    const { items } = await this.capacity.loadCapacityItems({
      onlyWithPhoiStart: DAILY_OUTPUT_REQUIRES_PHOI_START,
    });
    const ranges = items
      .flatMap((i) => stageRangesOf(i, params))
      .filter((r) => rangeCovers(r, day));
    if (ranges.length === 0) return [];

    const loadContOf = new Map(items.map((i) => [i.itemId, i.loadCont ?? 0]));
    const lines = await this.collectLines(day, ranges, loadContOf);
    return evaluateDailyOutput(day, lines, params);
  }

  /** Dựng `OutputLine` cho các khoảng đã phủ ngày `day`. Công đoạn nào nguồn lỗi thì bỏ cả công đoạn đó. */
  private async collectLines(
    day: string,
    ranges: StageRange[],
    loadContOf: Map<string, number>,
  ): Promise<OutputLine[]> {
    const endOfDay = vnDayStart(addDays(day, 1))!; // < 00:00 VN của ngày kế tiếp
    const byStage = (stage: CapacityStage) => ranges.filter((r) => r.stage === stage);
    const itemIds = [...new Set(ranges.map((r) => r.itemId))];
    const piIds = [...new Set(ranges.map((r) => r.piId))];
    const orderRows = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItemId: { in: itemIds.map((i) => BigInt(i)) } },
      select: { id: true, productionInvoiceItemId: true },
    });
    const orderOfItem = new Map(
      orderRows.map((o) => [String(o.productionInvoiceItemId), String(o.id)]),
    );

    const out: OutputLine[] = [];
    const tasks: Promise<void>[] = [];
    const guard = (label: string, fn: () => Promise<void>) =>
      tasks.push(
        fn().catch((err: Error) => {
          this.logger.warn(`Cảnh báo sản lượng ngày: nguồn '${label}' lỗi - ${err.message}`);
        }),
      );

    const hanSon = (stage: 'HAN' | 'SON') => {
      const rs = byStage(stage).filter((r) => orderOfItem.has(r.itemId));
      if (rs.length === 0) return;
      guard(`floor-report(${stage})`, async () => {
        const orderIds = [...new Set(rs.map((r) => orderOfItem.get(r.itemId)!))];
        const [plan, reports] = await Promise.all([
          this.productionBatches.getBatchPlanBatch(
            orderIds,
            stage === 'HAN' ? MfgStage.HAN : MfgStage.SON,
          ),
          this.prisma.floorReport.findMany({
            where: {
              kind: 'PIECE',
              reversalOfId: null,
              reversedBy: { is: null },
              createdAt: { lt: endOfDay },
              productionBatch: {
                is: {
                  stage: stage === 'HAN' ? MfgStage.HAN : MfgStage.SON,
                  productionOrderId: { in: orderIds.map((i) => BigInt(i)) },
                },
              },
            },
            select: {
              createdAt: true,
              productionBatch: { select: { productionOrderId: true } },
              lines: { select: { qty: true } },
            },
          }),
        ]);
        const done: UnitsByDay = new Map();
        for (const rp of reports) {
          const oid = String(rp.productionBatch!.productionOrderId);
          bump(
            done,
            oid,
            vnDayKey(rp.createdAt),
            rp.lines.reduce((a, l) => a + l.qty, 0),
          );
        }
        for (const r of rs) {
          const oid = orderOfItem.get(r.itemId)!;
          const total = (plan[oid]?.items ?? []).reduce((a, p) => a + p.plannedQty, 0);
          if (!(total > 0)) continue;
          out.push(
            this.lineOf(r, done.get(oid) ?? {}, (u) => unitsToCont(u, total, r.cont), false),
          );
        }
      });
    };
    hanSon('HAN');
    hanSon('SON');

    const dan = byStage('NHAP_DAN').filter((r) => orderOfItem.has(r.itemId));
    if (dan.length > 0) {
      guard('weaving', async () => {
        const orderIds = [...new Set(dan.map((r) => orderOfItem.get(r.itemId)!))];
        const [plan, receipts] = await Promise.all([
          this.weavingIssues.getIssuePlanBatch(orderIds),
          this.prisma.weavingReceipt.findMany({
            where: {
              productionOrderId: { in: orderIds.map((i) => BigInt(i)) },
              receivedAt: { lt: endOfDay },
            },
            select: { productionOrderId: true, receivedAt: true, qty: true },
          }),
        ]);
        const done: UnitsByDay = new Map();
        for (const rc of receipts)
          bump(done, String(rc.productionOrderId), vnDayKey(rc.receivedAt), rc.qty);
        for (const r of dan) {
          const oid = orderOfItem.get(r.itemId)!;
          const total = (plan[oid] ?? []).reduce((a, w) => a + w.totalQty, 0);
          if (!(total > 0)) continue;
          out.push(
            this.lineOf(r, done.get(oid) ?? {}, (u) => unitsToCont(u, total, r.cont), false),
          );
        }
      });
    }

    const kiem = byStage('CHUYEN_KIEM');
    if (kiem.length > 0) {
      guard('transfer-check', async () => {
        const ids = [...new Set(kiem.map((r) => r.itemId))];
        const [pieces, results] = await Promise.all([
          this.productionInvoices.listTransferCheckPiecesBatch(ids),
          this.prisma.transferCheckResult.findMany({
            where: {
              productionInvoiceItemId: { in: ids.map((i) => BigInt(i)) },
              checkedAt: { lt: endOfDay },
            },
            select: { productionInvoiceItemId: true, checkedAt: true, checkedQty: true },
          }),
        ]);
        const done: UnitsByDay = new Map();
        for (const rs of results)
          bump(done, String(rs.productionInvoiceItemId), vnDayKey(rs.checkedAt), rs.checkedQty);
        for (const r of kiem) {
          const total = (pieces[r.itemId] ?? []).reduce((a, p) => a + p.totalQty, 0);
          if (!(total > 0)) continue;
          out.push(
            this.lineOf(r, done.get(r.itemId) ?? {}, (u) => unitsToCont(u, total, r.cont), false),
          );
        }
      });
    }

    const goi = byStage('DONG_GOI');
    if (goi.length > 0) {
      guard('packaging', async () => {
        const ids = [...new Set(goi.map((r) => r.itemId))];
        const records = await this.prisma.packagingRecord.findMany({
          where: {
            productionInvoiceItemId: { in: ids.map((i) => BigInt(i)) },
            packedAt: { lt: endOfDay },
          },
          select: { productionInvoiceItemId: true, packedAt: true, boxesPacked: true },
        });
        const done: UnitsByDay = new Map();
        for (const rc of records)
          bump(done, String(rc.productionInvoiceItemId), vnDayKey(rc.packedAt), rc.boxesPacked);
        for (const r of goi) {
          // boxesPacked ĐÃ là BỘ (V4-11): cont = bộ ÷ loadCont = bộ × (cont của dòng ÷ số lượng bộ). Không chia số thùng/bộ.
          const loadCont = loadContOf.get(r.itemId) ?? 0;
          if (!(loadCont > 0)) continue;
          out.push(this.lineOf(r, done.get(r.itemId) ?? {}, (u) => u / loadCont, false));
        }
      });
    }

    const phoi = byStage('PHOI');
    if (phoi.length > 0) {
      guard('phoi-cut', async () => {
        const piBigIds = piIds.map((i) => BigInt(i));
        const [progress, reports] = await Promise.all([
          this.steelIssues.getPhoiProgressBatch(piIds),
          this.prisma.floorReport.findMany({
            where: {
              kind: 'CUT',
              reversalOfId: null,
              reversedBy: { is: null },
              createdAt: { lt: endOfDay },
              productionInvoiceId: { in: piBigIds },
            },
            select: {
              createdAt: true,
              productionInvoiceId: true,
              lines: { select: { qty: true } },
            },
          }),
        ]);
        const done: UnitsByDay = new Map();
        for (const rp of reports)
          bump(
            done,
            String(rp.productionInvoiceId),
            vnDayKey(rp.createdAt),
            rp.lines.reduce((a, l) => a + l.qty, 0),
          );
        // Tổng cần của PI = Σ required mọi đoạn CẮT (không gồm công đoạn phụ sau cắt).
        const totalOfPi = (pi: string): number | null => {
          const mats = progress[pi];
          if (!mats) return null; // hàm batch nuốt lỗi từng PI -> thiếu khoá = nguồn lỗi
          return mats.reduce(
            (a, m) => a + (m.segments ?? []).reduce((s, g) => s + g.required, 0),
            0,
          );
        };
        for (const r of phoi) {
          const total = totalOfPi(r.piId);
          if (!total || !(total > 0)) continue;
          // Cont làm được của PI = tỷ lệ × Σ cont các dòng của PI có khoảng Phôi phủ ngày; chia lại cho dòng theo cont của dòng
          // -> mỗi dòng nhận tỷ lệ × cont của dòng.
          out.push(
            this.lineOf(r, done.get(r.piId) ?? {}, (u) => unitsToCont(u, total, r.cont), true),
          );
        }
      });
    }

    await Promise.all(tasks);
    return out;
  }

  /** Quy đổi số đơn vị theo ngày của nguồn -> cont theo ngày. */
  private lineOf(
    range: StageRange,
    unitsByDay: Record<string, number>,
    toCont: (units: number) => number,
    estimated: boolean,
  ): OutputLine {
    const doneByDay: Record<string, number> = {};
    for (const [d, u] of Object.entries(unitsByDay)) doneByDay[d] = toCont(u);
    return { range, doneByDay, estimated };
  }
}
