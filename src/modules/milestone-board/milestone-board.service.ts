import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MfgStage,
  ProdItemStageType,
  ProductionInvoiceStatus,
  ProductionOrderFloorStage,
} from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { vnDayKey } from '../../common/utils/floor-stats.util';
import { purchaseDeadlineOf, purchaseGroupOf } from '../../common/utils/frame-deadline.util';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { ProductionInvoicesService } from '../production-invoices/production-invoices.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { WeavingIssuesService } from '../weaving-issues/weaving-issues.service';
import {
  MILESTONES,
  MilestoneKey,
  MilestoneProgress,
  MilestoneStatus,
  STATUS_RANK,
  averagePercent,
  combineProgress,
  goodCapped,
  milestoneStatus,
  percentOf,
  worstStatus,
} from './milestone-board.rules';

export interface MilestoneCell {
  key: MilestoneKey;
  label: string;
  /** Hạn đã lưu, ngày VN 'YYYY-MM-DD' - null = chưa đặt hạn. */
  deadline: string | null;
  status: MilestoneStatus;
  /** Số ngày tới hạn (âm = đã trễ chừng ấy ngày), null khi chưa đặt hạn. */
  daysLeft: number | null;
  /** % đã làm (0 khi không cần / chưa biết). */
  percent: number;
  /** Số cần / đã làm (đã chặn trần) - null khi nguồn tiến độ lỗi. Mốc mua hàng: số dòng vật tư (đã làm = tổng tỷ lệ về). */
  need: number | null;
  done: number | null;
  /** Giải thích ngắn: vật tư chưa về đủ, số đã làm/cần... null khi không có gì đáng nói. */
  reason: string | null;
}

/** Vật tư chưa về đủ của 1 mốc mua - tin sáng dùng để báo đúng NV mua (buyerId) và thủ kho (warehouseId). */
export interface MissingMaterial {
  /** Id dòng đề xuất mua - 1 dòng mua chung cả PI (sắt, đinh) có ở mọi SKU; tin sáng gộp theo id này. */
  lineId: string;
  materialId: string;
  /** Tên kèm chiều dài cây / quy cách khi có - 2 dòng cùng vật tư khác chiều dài không trông như 1. */
  name: string;
  unit: string;
  buyQty: number;
  receivedQty: number;
  /** Mã kho (= `User.warehouseScope` của thủ kho kho đó). */
  warehouseCode: string | null;
  buyerId: string | null;
}

export interface MilestoneRow {
  itemId: string;
  piId: string;
  piCode: string;
  productionOrderId: string;
  skuCode: string;
  skuName: string | null;
  quantity: number;
  floorStage: ProductionOrderFloorStage;
  milestones: MilestoneCell[];
  worst: MilestoneStatus;
  /** Vật tư còn thiếu theo từng mốc mua (rỗng khi đã về đủ / không cần). */
  missing: { MUA_VT_KHUNG: MissingMaterial[]; MUA_VT_CON_LAI: MissingMaterial[] };
}

export interface MilestoneBoard {
  /** Ngày VN lúc tính ('YYYY-MM-DD'). */
  today: string;
  generatedAt: string;
  /** Nguồn tiến độ tải lỗi (rỗng = đủ) - mốc phụ thuộc nguồn đó hiện "Chưa biết". */
  failedSources: string[];
  rows: MilestoneRow[];
}

interface PurchaseLine extends MissingMaterial {
  piId: string;
  group: 'MUA_VT_KHUNG' | 'MUA_VT_CON_LAI';
}

const fmt = (n: number) => Number(n.toFixed(2)).toLocaleString('vi-VN');

/**
 * "Bảng mốc" (2026-10-29, changelog 2026-09-25 mục 32.24): mỗi dòng SKU đang chạy (đã Sếp duyệt, lệnh chưa Kết thúc) × 9 mốc,
 * tính trạng thái so với hạn ĐÃ LƯU. Tiến độ lấy từ ĐÚNG các hàm batch mà màn "Tổng hợp lệnh SX" (FE ThongKePagePlan) đang
 * dùng và theo đúng luật "xong" ở đó (Hàn/Sơn = đạt + chờ KCS + chưa gửi; mua hàng = mọi dòng đã về đủ...) để 2 nơi không
 * nói 2 điều khác nhau. Chỉ đọc.
 */
@Injectable()
export class MilestoneBoardService {
  private readonly logger = new Logger(MilestoneBoardService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly steelIssues: SteelIssuesService,
    private readonly productionBatches: ProductionBatchesService,
    private readonly weavingIssues: WeavingIssuesService,
    private readonly productionInvoices: ProductionInvoicesService,
  ) {}

  async getBoard(now: Date = new Date()): Promise<MilestoneBoard> {
    const today = vnDayKey(now);
    const items = await this.prisma.productionInvoiceItem.findMany({
      where: {
        prodApprovalStatus: 'APPROVED',
        productionInvoiceId: { not: null },
        productionOrder: { is: { floorStage: { not: ProductionOrderFloorStage.FINISHED } } },
        // Phòng hờ (review 32.26): PI đã huỷ / đơn bán đã ngừng hay xoá thì không còn là việc phải làm - hiện vẫn để trên bảng sẽ
        // báo trễ và gửi cảnh báo CRITICAL cho Sếp về lệnh không còn tồn tại.
        productionInvoice: { status: { not: ProductionInvoiceStatus.CANCELLED } },
        OR: [{ salesOrderId: null }, { salesOrder: { isActive: true, deletedAt: null } }],
      },
      select: {
        id: true,
        productionInvoiceId: true,
        quantity: true,
        materialDeadline: true,
        finishedMaterialDeadline: true,
        deliveryDeadline: true,
        wireMaterialId: true,
        cushionMaterialId: true,
        productionInvoice: { select: { code: true, deadline: true } },
        mfgProduct: { select: { factoryCode: true, name: true } },
        stages: { select: { stageType: true, deadline: true } },
        productionOrder: { select: { id: true, floorStage: true } },
      },
      orderBy: { id: 'asc' },
    });
    if (items.length === 0)
      return { today, generatedAt: now.toISOString(), failedSources: [], rows: [] };

    const piIds = [...new Set(items.map((i) => String(i.productionInvoiceId)))];
    const orderIds = items.map((i) => String(i.productionOrder!.id));
    const itemIds = items.map((i) => String(i.id));

    const failedSources: string[] = [];
    // Mỗi nguồn bắt lỗi riêng (như FE): 1 nguồn lỗi chỉ làm các mốc dựa vào nó thành "Chưa biết", không kéo sập cả bảng.
    const safe = async <T>(label: string, p: Promise<T>): Promise<T | null> => {
      try {
        return await p;
      } catch (err) {
        this.logger.warn(`Bảng mốc: nguồn '${label}' lỗi - ${(err as Error).message}`);
        failedSources.push(label);
        return null;
      }
    };
    const piBigIds = [...new Set(items.map((i) => i.productionInvoiceId!))];
    const [
      phoiByPi,
      vtTpByOrder,
      hanByOrder,
      sonByOrder,
      weavingByOrder,
      packagingByItem,
      purchaseLines,
      approvedChoices,
    ] = await Promise.all([
      safe('phoi-progress', this.steelIssues.getPhoiProgressBatch(piIds)),
      safe(
        'production-batch-plan(PHOI)',
        this.productionBatches.getBatchPlanBatch(orderIds, MfgStage.PHOI),
      ),
      safe(
        'production-batch-plan(HAN)',
        this.productionBatches.getBatchPlanBatch(orderIds, MfgStage.HAN),
      ),
      safe(
        'production-batch-plan(SON)',
        this.productionBatches.getBatchPlanBatch(orderIds, MfgStage.SON),
      ),
      safe('weaving-issue-plan', this.weavingIssues.getIssuePlanBatch(orderIds)),
      safe('packaging', this.productionInvoices.getPackagingBatch(itemIds)),
      safe('purchase-proposals', this.loadPurchaseLines(piBigIds)),
      // Dây/nệm của MỌI dòng đã duyệt trong các PI này, kể cả dòng đã Kết thúc (không có trên bảng): dây riêng của dòng đã xong
      // vẫn là của dòng đó, không được tính sang dòng còn chạy (review 32.26) - cùng tập `approvedRows` FE dùng.
      this.prisma.productionInvoiceItem.findMany({
        where: { productionInvoiceId: { in: piBigIds }, prodApprovalStatus: 'APPROVED' },
        select: {
          id: true,
          productionInvoiceId: true,
          wireMaterialId: true,
          cushionMaterialId: true,
        },
      }),
    ]);
    // getPhoiProgressBatch tự nuốt lỗi từng PI (bỏ PI đó khỏi kết quả) - thiếu khoá = nguồn lỗi, phải báo như FE ThongKePagePlan.
    if (
      phoiByPi &&
      piIds.some((id) => !(id in phoiByPi)) &&
      !failedSources.includes('phoi-progress')
    ) {
      failedSources.push('phoi-progress');
    }

    // Dây/nệm là lựa chọn RIÊNG của từng dòng trong PI (mua gộp theo PI) - cùng luật scopePurchasingRows ở FE.
    const choiceIds = (i: { wireMaterialId: bigint | null; cushionMaterialId: bigint | null }) =>
      [i.wireMaterialId, i.cushionMaterialId].flatMap((m) => (m != null ? [String(m)] : []));

    const rows: MilestoneRow[] = items.map((item) => {
      const piId = String(item.productionInvoiceId);
      const orderId = String(item.productionOrder!.id);
      const stageDay = (t: ProdItemStageType) => {
        const s = item.stages.find((x) => x.stageType === t);
        return s ? vnDayKey(s.deadline) : null;
      };
      const day = (d: Date | null | undefined) => (d ? vnDayKey(d) : null);

      // ── Mua hàng ──
      const own = new Set(choiceIds(item));
      const siblings = new Set(
        approvedChoices
          .filter((o) => o.id !== item.id && String(o.productionInvoiceId) === piId)
          .flatMap(choiceIds),
      );
      const myLines = (purchaseLines ?? []).filter(
        (l) => l.piId === piId && (own.has(l.materialId) || !siblings.has(l.materialId)),
      );
      const purchase = (group: PurchaseLine['group']) => {
        const lines = myLines.filter((l) => l.group === group);
        const fraction = (l: PurchaseLine) =>
          l.buyQty <= 0 ? 1 : Math.min(1, l.receivedQty / l.buyQty);
        const progress: MilestoneProgress = {
          known: purchaseLines !== null,
          need: lines.length,
          done: lines.reduce((a, l) => a + fraction(l), 0),
        };
        const missing = lines.filter((l) => fraction(l) < 1);
        const reason = missing.length
          ? missing
              .slice(0, 3)
              .map((l) => `${l.name} ${fmt(l.receivedQty)}/${fmt(l.buyQty)} ${l.unit}`)
              .join('; ') + (missing.length > 3 ? `; +${missing.length - 3} vật tư khác` : '')
          : null;
        return { progress, missing, reason };
      };
      const muaKhung = purchase('MUA_VT_KHUNG');
      const muaConLai = purchase('MUA_VT_CON_LAI');

      // ── Phôi: cắt + công đoạn phụ theo SKU (byOrder) + vật tư thành phẩm Phôi tự làm ──
      const phoiItems = phoiByPi ? phoiByPi[piId] : undefined;
      const vtTp = vtTpByOrder ? vtTpByOrder[orderId] : undefined;
      let phoiNeed = 0;
      let phoiDone = 0;
      for (const mat of phoiItems ?? []) {
        for (const segs of [mat.segments, ...(mat.steps ?? []).map((s) => s.segments)]) {
          for (const seg of segs ?? []) {
            const src = (seg.byOrder ?? []).find((o) => o.productionOrderId === orderId);
            if (!src) continue;
            phoiNeed += src.required;
            phoiDone += goodCapped(src.required, src.done, src.failed);
          }
        }
      }
      for (const p of vtTp?.items ?? []) {
        phoiNeed += p.plannedQty;
        phoiDone += Math.min(p.passedQty + p.awaitingQcQty + (p.openQty ?? 0), p.plannedQty);
      }
      for (const m of vtTp?.materialYieldItems ?? []) {
        phoiNeed += m.plannedQty;
        phoiDone += Math.min(m.passedQty + m.awaitingQcQty, m.plannedQty);
      }
      const phoi: MilestoneProgress = {
        known: phoiItems !== undefined && vtTp !== undefined,
        need: phoiNeed,
        done: phoiDone,
      };

      // ── Hàn / Sơn: "đã báo" = đạt + chờ KCS + chưa gửi (FE pieceLine) ──
      const pieceProgress = (plan: typeof vtTp): MilestoneProgress => ({
        known: plan !== undefined,
        need: (plan?.items ?? []).reduce((a, p) => a + p.plannedQty, 0),
        done: (plan?.items ?? []).reduce(
          (a, p) => a + Math.min(p.passedQty + p.awaitingQcQty + (p.openQty ?? 0), p.plannedQty),
          0,
        ),
      });
      const han = pieceProgress(hanByOrder ? hanByOrder[orderId] : undefined);
      const son = pieceProgress(sonByOrder ? sonByOrder[orderId] : undefined);
      // Trạng thái Khung theo cộng dồn 3 tổ (xong khi cả 3 xong); % = trung bình % các tổ có việc như màn "Theo lệnh"
      // (người dùng chốt Q1, 32.27) để 2 màn cùng 1 con số.
      const khung = combineProgress([phoi, han, son]);
      const khungParts = [
        { label: 'Phôi', p: phoi },
        { label: 'Hàn', p: han },
        { label: 'Sơn', p: son },
      ].filter((x) => x.p.need > 0);
      const khungPercent = averagePercent(khungParts.map((x) => x.p));

      // ── Đan: xong khi đã NHẬN về đủ (so với tổng cần, không so với số đã xuất) ──
      const weaving = weavingByOrder ? weavingByOrder[orderId] : undefined;
      const dan: MilestoneProgress = {
        known: weaving !== undefined,
        need: (weaving ?? []).reduce((a, w) => a + w.totalQty, 0),
        done: (weaving ?? []).reduce(
          (a, w) =>
            a +
            Math.min(
              w.allocations.reduce((s, x) => s + x.receivedQty, 0),
              w.totalQty,
            ),
          0,
        ),
      };

      // ── Đóng gói / Hạn giao ──
      const pack = packagingByItem ? packagingByItem[String(item.id)] : undefined;
      const dongGoi: MilestoneProgress = {
        known: pack !== undefined && pack.totalQty > 0,
        need: pack?.totalQty ?? 0,
        done: Math.min(pack?.packedQty ?? 0, pack?.totalQty ?? 0),
      };

      const cell = (
        key: MilestoneKey,
        progress: MilestoneProgress,
        deadline: string | null,
        reason: string | null,
        percent: number = percentOf(progress),
      ): MilestoneCell => {
        const { status, daysLeft } = milestoneStatus(progress, deadline, today);
        return {
          key,
          label: MILESTONES.find((m) => m.key === key)!.label,
          deadline,
          status,
          daysLeft,
          percent,
          need: progress.known ? progress.need : null,
          done: progress.known ? Math.min(progress.done, progress.need) : null,
          reason: status === 'DONE' || status === 'NA' ? null : reason,
        };
      };
      const pctReason = (p: MilestoneProgress, unit: string) =>
        p.known && p.need > 0
          ? `Đã làm ${percentOf(p)}% (${fmt(Math.min(p.done, p.need))}/${fmt(p.need)} ${unit})`
          : null;
      const frameDay = stageDay(ProdItemStageType.FRAME);
      const khungReason =
        khung.known && khungParts.length > 0
          ? `Đã làm ${khungPercent}% (trung bình ${khungParts.map((x) => `${x.label} ${percentOf(x.p)}%`).join(', ')})`
          : null;

      const milestones: MilestoneCell[] = [
        // Hạn 2 mốc mua: cùng hàm `purchaseDeadlineOf` với "Theo dõi mua hàng" (đã lưu → hạn Khung / Đóng gói → hạn PI).
        cell(
          'MUA_VT_KHUNG',
          muaKhung.progress,
          day(purchaseDeadlineOf(item, 'FRAME')),
          muaKhung.reason,
        ),
        cell('PHOI', phoi, stageDay(ProdItemStageType.FRAME_PHOI), pctReason(phoi, 'đoạn/mảnh')),
        cell('HAN', han, stageDay(ProdItemStageType.FRAME_HAN), pctReason(han, 'mảnh')),
        cell('SON', son, stageDay(ProdItemStageType.FRAME_SON), pctReason(son, 'mảnh')),
        cell('KHUNG', khung, frameDay, khungReason, khungPercent),
        cell(
          'DAN',
          dan,
          stageDay(ProdItemStageType.WEAVING),
          dan.known && dan.need > 0 ? `Đã nhận về ${fmt(dan.done)}/${fmt(dan.need)} mảnh` : null,
        ),
        cell(
          'MUA_VT_CON_LAI',
          muaConLai.progress,
          day(purchaseDeadlineOf(item, 'FINISHED')),
          muaConLai.reason,
        ),
        cell(
          'DONG_GOI',
          dongGoi,
          stageDay(ProdItemStageType.PACKAGING),
          dongGoi.known ? `Đã đóng ${fmt(dongGoi.done)}/${fmt(dongGoi.need)} thùng` : null,
        ),
        cell(
          'HAN_GIAO',
          dongGoi,
          day(item.deliveryDeadline) ?? day(item.productionInvoice?.deadline),
          dongGoi.known ? `Đóng gói ${fmt(dongGoi.done)}/${fmt(dongGoi.need)}` : null,
        ),
      ];

      return {
        itemId: String(item.id),
        piId,
        piCode: item.productionInvoice?.code ?? '',
        productionOrderId: orderId,
        skuCode: item.mfgProduct.factoryCode,
        skuName: item.mfgProduct.name ?? null,
        quantity: item.quantity,
        floorStage: item.productionOrder!.floorStage,
        milestones,
        worst: worstStatus(milestones.map((m) => m.status)),
        missing: {
          MUA_VT_KHUNG: muaKhung.missing.map(stripLine),
          MUA_VT_CON_LAI: muaConLai.missing.map(stripLine),
        },
      };
    });

    // Dòng cần chú ý lên đầu: trạng thái xấu nhất, rồi hạn gần nhất của mốc chưa xong.
    const nearest = (r: MilestoneRow) =>
      Math.min(
        ...r.milestones
          .filter((m) => m.daysLeft !== null && m.status !== 'DONE' && m.status !== 'NA')
          .map((m) => m.daysLeft!),
        9999,
      );
    rows.sort(
      (a, b) =>
        STATUS_RANK[b.worst] - STATUS_RANK[a.worst] ||
        nearest(a) - nearest(b) ||
        a.piCode.localeCompare(b.piCode),
    );

    return { today, generatedAt: now.toISOString(), failedSources, rows };
  }

  /** Mọi dòng đề xuất mua của các PI (gộp theo PI như FE `getPurchasingRows`), kèm nhóm mốc mua của vật tư. */
  private async loadPurchaseLines(piIds: bigint[]): Promise<PurchaseLine[]> {
    const rows = await this.prisma.purchaseProposalItem.findMany({
      where: { proposal: { productionInvoiceId: { in: [...new Set(piIds)] } } },
      select: {
        id: true,
        materialId: true,
        buyQty: true,
        receivedQty: true,
        receiveWarehouseCode: true,
        stockLengthMm: true,
        spec: true,
        proposal: { select: { productionInvoiceId: true } },
        material: {
          select: {
            name: true,
            unit: true,
            detailKind: true,
            buyerId: true,
            warehouse: { select: { code: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => ({
      lineId: String(r.id),
      piId: String(r.proposal.productionInvoiceId),
      materialId: String(r.materialId),
      name:
        r.stockLengthMm != null
          ? `${r.material.name} (${r.stockLengthMm.toLocaleString('vi-VN')} mm)`
          : r.spec
            ? `${r.material.name} (${r.spec})`
            : r.material.name,
      // Dòng sắt mua theo CÂY (`stockLengthMm` = chiều dài cây, `buyQty` = số cây) - `Material.unit` của sắt trên production
      // là "Mm" nên không dùng được (test thật 32.27).
      unit: r.stockLengthMm != null ? 'cây' : r.material.unit,
      buyQty: r.buyQty.toNumber(),
      receivedQty: r.receivedQty.toNumber(),
      // Kho nhận THẬT của dòng: ưu tiên kho ghi đè (vật tư đóng gói về kho thành phẩm QLSX chọn), như receiveItem().
      warehouseCode: r.receiveWarehouseCode ?? r.material.warehouse?.code ?? null,
      buyerId: r.material.buyerId ?? null,
      group:
        purchaseGroupOf(r.material.detailKind) === 'FINISHED' ? 'MUA_VT_CON_LAI' : 'MUA_VT_KHUNG',
    }));
  }
}

function stripLine(l: PurchaseLine): MissingMaterial {
  return {
    lineId: l.lineId,
    materialId: l.materialId,
    name: l.name,
    unit: l.unit,
    buyQty: l.buyQty,
    receivedQty: l.receivedQty,
    warehouseCode: l.warehouseCode,
    buyerId: l.buyerId,
  };
}
