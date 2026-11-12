import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  ProdApprovalStatus,
  ProductionInvoiceStatus,
  ProductionOrderFloorStage,
} from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { loadLenhDisplayCodes } from '../../common/utils/lenh-code.util';
import { vnDayKey } from '../../common/utils/floor-stats.util';
import {
  addDays,
  DEFAULT_TIMELINE_PARAMS,
  diffDays,
  isDayKey,
  type TimelineParams,
} from '../../common/utils/timeline-suggest.util';
import {
  stageRangesOf,
  type CapacityItemInput,
  type CapacityStageKey,
} from './production-capacity.ranges';
import { aggregateCapacity } from './production-capacity.rules';
import type {
  CapacityBoard,
  CapacityCheckItemInput,
  CapacityCheckResult,
  CapacityMissingLoadCont,
  CapacityRow,
  CapacityWarning,
} from './production-capacity.types';

const SYSTEM_CONFIG_ID = 1;
const DEFAULT_BOARD_SPAN_DAYS = 14;
const MAX_BOARD_SPAN_DAYS = 62;
const MAX_CHECK_ITEMS = 50;

const STAGE_KEYS: CapacityStageKey[] = [
  'PHOI_START',
  'FRAME_PHOI',
  'FRAME_HAN',
  'FRAME_SON',
  'WEAVING',
  'TRANSFER_CHECK',
  'PACKAGING_START',
  'PACKAGING',
];

const WORKSHOP_SELECT = { select: { code: true, name: true, capacityMode: true } } as const;

const ITEM_SELECT = {
  id: true,
  productionInvoiceId: true,
  quantity: true,
  warehouseCode: true,
  warehouseName: true,
  mfgProduct: { select: { factoryCode: true, loadCont: true } },
  workshop: {
    select: { ...WORKSHOP_SELECT.select, paintWorkshop: WORKSHOP_SELECT },
  },
  stages: { select: { stageType: true, deadline: true } },
} satisfies Prisma.ProductionInvoiceItemSelect;

type ItemRow = Prisma.ProductionInvoiceItemGetPayload<{ select: typeof ITEM_SELECT }>;

/**
 * Phần A – Đợt 3 (YC10): năng lực 1,3 cont/ngày - CHỈ CẢNH BÁO, không khoá (v8 10.12). Xem production-capacity.types.ts (hợp đồng)
 * và production-capacity.ranges.ts (khoảng ngày từng công đoạn).
 */
@Injectable()
export class ProductionCapacityService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly workshopScope: WorkshopScopeService,
  ) {}

  /**
   * QLSX gắn xưởng (2026-11-12) chỉ thấy khối xưởng mình + các khối kho đóng gói dùng chung (Nhập đan/Chuyền kiểm/Đóng gói).
   * Lọc SAU khi gom cont (không lọc dòng đầu vào) vì khối kho dùng chung phải cộng đủ lệnh của mọi xưởng. Khối Sơn của xưởng
   * sơn nhờ (vd Phú An khi xem từ Phước An) thuộc xưởng khác nên không hiện. Trả null = không giới hạn.
   */
  private async visibleWorkshopCode(
    userId: string | undefined,
  ): Promise<string | null | undefined> {
    const scope = await this.workshopScope.getScope(userId);
    if (scope.workshopId == null) return undefined;
    const ws = await this.prisma.workshop.findUnique({
      where: { id: scope.workshopId },
      select: { code: true },
    });
    // Không tra được mã xưởng: chỉ còn khối kho dùng chung (an toàn hơn là lộ khối xưởng khác).
    return ws?.code ?? null;
  }

  private static keepGroup(
    ownCode: string | null,
    g: Pick<CapacityRow, 'groupKind' | 'groupCode'>,
  ): boolean {
    return g.groupKind === 'WAREHOUSE' || (ownCode != null && g.groupCode === ownCode);
  }

  /** Tham số năng lực Admin cấu hình (SystemConfig). */
  async loadParams(): Promise<TimelineParams> {
    const cfg = await this.prisma.systemConfig.findUnique({
      where: { id: SYSTEM_CONFIG_ID },
      select: { capacityContPerDay: true, daysPerContPhuocAn: true },
    });
    if (!cfg) return DEFAULT_TIMELINE_PARAMS;
    return {
      capacityContPerDay: cfg.capacityContPerDay.toNumber(),
      daysPerContPhuocAn: cfg.daysPerContPhuocAn,
    };
  }

  /**
   * Mọi dòng SKU đang chiếm năng lực: đã qua QLSX (có xưởng - WAITING_BOSS/APPROVED), PI chưa huỷ, lệnh chưa Kết thúc, đơn bán
   * còn hiệu lực (cùng lọc với Bảng mốc). `onlyWithPhoiStart`: chỉ dòng đã có M2 (cảnh báo sản lượng ngày - V4-13).
   * Dòng chưa có load cont vẫn có trong `items` (stageRangesOf trả rỗng nên không cộng cont) và được liệt kê thêm ở `missingLoadCont`.
   */
  async loadCapacityItems(opts: { onlyWithPhoiStart?: boolean } = {}): Promise<{
    items: CapacityItemInput[];
    missingLoadCont: CapacityMissingLoadCont[];
  }> {
    const rows = await this.prisma.productionInvoiceItem.findMany({
      where: {
        workshopId: { not: null },
        productionInvoiceId: { not: null },
        prodApprovalStatus: { in: [ProdApprovalStatus.WAITING_BOSS, ProdApprovalStatus.APPROVED] },
        productionInvoice: { status: { not: ProductionInvoiceStatus.CANCELLED } },
        AND: [
          {
            OR: [
              { productionOrder: { is: null } },
              {
                productionOrder: {
                  is: { floorStage: { not: ProductionOrderFloorStage.FINISHED } },
                },
              },
            ],
          },
          { OR: [{ salesOrderId: null }, { salesOrder: { isActive: true, deletedAt: null } }] },
          ...(opts.onlyWithPhoiStart
            ? [{ stages: { some: { stageType: 'PHOI_START' as const } } }]
            : []),
        ],
      },
      select: ITEM_SELECT,
      orderBy: { id: 'asc' },
    });
    return this.toInputs(rows);
  }

  /** Đúng các dòng theo id (bất kể trạng thái) - /check dùng cho dòng đang sửa mốc / QLSX đang chọn xưởng. */
  async loadItemsByIds(itemIds: bigint[]): Promise<{
    items: CapacityItemInput[];
    missingLoadCont: CapacityMissingLoadCont[];
  }> {
    if (itemIds.length === 0) return { items: [], missingLoadCont: [] };
    const rows = await this.prisma.productionInvoiceItem.findMany({
      where: { id: { in: itemIds } },
      select: ITEM_SELECT,
      orderBy: { id: 'asc' },
    });
    return this.toInputs(rows);
  }

  private async toInputs(rows: ItemRow[]): Promise<{
    items: CapacityItemInput[];
    missingLoadCont: CapacityMissingLoadCont[];
  }> {
    const piIds = rows.flatMap((r) =>
      r.productionInvoiceId != null ? [r.productionInvoiceId] : [],
    );
    const codes = await loadLenhDisplayCodes(this.prisma, piIds);
    const items: CapacityItemInput[] = [];
    const missingLoadCont: CapacityMissingLoadCont[] = [];
    for (const r of rows) {
      const piId = r.productionInvoiceId != null ? String(r.productionInvoiceId) : '';
      const base = {
        itemId: String(r.id),
        piId,
        displayCode: codes.get(piId) ?? '',
        skuCode: r.mfgProduct.factoryCode,
      };
      const loadCont = r.mfgProduct.loadCont ?? null;
      if (!(loadCont && loadCont > 0)) {
        missingLoadCont.push(base);
      }
      const stages: CapacityItemInput['stages'] = {};
      for (const st of r.stages) {
        if ((STAGE_KEYS as string[]).includes(st.stageType)) {
          stages[st.stageType as CapacityStageKey] = vnDayKey(st.deadline);
        }
      }
      items.push({
        ...base,
        quantity: r.quantity,
        loadCont,
        workshop: r.workshop
          ? {
              code: r.workshop.code,
              name: r.workshop.name,
              capacityMode: r.workshop.capacityMode,
              paint: r.workshop.paintWorkshop
                ? {
                    code: r.workshop.paintWorkshop.code,
                    name: r.workshop.paintWorkshop.name,
                    capacityMode: r.workshop.paintWorkshop.capacityMode,
                  }
                : null,
            }
          : null,
        warehouse: r.warehouseCode
          ? { code: r.warehouseCode, name: r.warehouseName ?? r.warehouseCode }
          : null,
        stages,
      });
    }
    return { items, missingLoadCont };
  }

  // ─── getBoard / check (hàm thuần gom cont: production-capacity.rules.ts) ─────────────────────────────────────────

  /** GET /production-capacity?from&to (mặc định hôm nay + 13 ngày, tối đa 62 ngày). */
  async getBoard(
    from?: string,
    to?: string,
    now: Date = new Date(),
    userId?: string,
  ): Promise<CapacityBoard> {
    const start = from ?? vnDayKey(now);
    if (!isDayKey(start))
      throw new BadRequestException('Ngày bắt đầu (from) phải dạng YYYY-MM-DD hợp lệ');
    const end = to ?? addDays(start, DEFAULT_BOARD_SPAN_DAYS - 1);
    if (!isDayKey(end))
      throw new BadRequestException('Ngày kết thúc (to) phải dạng YYYY-MM-DD hợp lệ');
    if (diffDays(start, end) < 0)
      throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
    if (diffDays(start, end) + 1 > MAX_BOARD_SPAN_DAYS) {
      throw new BadRequestException(`Chỉ xem tối đa ${MAX_BOARD_SPAN_DAYS} ngày một lần`);
    }
    const params = await this.loadParams();
    const { items, missingLoadCont } = await this.loadCapacityItems();
    const ranges = items.flatMap((it) => stageRangesOf(it, params));
    const agg = aggregateCapacity(ranges, start, end, params);
    let rows: CapacityRow[] = agg.rows;
    let warnings: CapacityWarning[] = agg.warnings;
    let missing = missingLoadCont;
    const own = await this.visibleWorkshopCode(userId);
    if (own !== undefined) {
      rows = rows.filter((r) => ProductionCapacityService.keepGroup(own, r));
      warnings = warnings.filter((w) => ProductionCapacityService.keepGroup(own, w));
      const ownItemIds = new Set(
        items.filter((it) => it.workshop?.code === own).map((it) => it.itemId),
      );
      missing = missingLoadCont.filter((m) => ownItemIds.has(m.itemId));
    }
    return {
      from: start,
      to: end,
      capacityContPerDay: params.capacityContPerDay,
      daysPerContPhuocAn: params.daysPerContPhuocAn,
      rows,
      warnings,
      missingLoadCont: missing,
    };
  }

  /** POST /production-capacity/check - thử mốc/xưởng/kho chưa lưu, chỉ trả cảnh báo dính tới dòng đang thử. */
  async check(inputs: CapacityCheckItemInput[], userId?: string): Promise<CapacityCheckResult> {
    if (inputs.length === 0 || inputs.length > MAX_CHECK_ITEMS) {
      throw new BadRequestException(`Gửi từ 1 đến ${MAX_CHECK_ITEMS} dòng để kiểm tra`);
    }
    // Dòng trùng id: lấy dòng gửi sau cùng.
    const byId = new Map<string, CapacityCheckItemInput>();
    for (const inp of inputs) {
      if (typeof inp.itemId !== 'string' || !/^\d+$/.test(inp.itemId)) {
        throw new BadRequestException(`Mã dòng không hợp lệ: ${String(inp.itemId)}`);
      }
      for (const [key, day] of Object.entries(inp.stages ?? {})) {
        if (!(STAGE_KEYS as string[]).includes(key)) {
          throw new BadRequestException(`Mốc không hợp lệ: ${key}`);
        }
        if (!isDayKey(day))
          throw new BadRequestException(`Ngày của mốc ${key} phải dạng YYYY-MM-DD hợp lệ`);
      }
      byId.set(inp.itemId, inp);
    }
    const ids = [...byId.keys()];
    const params = await this.loadParams();
    const [running, tried] = await Promise.all([
      this.loadCapacityItems(),
      this.loadItemsByIds(ids.map((id) => BigInt(id))),
    ]);
    const triedById = new Map(tried.items.map((it) => [it.itemId, it]));
    const missingIds = new Set(tried.missingLoadCont.map((m) => m.itemId));
    for (const id of ids) {
      if (!triedById.has(id) && !missingIds.has(id)) {
        throw new BadRequestException(`Không tìm thấy dòng SKU ${id}`);
      }
    }

    // Xưởng được chọn lại (nếu có).
    const workshopIds = [
      ...new Set(
        ids.flatMap((id) => (byId.get(id)!.workshopId ? [byId.get(id)!.workshopId!] : [])),
      ),
    ];
    const workshopById = new Map<string, NonNullable<CapacityItemInput['workshop']>>();
    for (const wid of workshopIds) {
      if (!/^\d+$/.test(wid)) throw new BadRequestException(`Mã xưởng không hợp lệ: ${wid}`);
    }
    if (workshopIds.length > 0) {
      const found = await this.prisma.workshop.findMany({
        where: { id: { in: workshopIds.map((w) => BigInt(w)) } },
        select: {
          id: true,
          ...WORKSHOP_SELECT.select,
          isActive: true,
          paintWorkshop: WORKSHOP_SELECT,
        },
      });
      for (const w of found) {
        if (!w.isActive) continue;
        workshopById.set(String(w.id), {
          code: w.code,
          name: w.name,
          capacityMode: w.capacityMode,
          paint: w.paintWorkshop
            ? {
                code: w.paintWorkshop.code,
                name: w.paintWorkshop.name,
                capacityMode: w.paintWorkshop.capacityMode,
              }
            : null,
        });
      }
      for (const wid of workshopIds) {
        if (!workshopById.has(wid))
          throw new BadRequestException('Xưởng không tồn tại hoặc đã ngừng dùng');
      }
    }

    const trials: CapacityItemInput[] = [];
    for (const id of ids) {
      const base = triedById.get(id);
      if (!base) continue; // thiếu load cont -> báo ở missingLoadCont, không cộng được
      const inp = byId.get(id)!;
      const trial: CapacityItemInput = { ...base, stages: { ...base.stages } };
      if (inp.workshopId) trial.workshop = workshopById.get(inp.workshopId)!;
      if (inp.warehouseCode) {
        const code = inp.warehouseCode.trim();
        if (code) {
          trial.warehouse = {
            code,
            name: base.warehouse?.code === code ? base.warehouse.name : code,
          };
        }
      }
      for (const [key, day] of Object.entries(inp.stages ?? {})) {
        trial.stages[key as CapacityStageKey] = day;
      }
      trials.push(trial);
    }

    const trialRanges = trials.flatMap((it) => stageRangesOf(it, params));
    const missingLoadCont = tried.missingLoadCont;
    if (trialRanges.length === 0) return { warnings: [], missingLoadCont };

    const others = running.items.filter((it) => !byId.has(it.itemId));
    const allRanges = [...others.flatMap((it) => stageRangesOf(it, params)), ...trialRanges];
    let from = trialRanges[0].from;
    let to = trialRanges[0].to;
    for (const r of trialRanges) {
      if (diffDays(from, r.from) < 0) from = r.from;
      if (diffDays(r.to, to) < 0) to = r.to;
    }
    const { warnings } = aggregateCapacity(allRanges, from, to, params);
    const own = await this.visibleWorkshopCode(userId);
    return {
      warnings: warnings.filter(
        (w) =>
          w.itemIds.some((id) => byId.has(id)) &&
          (own === undefined || ProductionCapacityService.keepGroup(own, w)),
      ),
      missingLoadCont,
    };
  }
}
