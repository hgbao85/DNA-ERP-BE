import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  SegmentReservationLogKind,
  CutBundleStatus,
  ProcessStep,
  ProductionInvoiceStatus,
  ProductionOrderFloorStage,
  ProductionOrderStatus,
  StepBundleStatus,
} from '../../generated/prisma/client';
import { lockBusinessKey, lockBusinessKeyShared } from '../../common/utils/advisory-lock.util';
import {
  compareSegmentCodes,
  normalizeSegmentSteps,
  SEGMENT_SUB_STEPS,
  SegmentSubStep,
  segmentProductionLockKey,
} from '../../common/utils/segment-code.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { WorkshopWarehouseResolver } from '../stock/workshop-warehouse.util';
import { isSegmentStockEnabled, SEGMENT_LEGACY_CONVERSION_LOCK } from './segment-stock.config';
import { CUTTING_PROPOSAL_SEGMENT_REF, SegmentStockService } from './segment-stock.service';
import type { SegmentSyncChange, SegmentTarget } from './segment-stock.types';
import { computeSegmentTargets, SegmentTargetVariant } from './segment-targets.util';
import { extraNeedOf } from '../steel-issues/phoi-need.util';
import { loadPlanSurplus } from '../steel-issues/plan-surplus.util';

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
  /**
   * Huỷ lệnh đợt 2 - Q2 (anh Nhân 24/11/2026: đoạn đã cắt của SKU huỷ tự vào tồn kho Phôi): lệnh đã đóng (mọi SKU Kết thúc) mà có
   * SKU bị huỷ thì vẫn tính lại, nhưng KHÔNG giữ gì cho lệnh - mọi đoạn đạt KCS vào dư. Cần vì KCS vẫn chấm nốt đợt của SKU đã huỷ
   * (câu 4) sau khi lệnh đã đóng; không có chế độ này thì đoạn chấm sau không bao giờ vào sổ.
   */
  surplusOnly: boolean;
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
    // Rà soát 14/11 TĐ8: chờ lượt chuyển đổi dữ liệu cũ (giữ độc quyền) - không thì tính lại chen giữa chuyển đổi bị đưa về 0. Lượt
    // chuyển đổi gọi chính hàm này trong phiên đang giữ bản độc quyền nên không tự chờ mình.
    await lockBusinessKeyShared(tx, SEGMENT_LEGACY_CONVERSION_LOCK);
    await lockBusinessKey(tx, segmentProductionLockKey(productionInvoiceId));
    // Đọc số liệu SAU khi khoá: 2 lượt KCS sát nhau - lượt chạy sau phải thấy số mới nhất.
    const loaded = await this.loadProduction(tx, productionInvoiceId);
    if (loaded.closed && !loaded.surplusOnly) return null;
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
        select: { id: true, bomRevisionId: true, quantity: true, floorStage: true, status: true },
      }),
    ]);
    const closed =
      invoice.status === ProductionInvoiceStatus.DONE ||
      invoice.status === ProductionInvoiceStatus.CANCELLED ||
      (orders.length > 0 &&
        orders.every((o) => o.floorStage === ProductionOrderFloorStage.FINISHED));
    const anyCancelled = orders.some((o) => o.status === ProductionOrderStatus.CANCELLED);
    const surplusOnly = closed && anyCancelled;
    // Q2: SKU đã huỷ không còn cần đoạn - số cần chỉ tính SKU còn hiệu lực, đoạn đã cắt cho SKU huỷ thành dư. Chế độ chỉ-dư: không
    // SKU nào cần (lệnh đã đóng, phần giữ đã nhả về dư lúc đóng).
    const needOrders = surplusOnly
      ? []
      : orders.filter((o) => o.status !== ProductionOrderStatus.CANCELLED);

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
        select: { segmentSpecId: true, failedQty: true, shortQty: true },
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
          shortQty: true,
          scrapQty: true,
          qcReview: { select: { stepBundle: { select: { step: true } } } },
        },
      }),
    ]);

    // Số cần theo (cỡ đoạn, bộ công đoạn): qtyPerPiece × qtyPerUnit × số lượng SKU, bỏ <= 0 (như computeCutProgress).
    const qtyPerUnitByKey = new Map(
      bomPieces.map((bp) => [`${bp.bomRevisionId}:${bp.pieceId}`, bp.qtyPerUnit]),
    );
    const needBySpec = new Map<string, Map<string, number>>();
    const needOrderIds = new Set(needOrders.map((o) => o.id));
    // Review IT 26/11 mục 3.1: mã đoạn của MỌI SKU (kể cả SKU đã huỷ, chế độ chỉ-dư) đều có mặt - SKU không còn cần thì số cần 0,
    // để đoạn đã qua công đoạn của mã đó thành dư đúng mã (không bị coi là đoạn dở rồi trừ khỏi kho).
    for (const order of orders) {
      const counts = needOrderIds.has(order.id);
      for (const pb of pieceBoms) {
        if (pb.bomRevisionId !== order.bomRevisionId) continue;
        const qtyPerUnit = qtyPerUnitByKey.get(`${pb.bomRevisionId}:${pb.pieceId}`) ?? 0;
        const need = pb.qtyPerPiece * qtyPerUnit * order.quantity;
        if (need <= 0) continue;
        const specKey = pb.segmentSpecId.toString();
        const code = normalizeSegmentSteps(pb.processSteps);
        const byCode = needBySpec.get(specKey) ?? new Map<string, number>();
        byCode.set(code, (byCode.get(code) ?? 0) + (counts ? need : 0));
        needBySpec.set(specKey, byCode);
      }
    }
    // Câu 14a (anh Nhân 24/11/2026): phần đoạn dư phương án cắt đã lấy từ kho cho lệnh (đang giữ, nhật ký SURPLUS_IN refType
    // CUTTING_PROPOSAL trừ phần nhả) đã nằm trong giữ của lệnh -> đoạn TỰ CẮT chỉ cần phủ phần còn lại; phần cắt hơn thành dư.
    if (needBySpec.size > 0) {
      const stockLogs = await db.segmentReservationLog.findMany({
        where: {
          refType: CUTTING_PROPOSAL_SEGMENT_REF,
          kind: { in: [SegmentReservationLogKind.SURPLUS_IN, SegmentReservationLogKind.RELEASE] },
          reservation: { productionInvoiceId },
        },
        select: {
          kind: true,
          qty: true,
          reservation: { select: { segmentSpecId: true, segmentSteps: true } },
        },
      });
      for (const l of stockLogs) {
        const byCode = needBySpec.get(l.reservation.segmentSpecId.toString());
        const code = l.reservation.segmentSteps;
        if (!byCode || !byCode.has(code)) continue;
        const sign = l.kind === SegmentReservationLogKind.SURPLUS_IN ? -1 : 1;
        byCode.set(code, (byCode.get(code) ?? 0) + sign * l.qty.toNumber());
      }
      for (const byCode of needBySpec.values())
        for (const [code, v] of byCode) byCode.set(code, Math.max(0, v));
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
    // P1 (18/11/2026): đoạn KCS ghi THIẾU không có thật nên trừ cùng với lỗi.
    const cutFailed = sumBy(cutQc, specKeyOf, (r) => r.failedQty + (r.shortQty ?? 0));

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
    // Σ số BỎ (cắt lại) theo (cỡ, công đoạn) - đoạn đã bị loại hẳn nên cũng trừ ở Cắt và ở các công đoạn đứng trước.
    const stepScrap = new Map<string, number>();
    for (const r of stepQc) {
      const step = r.qcReview.stepBundle?.step;
      if (!step || step === ProcessStep.CAT) continue;
      const k = stepKey(r.segmentSpecId, step);
      stepFailed.set(k, (stepFailed.get(k) ?? 0) + r.failedQty + (r.shortQty ?? 0));
      stepScrap.set(k, (stepScrap.get(k) ?? 0) + (r.scrapQty ?? 0));
    }
    // Các dòng định mức (bộ công đoạn) của từng cỡ - để biết dòng nào cần cả 2 công đoạn khi chia phần bỏ.
    const lineStepsBySpec = new Map<string, string[][]>();
    for (const order of orders) {
      for (const pb of pieceBoms) {
        if (pb.bomRevisionId !== order.bomRevisionId) continue;
        const qtyPerUnit = qtyPerUnitByKey.get(`${pb.bomRevisionId}:${pb.pieceId}`) ?? 0;
        if (pb.qtyPerPiece * qtyPerUnit * order.quantity <= 0) continue;
        const specKey = pb.segmentSpecId.toString();
        const arr = lineStepsBySpec.get(specKey) ?? [];
        arr.push([...pb.processSteps]);
        lineStepsBySpec.set(specKey, arr);
      }
    }
    // Câu 12b (24/11/2026): đoạn dư theo phương án làm đủ bộ công đoạn của dòng định mức NHIỀU công đoạn nhất (cùng luật
    // PhoiNeedIndex.addOpened) - đã cắt mà chưa qua công đoạn thì là đoạn chờ công đoạn, không phải dư trơn.
    const plannedBySpec = new Map<string, Record<string, number>>();
    if (needOrders.length > 0) {
      const rows = await loadPlanSurplus(
        db,
        needOrders.map((o) => o.id),
      );
      for (const r of rows) {
        if (r.fromStockSteps !== undefined) continue;
        const order = needOrders.find((o) => o.id === r.productionOrderId);
        if (!order) continue;
        const lines = pieceBoms
          .filter(
            (pb) =>
              pb.bomRevisionId === order.bomRevisionId && pb.segmentSpecId === r.segmentSpecId,
          )
          .map((pb) => normalizeSegmentSteps(pb.processSteps))
          .sort((a, b) => (b ? b.split(',').length : 0) - (a ? a.split(',').length : 0));
        if (lines.length === 0 || lines[0] === '') continue;
        const m = plannedBySpec.get(r.segmentSpecId.toString()) ?? {};
        m[lines[0]] = (m[lines[0]] ?? 0) + r.qty;
        plannedBySpec.set(r.segmentSpecId.toString(), m);
      }
    }

    // Hợp các cỡ đoạn: có số cần, có cắt, có công đoạn.
    const specIds = new Map<string, bigint>();
    for (const pb of pieceBoms) specIds.set(pb.segmentSpecId.toString(), pb.segmentSpecId);
    for (const r of cutSegments) specIds.set(specKeyOf(r), r.segmentSpecId);
    for (const r of subSteps) specIds.set(specKeyOf(r), r.segmentSpecId);

    const specs: SegmentProductionSpecResult[] = [];
    const sortedSpecs = [...specIds.entries()].sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [specKey, specId] of sortedSpecs) {
      const scrapByStep: Partial<Record<string, number>> = {};
      for (const t of SEGMENT_SUB_STEPS) {
        const sc = stepScrap.get(stepKey(specId, t)) ?? 0;
        if (sc > 0) scrapByStep[t] = sc;
      }
      const lineSteps = lineStepsBySpec.get(specKey) ?? [];
      // Cắt trừ thêm Σ bỏ ở MỌI công đoạn phụ (phần phải cắt lại). Thiếu của Cắt đã nằm trong cutFailed.
      const cutPassedQty = passedQty(
        cutDone.get(specKey) ?? 0,
        (cutFailed.get(specKey) ?? 0) + extraNeedOf('CAT', scrapByStep, lineSteps),
        cutOpen.get(specKey) ?? 0,
        cutAwaiting.get(specKey) ?? 0,
      );
      const stepPassedQty: Partial<Record<SegmentSubStep, number>> = {};
      for (const t of SEGMENT_SUB_STEPS) {
        const k = stepKey(specId, t);
        // Công đoạn T trừ thêm phần bỏ ở các công đoạn U đứng SAU T có dòng định mức cần cả T lẫn U (đoạn đã làm T
        // nhưng bị bỏ ở U thì không còn là đoạn đủ công đoạn T).
        const p = passedQty(
          stepDone.get(k) ?? 0,
          (stepFailed.get(k) ?? 0) + extraNeedOf(t, scrapByStep, lineSteps),
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
        plannedSurplus: plannedBySpec.get(specKey),
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
    return { closed, surplusOnly, specs };
  }
}
