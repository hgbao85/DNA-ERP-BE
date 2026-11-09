import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  FloorReportKind,
  MfgStage,
  ProductionInvoiceStatus,
  ProductionOrderFloorStage,
} from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { vnDayKey, vnDayStart } from '../../common/utils/floor-stats.util';
import { percentOf } from '../floor/floor-progress.util';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import {
  PIECE_SYNC_COUNT_MODE,
  type PieceSyncBoard,
  type PieceSyncLine,
  type PieceSyncRow,
} from './piece-sync-board.types';
import { computePieceSync } from './piece-sync.util';

interface PhoiSegOrder {
  productionOrderId: string | null;
  done: number;
  failed: number;
  openQty?: number;
  awaitingQcQty?: number;
}
interface PhoiSeg {
  segmentSpecId: string;
  byOrder?: PhoiSegOrder[];
}

/**
 * "Đồng bộ Phôi – Hàn" (2026-11-04, changelog-2026-10-08 mục 59): mỗi dòng = (SKU đang chạy × mảnh phải qua Hàn), so số mảnh
 * Phôi đã đồng bộ (ƯỚC TÍNH, xem piece-sync.util.ts) với số mảnh Hàn đã báo. Chỉ đọc.
 *
 * ĐỦ CÔNG ĐOẠN (changelog-2026-10-08 mục 64, thay "chỉ tính theo Cắt" của mục 61): 1 đoạn phải qua Cắt + mọi công đoạn phụ ghi
 * ở PieceBom.processSteps mới tính. Cách đếm theo PIECE_SYNC_COUNT_MODE (mặc định PASSED_QC = chỉ đoạn đã ĐẠT KCS); chạy thêm
 * 1 lần theo 'đã báo' để ra phoiPendingQcQty (số mảnh sẽ đồng bộ thêm nếu phần chưa có kết quả KCS đều đạt). Cách chọn dòng và bắt lỗi từng nguồn
 * chép theo MilestoneBoardService để 2 bảng cùng tập SKU.
 */
@Injectable()
export class PieceSyncBoardService {
  private readonly logger = new Logger(PieceSyncBoardService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly steelIssues: SteelIssuesService,
    private readonly productionBatches: ProductionBatchesService,
  ) {}

  async getBoard(productionInvoiceIds?: string[], now: Date = new Date()): Promise<PieceSyncBoard> {
    const today = vnDayKey(now);
    const items = await this.prisma.productionInvoiceItem.findMany({
      where: {
        // Cùng điều kiện với Bảng mốc: dòng đã duyệt, lệnh chưa Kết thúc, PI chưa huỷ, đơn bán còn hiệu lực.
        prodApprovalStatus: 'APPROVED',
        productionInvoiceId: productionInvoiceIds?.length
          ? { in: productionInvoiceIds.map((id) => BigInt(id)) }
          : { not: null },
        productionOrder: { is: { floorStage: { not: ProductionOrderFloorStage.FINISHED } } },
        productionInvoice: { status: { not: ProductionInvoiceStatus.CANCELLED } },
        OR: [{ salesOrderId: null }, { salesOrder: { isActive: true, deletedAt: null } }],
      },
      select: {
        id: true,
        productionInvoiceId: true,
        productionInvoice: { select: { code: true } },
        mfgProduct: { select: { factoryCode: true, name: true } },
        productionOrder: { select: { id: true, quantity: true, bomRevisionId: true } },
      },
      orderBy: { id: 'asc' },
    });
    if (items.length === 0)
      return {
        today,
        generatedAt: now.toISOString(),
        failedSources: [],
        unassignedPhoiPiIds: [],
        rows: [],
      };

    const piIds = [...new Set(items.map((i) => String(i.productionInvoiceId)))];
    const orderIds = items.map((i) => String(i.productionOrder!.id));
    const orderBigIds = items.map((i) => i.productionOrder!.id);
    const revisionIds = [...new Set(items.map((i) => i.productionOrder!.bomRevisionId))];

    const failedSources: string[] = [];
    const safe = async <T>(label: string, p: Promise<T>): Promise<T | null> => {
      try {
        return await p;
      } catch (err) {
        this.logger.warn(`Đồng bộ Phôi–Hàn: nguồn '${label}' lỗi - ${(err as Error).message}`);
        if (!failedSources.includes(label)) failedSources.push(label);
        return null;
      }
    };

    const [phoiByPi, planHan, planPhoi, reports, bomPieces, pieceBoms, yields] = await Promise.all([
      safe('phoi-progress', this.steelIssues.getPhoiProgressBatch(piIds)),
      safe(
        'production-batch-plan(HAN)',
        this.productionBatches.getBatchPlanBatch(orderIds, MfgStage.HAN),
      ),
      safe(
        'production-batch-plan(PHOI)',
        this.productionBatches.getBatchPlanBatch(orderIds, MfgStage.PHOI),
      ),
      safe(
        'floor-reports',
        this.prisma.floorReport.findMany({
          where: {
            kind: FloorReportKind.PIECE,
            createdAt: { gte: vnDayStart(today)! },
            // Không tính dòng đảo, và cũng không tính lần báo ĐÃ bị đảo (huỷ).
            reversalOfId: null,
            reversedBy: { is: null },
            productionBatch: { stage: MfgStage.HAN, productionOrderId: { in: orderBigIds } },
          },
          select: {
            productionBatch: { select: { productionOrderId: true } },
            lines: { select: { pieceId: true, qty: true } },
          },
        }),
      ),
      // Lấy CẢ mảnh không qua Hàn: mảnh đó dùng chung cỡ đoạn thì cũng phải được chia phần đoạn đã cắt, nếu không mảnh
      // qua Hàn sẽ được tính dư. Chỉ mảnh needsHan mới lên bảng (lọc ở vòng ráp dòng).
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId: { in: revisionIds } },
        include: { piece: true },
      }),
      this.prisma.pieceBom.findMany({
        where: { bomRevisionId: { in: revisionIds } },
        include: { segmentSpec: { include: { material: true } } },
        orderBy: { id: 'asc' },
      }),
      this.prisma.pieceMaterialYield.findMany({
        where: { bomRevisionId: { in: revisionIds } },
        select: { bomRevisionId: true, pieceId: true },
      }),
    ]);
    // getPhoiProgressBatch tự nuốt lỗi từng PI (bỏ PI khỏi kết quả) - thiếu khoá = nguồn lỗi, như Bảng mốc.
    if (
      phoiByPi &&
      piIds.some((id) => !(id in phoiByPi)) &&
      !failedSources.includes('phoi-progress')
    ) {
      failedSources.push('phoi-progress');
    }

    // Hàn báo hôm nay theo (lệnh, mảnh); kết quả âm (đảo từng phần) không kéo dưới 0.
    const hanTodayMap = new Map<string, number>();
    for (const r of reports ?? []) {
      for (const l of r.lines) {
        if (l.pieceId == null || !r.productionBatch) continue;
        const k = `${r.productionBatch.productionOrderId}:${l.pieceId}`;
        hanTodayMap.set(k, (hanTodayMap.get(k) ?? 0) + l.qty);
      }
    }

    const byRevision = <T extends { bomRevisionId: bigint }>(list: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of list) {
        const k = String(r.bomRevisionId);
        const arr = m.get(k);
        if (arr) arr.push(r);
        else m.set(k, [r]);
      }
      return m;
    };
    const piecesByRev = byRevision(bomPieces);
    const bomsByRev = byRevision(pieceBoms);
    const yieldKeys = new Set(yields.map((y) => `${y.bomRevisionId}:${y.pieceId}`));

    const unassigned = new Set<string>();
    const rows: PieceSyncRow[] = [];

    // PI id tăng, rồi SKU (lệnh SX) tăng.
    const sorted = [...items].sort(
      (a, b) =>
        cmpBig(a.productionInvoiceId!, b.productionInvoiceId!) ||
        cmpBig(a.productionOrder!.id, b.productionOrder!.id),
    );

    for (const item of sorted) {
      const piId = String(item.productionInvoiceId);
      const order = item.productionOrder!;
      const orderId = String(order.id);
      const revKey = String(order.bomRevisionId);

      const pieces = [...(piecesByRev.get(revKey) ?? [])].sort(
        (a, b) =>
          a.piece.groupNumber - b.piece.groupNumber ||
          (a.piece.pieceNumber ?? Infinity) - (b.piece.pieceNumber ?? Infinity) ||
          cmpBig(a.piece.id, b.piece.id),
      );
      if (!pieces.some((p) => p.needsHan)) continue;
      const pieceIdSet = new Set(pieces.map((p) => p.pieceId));
      const boms = (bomsByRev.get(revKey) ?? []).filter((b) => pieceIdSet.has(b.pieceId));

      const phoiItems = phoiByPi ? phoiByPi[piId] : undefined;
      const phoiKnown = phoiItems !== undefined;

      // Bảng đoạn của SKU, khoá `${segmentSpecId}:${step}` ('CAT' = Cắt, còn lại = công đoạn phụ), cộng phần byOrder của lệnh này:
      //  reported = max(0, đã báo − KCS lỗi); passed = reported − chưa gửi KCS − đang chờ KCS (≥ 0) = đã ĐẠT KCS.
      const reportedGood = new Map<string, number>();
      const passedGood = new Map<string, number>();
      const addSeg = (seg: PhoiSeg, step: string) => {
        for (const o of seg.byOrder ?? []) {
          if (o.productionOrderId === null) {
            // Đợt cũ chưa gắn SKU: không biết của SKU nào nên không cộng, chỉ báo cho người xem.
            if (o.done > 0) unassigned.add(piId);
            continue;
          }
          if (o.productionOrderId !== orderId) continue;
          const k = `${seg.segmentSpecId}:${step}`;
          const reported = Math.max(0, o.done - o.failed);
          const passed = Math.max(0, reported - (o.openQty ?? 0) - (o.awaitingQcQty ?? 0));
          reportedGood.set(k, (reportedGood.get(k) ?? 0) + reported);
          passedGood.set(k, (passedGood.get(k) ?? 0) + passed);
        }
      };
      if (phoiItems) {
        for (const mat of phoiItems) {
          for (const seg of (mat.segments as PhoiSeg[] | undefined) ?? []) addSeg(seg, 'CAT');
          for (const st of mat.steps ?? []) {
            for (const seg of (st.segments as PhoiSeg[] | undefined) ?? []) addSeg(seg, st.step);
          }
        }
      }
      const passedMode = PIECE_SYNC_COUNT_MODE === 'PASSED_QC';
      const mainGood = passedMode ? passedGood : reportedGood;

      const planPhoiOfOrder = planPhoi ? planPhoi[orderId] : undefined;
      const planHanOfOrder = planHan ? planHan[orderId] : undefined;
      const hasYield = (pieceId: bigint) => yieldKeys.has(`${revKey}:${pieceId}`);
      // Số mảnh Phôi tự báo ở Vật tư TP (thiếu trong plan = 0); mảnh không có Sắt tự tính = null.
      // passedOnly: chỉ đếm số đã đạt KCS; ngược lại cộng cả đang chờ KCS + chưa gửi.
      const selfQtyOf = (pieceId: bigint, passedOnly: boolean): number | null => {
        if (!hasYield(pieceId)) return null;
        let sum = 0;
        for (const p of planPhoiOfOrder?.items ?? []) {
          if (p.pieceId !== String(pieceId)) continue;
          sum += passedOnly ? p.passedQty : p.passedQty + p.awaitingQcQty + (p.openQty ?? 0);
        }
        return sum;
      };
      const mainSelfQtyOf = (pieceId: bigint) => selfQtyOf(pieceId, passedMode);

      const runSync = (good: Map<string, number>, passedOnly: boolean) =>
        phoiKnown
          ? computePieceSync({
              orderQuantity: order.quantity,
              pieces: pieces.map((p) => ({
                pieceId: String(p.pieceId),
                qtyPerUnit: p.qtyPerUnit,
                selfCalcPieceQty: selfQtyOf(p.pieceId, passedOnly),
              })),
              lines: boms.map((b) => ({
                lineKey: String(b.id),
                pieceId: String(b.pieceId),
                segmentSpecId: String(b.segmentSpecId),
                qtyPerPiece: b.qtyPerPiece,
                processSteps: b.processSteps,
              })),
              goodBySpecStep: good,
            })
          : [];
      const results = runSync(mainGood, passedMode);
      // Lần chạy theo 'đã báo' chỉ để tính phần còn chờ KCS; mode REPORTED thì không có phần chờ.
      const reportedResults = passedMode && phoiKnown ? runSync(reportedGood, false) : [];
      const reportedOf = new Map(reportedResults.map((r) => [r.pieceId, r]));
      const resultOf = new Map(results.map((r) => [r.pieceId, r]));
      const lineResultOf = new Map(
        results.flatMap((r) => r.lines.map((l) => [l.lineKey, l] as const)),
      );

      for (const p of pieces) {
        if (!p.needsHan) continue;
        const pieceId = String(p.pieceId);
        const requiredQty = p.qtyPerUnit * order.quantity;
        const res = resultOf.get(pieceId);
        // Mảnh có Sắt tự tính mà nguồn plan PHOI lỗi: không biết số tự báo -> Phôi của mảnh là "không biết".
        const unknown = !phoiKnown || (hasYield(p.pieceId) && planPhoi === null);
        const phoiSyncedQty = unknown || !res ? null : res.phoiSyncedQty;
        const phoiPendingQcQty =
          phoiSyncedQty === null
            ? null
            : passedMode
              ? Math.max(
                  0,
                  (reportedOf.get(pieceId)?.phoiSyncedQty ?? phoiSyncedQty) - phoiSyncedQty,
                )
              : 0;

        const hanRaw = (planHanOfOrder?.items ?? [])
          .filter((i) => i.pieceId === pieceId)
          .reduce((a, i) => a + i.passedQty + i.awaitingQcQty + (i.openQty ?? 0), 0);
        const hanDoneQty = Math.min(requiredQty, hanRaw);

        const lines: PieceSyncLine[] = unknown
          ? []
          : boms
              .filter((b) => b.pieceId === p.pieceId)
              .flatMap((b) => {
                const lr = lineResultOf.get(String(b.id));
                if (!lr) return [];
                return [
                  {
                    segmentSpecId: String(b.segmentSpecId),
                    materialCode: b.segmentSpec.material.code,
                    materialName: b.segmentSpec.material.name,
                    materialSpec: b.segmentSpec.material.spec ?? null,
                    cutLengthMm: b.segmentSpec.cutLengthMm.toNumber(),
                    qtyPerPiece: b.qtyPerPiece,
                    steps: lr.steps,
                    usableQty: lr.usableQty,
                    makeablePieces: lr.makeablePieces,
                    limitingStep: lr.limitingStep,
                  },
                ];
              });

        rows.push({
          productionInvoiceId: piId,
          piCode: item.productionInvoice?.code ?? '',
          productionOrderId: orderId,
          skuCode: item.mfgProduct.factoryCode,
          skuName: item.mfgProduct.name ?? null,
          orderQuantity: order.quantity,
          pieceId,
          pieceCode: p.piece.code,
          pieceName: p.piece.name,
          qtyPerUnit: p.qtyPerUnit,
          requiredQty,
          phoiSyncedQty,
          phoiPendingQcQty,
          syncPercent: phoiSyncedQty === null ? null : percentOf(phoiSyncedQty, requiredQty),
          hanDoneQty,
          hanTodayQty: Math.max(0, hanTodayMap.get(`${orderId}:${pieceId}`) ?? 0),
          notWeldedQty: phoiSyncedQty === null ? null : Math.max(0, phoiSyncedQty - hanDoneQty),
          phoiNotSyncedQty:
            phoiSyncedQty === null ? null : Math.max(0, requiredQty - phoiSyncedQty),
          hanAheadOfPhoi: phoiSyncedQty !== null && hanDoneQty > phoiSyncedQty,
          selfCalcPieceQty: unknown ? null : mainSelfQtyOf(p.pieceId),
          lines,
        });
      }
    }

    return {
      today,
      generatedAt: now.toISOString(),
      failedSources,
      unassignedPhoiPiIds: [...unassigned],
      rows,
    };
  }
}

function cmpBig(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
