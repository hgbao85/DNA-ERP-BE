import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CutBundleStatus,
  ProcessStep,
  ProductionInvoiceStatus,
  ProductionOrderFloorStage,
  StepBundleStatus,
} from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import {
  compareSegmentCodes,
  normalizeSegmentSteps,
  SEGMENT_SUB_STEPS,
  SegmentSubStep,
  segmentProductionLockKey,
} from '../../common/utils/segment-code.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { WorkshopWarehouseResolver } from '../stock/workshop-warehouse.util';
import { isSegmentStockEnabled } from './segment-stock.config';
import { SegmentStockService } from './segment-stock.service';
import type { SegmentSyncChange, SegmentTarget } from './segment-stock.types';
import { computeSegmentTargets, SegmentTargetVariant } from './segment-targets.util';

/** Kết quả tính cho 1 cỡ đoạn của lệnh. */
export interface SegmentProductionSpecResult {
  segmentSpecId: bigint;
  /** Đã cắt + KCS đạt (C). */
  cutPassedQty: number;
  /** Đã qua từng công đoạn phụ + KCS đạt (P). */
  stepPassedQty: Partial<Record<SegmentSubStep, number>>;
  variants: SegmentTargetVariant[];
  wipQty: number;
  leftoverStepQty: Partial<Record<SegmentSubStep, number>>;
}

export interface SegmentProductionCurrent {
  segmentSpecId: bigint;
  segmentSteps: string;
  warehouseId: bigint;
  heldQty: number;
  surplusQty: number;
}

export interface RecomputeSegmentStockResult {
  productionInvoiceId: bigint;
  dryRun: boolean;
  closed: boolean;
  /** Kho Phôi của xưởng làm lệnh (dự kiến khi dryRun; null nếu tra không ra). */
  warehouseId: bigint | null;
  specs: SegmentProductionSpecResult[];
  /** Đã ghi hiện tại (SegmentProduction) - khi ghi thật là trạng thái TRƯỚC lần tính này. */
  current: SegmentProductionCurrent[];
  /** Phần chênh sync đã ghi (rỗng khi dryRun). */
  changes: SegmentSyncChange[];
}

interface LoadedProduction {
  closed: boolean;
  specs: SegmentProductionSpecResult[];
}

const sumBy = <T>(rows: T[], key: (r: T) => string, qty: (r: T) => number): Map<string, number> => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + qty(r));
  return m;
};

/** Công thức "đạt KCS" của piece-sync-board: reported = max(0, đã báo - lỗi); passed = max(0, reported - chưa gửi - chờ KCS). */
const passedQty = (done: number, failed: number, open: number, awaiting: number): number =>
  Math.max(0, Math.max(0, done - failed) - open - awaiting);

/**
 * Phía CỘNG tồn đoạn kho Phôi theo lệnh (13/11/2026): sau mỗi lần KCS đạt (đợt cắt / đợt công đoạn phụ) tính lại cho CẢ lệnh
 * mỗi mã đoạn có bao nhiêu đoạn đủ công đoạn + KCS đạt (giữ cho lệnh, trần = số cần; phần vượt vào dư) rồi gọi
 * SegmentStockService.syncOrderProduction ghi phần chênh vào sổ kho. Số liệu cùng nguồn / cùng công thức với bảng tiến độ Phôi
 * (SteelIssuesService.computeCutProgress / computeStepProgress) và piece-sync-board nhưng gộp theo CẢ lệnh, không tách SKU.
 */
@Injectable()
export class SegmentProductionService {
  private readonly logger = new Logger(SegmentProductionService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly segmentStockService: SegmentStockService,
  ) {}

  /**
   * Tính lại phía cộng cho 1 lệnh. dryRun: chỉ tính (không khoá, không ghi) - chạy được cả khi công tắc tắt. Ghi thật: cần công
   * tắc SEGMENT_STOCK_ENABLED bật và lệnh chưa kết thúc (lệnh kết thúc đã nhả phần giữ về dư).
   */
  async recomputeForPi(
    productionInvoiceId: bigint,
    opts: { actorId?: string | null; reason: string; dryRun?: boolean },
  ): Promise<RecomputeSegmentStockResult> {
    const pi = await this.prisma.productionInvoice.findUnique({
      where: { id: productionInvoiceId },
      select: { id: true },
    });
    if (!pi) throw new NotFoundException(`Không tìm thấy lệnh sản xuất ${productionInvoiceId}`);

    if (opts.dryRun) {
      const loaded = await this.loadProduction(this.prisma, productionInvoiceId);
      const current = await this.loadCurrent(this.prisma, productionInvoiceId);
      let warehouseId: bigint | null = null;
      try {
        const wh = await new WorkshopWarehouseResolver(this.prisma).phoiWarehouseOfPi(
          productionInvoiceId,
        );
        warehouseId = wh.id;
      } catch (e) {
        this.logger.warn(
          `Không tra được kho Phôi của lệnh ${productionInvoiceId} (xem thử): ${(e as Error).message}`,
        );
      }
      return {
        productionInvoiceId,
        dryRun: true,
        closed: loaded.closed,
        warehouseId,
        specs: loaded.specs,
        current,
        changes: [],
      };
    }

    if (!isSegmentStockEnabled()) {
      throw new ConflictException('Tồn đoạn theo lệnh chưa bật (SEGMENT_STOCK_ENABLED)');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const result = await this.recomputeInTx(tx, productionInvoiceId, opts);
        if (!result) {
          throw new ConflictException(
            'Lệnh đã kết thúc - phần giữ đoạn đã nhả về dư, không tính lại được',
          );
        }
        return result;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  /**
   * Ghi thật phía cộng cho 1 lệnh trong transaction của caller (khoá lệnh trước rồi đọc số). Lệnh đã kết thúc -> null, không ghi.
   * Dùng bởi recomputeForPi và chuyển đổi dữ liệu cũ (SegmentLegacyConversionService - cả lượt chạy trong 1 transaction).
   * KHÔNG kiểm công tắc - caller tự kiểm.
   */
  async recomputeInTx(
    tx: PrismaTx,
    productionInvoiceId: bigint,
    opts: { actorId?: string | null; reason: string },
  ): Promise<RecomputeSegmentStockResult | null> {
    await lockBusinessKey(tx, segmentProductionLockKey(productionInvoiceId));
    // Đọc số liệu SAU khi khoá: 2 lượt KCS sát nhau - lượt chạy sau phải thấy số mới nhất.
    const loaded = await this.loadProduction(tx, productionInvoiceId);
    if (loaded.closed) return null;
    const current = await this.loadCurrent(tx, productionInvoiceId);
    const wh = await new WorkshopWarehouseResolver(tx).phoiWarehouseOfPi(productionInvoiceId);
    const sync = await this.segmentStockService.syncOrderProduction(tx, {
      productionInvoiceId,
      warehouseId: wh.id,
      targets: this.toTargets(loaded.specs),
      actorId: opts.actorId ?? null,
      reason: opts.reason,
    });
    return {
      productionInvoiceId,
      dryRun: false,
      closed: false,
      warehouseId: wh.id,
      specs: loaded.specs,
      current,
      changes: sync.changes,
    };
  }

  /**
   * Móc sau KCS (SAU khi transaction duyệt đã commit). Công tắc tắt -> return ngay, không truy vấn gì. MỌI lỗi chỉ log, KHÔNG
   * ném: KCS đã ghi xong không được hỏng vì tồn đoạn (lệch thì "tính lại" ở endpoint sửa lại được).
   */
  async recomputeAfterQc(
    productionInvoiceId: bigint,
    actorId: string | null,
    reason: string,
  ): Promise<void> {
    if (!isSegmentStockEnabled()) return;
    try {
      await this.recomputeForPi(productionInvoiceId, { actorId, reason });
    } catch (e) {
      if (e instanceof ConflictException) {
        // Lệnh đã kết thúc / công tắc vừa tắt - bỏ qua êm.
        this.logger.warn(
          `Bỏ qua tính tồn đoạn sau KCS (${reason}, lệnh ${productionInvoiceId}): ${e.message}`,
        );
        return;
      }
      this.logger.error(
        `Tính tồn đoạn sau KCS thất bại (${reason}, lệnh ${productionInvoiceId}): ${(e as Error).message}`,
        (e as Error).stack,
      );
    }
  }

  private toTargets(specs: SegmentProductionSpecResult[]): SegmentTarget[] {
    const out: SegmentTarget[] = [];
    for (const s of specs) {
      for (const v of s.variants) {
        out.push({
          segmentSpecId: s.segmentSpecId,
          segmentSteps: v.segmentSteps,
          heldQty: v.heldQty,
          surplusQty: v.surplusQty,
        });
      }
    }
    return out.sort(compareSegmentCodes);
  }

  private async loadCurrent(
    db: Pick<PrismaTx, 'segmentProduction'>,
    productionInvoiceId: bigint,
  ): Promise<SegmentProductionCurrent[]> {
    const rows = await db.segmentProduction.findMany({ where: { productionInvoiceId } });
    return rows
      .map((r) => ({
        segmentSpecId: r.segmentSpecId,
        segmentSteps: r.segmentSteps,
        warehouseId: r.warehouseId,
        heldQty: r.heldQty.toNumber(),
        surplusQty: r.surplusQty.toNumber(),
      }))
      .sort(compareSegmentCodes);
  }

  /** Đọc số liệu của cả lệnh rồi tính từng cỡ đoạn. Gộp theo CẢ lệnh (không tách SKU; đợt cũ chưa gắn SKU vẫn tính). */
  private async loadProduction(
    db: PrismaTx,
    productionInvoiceId: bigint,
  ): Promise<LoadedProduction> {
    const [invoice, orders] = await Promise.all([
      db.productionInvoice.findUniqueOrThrow({
        where: { id: productionInvoiceId },
        select: { status: true },
      }),
      db.productionOrder.findMany({
        where: { productionInvoiceItem: { productionInvoiceId } },
        select: { id: true, bomRevisionId: true, quantity: true, floorStage: true },
      }),
    ]);
    const closed =
      invoice.status === ProductionInvoiceStatus.DONE ||
      invoice.status === ProductionInvoiceStatus.CANCELLED ||
      (orders.length > 0 &&
        orders.every((o) => o.floorStage === ProductionOrderFloorStage.FINISHED));

    const revisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const [bomPieces, pieceBoms, cutSegments, cutQc, stepSegments, stepQc] = await Promise.all([
      db.bomPiece.findMany({
        where: { bomRevisionId: { in: revisionIds } },
        select: { bomRevisionId: true, pieceId: true, qtyPerUnit: true },
      }),
      db.pieceBom.findMany({
        where: { bomRevisionId: { in: revisionIds } },
        select: {
          bomRevisionId: true,
          pieceId: true,
          segmentSpecId: true,
          qtyPerPiece: true,
          processSteps: true,
        },
      }),
      db.cutPatternSegment.findMany({
        where: { cutBundle: { steelIssue: { productionInvoiceId } } },
        select: { segmentSpecId: true, qty: true, cutBundle: { select: { status: true } } },
      }),
      db.qcReviewSegment.findMany({
        where: { qcReview: { steelIssue: { productionInvoiceId } } },
        select: { segmentSpecId: true, failedQty: true },
      }),
      db.stepBatchSegment.findMany({
        where: { stepBatch: { productionInvoiceId } },
        select: {
          segmentSpecId: true,
          qty: true,
          stepBatch: { select: { step: true, stepBundle: { select: { status: true } } } },
        },
      }),
      db.qcReviewSegment.findMany({
        where: { qcReview: { stepBundle: { productionInvoiceId } } },
        select: {
          segmentSpecId: true,
          failedQty: true,
          qcReview: { select: { stepBundle: { select: { step: true } } } },
        },
      }),
    ]);

    // Số cần theo (cỡ đoạn, bộ công đoạn): qtyPerPiece × qtyPerUnit × số lượng SKU, bỏ <= 0 (như computeCutProgress).
    const qtyPerUnitByKey = new Map(
      bomPieces.map((bp) => [`${bp.bomRevisionId}:${bp.pieceId}`, bp.qtyPerUnit]),
    );
    const needBySpec = new Map<string, Map<string, number>>();
    for (const order of orders) {
      for (const pb of pieceBoms) {
        if (pb.bomRevisionId !== order.bomRevisionId) continue;
        const qtyPerUnit = qtyPerUnitByKey.get(`${pb.bomRevisionId}:${pb.pieceId}`) ?? 0;
        const need = pb.qtyPerPiece * qtyPerUnit * order.quantity;
        if (need <= 0) continue;
        const specKey = pb.segmentSpecId.toString();
        const code = normalizeSegmentSteps(pb.processSteps);
        const byCode = needBySpec.get(specKey) ?? new Map<string, number>();
        byCode.set(code, (byCode.get(code) ?? 0) + need);
        needBySpec.set(specKey, byCode);
      }
    }

    // Cắt: done = Σ qty, open = đợt CUTTING, awaiting = đợt AWAITING_QC, failed = lỗi KCS cộng dồn.
    const specKeyOf = (r: { segmentSpecId: bigint }) => r.segmentSpecId.toString();
    const cutDone = sumBy(cutSegments, specKeyOf, (r) => r.qty);
    const cutOpen = sumBy(
      cutSegments.filter((r) => r.cutBundle.status === CutBundleStatus.CUTTING),
      specKeyOf,
      (r) => r.qty,
    );
    const cutAwaiting = sumBy(
      cutSegments.filter((r) => r.cutBundle.status === CutBundleStatus.AWAITING_QC),
      specKeyOf,
      (r) => r.qty,
    );
    const cutFailed = sumBy(cutQc, specKeyOf, (r) => r.failedQty);

    // Công đoạn phụ (bỏ CAT nếu lỡ có): open = chưa có đợt gửi KCS, awaiting = đợt AWAITING_QC.
    const stepKey = (specId: bigint, step: string) => `${specId.toString()}|${step}`;
    const subSteps = stepSegments.filter((r) => r.stepBatch.step !== ProcessStep.CAT);
    const stepOf = (r: (typeof subSteps)[number]) => stepKey(r.segmentSpecId, r.stepBatch.step);
    const stepDone = sumBy(subSteps, stepOf, (r) => r.qty);
    const stepOpen = sumBy(
      subSteps.filter((r) => r.stepBatch.stepBundle === null),
      stepOf,
      (r) => r.qty,
    );
    const stepAwaiting = sumBy(
      subSteps.filter((r) => r.stepBatch.stepBundle?.status === StepBundleStatus.AWAITING_QC),
      stepOf,
      (r) => r.qty,
    );
    const stepFailed = new Map<string, number>();
    for (const r of stepQc) {
      const step = r.qcReview.stepBundle?.step;
      if (!step || step === ProcessStep.CAT) continue;
      const k = stepKey(r.segmentSpecId, step);
      stepFailed.set(k, (stepFailed.get(k) ?? 0) + r.failedQty);
    }

    // Hợp các cỡ đoạn: có số cần, có cắt, có công đoạn.
    const specIds = new Map<string, bigint>();
    for (const pb of pieceBoms) specIds.set(pb.segmentSpecId.toString(), pb.segmentSpecId);
    for (const r of cutSegments) specIds.set(specKeyOf(r), r.segmentSpecId);
    for (const r of subSteps) specIds.set(specKeyOf(r), r.segmentSpecId);

    const specs: SegmentProductionSpecResult[] = [];
    const sortedSpecs = [...specIds.entries()].sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [specKey, specId] of sortedSpecs) {
      const cutPassedQty = passedQty(
        cutDone.get(specKey) ?? 0,
        cutFailed.get(specKey) ?? 0,
        cutOpen.get(specKey) ?? 0,
        cutAwaiting.get(specKey) ?? 0,
      );
      const stepPassedQty: Partial<Record<SegmentSubStep, number>> = {};
      for (const t of SEGMENT_SUB_STEPS) {
        const k = stepKey(specId, t);
        const p = passedQty(
          stepDone.get(k) ?? 0,
          stepFailed.get(k) ?? 0,
          stepOpen.get(k) ?? 0,
          stepAwaiting.get(k) ?? 0,
        );
        if (p > 0) stepPassedQty[t] = p;
      }
      const r = computeSegmentTargets({
        cutPassedQty,
        stepPassedQty,
        variants: [...(needBySpec.get(specKey) ?? [])].map(([segmentSteps, needQty]) => ({
          segmentSteps,
          needQty,
        })),
      });
      specs.push({
        segmentSpecId: specId,
        cutPassedQty,
        stepPassedQty,
        variants: r.variants,
        wipQty: r.wipQty,
        leftoverStepQty: r.leftoverStepQty,
      });
    }
    return { closed, specs };
  }
}
