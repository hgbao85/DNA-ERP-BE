import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CutBundleStatus,
  FloorReportKind,
  MfgStage,
  ProcessStep,
  ProductionBatchStatus,
  Prisma,
} from '../../generated/prisma/client';
import { MFG_FLOOR_WAREHOUSE_SCOPE } from '../../common/constants/role-permissions.constant';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { writeFloorReport } from '../../common/utils/floor-report.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { PhoiProgressItemResponseDto } from '../steel-issues/dto/phoi-progress-response.dto';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { FloorWorkerStage } from './dto/floor-worker.dto';

const USER_NAME = { select: { firstName: true, lastName: true, username: true } } as const;
const fullName = (u: { firstName: string; lastName: string; username: string } | null) =>
  u ? `${u.lastName} ${u.firstName}`.trim() || u.username : null;

/** Lần báo + dòng + ai/máy nào/lúc nào + đã bị đảo chưa - dùng chung cho mọi loại đợt. */
const REPORT_INCLUDE = {
  reportedBy: USER_NAME,
  workstation: { select: { code: true, name: true } },
  lines: {
    include: {
      segmentSpec: { select: { cutLengthMm: true } },
      piece: { select: { code: true, name: true } },
    },
  },
  reversedBy: { select: { id: true, reason: true, createdAt: true, reportedBy: USER_NAME } },
} as const;

type ReportRow = Prisma.FloorReportGetPayload<{ include: typeof REPORT_INCLUDE }>;

/**
 * Màn chung của QLSX cho 3 tổ (2026-10-13, mục 15/22): các đợt CHƯA gửi KCS kèm từng lần báo (ai, máy nào,
 * lúc nào, bao nhiêu), "Gửi KCS" (QLSX kiểm rồi gửi - người dùng chọn ở mục 15), và đảo 1 lần báo sai có lý do.
 * Gửi KCS gọi lại ĐÚNG hàm cũ của tổ (finishCutBundle/finishProductionBatch/submitStepBundle) - luồng KCS
 * không đổi.
 */
@Injectable()
export class FloorReviewService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly steelIssues: SteelIssuesService,
    private readonly productionBatches: ProductionBatchesService,
  ) {}

  async listOpen(stage: FloorWorkerStage, productionInvoiceId?: string) {
    const piId = productionInvoiceId ? parseBigIntId(productionInvoiceId) : undefined;
    const productionBatches = await this.prisma.productionBatch.findMany({
      where: {
        stage: stage as MfgStage,
        status: ProductionBatchStatus.OPEN,
        ...(piId && { productionOrder: { productionInvoiceItem: { productionInvoiceId: piId } } }),
      },
      orderBy: { reportedAt: 'asc' },
      include: {
        piece: { select: { code: true, name: true } },
        reportedBy: USER_NAME,
        productionOrder: {
          select: {
            id: true,
            poNumber: true,
            mfgProduct: { select: { factoryCode: true } },
            productionInvoiceItem: {
              select: { productionInvoice: { select: { id: true, code: true } } },
            },
          },
        },
        floorReports: { include: REPORT_INCLUDE, orderBy: { createdAt: 'asc' } },
      },
    });
    const piecePlans = await this.loadPiecePlans(stage, productionBatches);
    const pieceBatches = productionBatches.map((b) => {
      const reports = b.floorReports.filter((r) => !r.reversalOfId).map((r) => this.toReport(r));
      const item = piecePlans.items.get(`${b.productionOrderId}:${b.pieceId}`);
      const required = item?.plannedQty ?? 0;
      const reported = item
        ? item.passedQty +
          item.awaitingQcQty +
          (piecePlans.open.get(`${b.productionOrderId}:${b.pieceId}`) ?? 0)
        : 0;
      return {
        productionBatchId: b.id.toString(),
        stage: b.stage,
        pi: this.piOf(b.productionOrder.productionInvoiceItem.productionInvoice),
        order: this.orderOf(b.productionOrder),
        piece: b.piece,
        reportedQty: b.reportedQty,
        openedByName: fullName(b.reportedBy),
        openedAt: b.reportedAt,
        waitingSince: this.waitingSince(reports, b.reportedAt),
        /** Số cần / đã báo (mọi người, mọi trạng thái) của mảnh này trong SKU - để QLSX thấy báo vượt. required = 0: không rõ. */
        progress: { required, reported, over: Math.max(0, reported - required) },
        reports,
      };
    });
    if (stage !== MfgStage.PHOI) return { cutBundles: [], stepGroups: [], pieceBatches };

    const [cutBundles, stepBatches] = await Promise.all([
      this.prisma.cutBundle.findMany({
        where: {
          status: CutBundleStatus.CUTTING,
          ...(piId && { steelIssue: { productionInvoiceId: piId } }),
        },
        orderBy: { createdAt: 'asc' },
        include: {
          openedBy: USER_NAME,
          segments: { include: { segmentSpec: { select: { cutLengthMm: true } } } },
          steelIssue: {
            select: {
              material: { select: { id: true, code: true, name: true } },
              productionInvoice: { select: { id: true, code: true } },
            },
          },
          productionOrder: {
            select: { id: true, poNumber: true, mfgProduct: { select: { factoryCode: true } } },
          },
          floorReports: { include: REPORT_INCLUDE, orderBy: { createdAt: 'asc' } },
        },
      }),
      this.prisma.stepBatch.findMany({
        where: { stepBundleId: null, ...(piId && { productionInvoiceId: piId }) },
        orderBy: { createdAt: 'asc' },
        include: {
          reportedBy: USER_NAME,
          material: { select: { id: true, code: true, name: true } },
          productionInvoice: { select: { id: true, code: true } },
          productionOrder: {
            select: { id: true, poNumber: true, mfgProduct: { select: { factoryCode: true } } },
          },
          segments: { include: { segmentSpec: { select: { cutLengthMm: true } } } },
          floorReports: { include: REPORT_INCLUDE, orderBy: { createdAt: 'asc' } },
        },
      }),
    ]);

    // Số cần / đã làm theo PI (cắt) và theo (PI, công đoạn) - chỉ để hiển thị, lỗi thì thẻ không có số cần.
    const cutProgress = await this.loadPhoiProgress(
      cutBundles.map((b) => b.steelIssue.productionInvoice.id.toString()),
    );
    const stepProgress = await this.loadStepProgress(
      stepBatches.map((sb) => ({ piId: sb.productionInvoiceId.toString(), step: sb.step })),
    );

    // Công đoạn phụ gửi KCS theo (PI, loại sắt, công đoạn, SKU, NGƯỜI BÁO) - đúng phạm vi submitStepBundle() khi truyền worker:
    // mỗi công nhân 1 đợt riêng để KCS chấm đạt/lỗi biết của ai (mục 20.5/26).
    const groups = new Map<
      string,
      {
        pi: { productionInvoiceId: string; code: string };
        material: { materialId: string; code: string; name: string };
        step: ProcessStep;
        order: ReturnType<FloorReviewService['orderOf']> | null;
        workerId: string | null;
        workerName: string | null;
        segments: Map<string, { cutLengthMm: number; qty: number }>;
        reports: ReturnType<FloorReviewService['toReport']>[];
      }
    >();
    for (const sb of stepBatches) {
      const key = `${sb.productionInvoiceId}:${sb.materialId}:${sb.step}:${sb.productionOrderId ?? ''}:${sb.reportedById ?? ''}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          pi: this.piOf(sb.productionInvoice)!,
          material: {
            materialId: sb.material.id.toString(),
            code: sb.material.code,
            name: sb.material.name,
          },
          step: sb.step,
          order: sb.productionOrder ? this.orderOf(sb.productionOrder) : null,
          workerId: sb.reportedById,
          workerName: fullName(sb.reportedBy),
          segments: new Map(),
          reports: [],
        };
        groups.set(key, g);
      }
      for (const s of sb.segments) {
        const k = s.segmentSpecId.toString();
        const cur = g.segments.get(k);
        g.segments.set(k, {
          cutLengthMm: Number(s.segmentSpec.cutLengthMm),
          qty: (cur?.qty ?? 0) + s.qty,
        });
      }
      g.reports.push(
        ...sb.floorReports.filter((r) => !r.reversalOfId).map((r) => this.toReport(r)),
      );
    }

    return {
      cutBundles: cutBundles.map((b) => {
        const reports = b.floorReports.filter((r) => !r.reversalOfId).map((r) => this.toReport(r));
        const segs = b.segments
          .map((s) => ({
            segmentSpecId: s.segmentSpecId.toString(),
            cutLengthMm: Number(s.segmentSpec.cutLengthMm),
            qty: s.qty,
          }))
          .sort((a, c) => c.cutLengthMm - a.cutLengthMm);
        const progressItem = cutProgress
          .get(b.steelIssue.productionInvoice.id.toString())
          ?.find((m) => m.materialId === b.steelIssue.material.id.toString());
        return {
          cutBundleId: b.id.toString(),
          pi: this.piOf(b.steelIssue.productionInvoice),
          material: {
            materialId: b.steelIssue.material.id.toString(),
            code: b.steelIssue.material.code,
            name: b.steelIssue.material.name,
          },
          order: b.productionOrder ? this.orderOf(b.productionOrder) : null,
          openedByName: fullName(b.openedBy),
          createdAt: b.createdAt,
          waitingSince: this.waitingSince(reports, b.createdAt),
          segments: segs.map(({ cutLengthMm, qty }) => ({ cutLengthMm, qty })),
          /** Mỗi cỡ: số cần / đã cắt của SKU (cả PI nếu đợt cũ không gắn SKU) + phần vượt. */
          progress: this.segmentProgress(progressItem, b.productionOrderId, segs),
          /** Sắt vào – đoạn ra của LOẠI SẮT này cả PI (mục 21.1.4): đoạn báo vượt sắt đã nhận. null = chưa có số. */
          steelBalance: progressItem?.steelBalance ?? null,
          reports,
        };
      }),
      stepGroups: [...groups.values()].map((g) => {
        const segs = [...g.segments.entries()]
          .map(([segmentSpecId, v]) => ({ segmentSpecId, ...v }))
          .sort((a, c) => c.cutLengthMm - a.cutLengthMm);
        const progressItem = stepProgress
          .get(`${g.pi.productionInvoiceId}:${g.step}`)
          ?.find((m) => m.materialId === g.material.materialId);
        return {
          ...g,
          waitingSince: this.waitingSince(g.reports, new Date()),
          segments: segs.map(({ cutLengthMm, qty }) => ({ cutLengthMm, qty })),
          progress: this.segmentProgress(progressItem, g.order?.productionOrderId ?? null, segs),
        };
      }),
      pieceBatches,
    };
  }

  /** Lần báo CÒN HIỆU LỰC đầu tiên chưa gửi KCS - "chờ bao lâu" tính từ đây (không phải từ lúc mở đợt: đợt mở sáng, báo thêm chiều). */
  private waitingSince(reports: { createdAt: Date; reversed: unknown }[], fallback: Date): Date {
    const live = reports.filter((r) => !r.reversed).map((r) => r.createdAt.getTime());
    return new Date(live.length ? Math.min(...live) : fallback.getTime());
  }

  private segmentProgress(
    item: PhoiProgressItemResponseDto | undefined,
    orderId: bigint | string | null,
    segs: { segmentSpecId: string; cutLengthMm: number; qty: number }[],
  ) {
    return segs.map((sg) => {
      const p = item?.segments.find((s) => s.segmentSpecId === sg.segmentSpecId);
      // Đợt gắn SKU -> số của SKU đó; đợt cũ không gắn SKU -> số cả PI.
      const o =
        orderId != null
          ? p?.byOrder.find((b) => b.productionOrderId === String(orderId))
          : undefined;
      const required = o ? o.required : (p?.required ?? 0);
      const done = o ? o.done : (p?.done ?? 0);
      return {
        cutLengthMm: sg.cutLengthMm,
        qty: sg.qty,
        required,
        done,
        over: Math.max(0, done - required),
      };
    });
  }

  private async loadPhoiProgress(piIds: string[]) {
    const map = new Map<string, PhoiProgressItemResponseDto[]>();
    await Promise.all(
      [...new Set(piIds)].map(async (id) => {
        try {
          map.set(id, await this.steelIssues.getPhoiProgress(id));
        } catch {
          /* không lấy được tiến độ thì thẻ chỉ không hiện "cần" - không làm hỏng danh sách đợt chờ */
        }
      }),
    );
    return map;
  }

  private async loadStepProgress(pairs: { piId: string; step: ProcessStep }[]) {
    const map = new Map<string, PhoiProgressItemResponseDto[]>();
    const keys = new Map(pairs.map((p) => [`${p.piId}:${p.step}`, p]));
    await Promise.all(
      [...keys.entries()].map(async ([key, p]) => {
        try {
          map.set(key, await this.steelIssues.getStepProgress(p.piId, p.step));
        } catch {
          /* như trên */
        }
      }),
    );
    return map;
  }

  /** Kế hoạch mảnh (cần / đã KCS / chờ KCS) + số đang mở (chưa gửi KCS, mọi người) theo (SKU, mảnh). */
  private async loadPiecePlans(stage: FloorWorkerStage, batches: { productionOrderId: bigint }[]) {
    const items = new Map<
      string,
      { plannedQty: number; passedQty: number; awaitingQcQty: number }
    >();
    const open = new Map<string, number>();
    const orderIds = [...new Set(batches.map((b) => b.productionOrderId))];
    if (orderIds.length === 0) return { items, open };
    try {
      const [plans, openAgg] = await Promise.all([
        this.productionBatches.getBatchPlanBatch(
          orderIds.map((o) => o.toString()),
          stage as MfgStage,
        ),
        this.prisma.productionBatch.groupBy({
          by: ['productionOrderId', 'pieceId'],
          where: {
            stage: stage as MfgStage,
            status: ProductionBatchStatus.OPEN,
            productionOrderId: { in: orderIds },
          },
          _sum: { reportedQty: true },
        }),
      ]);
      for (const [orderId, plan] of Object.entries(plans)) {
        for (const it of plan.items) items.set(`${orderId}:${it.pieceId}`, it);
      }
      for (const r of openAgg) {
        open.set(`${r.productionOrderId}:${r.pieceId}`, r._sum.reportedQty ?? 0);
      }
    } catch {
      /* như trên - thẻ chỉ không có số cần */
    }
    return { items, open };
  }

  // ─── Gửi KCS (QLSX) ─────────────────────────────────────────────────────────

  sendCutBundle(cutBundleId: string) {
    return this.steelIssues.finishCutBundle(cutBundleId);
  }

  /** stage của chính đợt làm "vai" người gửi (assertMfgRoleMatchesStage), kho trừ tồn đoạn = kho xưởng
   *  phoi-son-han như tài khoản tổ (QLSX không có warehouseScope - xem mục 15). */
  async sendProductionBatch(productionBatchId: string, actorId: string) {
    const batch = await this.prisma.productionBatch.findUnique({
      where: { id: parseBigIntId(productionBatchId) },
      select: { stage: true },
    });
    if (!batch) throw new NotFoundException(`Đợt ${productionBatchId} không tồn tại`);
    return this.productionBatches.finishProductionBatch(
      productionBatchId,
      actorId,
      batch.stage,
      MFG_FLOOR_WAREHOUSE_SCOPE,
    );
  }

  sendStepGroup(
    dto: {
      productionInvoiceId: string;
      materialId: string;
      step: ProcessStep;
      productionOrderId: string;
      /** Công nhân của nhóm (id; null = đợt cũ chưa biết người). Bỏ trống = gom hết như màn Phôi cũ. */
      workerId?: string | null;
    },
    actorId: string,
  ) {
    return this.steelIssues.submitStepBundle(
      dto.productionInvoiceId,
      dto.materialId,
      dto.step,
      actorId,
      dto.productionOrderId,
      dto.workerId !== undefined ? { id: dto.workerId } : undefined,
    );
  }

  // ─── Đảo 1 lần báo sai ──────────────────────────────────────────────────────

  /**
   * QLSX đảo 1 lần báo (bất kỳ, không chỉ lần cuối như "Hoàn tác" cũ) của đợt CHƯA gửi KCS: ghi 1 dòng sổ âm +
   * lý do (công nhân thấy trong "Sản lượng của tôi") rồi trừ đúng số của lần đó khỏi đợt. Đợt đã gửi KCS thì
   * không đảo được - lúc đó KCS chấm là chốt kiểm soát (giữ quyết định không sửa số sau KCS).
   */
  async reverse(floorReportId: string, reason: string, actorId: string) {
    const report = await this.prisma.floorReport.findUnique({
      where: { id: parseBigIntId(floorReportId) },
      include: { lines: true, reversedBy: { select: { id: true } } },
    });
    if (!report) throw new NotFoundException(`Lần báo ${floorReportId} không tồn tại`);
    if (report.reversalOfId) throw new BadRequestException('Đây là dòng đảo - không đảo lại được');
    if (report.reversedBy) throw new ConflictException('Lần báo này đã bị đảo rồi');

    const reversal = {
      kind: report.kind,
      reportedById: actorId,
      reversalOfId: report.id,
      workstationId: report.workstationId ?? undefined,
      productionInvoiceId: report.productionInvoiceId,
      reason: reason.trim(),
      lines: report.lines.map((l) => ({
        segmentSpecId: l.segmentSpecId ?? undefined,
        pieceId: l.pieceId ?? undefined,
        qty: -l.qty,
      })),
    };

    try {
      if (report.kind === FloorReportKind.CUT) {
        await this.reverseCut(report.cutBundleId, report.lines, reversal);
      } else if (report.kind === FloorReportKind.STEP) {
        await this.reverseStep(report.stepBatchId, reversal);
      } else {
        await this.reversePiece(report.productionBatchId, report.lines, reversal);
      }
    } catch (e) {
      // reversalOfId @unique - 2 QLSX cùng bấm đảo 1 lần báo.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Lần báo này vừa được người khác đảo');
      }
      throw e;
    }
    return { ok: true };
  }

  private async reverseCut(
    cutBundleId: bigint | null,
    lines: { segmentSpecId: bigint | null; qty: number }[],
    reversal: Parameters<typeof writeFloorReport>[1],
  ) {
    if (!cutBundleId) throw new ConflictException('Đợt cắt của lần báo này không còn');
    await this.prisma.$transaction(async (tx) => {
      // Khoá dòng đợt cắt: "Gửi KCS" (finishCutBundle) chạy cùng lúc phải chờ, rồi thấy đúng trạng thái.
      const [locked] = await tx.$queryRaw<{ status: CutBundleStatus }[]>`
        SELECT "status" FROM "cut_bundles" WHERE "id" = ${cutBundleId} FOR UPDATE`;
      if (!locked) throw new ConflictException('Đợt cắt của lần báo này không còn');
      if (locked.status !== CutBundleStatus.CUTTING) {
        throw new ConflictException('Đợt cắt đã gửi KCS - không đảo được nữa');
      }
      await writeFloorReport(tx, { ...reversal, cutBundleId });
      for (const l of lines) {
        if (!l.segmentSpecId) continue;
        const row = await tx.cutPatternSegment.findUnique({
          where: { cutBundleId_segmentSpecId: { cutBundleId, segmentSpecId: l.segmentSpecId } },
        });
        if (!row) continue;
        const newQty = row.qty - l.qty;
        if (newQty <= 0) await tx.cutPatternSegment.delete({ where: { id: row.id } });
        else await tx.cutPatternSegment.update({ where: { id: row.id }, data: { qty: newQty } });
      }
      // Hết đoạn -> xoá hẳn đợt (cùng cách "Hoàn tác" cũ); sổ còn nguyên, FK về NULL.
      if ((await tx.cutPatternSegment.count({ where: { cutBundleId } })) === 0) {
        await tx.cutBundle.delete({ where: { id: cutBundleId } });
      }
    });
  }

  /** 1 lần báo công đoạn phụ = đúng 1 StepBatch (recordStepBatch luôn tạo dòng mới) -> đảo = xoá dòng đó. */
  private async reverseStep(
    stepBatchId: bigint | null,
    reversal: Parameters<typeof writeFloorReport>[1],
  ) {
    if (!stepBatchId) throw new ConflictException('Đợt công đoạn của lần báo này không còn');
    await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ stepBundleId: bigint | null }[]>`
        SELECT "stepBundleId" FROM "step_batches" WHERE "id" = ${stepBatchId} FOR UPDATE`;
      if (!locked) throw new ConflictException('Đợt công đoạn của lần báo này không còn');
      if (locked.stepBundleId)
        throw new ConflictException('Công đoạn đã gửi KCS - không đảo được nữa');
      await writeFloorReport(tx, { ...reversal, stepBatchId });
      await tx.stepBatchSegment.deleteMany({ where: { stepBatchId } });
      await tx.stepBatch.delete({ where: { id: stepBatchId } });
    });
  }

  private async reversePiece(
    productionBatchId: bigint | null,
    lines: { qty: number }[],
    reversal: Parameters<typeof writeFloorReport>[1],
  ) {
    if (!productionBatchId) throw new ConflictException('Đợt của lần báo này không còn');
    const batch = await this.prisma.productionBatch.findUnique({
      where: { id: productionBatchId },
    });
    if (!batch) throw new ConflictException('Đợt của lần báo này không còn');
    const qty = lines.reduce((s, l) => s + l.qty, 0);
    await this.prisma.$transaction(async (tx) => {
      // Cùng khoá với recordProductionBatch()/finishProductionBatch() -> loại trừ lẫn nhau.
      await lockBusinessKey(
        tx,
        `production-batch-open:${batch.productionOrderId}:${batch.pieceId}:${batch.stage}`,
      );
      const fresh = await tx.productionBatch.findUniqueOrThrow({ where: { id: batch.id } });
      if (fresh.status !== ProductionBatchStatus.OPEN) {
        throw new ConflictException('Đợt đã gửi KCS - không đảo được nữa');
      }
      await writeFloorReport(tx, { ...reversal, productionBatchId: batch.id });
      const left = Math.max(fresh.reportedQty - qty, 0);
      if (left === 0) await tx.productionBatch.delete({ where: { id: batch.id } });
      else
        await tx.productionBatch.update({ where: { id: batch.id }, data: { reportedQty: left } });
    });
  }

  // ─── map ────────────────────────────────────────────────────────────────────

  private piOf(pi: { id: bigint; code: string } | null | undefined) {
    return pi ? { productionInvoiceId: pi.id.toString(), code: pi.code } : null;
  }

  private orderOf(o: { id: bigint; poNumber: string; mfgProduct: { factoryCode: string } }) {
    return {
      productionOrderId: o.id.toString(),
      poNumber: o.poNumber,
      sku: o.mfgProduct.factoryCode,
    };
  }

  private toReport(r: ReportRow) {
    return {
      floorReportId: r.id.toString(),
      createdAt: r.createdAt,
      reportedByName: fullName(r.reportedBy),
      workstation: r.workstation,
      lines: r.lines.map((l) => ({
        qty: l.qty,
        cutLengthMm: l.segmentSpec ? Number(l.segmentSpec.cutLengthMm) : null,
        piece: l.piece,
      })),
      reversed: r.reversedBy
        ? {
            reason: r.reversedBy.reason,
            at: r.reversedBy.createdAt,
            byName: fullName(r.reversedBy.reportedBy),
          }
        : null,
    };
  }
}
