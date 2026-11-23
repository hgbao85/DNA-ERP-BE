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
  ProductionOrderStatus,
} from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { writeFloorReport } from '../../common/utils/floor-report.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { MaterialYieldRecipeProductionService } from '../material-yield-recipes/material-yield-recipe-production.service';
import { loadMaterialYieldNeed } from '../material-yield-recipes/material-yield-need.util';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { ProductionBatchPlanItemResponseDto } from '../production-batches/dto/production-batch-plan-item-response.dto';
import { PhoiProgressItemResponseDto } from '../steel-issues/dto/phoi-progress-response.dto';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { FloorWorkerStage } from './dto/floor-worker.dto';
import { filterByQueueWorkshop, queueWorkshopIdOfPi } from './floor-queue-workshop.util';
import { blockedReasonOf, listKcsPendingItems, piHasActiveSkuWhere } from './kcs-pending.util';
import {
  orderNotCancelled,
  orderNotCancelledNullable,
} from '../../common/utils/cancelled-order.util';

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

/** Nhãn cổng "lệnh dừng" khi KCS chốt để chấm: "... chưa/không thể chốt để chấm" (hợp đồng v2 mục 3). */
const KCS_CLOSE_GATE_LABEL = 'chốt để chấm';

/** 3 câu 409 khi KCS bấm Chấm đợt vừa bị QLSX hủy hết (đợt bị xoá) - hợp đồng v2 mục 3 / bản sửa mục 8. */
const CUT_BUNDLE_CANCELLED_MESSAGE =
  'Đợt cắt này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.';
const BATCH_CANCELLED_MESSAGE =
  'Lô này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.';
const STEP_GROUP_UNASSIGNED_MESSAGE = 'Dữ liệu cũ chưa gắn SKU - chưa chấm được, báo IT.';

/** 3 câu 409 khi QLSX hủy lần báo của đợt KCS đã bắt đầu chấm (hợp đồng v2 mục 5). */
const REVERSE_AFTER_CLOSE_MESSAGE =
  'KCS đã bắt đầu chấm đợt này - không hủy được nữa. Số sai thì báo KCS ghi “số thực có” khi chấm.';

/** QLSX hủy lần báo giữ khoá cả PI + đọc số cần (X3): DB ở xa, mặc định 5 giây dễ hết hạn (P2028 -> 500). */
const REVERSE_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/**
 * S6 (P1): MỘT hàm "báo thêm được tối đa bao nhiêu mảnh" cho lô mảnh (Phôi / Hàn / Sơn) = max(0, kế hoạch - đã KCS chấm
 * còn tính - đang chờ KCS - đang mở). Dùng ở màn KCS / QLSX (floor-review) và màn quét (floor-scan, BE-4b) để 2 nơi ra cùng số.
 */
export function pieceMaxNow(item: {
  plannedQty: number;
  passedQty: number;
  awaitingQcQty: number;
  openQty: number;
}): number {
  return Math.max(0, item.plannedQty - item.passedQty - item.awaitingQcQty - item.openQty);
}

/** Pat (công đoạn của mảnh Phôi): max(0, cần - (đã báo - lỗi - thiếu)). `doneQty` là số thô (append-only). */
export function pieceStepMaxNow(sp: {
  requiredQty: number;
  doneQty: number;
  failedQty: number;
  shortQty: number;
}): number {
  return Math.max(0, sp.requiredQty - Math.max(0, sp.doneQty - sp.failedQty - sp.shortQty));
}

type OrderInfo = {
  id: bigint;
  poNumber: string;
  mfgProduct: { factoryCode: string };
};

/**
 * Màn đợt công nhân đã báo, KCS chưa chấm (P1 "KCS tự chuyển", 18/11/2026): QLSX xem + hủy lần báo sai; KCS xem + bấm Chấm
 * ("chốt để chấm"). Từ P1 KHÔNG còn bước "QLSX gửi KCS": công nhân báo xong là KCS tự thấy, KCS bấm Chấm thì đợt mới chốt.
 * 5 hàm close* gọi lại ĐÚNG hàm chốt cũ của tổ (finishCutBundle / finishProductionBatch / submitStepBundle / submitPieceStep /
 * submitStep) với notifyKcs = false (KCS tự thấy đợt nên không cần tin) và nhãn cổng 'chốt để chấm'.
 */
@Injectable()
export class FloorReviewService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly steelIssues: SteelIssuesService,
    private readonly productionBatches: ProductionBatchesService,
    private readonly workshopScope: WorkshopScopeService,
    private readonly materialYieldProduction: MaterialYieldRecipeProductionService,
  ) {}

  /**
   * X4 (danh sách lỗi 16/11): QLSX gắn xưởng chỉ hủy lần báo của PI có xưởng hàng đợi (ở tổ đó) = xưởng mình -
   * cùng quy tắc hàng đợi tổ (Sơn của xưởng nhờ sơn thuộc xưởng sơn). Trước đây không kiểm gì.
   */
  private async assertManagesPi(
    actorId: string,
    stage: MfgStage,
    productionInvoiceId: bigint | null | undefined,
    what: string,
  ): Promise<void> {
    if (productionInvoiceId == null) return;
    const scope = await this.workshopScope.getScope(actorId);
    if (scope.workshopId == null) return;
    const ws = await queueWorkshopIdOfPi(this.prisma, stage, productionInvoiceId);
    this.workshopScope.assertCanManage(scope, [ws], what);
  }

  /**
   * Đợt đang mở của 1 tổ. `limitToWorkshop` = true (QLSX): QLSX gắn xưởng chỉ thấy đợt của xưởng mình (X4 16/11, người không
   * gắn xưởng thấy hết). false (KCS không có vai QLSX): KHÔNG lọc xưởng, kể cả khi tài khoản có gắn xưởng.
   * Mọi phần tử có piActive / blockedReason / waitingSince; progress theo nghĩa "đã tính" (thô - lỗi - thiếu).
   */
  async listOpen(
    stage: FloorWorkerStage,
    productionInvoiceId?: string,
    userId?: string,
    limitToWorkshop = true,
  ) {
    const piId = productionInvoiceId ? parseBigIntId(productionInvoiceId) : undefined;
    const workshopId = limitToWorkshop
      ? (await this.workshopScope.getScope(userId)).workshopId
      : null;
    const allProductionBatches = await this.prisma.productionBatch.findMany({
      where: {
        stage: stage as MfgStage,
        status: ProductionBatchStatus.OPEN,
        // Huỷ lệnh theo SKU (23/11/2026): đợt của SKU đã huỷ không chấm được - không hiện.
        AND: [
          orderNotCancelled(),
          ...(piId
            ? [{ productionOrder: { productionInvoiceItem: { productionInvoiceId: piId } } }]
            : []),
        ],
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
    const productionBatches = await filterByQueueWorkshop(
      this.prisma,
      workshopId,
      stage as MfgStage,
      allProductionBatches,
      (b) => b.productionOrder.productionInvoiceItem.productionInvoice?.id,
    );
    const stoppedPis = await this.loadStoppedPis(stage, piId, workshopId);
    // Huỷ lệnh theo SKU (23/11/2026): id lệnh SX đã huỷ - FE ẩn đợt CHỜ CHẤM (AWAITING_QC, lấy từ API danh sách riêng) của các
    // lệnh này; đợt đang mở đã lọc ở BE ngay trên. Huỷ hiếm nên tập này nhỏ.
    const cancelledOrderIds = (
      await this.prisma.productionOrder.findMany({
        where: { status: ProductionOrderStatus.CANCELLED },
        select: { id: true },
      })
    ).map((o) => o.id.toString());

    if (stage !== MfgStage.PHOI) {
      const activePis = await this.loadActivePiSet(
        productionBatches.map((b) => b.productionOrder.productionInvoiceItem.productionInvoice?.id),
      );
      const piecePlans = await this.loadPiecePlans(stage, productionBatches);
      return {
        cutBundles: [],
        stepGroups: [],
        pieceBatches: this.mapPieceBatches(productionBatches, piecePlans, activePis),
        pieceStepGroups: [],
        materialYieldGroups: [],
        stoppedPis,
        cancelledOrderIds,
      };
    }

    const [allCutBundles, allStepBatches, allPieceStepBatches, allYieldBatches] = await Promise.all(
      [
        this.prisma.cutBundle.findMany({
          where: {
            status: CutBundleStatus.CUTTING,
            ...orderNotCancelledNullable(),
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
          where: {
            stepBundleId: null,
            ...orderNotCancelledNullable(),
            ...(piId && { productionInvoiceId: piId }),
          },
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
        // Pat (công đoạn của mảnh Phôi): chưa gom vào đợt chốt - không có sổ báo (không hủy được từng lần).
        this.prisma.pieceStepBatch.findMany({
          where: {
            pieceStepBundleId: null,
            AND: [
              orderNotCancelled(),
              ...(piId
                ? [{ productionOrder: { productionInvoiceItem: { productionInvoiceId: piId } } }]
                : []),
            ],
          },
          orderBy: { reportedAt: 'asc' },
          include: {
            reportedBy: USER_NAME,
            piece: { select: { code: true, name: true } },
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
          },
        }),
        // Chân nhôm (vật tư thành phẩm không gắn mảnh): chưa gom vào đợt chốt, cũng không có sổ báo.
        this.prisma.materialYieldStepBatch.findMany({
          where: {
            materialYieldStepBundleId: null,
            ...(piId && { productionInvoiceId: piId }),
          },
          orderBy: { reportedAt: 'asc' },
          include: {
            reportedBy: USER_NAME,
            productionInvoice: { select: { id: true, code: true } },
            recipe: {
              select: { outputMaterial: { select: { id: true, code: true, name: true } } },
            },
          },
        }),
      ],
    );

    const cutBundles = await filterByQueueWorkshop(
      this.prisma,
      workshopId,
      MfgStage.PHOI,
      allCutBundles,
      (b) => b.steelIssue.productionInvoice.id,
    );
    const stepBatches = await filterByQueueWorkshop(
      this.prisma,
      workshopId,
      MfgStage.PHOI,
      allStepBatches,
      (sb) => sb.productionInvoiceId,
    );
    const pieceStepBatches = await filterByQueueWorkshop(
      this.prisma,
      workshopId,
      MfgStage.PHOI,
      allPieceStepBatches,
      (r) => r.productionOrder.productionInvoiceItem.productionInvoice?.id,
    );
    const yieldBatches = await filterByQueueWorkshop(
      this.prisma,
      workshopId,
      MfgStage.PHOI,
      allYieldBatches,
      (r) => r.productionInvoiceId,
    );

    // PI còn SKU đang chạy (QLSX đã Bắt đầu, chưa Kết thúc / Tạm dừng) + SKU của PI có nhóm công đoạn phụ (để biết PI 1 SKU / nhiều SKU).
    const activePis = await this.loadActivePiSet([
      ...productionBatches.map(
        (b) => b.productionOrder.productionInvoiceItem.productionInvoice?.id,
      ),
      ...cutBundles.map((b) => b.steelIssue.productionInvoice.id),
      ...stepBatches.map((sb) => sb.productionInvoiceId),
      ...pieceStepBatches.map((r) => r.productionOrder.productionInvoiceItem.productionInvoice?.id),
      ...yieldBatches.map((r) => r.productionInvoiceId),
    ]);
    const ordersOfPi = await this.loadOrdersOfPis(stepBatches.map((sb) => sb.productionInvoiceId));

    // Số cần / đã làm theo PI (cắt) và theo (PI, công đoạn) - chỉ để hiển thị, lỗi thì thẻ không có số cần.
    const cutProgress = await this.loadPhoiProgress(
      cutBundles.map((b) => b.steelIssue.productionInvoice.id.toString()),
    );
    const stepProgress = await this.loadStepProgress(
      stepBatches.map((sb) => ({ piId: sb.productionInvoiceId.toString(), step: sb.step })),
    );
    const piecePlans = await this.loadPiecePlans(stage, [
      ...productionBatches,
      ...pieceStepBatches,
    ]);
    const yieldNeed = await this.loadYieldNeed(yieldBatches.map((r) => r.productionInvoiceId));

    // Công đoạn phụ gom theo (PI, loại sắt, công đoạn, SKU, NGƯỜI BÁO) - đúng phạm vi submitStepBundle() khi truyền worker:
    // mỗi công nhân 1 đợt riêng để KCS chấm đạt/lỗi biết của ai (mục 20.5/26). Dòng cũ chưa gắn SKU của PI 1 SKU gộp vào
    // SKU duy nhất (cùng luật skuScope); của PI nhiều SKU thì thành nhóm riêng "chưa gắn SKU" (blockedReason CHUA_GAN_SKU).
    const groups = new Map<
      string,
      {
        pi: { productionInvoiceId: string; code: string };
        piBig: bigint;
        material: { materialId: string; code: string; name: string };
        step: ProcessStep;
        order: ReturnType<FloorReviewService['orderOf']> | null;
        workerId: string | null;
        workerName: string | null;
        segments: Map<string, { cutLengthMm: number; qty: number }>;
        reports: ReturnType<FloorReviewService['toReport']>[];
        firstRowAt: Date;
      }
    >();
    for (const sb of stepBatches) {
      const piOrders = ordersOfPi.get(sb.productionInvoiceId.toString()) ?? [];
      const effectiveOrder: OrderInfo | null =
        sb.productionOrder ?? (piOrders.length === 1 ? piOrders[0] : null);
      const key = `${sb.productionInvoiceId}:${sb.materialId}:${sb.step}:${effectiveOrder?.id ?? ''}:${sb.reportedById ?? ''}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          pi: this.piOf(sb.productionInvoice)!,
          piBig: sb.productionInvoiceId,
          material: {
            materialId: sb.material.id.toString(),
            code: sb.material.code,
            name: sb.material.name,
          },
          step: sb.step,
          order: effectiveOrder ? this.orderOf(effectiveOrder) : null,
          workerId: sb.reportedById,
          workerName: fullName(sb.reportedBy),
          segments: new Map(),
          reports: [],
          firstRowAt: sb.createdAt,
        };
        groups.set(key, g);
      }
      if (sb.createdAt.getTime() < g.firstRowAt.getTime()) g.firstRowAt = sb.createdAt;
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
        const piActive = activePis.has(b.steelIssue.productionInvoice.id.toString());
        return {
          cutBundleId: b.id.toString(),
          pi: this.piOf(b.steelIssue.productionInvoice),
          piActive,
          blockedReason: blockedReasonOf({ piActive, multiSku: false, productionOrderId: 0n }),
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
          /** Mỗi cỡ: số cần / số được tính (thô - lỗi - thiếu) của SKU (cả PI nếu đợt cũ không gắn SKU) + phần vượt + báo thêm được tối đa. */
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
        const piActive = activePis.has(g.piBig.toString());
        const multiSku = (ordersOfPi.get(g.piBig.toString())?.length ?? 0) > 1;
        const orderId = g.order?.productionOrderId ?? null;
        const { piBig: _piBig, firstRowAt, ...rest } = g;
        void _piBig;
        return {
          ...rest,
          piActive,
          blockedReason: blockedReasonOf({ piActive, multiSku, productionOrderId: orderId }),
          waitingSince: this.waitingSince(g.reports, firstRowAt),
          segments: segs.map(({ cutLengthMm, qty }) => ({ cutLengthMm, qty })),
          progress: this.segmentProgress(progressItem, orderId, segs),
        };
      }),
      pieceBatches: this.mapPieceBatches(productionBatches, piecePlans, activePis),
      pieceStepGroups: this.mapPieceStepGroups(pieceStepBatches, piecePlans, activePis),
      materialYieldGroups: this.mapMaterialYieldGroups(yieldBatches, yieldNeed, activePis),
      stoppedPis,
      cancelledOrderIds,
    };
  }

  /** Lô mảnh đang mở (Phôi / Hàn / Sơn). */
  private mapPieceBatches(
    productionBatches: {
      id: bigint;
      stage: MfgStage;
      productionOrderId: bigint;
      pieceId: bigint;
      reportedQty: number;
      reportedAt: Date;
      reportedBy: { firstName: string; lastName: string; username: string } | null;
      piece: { code: string; name: string };
      productionOrder: {
        id: bigint;
        poNumber: string;
        mfgProduct: { factoryCode: string };
        productionInvoiceItem: { productionInvoice: { id: bigint; code: string } | null };
      };
      floorReports: ReportRow[];
    }[],
    piecePlans: Awaited<ReturnType<FloorReviewService['loadPiecePlans']>>,
    activePis: Set<string>,
  ) {
    return productionBatches.map((b) => {
      const reports = b.floorReports.filter((r) => !r.reversalOfId).map((r) => this.toReport(r));
      const item = piecePlans.items.get(`${b.productionOrderId}:${b.pieceId}`);
      const open = piecePlans.open.get(`${b.productionOrderId}:${b.pieceId}`) ?? 0;
      const required = item?.plannedQty ?? 0;
      // "Đã tính" = đã KCS chấm còn tính (đã trừ lỗi / thiếu) + đang chờ KCS + đang mở (S6).
      const reported = item ? item.passedQty + item.awaitingQcQty + open : 0;
      const pi = b.productionOrder.productionInvoiceItem.productionInvoice;
      const piActive = pi == null || activePis.has(pi.id.toString());
      return {
        productionBatchId: b.id.toString(),
        stage: b.stage,
        pi: this.piOf(pi),
        piActive,
        blockedReason: blockedReasonOf({ piActive, multiSku: false, productionOrderId: 0n }),
        order: this.orderOf(b.productionOrder),
        piece: b.piece,
        reportedQty: b.reportedQty,
        openedByName: fullName(b.reportedBy),
        openedAt: b.reportedAt,
        waitingSince: this.waitingSince(reports, b.reportedAt),
        /** Số cần / đã tính (mọi người, mọi trạng thái) của mảnh này trong SKU + báo thêm được tối đa. required = 0: không rõ. */
        progress: {
          required,
          reported,
          over: Math.max(0, reported - required),
          maxNow: item ? pieceMaxNow({ ...item, openQty: open }) : 0,
        },
        reports,
      };
    });
  }

  /** Pat: nhóm công đoạn của mảnh chưa chốt, gom theo (lệnh, mảnh, công đoạn). Không có sổ báo nên không hủy được. */
  private mapPieceStepGroups(
    rows: {
      productionOrderId: bigint;
      pieceId: bigint;
      step: ProcessStep;
      qty: number;
      reportedAt: Date;
      reportedBy: { firstName: string; lastName: string; username: string } | null;
      piece: { code: string; name: string };
      productionOrder: {
        id: bigint;
        poNumber: string;
        mfgProduct: { factoryCode: string };
        productionInvoiceItem: { productionInvoice: { id: bigint; code: string } | null };
      };
    }[],
    piecePlans: Awaited<ReturnType<FloorReviewService['loadPiecePlans']>>,
    activePis: Set<string>,
  ) {
    const groups = new Map<
      string,
      {
        row: (typeof rows)[number];
        qty: number;
        waitingSince: Date;
        workers: Set<string>;
      }
    >();
    for (const r of rows) {
      const key = `${r.productionOrderId}:${r.pieceId}:${r.step}`;
      let g = groups.get(key);
      if (!g) {
        g = { row: r, qty: 0, waitingSince: r.reportedAt, workers: new Set() };
        groups.set(key, g);
      }
      g.qty += r.qty;
      if (r.reportedAt.getTime() < g.waitingSince.getTime()) g.waitingSince = r.reportedAt;
      const name = fullName(r.reportedBy);
      if (name) g.workers.add(name);
    }
    return [...groups.values()].map((g) => {
      const r = g.row;
      const sp = piecePlans.items
        .get(`${r.productionOrderId}:${r.pieceId}`)
        ?.stepProgress.find((s) => s.step === r.step);
      const required = sp?.requiredQty ?? 0;
      const reportedQty = sp?.doneQty ?? 0;
      const failed = sp?.failedQty ?? 0;
      const shortQty = sp?.shortQty ?? 0;
      const done = Math.max(0, reportedQty - failed - shortQty);
      const pi = r.productionOrder.productionInvoiceItem.productionInvoice;
      const piActive = pi == null || activePis.has(pi.id.toString());
      return {
        productionOrderId: r.productionOrderId.toString(),
        pieceId: r.pieceId.toString(),
        piece: r.piece,
        step: r.step,
        pi: this.piOf(pi),
        piActive,
        blockedReason: blockedReasonOf({ piActive, multiSku: false, productionOrderId: 0n }),
        order: this.orderOf(r.productionOrder),
        /** Số mảnh công nhân đã báo mà KCS chưa chốt (của nhóm này). */
        qty: g.qty,
        reportedByNames: [...g.workers],
        waitingSince: g.waitingSince,
        progress: {
          required,
          reportedQty,
          done,
          failed,
          shortQty,
          over: Math.max(0, done - required),
          maxNow: sp ? pieceStepMaxNow(sp) : 0,
        },
      };
    });
  }

  /** Chân nhôm: nhóm công đoạn chưa chốt, gom theo (PI, công thức, công đoạn). Không có sổ báo nên không hủy được. */
  private mapMaterialYieldGroups(
    rows: {
      productionInvoiceId: bigint;
      recipeId: bigint;
      step: ProcessStep;
      qty: number;
      reportedAt: Date;
      reportedBy: { firstName: string; lastName: string; username: string } | null;
      productionInvoice: { id: bigint; code: string };
      recipe: { outputMaterial: { id: bigint; code: string; name: string } };
    }[],
    need: Awaited<ReturnType<FloorReviewService['loadYieldNeed']>>,
    activePis: Set<string>,
  ) {
    const groups = new Map<
      string,
      { row: (typeof rows)[number]; qty: number; waitingSince: Date; workers: Set<string> }
    >();
    for (const r of rows) {
      const key = `${r.productionInvoiceId}:${r.recipeId}:${r.step}`;
      let g = groups.get(key);
      if (!g) {
        g = { row: r, qty: 0, waitingSince: r.reportedAt, workers: new Set() };
        groups.set(key, g);
      }
      g.qty += r.qty;
      if (r.reportedAt.getTime() < g.waitingSince.getTime()) g.waitingSince = r.reportedAt;
      const name = fullName(r.reportedBy);
      if (name) g.workers.add(name);
    }
    return [...groups.values()].map((g) => {
      const r = g.row;
      const n = need.get(`${r.productionInvoiceId}:${r.recipeId}:${r.step}`);
      const required = n?.required ?? 0;
      const done = Math.max(0, n?.counted ?? 0);
      const piActive = activePis.has(r.productionInvoiceId.toString());
      return {
        productionInvoiceId: r.productionInvoiceId.toString(),
        recipeId: r.recipeId.toString(),
        pi: this.piOf(r.productionInvoice),
        piActive,
        blockedReason: blockedReasonOf({ piActive, multiSku: false, productionOrderId: 0n }),
        material: {
          materialId: r.recipe.outputMaterial.id.toString(),
          code: r.recipe.outputMaterial.code,
          name: r.recipe.outputMaterial.name,
        },
        step: r.step,
        /** Số công nhân đã báo mà KCS chưa chốt (của nhóm này). */
        qty: g.qty,
        reportedByNames: [...g.workers],
        waitingSince: g.waitingSince,
        /** required = số cần cả PI của công đoạn này; done = đã tính (thô - lỗi - thiếu, gồm cả lần đang chờ). */
        progress: {
          required,
          done,
          over: Math.max(0, done - required),
          maxNow: Math.max(0, required - done),
        },
      };
    });
  }

  /**
   * PI của tổ đang có đợt chờ KCS (đang mở hoặc đã chốt chưa chấm) mà không còn SKU nào ACTIVE: FE KCS tô xám dòng
   * AWAITING_QC của các PI này và khoá nút chấm (hợp đồng v2 mục 2, bản sửa MF2). QLSX gắn xưởng chỉ thấy PI của xưởng mình.
   */
  private async loadStoppedPis(
    stage: FloorWorkerStage,
    piId: bigint | undefined,
    workshopId: bigint | null,
  ): Promise<{ productionInvoiceId: string; code: string }[]> {
    const items = (await listKcsPendingItems(this.prisma)).filter(
      (i) =>
        i.stage === stage &&
        i.blockedReason === 'LENH_DUNG' &&
        i.productionInvoiceId != null &&
        (piId == null || i.productionInvoiceId === piId),
    );
    const scoped = await filterByQueueWorkshop(
      this.prisma,
      workshopId,
      stage as MfgStage,
      items,
      (i) => i.productionInvoiceId,
    );
    const ids = [...new Set(scoped.map((i) => i.productionInvoiceId as bigint))];
    if (ids.length === 0) return [];
    const pis = await this.prisma.productionInvoice.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });
    return pis.map((p) => ({ productionInvoiceId: p.id.toString(), code: p.code }));
  }

  /** PI còn ít nhất 1 SKU đang ACTIVE (cùng luật cổng sàn, kcs-pending.util). */
  private async loadActivePiSet(ids: (bigint | null | undefined)[]): Promise<Set<string>> {
    const uniq = [...new Set(ids.filter((x): x is bigint => x != null))];
    if (uniq.length === 0) return new Set();
    const rows = await this.prisma.productionInvoice.findMany({
      where: { id: { in: uniq }, ...piHasActiveSkuWhere() },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id.toString()));
  }

  /** SKU (lệnh sản xuất) của từng PI - để biết PI 1 SKU hay nhiều SKU. */
  private async loadOrdersOfPis(piIds: bigint[]): Promise<Map<string, OrderInfo[]>> {
    const out = new Map<string, OrderInfo[]>();
    const uniq = [...new Set(piIds)];
    if (uniq.length === 0) return out;
    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: { in: uniq } } },
      select: {
        id: true,
        poNumber: true,
        mfgProduct: { select: { factoryCode: true } },
        productionInvoiceItem: { select: { productionInvoiceId: true } },
      },
    });
    for (const o of orders) {
      const pi = o.productionInvoiceItem?.productionInvoiceId;
      if (pi == null) continue;
      const k = pi.toString();
      const list = out.get(k);
      if (list) list.push(o);
      else out.set(k, [o]);
    }
    return out;
  }

  /** Lần báo CÒN HIỆU LỰC đầu tiên chưa chấm - "chờ bao lâu" tính từ đây (không phải từ lúc mở đợt: đợt mở sáng, báo thêm chiều). */
  private waitingSince(reports: { createdAt: Date; reversed: unknown }[], fallback: Date): Date {
    const live = reports.filter((r) => !r.reversed).map((r) => r.createdAt.getTime());
    return new Date(live.length ? Math.min(...live) : fallback.getTime());
  }

  /**
   * Tiến độ từng cỡ đoạn (P1): done = ĐÃ TÍNH = thô - lỗi - thiếu (khác `done` của API phoi-progress, nơi done = thô - thiếu,
   * vẫn gồm lỗi); reportedQty = số thô; over = phần đã tính vượt số cần; maxNow = lần báo kế tiếp tối đa (BE tính, gồm vế vật lý).
   */
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
      const src = o ?? p;
      const required = src?.required ?? 0;
      const failed = src?.failed ?? 0;
      const shortQty = src?.shortQty ?? 0;
      const reportedQty = src?.reportedQty ?? 0;
      const done = Math.max(0, reportedQty - failed - shortQty);
      return {
        cutLengthMm: sg.cutLengthMm,
        qty: sg.qty,
        required,
        baseRequired: src?.baseRequired ?? 0,
        extraNeed: src?.extraNeed ?? 0,
        done,
        failed,
        shortQty,
        reportedQty,
        over: Math.max(0, done - required),
        maxNow: src?.maxNow ?? 0,
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

  /** Số cần / đã tính của chân nhôm theo (PI, công thức, công đoạn). Lỗi thì thẻ không có số cần. */
  private async loadYieldNeed(piIds: bigint[]) {
    const uniq = [...new Set(piIds)];
    if (uniq.length === 0) return new Map<string, { required: number; counted: number }>();
    try {
      return await loadMaterialYieldNeed(this.prisma, uniq);
    } catch {
      return new Map<string, { required: number; counted: number }>();
    }
  }

  /** Kế hoạch mảnh (cần / đã KCS / chờ KCS / tiến độ pat) + số đang mở (chưa chốt, mọi người) theo (SKU, mảnh). */
  private async loadPiecePlans(stage: FloorWorkerStage, batches: { productionOrderId: bigint }[]) {
    const items = new Map<string, ProductionBatchPlanItemResponseDto>();
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

  // ─── KCS chốt để chấm ───────────────────────────────────────────────────────
  //
  // Luật chung 5 hàm: không kiểm xưởng (KCS chấm mọi xưởng), không phát tin *_TO_KCS (KCS tự thấy đợt), truyền VAI CỦA TỔ
  // (HAN / SON / PHOI) chứ không phải 'KCS' (assertMfgRoleMatchesStage), nhãn cổng lệnh dừng = 'chốt để chấm'.
  // Đợt bị QLSX hủy hết thì đã bị xoá: hàm cũ ném 404 kỹ thuật -> đổi thành 409 câu lời thường.

  /** Đổi NotFound (đợt đã bị xoá vì QLSX hủy hết số) thành 409; lỗi khác ném lại nguyên văn. */
  private notFoundToConflict(e: unknown, message: string): unknown {
    return e instanceof NotFoundException ? new ConflictException(message) : e;
  }

  async closeCutBundle(cutBundleId: string, actorId: string) {
    void actorId; // finishCutBundle không ghi người chốt - tham số để 5 hàm cùng chữ ký
    try {
      return await this.steelIssues.finishCutBundle(cutBundleId, {
        notifyKcs: false,
        gateLabel: KCS_CLOSE_GATE_LABEL,
      });
    } catch (e) {
      throw this.notFoundToConflict(e, CUT_BUNDLE_CANCELLED_MESSAGE);
    }
  }

  async closeStepGroup(
    dto: {
      productionInvoiceId: string;
      materialId: string;
      step: ProcessStep;
      /** null = dòng cũ chưa gắn SKU: PI 1 SKU thì gộp vào SKU duy nhất; PI nhiều SKU thì 409. */
      productionOrderId: string | null;
      /** null = dòng cũ chưa biết người; không gửi = coi như null (không bao giờ gom hết mọi công nhân). */
      workerId?: string | null;
    },
    actorId: string,
  ) {
    let productionOrderId = dto.productionOrderId ?? null;
    if (productionOrderId == null) {
      const orders = await this.prisma.productionOrder.findMany({
        where: {
          productionInvoiceItem: { productionInvoiceId: parseBigIntId(dto.productionInvoiceId) },
        },
        select: { id: true },
      });
      if (orders.length !== 1) throw new ConflictException(STEP_GROUP_UNASSIGNED_MESSAGE);
      productionOrderId = orders[0].id.toString();
    }
    return this.steelIssues.submitStepBundle(
      dto.productionInvoiceId,
      dto.materialId,
      dto.step,
      actorId,
      productionOrderId,
      { id: dto.workerId ?? null },
      { gateLabel: KCS_CLOSE_GATE_LABEL },
    );
  }

  /** Vai của tổ lấy từ chính lô (Hàn / Sơn / Phôi) - như tài khoản tổ; không trừ đoạn (trừ lúc KCS chấm). */
  async closeProductionBatch(productionBatchId: string, actorId: string) {
    const batch = await this.prisma.productionBatch.findUnique({
      where: { id: parseBigIntId(productionBatchId) },
      select: { stage: true },
    });
    if (!batch) throw new ConflictException(BATCH_CANCELLED_MESSAGE);
    try {
      return await this.productionBatches.finishProductionBatch(
        productionBatchId,
        actorId,
        batch.stage,
        null,
        { notifyKcs: false, gateLabel: KCS_CLOSE_GATE_LABEL },
      );
    } catch (e) {
      throw this.notFoundToConflict(e, BATCH_CANCELLED_MESSAGE);
    }
  }

  async closePieceStepGroup(
    dto: { productionOrderId: string; pieceId: string; step: ProcessStep },
    actorId: string,
  ) {
    return this.productionBatches.submitPieceStep(
      dto.productionOrderId,
      { pieceId: dto.pieceId, step: dto.step },
      actorId,
      MfgStage.PHOI,
      { gateLabel: KCS_CLOSE_GATE_LABEL },
    );
  }

  async closeMaterialYieldGroup(
    dto: { productionInvoiceId: string; recipeId: string; step: ProcessStep },
    actorId: string,
  ) {
    return this.materialYieldProduction.submitStep(
      dto.productionInvoiceId,
      { recipeId: dto.recipeId, step: dto.step },
      actorId,
      MfgStage.PHOI,
      { notifyKcs: false, gateLabel: KCS_CLOSE_GATE_LABEL },
    );
  }

  // ─── Đảo 1 lần báo sai ──────────────────────────────────────────────────────

  /**
   * QLSX đảo 1 lần báo (bất kỳ, không chỉ lần cuối như "Hoàn tác" cũ) của đợt CHƯA chốt: ghi 1 dòng sổ âm +
   * lý do (công nhân thấy trong "Sản lượng của tôi") rồi trừ đúng số của lần đó khỏi đợt. Đợt KCS đã bấm Chấm (chốt)
   * thì không đảo được - KCS chấm là chốt kiểm soát; số sai thì KCS ghi "số thực có" khi chấm.
   */
  async reverse(floorReportId: string, reason: string, actorId: string) {
    const report = await this.prisma.floorReport.findUnique({
      where: { id: parseBigIntId(floorReportId) },
      include: { lines: true, reversedBy: { select: { id: true } } },
    });
    if (!report) throw new NotFoundException(`Lần báo ${floorReportId} không tồn tại`);
    if (report.reversalOfId)
      throw new BadRequestException('Đây là dòng ghi hủy - không hủy lại được');
    if (report.reversedBy) throw new ConflictException('Lần báo này đã bị hủy rồi');
    // X4 16/11: chỉ QLSX của xưởng làm đợt đó hủy được. Báo mảnh lấy tổ của chính đợt (Sơn đi theo xưởng sơn).
    const stage =
      report.kind === FloorReportKind.PIECE && report.productionBatchId
        ? ((
            await this.prisma.productionBatch.findUnique({
              where: { id: report.productionBatchId },
              select: { stage: true },
            })
          )?.stage ?? MfgStage.PHOI)
        : MfgStage.PHOI;
    await this.assertManagesPi(actorId, stage, report.productionInvoiceId, 'lần báo này');

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
        throw new ConflictException('Lần báo này vừa được người khác hủy');
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
      // Khoá dòng đợt cắt: KCS bấm Chấm (finishCutBundle) chạy cùng lúc phải chờ, rồi thấy đúng trạng thái.
      const [locked] = await tx.$queryRaw<{ status: CutBundleStatus }[]>`
        SELECT "status" FROM "cut_bundles" WHERE "id" = ${cutBundleId} FOR UPDATE`;
      if (!locked) throw new ConflictException('Đợt cắt của lần báo này không còn');
      if (locked.status !== CutBundleStatus.CUTTING) {
        throw new ConflictException(REVERSE_AFTER_CLOSE_MESSAGE);
      }
      // X3 16/11: hủy số cắt không được làm Uốn/Dập... đã báo của SKU vượt số cắt còn lại.
      const current = await tx.cutPatternSegment.findMany({ where: { cutBundleId } });
      await this.steelIssues.assertStepsWithinCutAfterReduceInTx(
        tx,
        cutBundleId,
        lines.flatMap((l) => {
          if (!l.segmentSpecId) return [];
          const row = current.find((s) => s.segmentSpecId === l.segmentSpecId);
          return [{ segmentSpecId: l.segmentSpecId, qty: Math.min(l.qty, row?.qty ?? 0) }];
        }),
      );
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
    }, REVERSE_TX_OPTIONS);
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
      if (locked.stepBundleId) throw new ConflictException(REVERSE_AFTER_CLOSE_MESSAGE);
      await writeFloorReport(tx, { ...reversal, stepBatchId });
      await tx.stepBatchSegment.deleteMany({ where: { stepBatchId } });
      await tx.stepBatch.delete({ where: { id: stepBatchId } });
    }, REVERSE_TX_OPTIONS);
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
        throw new ConflictException(REVERSE_AFTER_CLOSE_MESSAGE);
      }
      await writeFloorReport(tx, { ...reversal, productionBatchId: batch.id });
      const left = Math.max(fresh.reportedQty - qty, 0);
      if (left === 0) await tx.productionBatch.delete({ where: { id: batch.id } });
      else
        await tx.productionBatch.update({ where: { id: batch.id }, data: { reportedQty: left } });
    }, REVERSE_TX_OPTIONS);
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
