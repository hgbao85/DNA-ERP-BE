import {
  BookingStatus,
  CuttingProposalStatus,
  FloorQueueStatus,
  FloorReportKind,
  MfgStage,
  Prisma,
  ProdItemStageType,
  ProductionInvoiceStatus,
  ReservationStatus,
  SolverMachine,
  WorkstationKind,
} from '../../generated/prisma/client';
import { vnDayKey } from '../../common/utils/floor-stats.util';
import { PrismaTx } from '../../prisma/prisma.service';
import { bookingDueDay } from '../bookings/booking-calc.util';
import {
  loadSegmentProcessInfo,
  resolveProposalBomEntries,
  type SegmentProcessInfo,
} from '../cutting-proposals/proposal-segment-info.util';
import { parseMachineByWorkshop } from '../cutting-proposals/steel-spec-key.util';
import { comparePriority, reportedSegmentKey, type CutMachineType } from './cut-allocation.util';

// Nạp dữ liệu chia máy của 1 xưởng thành Snapshot (chỉ đọc), dùng chung cho bảng, chia và kéo lệnh.

export const PROPOSAL_SELECT = {
  id: true,
  productionInvoiceId: true,
  productionOrder: {
    select: {
      bomRevisionId: true,
      quantity: true,
      productionInvoiceItem: { select: { productionInvoiceId: true, workshopId: true } },
    },
  },
  // Phương án neo PI: nạp sẵn lệnh SX của mọi dòng PI (nguồn định mức) để khỏi truy vấn thêm.
  productionInvoice: {
    select: {
      items: { select: { productionOrder: { select: { bomRevisionId: true, quantity: true } } } },
    },
  },
  items: { select: { bomRevisionId: true, quantity: true } },
  lines: {
    where: { feasible: true },
    select: {
      id: true,
      materialId: true,
      totalBars: true,
      bestStockLengthMm: true,
      machine: true,
      pieceSummary: true,
      material: { select: { id: true, code: true, name: true, spec: true } },
      patterns: {
        orderBy: { patternIndex: 'asc' },
        select: {
          id: true,
          patternIndex: true,
          barCount: true,
          wastePerBarMm: true,
          bundles: true,
          segments: {
            select: { countPerBar: true, segmentSpec: { select: { cutLengthMm: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.CuttingProposalSelect;

export type ProposalRow = Prisma.CuttingProposalGetPayload<{ select: typeof PROPOSAL_SELECT }>;
export type AllocationRecord = Prisma.CutAllocationGetPayload<object>;
export type WorkshopRef = { id: bigint; code: string; name: string };

export interface MachineInfo {
  id: bigint;
  code: string;
  name: string;
  cutMachineType: SolverMachine | null;
}

export interface OrderInfo {
  id: bigint;
  code: string;
  priority: { phoiStart: string | null; bookingDue: string | null; deadline: string | null };
}

export interface PatternMeta {
  patternId: string;
  proposalId: string;
  piId: string;
  materialId: string;
  line: ProposalRow['lines'][number];
  pattern: ProposalRow['lines'][number]['patterns'][number];
  segments: Array<{ cutLengthMm: number; countPerBar: number }>;
}

export interface PairInfo {
  required: number;
  patternBars: number;
  hasPatterns: boolean;
  material: ProposalRow['lines'][number]['material'];
}

export interface Snapshot {
  workshop: WorkshopRef;
  laserAllowed: boolean;
  machines: MachineInfo[];
  /** Lệnh ứng viên đã sắp theo khoá ưu tiên. */
  orders: OrderInfo[];
  /** Phương án APPROVED phủ các lệnh ứng viên. */
  proposals: ProposalRow[];
  proposalsByPi: Map<string, ProposalRow[]>;
  patterns: Map<string, PatternMeta>;
  /** Khoá `${piId}:${materialId}`. */
  pairs: Map<string, PairInfo>;
  /** Khoá như `pairs`: số cây đã xuất + còn giữ chỗ (kho xưởng này hoặc không gắn xưởng). */
  available: Map<string, number>;
  /** Khoá như `pairs`: số cây còn giữ chỗ ở kho xưởng khác (không nằm trong `available`). */
  heldElsewhere: Map<string, number>;
  valid: AllocationRecord[];
  stale: AllocationRecord[];
}

export type ReportedSegments = {
  byPair: Map<string, number>;
  byMachine: Map<string, Map<string, number>>;
};

/**
 * Cache snapshot theo lượt quét nền: mỗi xưởng chỉ dựng 1 lần. Ai ghi dòng chia của xưởng phải gọi
 * `invalidate` để lần đọc sau không dùng dữ liệu cũ.
 */
export class CutSnapshotCache {
  private readonly snaps = new Map<string, Snapshot>();

  get(workshopId: bigint): Snapshot | undefined {
    return this.snaps.get(workshopId.toString());
  }

  set(workshopId: bigint, snap: Snapshot): void {
    this.snaps.set(workshopId.toString(), snap);
  }

  invalidate(workshopId: bigint): void {
    this.snaps.delete(workshopId.toString());
  }
}

/**
 * Giữ chỗ ở kho của xưởng KHÁC: sắt chưa xuất được cho xưởng này, phải chuyển kho trước. Kho không
 * gắn xưởng thì không.
 */
export function heldInOtherWorkshop(
  warehouseWorkshopId: bigint | null | undefined,
  workshopId: bigint,
): boolean {
  return warehouseWorkshopId != null && warehouseWorkshopId !== workshopId;
}

export function materialLabel(m: { name: string; spec: string | null }): string {
  const spec = m.spec?.trim();
  return spec ? `${m.name} · ${spec}` : m.name;
}

export function toMachineType(t: SolverMachine | null): CutMachineType {
  return t === SolverMachine.tu_dong ? 'tu_dong' : 'laser';
}

function minDay(days: Array<string | null>): string | null {
  let best: string | null = null;
  for (const d of days) if (d && (best === null || d < best)) best = d;
  return best;
}

/** Cặp (lệnh, loại sắt) đủ sắt đã xuất / giữ chỗ cho số cây cần. */
export function isPairSufficient(snap: Snapshot, pairKey: string): boolean {
  const pair = snap.pairs.get(pairKey);
  return !!pair && pair.required > 0 && (snap.available.get(pairKey) ?? 0) >= pair.required;
}

// ─── Nạp snapshot ────────────────────────────────────────────────────────────

async function loadWorkshopData(db: PrismaTx, workshopId: bigint) {
  const itemInWorkshop = {
    workshopId,
    productionOrder: { isNot: null },
  } satisfies Prisma.ProductionInvoiceItemWhereInput;

  return Promise.all([
    db.systemConfig.findUnique({ where: { id: 1 }, select: { solverMachineByWorkshop: true } }),
    db.workstation.findMany({
      where: { workshopId, kind: WorkstationKind.CUT, isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, cutMachineType: true },
    }),
    db.productionInvoice.findMany({
      where: {
        status: { notIn: [ProductionInvoiceStatus.DONE, ProductionInvoiceStatus.CANCELLED] },
        items: { some: itemInWorkshop },
        floorQueueEntries: { none: { stage: MfgStage.PHOI, status: FloorQueueStatus.DONE } },
      },
      select: {
        id: true,
        code: true,
        deadline: true,
        items: {
          where: itemInWorkshop,
          select: {
            stages: {
              where: { stageType: ProdItemStageType.PHOI_START },
              select: { deadline: true },
            },
            bookingLines: {
              where: {
                booking: { status: { in: [BookingStatus.DRAFT, BookingStatus.CONFIRMED] } },
              },
              select: { booking: { select: { pickupDate: true, cutOffAt: true } } },
            },
          },
        },
      },
    }),
    db.cutAllocation.findMany({ where: { workshopId }, orderBy: { id: 'asc' } }),
  ]);
}

type InvoiceRow = Awaited<ReturnType<typeof loadWorkshopData>>[2][number];

function buildOrders(invoices: InvoiceRow[]): OrderInfo[] {
  return invoices
    .map((pi) => ({
      id: pi.id,
      code: pi.code,
      priority: {
        phoiStart: minDay(pi.items.flatMap((it) => it.stages.map((s) => vnDayKey(s.deadline)))),
        bookingDue: minDay(
          pi.items.flatMap((it) => it.bookingLines.map((bl) => bookingDueDay(bl.booking))),
        ),
        deadline: pi.deadline ? vnDayKey(pi.deadline) : null,
      },
    }))
    .sort((a, b) => comparePriority({ ...a.priority, id: a.id }, { ...b.priority, id: b.id }));
}

interface ReservationRow {
  productionInvoiceId: bigint | null;
  materialId: bigint;
  quantity: Prisma.Decimal;
  consumedQty: Prisma.Decimal;
  warehouse: { workshopId: bigint | null };
}

async function loadSupplyRows(db: PrismaTx, piIds: bigint[]) {
  return Promise.all([
    db.cuttingProposal.findMany({
      where: {
        status: CuttingProposalStatus.APPROVED,
        OR: [
          { productionInvoiceId: { in: piIds } },
          { productionOrder: { productionInvoiceItem: { productionInvoiceId: { in: piIds } } } },
        ],
      },
      select: PROPOSAL_SELECT,
      orderBy: { id: 'asc' },
    }),
    db.steelIssue.groupBy({
      by: ['productionInvoiceId', 'materialId'],
      where: { productionInvoiceId: { in: piIds }, reworkOfId: null },
      _sum: { barCount: true },
    }),
    db.stockReservation.findMany({
      where: { productionInvoiceId: { in: piIds }, status: ReservationStatus.ACTIVE },
      select: {
        productionInvoiceId: true,
        materialId: true,
        quantity: true,
        consumedQty: true,
        warehouse: { select: { workshopId: true } },
      },
    }),
  ]);
}

type Catalog = Pick<
  Snapshot,
  'proposals' | 'proposalsByPi' | 'patterns' | 'pairs' | 'available' | 'heldElsewhere'
>;

function emptyCatalog(): Catalog {
  return {
    proposals: [],
    proposalsByPi: new Map(),
    patterns: new Map(),
    pairs: new Map(),
    available: new Map(),
    heldElsewhere: new Map(),
  };
}

function indexPatterns(
  catalog: Catalog,
  proposal: ProposalRow,
  piKey: string,
  line: ProposalRow['lines'][number],
): void {
  const pairKey = `${piKey}:${line.materialId}`;
  const pair = catalog.pairs.get(pairKey) ?? {
    required: 0,
    patternBars: 0,
    hasPatterns: false,
    material: line.material,
  };
  pair.required += line.totalBars ?? 0;
  for (const pat of line.patterns) {
    pair.hasPatterns = true;
    pair.patternBars += pat.barCount;
    catalog.patterns.set(pat.id.toString(), {
      patternId: pat.id.toString(),
      proposalId: proposal.id.toString(),
      piId: piKey,
      materialId: line.materialId.toString(),
      line,
      pattern: pat,
      segments: pat.segments
        .map((s) => ({
          cutLengthMm: Number(s.segmentSpec.cutLengthMm),
          countPerBar: s.countPerBar,
        }))
        .sort((a, b) => b.cutLengthMm - a.cutLengthMm),
    });
  }
  catalog.pairs.set(pairKey, pair);
}

function indexProposals(catalog: Catalog, rawProposals: ProposalRow[], workshopId: bigint): void {
  for (const p of rawProposals) {
    // Phương án neo PI: lấy hết. Neo PO: chỉ khi dòng lệnh của PO thuộc xưởng này hoặc chưa có
    // xưởng.
    let piId: bigint | null = p.productionInvoiceId;
    if (piId == null && p.productionOrder) {
      const item = p.productionOrder.productionInvoiceItem;
      if (item.workshopId != null && item.workshopId !== workshopId) continue;
      piId = item.productionInvoiceId;
    }
    if (piId == null) continue;
    const piKey = piId.toString();
    catalog.proposals.push(p);
    const list = catalog.proposalsByPi.get(piKey) ?? [];
    list.push(p);
    catalog.proposalsByPi.set(piKey, list);
    for (const line of p.lines) indexPatterns(catalog, p, piKey, line);
  }
}

function tallySupply(
  catalog: Catalog,
  issues: Array<{
    productionInvoiceId: bigint;
    materialId: bigint;
    _sum: { barCount: number | null };
  }>,
  reservations: ReservationRow[],
  workshopId: bigint,
): void {
  const add = (map: Map<string, number>, k: string, n: number) => map.set(k, (map.get(k) ?? 0) + n);
  for (const i of issues) {
    add(catalog.available, `${i.productionInvoiceId}:${i.materialId}`, i._sum.barCount ?? 0);
  }
  for (const r of reservations) {
    const k = `${r.productionInvoiceId}:${r.materialId}`;
    const remaining = Math.max(0, r.quantity.toNumber() - r.consumedQty.toNumber());
    // Sắt giữ ở kho xưởng khác không tính "đủ sắt": lệnh ở "Chờ sắt" tới khi kho xưởng này nhận
    // phiếu chuyển. Nhờ vậy máy rảnh không kéo lệnh đó và thủ kho kho cũ không bị báo xuất việc
    // không làm được.
    if (heldInOtherWorkshop(r.warehouse.workshopId, workshopId)) {
      add(catalog.heldElsewhere, k, remaining);
      continue;
    }
    add(catalog.available, k, remaining);
  }
}

async function loadCatalog(db: PrismaTx, workshopId: bigint, piIds: bigint[]): Promise<Catalog> {
  const catalog = emptyCatalog();
  if (piIds.length === 0) return catalog;
  const [rawProposals, issues, reservations] = await loadSupplyRows(db, piIds);
  indexProposals(catalog, rawProposals, workshopId);
  tallySupply(catalog, issues, reservations, workshopId);
  return catalog;
}

/** Dòng cũ: phương án không còn APPROVED, lệnh không còn ứng viên, hoặc máy không còn dùng. */
function splitStale(
  allocations: AllocationRecord[],
  patterns: Map<string, PatternMeta>,
  machines: MachineInfo[],
): { valid: AllocationRecord[]; stale: AllocationRecord[] } {
  const activeMachines = new Set(machines.map((m) => m.id.toString()));
  const valid: AllocationRecord[] = [];
  const stale: AllocationRecord[] = [];
  for (const row of allocations) {
    const meta = patterns.get(row.patternId.toString());
    const ok =
      meta != null &&
      meta.proposalId === row.cuttingProposalId.toString() &&
      meta.piId === row.productionInvoiceId.toString() &&
      activeMachines.has(row.workstationId.toString());
    (ok ? valid : stale).push(row);
  }
  return { valid, stale };
}

export async function loadSnapshot(db: PrismaTx, workshop: WorkshopRef): Promise<Snapshot> {
  const [config, machines, invoices, allocations] = await loadWorkshopData(db, workshop.id);
  const lockedMachine =
    parseMachineByWorkshop(config?.solverMachineByWorkshop)[workshop.code] ?? null;
  const orders = buildOrders(invoices);
  const catalog = await loadCatalog(
    db,
    workshop.id,
    orders.map((o) => o.id),
  );
  return {
    workshop,
    laserAllowed: lockedMachine !== 'tu_dong',
    machines,
    orders,
    ...catalog,
    ...splitStale(allocations, catalog.patterns, machines),
  };
}

/** Snapshot qua cache của lượt quét (nếu có); không có cache thì nạp mới như thường. */
export async function loadSnapshotCached(
  db: PrismaTx,
  workshop: WorkshopRef,
  cache?: CutSnapshotCache,
): Promise<Snapshot> {
  const hit = cache?.get(workshop.id);
  if (hit) return hit;
  const snap = await loadSnapshot(db, workshop);
  cache?.set(workshop.id, snap);
  return snap;
}

export async function loadProcessInfo(
  db: PrismaTx,
  snap: Snapshot,
  withPunchDemand: boolean,
): Promise<Map<string, SegmentProcessInfo>> {
  const entries = await resolveProposalBomEntries(
    db,
    snap.proposals.map((p) => ({
      id: p.id,
      productionInvoiceId: p.productionInvoiceId,
      productionOrder: p.productionOrder,
      items: p.items,
      invoiceOrders: p.productionInvoice
        ? p.productionInvoice.items.flatMap((it) =>
            it.productionOrder ? [it.productionOrder] : [],
          )
        : null,
    })),
  );
  return loadSegmentProcessInfo(db, entries, { withPunchDemand });
}

/**
 * Tiến độ xấp xỉ: đoạn đã báo CUT (chưa bị đảo). `byPair`: khoá `${máy}:${lệnh}:${loại sắt}`;
 * `byMachine`: theo máy, tách theo cỡ đoạn (khoá reportedSegmentKey) để ước số cây từng dòng.
 */
export async function loadReported(db: PrismaTx, snap: Snapshot): Promise<ReportedSegments> {
  const result: ReportedSegments = { byPair: new Map(), byMachine: new Map() };
  const machineIds = snap.machines.map((m) => m.id);
  const piIds = snap.orders.map((o) => o.id);
  if (machineIds.length === 0 || piIds.length === 0 || snap.valid.length === 0) return result;
  const rows = await db.$queryRaw<
    Array<{
      workstationId: bigint;
      productionInvoiceId: bigint;
      materialId: bigint;
      cutLengthMm: number;
      qty: number;
    }>
  >(Prisma.sql`
      SELECT fr."workstationId" AS "workstationId", fr."productionInvoiceId" AS "productionInvoiceId",
             ss."materialId" AS "materialId", ss."cutLengthMm"::float8 AS "cutLengthMm",
             SUM(frl."qty")::int AS "qty"
      FROM "floor_reports" fr
      JOIN "floor_report_lines" frl ON frl."floorReportId" = fr."id"
      JOIN "segment_spec" ss ON ss."id" = frl."segmentSpecId"
      WHERE fr."kind" = ${FloorReportKind.CUT}::"FloorReportKind"
        AND fr."reversalOfId" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "floor_reports" rv WHERE rv."reversalOfId" = fr."id")
        AND fr."workstationId" IN (${Prisma.join(machineIds)})
        AND fr."productionInvoiceId" IN (${Prisma.join(piIds)})
      GROUP BY fr."workstationId", fr."productionInvoiceId", ss."materialId", ss."cutLengthMm"
    `);
  for (const r of rows) {
    const qty = Number(r.qty);
    const pairKey = `${r.workstationId}:${r.productionInvoiceId}:${r.materialId}`;
    result.byPair.set(pairKey, (result.byPair.get(pairKey) ?? 0) + qty);
    const machineKey = r.workstationId.toString();
    const perMachine = result.byMachine.get(machineKey) ?? new Map<string, number>();
    const segKey = reportedSegmentKey(r.productionInvoiceId, r.materialId, Number(r.cutLengthMm));
    perMachine.set(segKey, (perMachine.get(segKey) ?? 0) + qty);
    result.byMachine.set(machineKey, perMachine);
  }
  return result;
}
