import {
  CutBundleStatus,
  MfgStage,
  Prisma,
  ProductionBatchStatus,
  ProductionOrderFloorStage,
} from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';
import type { StaleItem, StaleStage } from './floor-stale.util';

/**
 * Các đợt công nhân đã báo mà KCS chưa chấm (P1 "KCS tự chuyển", 18/11/2026) - MỘT nguồn dùng chung cho:
 * số đỏ menu KCS (GET /me/work-queue), summary của QLSX (GET /floor/summary) và tin nhắc chờ lâu (KCS_BATCH_STALE).
 *
 * 5 loại đợt x 2 trạng thái:
 * - OPEN: công nhân đã báo, KCS chưa bấm Chấm (cắt đang CUTTING; nhóm công đoạn phụ chưa gom; lô mảnh OPEN; pat / chân nhôm
 *   chưa gom). Nhóm công đoạn gom theo (PI, sắt, công đoạn, SKU, người); pat gom theo (lệnh, mảnh, công đoạn); chân nhôm gom
 *   theo (PI, công thức, công đoạn).
 * - AWAITING_QC: KCS đã chốt, chưa chấm xong (bảng đợt / lô / bó ở trạng thái AWAITING_QC).
 *
 * Hàm không inject service nào, nhận `db` (prisma hoặc tx) làm tham số - cùng idiom floor-stale.util.ts.
 */

/** Ngưỡng "chờ lâu" (giờ) của tin KCS_BATCH_STALE. Cố ý KHÔNG dời STALE_HOURS khỏi floor-alerts.service.ts. */
export const KCS_STALE_HOURS = 4;

/** Loại đợt: đợt cắt / nhóm công đoạn phụ của sắt / lô mảnh Phôi-Hàn-Sơn / nhóm công đoạn của pat / nhóm công đoạn của chân nhôm. */
export type KcsPendingKind = 'CUT' | 'STEP' | 'PIECE_BATCH' | 'PIECE_STEP' | 'MATERIAL_YIELD';

/** Lý do dòng chưa chấm được: lệnh đang tạm dừng / đã kết thúc, hoặc dữ liệu cũ chưa gắn SKU (PI nhiều SKU). */
export type KcsBlockedReason = null | 'LENH_DUNG' | 'CHUA_GAN_SKU';

export type KcsPendingItem = StaleItem & {
  kind: KcsPendingKind;
  state: 'OPEN' | 'AWAITING_QC';
  /** Lần báo CÒN HIỆU LỰC (chưa bị đảo) đầu tiên; không có sổ báo thì lấy giờ tạo / giờ báo sớm nhất của dòng. */
  waitingSince: Date;
  blockedReason: KcsBlockedReason;
};

type KcsPendingDb = Pick<
  PrismaTx,
  | 'cutBundle'
  | 'stepBatch'
  | 'stepBundle'
  | 'productionBatch'
  | 'pieceStepBatch'
  | 'pieceStepBundle'
  | 'materialYieldStepBatch'
  | 'materialYieldStepBundle'
  | 'productionInvoice'
  | 'productionOrder'
>;

/**
 * Điều kiện Prisma "PI còn ít nhất 1 SKU đang ACTIVE" (QLSX đã Bắt đầu, chưa Kết thúc / Tạm dừng) - cùng luật cổng sàn
 * (floor-gate.util.ts) và mẫu paint-transfer-reminder.service.ts.
 */
export function piHasActiveSkuWhere(): Prisma.ProductionInvoiceWhereInput {
  return {
    items: { some: { productionOrder: { floorStage: ProductionOrderFloorStage.ACTIVE } } },
  };
}

/**
 * Lý do dòng bị chặn (null = chấm được). LENH_DUNG thắng CHUA_GAN_SKU. CHUA_GAN_SKU chỉ áp cho dòng chưa gắn SKU
 * (productionOrderId null) của PI NHIỀU SKU - PI 1 SKU thì dòng đó chắc chắn của SKU duy nhất.
 */
export function blockedReasonOf(input: {
  piActive: boolean;
  multiSku: boolean;
  productionOrderId: bigint | string | null;
}): KcsBlockedReason {
  if (!input.piActive) return 'LENH_DUNG';
  if (input.multiSku && input.productionOrderId == null) return 'CHUA_GAN_SKU';
  return null;
}

/** Số đợt theo tổ cho số đỏ menu KCS: bỏ dòng có blockedReason (dòng xám không tính). */
export function countKcsByStage(items: readonly KcsPendingItem[]): {
  phoi: number;
  han: number;
  son: number;
} {
  const out = { phoi: 0, han: 0, son: 0 };
  for (const i of items) {
    if (i.blockedReason) continue;
    if (i.stage === 'PHOI') out.phoi += 1;
    else if (i.stage === 'HAN') out.han += 1;
    else out.son += 1;
  }
  return out;
}

/** Lần báo CÒN HIỆU LỰC: chưa phải dòng đảo và chưa bị đảo (cùng cách floor-alerts.service.ts). */
const LIVE_REPORT: Prisma.FloorReportWhereInput = { reversalOfId: null, reversedBy: { is: null } };
const FIRST_LIVE_REPORT = {
  where: LIVE_REPORT,
  select: { createdAt: true },
  orderBy: { createdAt: 'asc' },
  take: 1,
} as const;

/** Sớm nhất trong các mốc (danh sách không rỗng). */
function earliest(dates: readonly Date[]): Date {
  return dates.reduce((best, d) => (d.getTime() < best.getTime() ? d : best));
}

/**
 * Mốc chờ của 1 đợt: lần báo CÒN HIỆU LỰC đầu tiên; đợt không có sổ báo thì mốc sớm nhất trong `fallbacks`
 * (giờ tạo / giờ báo của dòng). `fallbacks` luôn có ít nhất 1 phần tử.
 */
function waitingFrom(reports: readonly { createdAt: Date }[], fallbacks: readonly Date[]): Date {
  return earliest(reports.length > 0 ? reports.map((r) => r.createdAt) : fallbacks);
}

const STAGE_ENUMS: MfgStage[] = [MfgStage.PHOI, MfgStage.HAN, MfgStage.SON];

function asStage(stage: MfgStage): StaleStage | null {
  return stage === MfgStage.PHOI || stage === MfgStage.HAN || stage === MfgStage.SON ? stage : null;
}

type RawItem = {
  stage: StaleStage;
  kind: KcsPendingKind;
  state: 'OPEN' | 'AWAITING_QC';
  productionInvoiceId: bigint | null;
  /** SKU của dòng (chỉ nhóm công đoạn phụ đang mở dùng để suy CHUA_GAN_SKU). */
  productionOrderId?: bigint | null;
  /** true = có thể bị CHUA_GAN_SKU (nhóm công đoạn phụ đang mở). */
  skuScoped?: boolean;
  /** Câu 4 (24/11/2026): đợt của SKU đã huỷ - KCS vẫn chấm nốt, không xám dù PI không còn SKU đang chạy. */
  orderCancelled?: boolean;
  waitingSince: Date;
};

/**
 * Liệt kê mọi đợt KCS chưa chấm (5 loại x đang mở + đã chốt), kèm lý do bị chặn. `staleBefore` có thì chỉ giữ dòng có
 * waitingSince < staleBefore (dùng cho tin chờ lâu). Không lọc xưởng - nơi gọi tự lọc (groupStaleByQueueWorkshop / filterByQueueWorkshop).
 */
export async function listKcsPendingItems(
  db: KcsPendingDb,
  opts?: { staleBefore?: Date },
): Promise<KcsPendingItem[]> {
  const raw: RawItem[] = [];

  const [
    cutBundles,
    stepBatches,
    stepBundles,
    productionBatches,
    pieceStepBatches,
    pieceStepBundles,
    yieldBatches,
    yieldBundles,
  ] = await Promise.all([
    db.cutBundle.findMany({
      where: {
        status: { in: [CutBundleStatus.CUTTING, CutBundleStatus.AWAITING_QC] },
      },
      select: {
        status: true,
        createdAt: true,
        productionOrder: { select: { status: true } },
        steelIssue: { select: { productionInvoiceId: true } },
        floorReports: FIRST_LIVE_REPORT,
      },
    }),
    db.stepBatch.findMany({
      where: { stepBundleId: null },
      select: {
        productionOrder: { select: { status: true } },
        productionInvoiceId: true,
        materialId: true,
        step: true,
        productionOrderId: true,
        reportedById: true,
        createdAt: true,
        floorReports: FIRST_LIVE_REPORT,
      },
    }),
    db.stepBundle.findMany({
      where: { status: 'AWAITING_QC' },
      select: {
        productionOrder: { select: { status: true } },
        productionInvoiceId: true,
        submittedAt: true,
        batches: { select: { createdAt: true, floorReports: FIRST_LIVE_REPORT } },
      },
    }),
    db.productionBatch.findMany({
      where: {
        stage: { in: STAGE_ENUMS },
        status: { in: [ProductionBatchStatus.OPEN, ProductionBatchStatus.AWAITING_QC] },
      },
      select: {
        stage: true,
        status: true,
        reportedAt: true,
        productionOrder: {
          select: {
            status: true,
            productionInvoiceItem: { select: { productionInvoiceId: true } },
          },
        },
        floorReports: FIRST_LIVE_REPORT,
      },
    }),
    db.pieceStepBatch.findMany({
      where: { pieceStepBundleId: null },
      select: {
        productionOrderId: true,
        pieceId: true,
        step: true,
        reportedAt: true,
        productionOrder: {
          select: {
            status: true,
            productionInvoiceItem: { select: { productionInvoiceId: true } },
          },
        },
      },
    }),
    db.pieceStepBundle.findMany({
      where: { status: 'AWAITING_QC' },
      select: {
        submittedAt: true,
        productionOrder: {
          select: {
            status: true,
            productionInvoiceItem: { select: { productionInvoiceId: true } },
          },
        },
        batches: { select: { reportedAt: true } },
      },
    }),
    db.materialYieldStepBatch.findMany({
      where: { materialYieldStepBundleId: null },
      select: { productionInvoiceId: true, recipeId: true, step: true, reportedAt: true },
    }),
    db.materialYieldStepBundle.findMany({
      where: { status: 'AWAITING_QC' },
      select: {
        productionInvoiceId: true,
        submittedAt: true,
        batches: { select: { reportedAt: true } },
      },
    }),
  ]);

  // 1) Đợt cắt (đang mở = CUTTING, đã chốt = AWAITING_QC).
  for (const b of cutBundles) {
    raw.push({
      stage: 'PHOI',
      kind: 'CUT',
      state: b.status === CutBundleStatus.CUTTING ? 'OPEN' : 'AWAITING_QC',
      productionInvoiceId: b.steelIssue?.productionInvoiceId ?? null,
      orderCancelled: b.productionOrder?.status === 'CANCELLED',
      waitingSince: waitingFrom(b.floorReports, [b.createdAt]),
    });
  }

  // 2) Nhóm công đoạn phụ đang mở: gom theo (PI, sắt, công đoạn, SKU, người). Dòng cũ chưa gắn SKU của PI 1 SKU gộp vào
  //    SKU duy nhất - cần danh sách SKU của PI nên gom ở bước dưới (sau khi biết orderIdsOfPi).
  // 3) Nhóm đã chốt (StepBundle AWAITING_QC).
  for (const sb of stepBundles) {
    const reports = sb.batches.flatMap((x) => x.floorReports);
    raw.push({
      stage: 'PHOI',
      kind: 'STEP',
      state: 'AWAITING_QC',
      productionInvoiceId: sb.productionInvoiceId,
      orderCancelled: sb.productionOrder?.status === 'CANCELLED',
      waitingSince: waitingFrom(reports, [...sb.batches.map((x) => x.createdAt), sb.submittedAt]),
    });
  }

  // 4) Lô mảnh (Phôi / Hàn / Sơn): đang mở = OPEN, đã chốt = AWAITING_QC.
  for (const p of productionBatches) {
    const stage = asStage(p.stage);
    if (!stage) continue;
    raw.push({
      stage,
      kind: 'PIECE_BATCH',
      state: p.status === ProductionBatchStatus.OPEN ? 'OPEN' : 'AWAITING_QC',
      productionInvoiceId: p.productionOrder?.productionInvoiceItem?.productionInvoiceId ?? null,
      orderCancelled: p.productionOrder?.status === 'CANCELLED',
      waitingSince: waitingFrom(p.floorReports, [p.reportedAt]),
    });
  }

  // 5) Pat: nhóm đang mở gom theo (lệnh, mảnh, công đoạn); không có sổ báo nên lấy giờ báo sớm nhất của dòng chưa gom.
  const pieceGroups = new Map<string, RawItem>();
  for (const r of pieceStepBatches) {
    const key = `${r.productionOrderId}:${r.pieceId}:${r.step}`;
    const g = pieceGroups.get(key);
    if (g) {
      g.waitingSince = earliest([g.waitingSince, r.reportedAt]);
    } else {
      pieceGroups.set(key, {
        stage: 'PHOI',
        kind: 'PIECE_STEP',
        state: 'OPEN',
        productionInvoiceId: r.productionOrder?.productionInvoiceItem?.productionInvoiceId ?? null,
        orderCancelled: r.productionOrder?.status === 'CANCELLED',
        waitingSince: r.reportedAt,
      });
    }
  }
  raw.push(...pieceGroups.values());
  for (const b of pieceStepBundles) {
    raw.push({
      stage: 'PHOI',
      kind: 'PIECE_STEP',
      state: 'AWAITING_QC',
      productionInvoiceId: b.productionOrder?.productionInvoiceItem?.productionInvoiceId ?? null,
      orderCancelled: b.productionOrder?.status === 'CANCELLED',
      waitingSince: earliest([...b.batches.map((x) => x.reportedAt), b.submittedAt]),
    });
  }

  // 6) Chân nhôm: nhóm đang mở gom theo (PI, công thức, công đoạn).
  const yieldGroups = new Map<string, RawItem>();
  for (const r of yieldBatches) {
    const key = `${r.productionInvoiceId}:${r.recipeId}:${r.step}`;
    const g = yieldGroups.get(key);
    if (g) {
      g.waitingSince = earliest([g.waitingSince, r.reportedAt]);
    } else {
      yieldGroups.set(key, {
        stage: 'PHOI',
        kind: 'MATERIAL_YIELD',
        state: 'OPEN',
        productionInvoiceId: r.productionInvoiceId,
        waitingSince: r.reportedAt,
      });
    }
  }
  raw.push(...yieldGroups.values());
  for (const b of yieldBundles) {
    raw.push({
      stage: 'PHOI',
      kind: 'MATERIAL_YIELD',
      state: 'AWAITING_QC',
      productionInvoiceId: b.productionInvoiceId,
      waitingSince: earliest([...b.batches.map((x) => x.reportedAt), b.submittedAt]),
    });
  }

  // SKU của từng PI (để biết PI 1 SKU / nhiều SKU) - chỉ cần cho nhóm công đoạn phụ đang mở nên chỉ tra PI của chúng,
  // nhưng PI "đang chạy" cần cho mọi dòng.
  const piIds = new Map<string, bigint>();
  const addPi = (id: bigint | null) => {
    if (id != null) piIds.set(id.toString(), id);
  };
  for (const r of raw) addPi(r.productionInvoiceId);
  for (const r of stepBatches) addPi(r.productionInvoiceId);
  const piIdList = [...piIds.values()];

  const [activePis, orders] =
    piIdList.length === 0
      ? [[], []]
      : await Promise.all([
          db.productionInvoice.findMany({
            where: { id: { in: piIdList }, ...piHasActiveSkuWhere() },
            select: { id: true },
          }),
          db.productionOrder.findMany({
            where: { productionInvoiceItem: { productionInvoiceId: { in: piIdList } } },
            select: {
              id: true,
              productionInvoiceItem: { select: { productionInvoiceId: true } },
            },
          }),
        ]);
  const activePiSet = new Set(activePis.map((p) => p.id.toString()));
  const orderIdsOfPi = new Map<string, bigint[]>();
  for (const o of orders) {
    const pi = o.productionInvoiceItem?.productionInvoiceId;
    if (pi == null) continue;
    const k = pi.toString();
    const list = orderIdsOfPi.get(k);
    if (list) list.push(o.id);
    else orderIdsOfPi.set(k, [o.id]);
  }

  // Nhóm công đoạn phụ đang mở: PI 1 SKU thì dòng chưa gắn SKU gộp vào SKU duy nhất.
  const stepGroups = new Map<string, RawItem>();
  for (const r of stepBatches) {
    const piOrders = orderIdsOfPi.get(r.productionInvoiceId.toString()) ?? [];
    const effectiveOrder = r.productionOrderId ?? (piOrders.length === 1 ? piOrders[0] : null);
    const key = `${r.productionInvoiceId}:${r.materialId}:${r.step}:${effectiveOrder ?? ''}:${r.reportedById ?? ''}`;
    const at = waitingFrom(r.floorReports, [r.createdAt]);
    const g = stepGroups.get(key);
    if (g) {
      g.waitingSince = earliest([g.waitingSince, at]);
    } else {
      stepGroups.set(key, {
        stage: 'PHOI',
        kind: 'STEP',
        state: 'OPEN',
        productionInvoiceId: r.productionInvoiceId,
        productionOrderId: effectiveOrder,
        skuScoped: true,
        orderCancelled: r.productionOrder?.status === 'CANCELLED',
        waitingSince: at,
      });
    }
  }
  raw.push(...stepGroups.values());

  const out: KcsPendingItem[] = [];
  for (const r of raw) {
    const piActive =
      r.productionInvoiceId == null ||
      activePiSet.has(r.productionInvoiceId.toString()) ||
      r.orderCancelled === true;
    const multiSku =
      r.skuScoped === true &&
      r.productionInvoiceId != null &&
      (orderIdsOfPi.get(r.productionInvoiceId.toString())?.length ?? 0) > 1;
    const blockedReason = blockedReasonOf({
      piActive,
      multiSku,
      productionOrderId: r.skuScoped ? (r.productionOrderId ?? null) : 0n,
    });
    if (opts?.staleBefore && r.waitingSince.getTime() >= opts.staleBefore.getTime()) continue;
    out.push({
      stage: r.stage,
      productionInvoiceId: r.productionInvoiceId,
      kind: r.kind,
      state: r.state,
      waitingSince: r.waitingSince,
      blockedReason,
    });
  }
  return out;
}
