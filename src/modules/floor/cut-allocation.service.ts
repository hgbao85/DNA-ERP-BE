import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CutAllocationChangeReason,
  CutAllocationLogAction,
  CutMachineClass,
  Prisma,
  ProductionOrderFloorStage,
  WorkstationKind,
} from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import {
  WorkshopScope,
  WorkshopScopeService,
} from '../../common/workshop-scope/workshop-scope.service';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import type { SegmentProcessInfo } from '../cutting-proposals/proposal-segment-info.util';
import {
  buildBoardData,
  distinctPis,
  toMachineProgress,
  workshopLabel,
} from './cut-allocation-board';
import {
  BUNDLE_LOCKED_MESSAGE,
  BUNDLE_MOVE_REASON_MESSAGE,
  isGuardedRowStale,
  ROW_GUARD_SELECT,
  STALE_MESSAGE,
  type GuardedRow,
} from './cut-allocation-guard';
import { loadLogEntries, resolveLogRange, summarizeByOrder } from './cut-allocation-log';
import { assertTargetMachine } from './cut-allocation-machine-rule';
import {
  isPairSufficient,
  loadProcessInfo,
  loadReported,
  loadSnapshot,
  loadSnapshotCached,
  toMachineType,
  type AllocationRecord,
  type CutSnapshotCache,
  type Snapshot,
  type WorkshopRef,
} from './cut-allocation-snapshot';
import { loadSteelGaps } from './cut-allocation-steel-gaps';
import type {
  CutAllocationBoard,
  CutAllocationLogResult,
  CutAutoPullResult,
  CutMachineProgressInfo,
  CutMachineWork,
  SteelGap,
} from './cut-allocation-types';
import { buildUnits, hasBend, remainingLoad, type UnitMeta } from './cut-allocation-units';
import { planAllocation, sortMachineRows } from './cut-allocation.util';
import { assignPullSeq, buildPullResult, planPulls, type PullPick } from './cut-auto-pull-plan';
import {
  AddCutAllocationDto,
  AutoCutAllocationDto,
  CutAllocationLogQueryDto,
  ReorderCutAllocationDto,
  SplitCutAllocationDto,
  UpdateCutAllocationDto,
} from './dto/cut-allocation.dto';

// Kiểu trả về là hợp đồng với FE; controller và các service khác vẫn import từ file này.
export type {
  CutAllocationBoard,
  CutAllocationLogEntry,
  CutAllocationLogResult,
  CutAllocationRow,
  CutAllocationSegment,
  CutAutoPullResult,
  CutMachineProgressInfo,
  CutMachineWork,
  SteelGap,
} from './cut-allocation-types';

/** Giao dịch chia máy nạp cả bảng của xưởng; mặc định 5 giây của Prisma không đủ trên DB thật. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

type LogBase = Omit<Prisma.CutAllocationLogUncheckedCreateInput, 'action' | 'barCount'>;

/** Chia máy cắt: bảng kế hoạch chia sắt cho máy cắt của QLSX xưởng. */
@Injectable()
export class CutAllocationService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly workshopScope: WorkshopScopeService,
  ) {}

  // ─── Xưởng + phạm vi ───────────────────────────────────────────────────────

  private scopeError(scope: WorkshopScope): ForbiddenException {
    return new ForbiddenException(
      scope.workshopName
        ? `Bạn chỉ chia máy cắt cho ${workshopLabel(scope.workshopName)}`
        : 'Bạn chỉ chia máy cắt cho xưởng mình phụ trách',
    );
  }

  private async loadWorkshop(id: bigint): Promise<WorkshopRef> {
    const ws = await this.prisma.workshop.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!ws || !ws.isActive) {
      throw new BadRequestException('Xưởng không tồn tại hoặc đã ngừng hoạt động');
    }
    return { id: ws.id, code: ws.code, name: ws.name };
  }

  /** Xưởng theo id (không kiểm isActive), null nếu không có: dùng cho các đường đọc nền. */
  private async findWorkshopRef(id: bigint): Promise<WorkshopRef | null> {
    return this.prisma.workshop.findUnique({
      where: { id },
      select: { id: true, code: true, name: true },
    });
  }

  /** Xưởng của request: QLSX theo xưởng bị khoá vào xưởng mình, QLSX chung phải chọn xưởng. */
  private async resolveWorkshop(userId: string, requested?: string): Promise<WorkshopRef> {
    const scope = await this.workshopScope.getScope(userId);
    const asked = requested ? parseBigIntId(requested) : null;
    if (scope.workshopId != null) {
      if (asked != null && asked !== scope.workshopId) throw this.scopeError(scope);
      return this.loadWorkshop(scope.workshopId);
    }
    if (asked == null) throw new BadRequestException('Chọn xưởng để chia máy cắt');
    return this.loadWorkshop(asked);
  }

  /** Route theo `:id`: dòng phải thuộc xưởng của QLSX (QLSX chung: mọi xưởng). */
  private async resolveRowWorkshop(userId: string, rowId: bigint): Promise<WorkshopRef> {
    const row = await this.prisma.cutAllocation.findUnique({
      where: { id: rowId },
      select: { workshopId: true },
    });
    if (!row) throw new NotFoundException('Không tìm thấy dòng chia máy');
    const scope = await this.workshopScope.getScope(userId);
    if (scope.workshopId != null && scope.workshopId !== row.workshopId) {
      throw this.scopeError(scope);
    }
    return this.loadWorkshop(row.workshopId);
  }

  // ─── Bảng (GET) ────────────────────────────────────────────────────────────

  /** `cache`: lượt quét nền dùng chung 1 snapshot cho nhiều lần đọc cùng xưởng. */
  private async buildBoard(
    db: PrismaTx,
    workshop: WorkshopRef,
    extraWarnings: string[],
    cache?: CutSnapshotCache,
  ): Promise<CutAllocationBoard> {
    const snap = await loadSnapshotCached(db, workshop, cache);
    const info = await loadProcessInfo(db, snap, false);
    const reported = await loadReported(db, snap);
    return buildBoardData(snap, info, reported, extraWarnings);
  }

  async getBoard(userId: string, workshopId?: string): Promise<CutAllocationBoard> {
    const workshop = await this.resolveWorkshop(userId, workshopId);
    return this.buildBoard(this.prisma, workshop, []);
  }

  /**
   * Việc đã chia cho 1 máy cắt (màn quét máy cắt): các dòng của máy, bỏ dòng cũ, theo seq, cùng
   * hình dạng dòng bảng chia, kèm ước tiến độ. Máy không có xưởng hoặc không phải máy cắt thì rỗng.
   */
  async getMachineWork(workstationId: bigint): Promise<CutMachineWork> {
    const empty: CutMachineWork = { rows: [], barsDoneEst: 0, barsLeftEst: 0, status: 'EMPTY' };
    const machine = await this.prisma.workstation.findUnique({
      where: { id: workstationId },
      select: { kind: true, workshopId: true },
    });
    if (!machine || machine.kind !== WorkstationKind.CUT || machine.workshopId == null) {
      return empty;
    }
    const ws = await this.findWorkshopRef(machine.workshopId);
    if (!ws) return empty;
    const board = await this.buildBoard(this.prisma, ws, []);
    const key = workstationId.toString();
    const m = board.machines.find((x) => x.id === key);
    return {
      rows: board.rows.filter((r) => r.workstationId === key).sort((a, b) => a.seq - b.seq),
      barsDoneEst: m?.barsDoneEst ?? 0,
      barsLeftEst: m?.barsLeftEst ?? 0,
      status: m?.status ?? 'EMPTY',
    };
  }

  /**
   * Các lệnh có dòng chia (còn hiệu lực) trên MỌI máy cắt của 1 xưởng: máy Uốn/Dập/... của tổ Phôi
   * báo được cho các lệnh này. Thứ tự: seq nhỏ trước, rồi id dòng.
   */
  async getWorkshopAllocationPis(
    workshopId: bigint,
  ): Promise<Array<{ productionInvoiceId: string; code: string }>> {
    const ws = await this.findWorkshopRef(workshopId);
    if (!ws) return [];
    const board = await this.buildBoard(this.prisma, ws, []);
    return distinctPis(board.rows);
  }

  /** Tiến độ ước của từng máy cắt trong 1 xưởng (nhắc máy sắp hết việc / rảnh). */
  async machineProgressByWorkshop(
    workshopId: bigint,
    cache?: CutSnapshotCache,
  ): Promise<CutMachineProgressInfo[]> {
    const ws = await this.findWorkshopRef(workshopId);
    if (!ws) return [];
    return toMachineProgress(await this.buildBoard(this.prisma, ws, [], cache));
  }

  /**
   * Lệnh còn thiếu sắt chưa xuất xuống Phôi trong xưởng: các cặp (lệnh, loại sắt) có dòng chia hiện
   * hành mà đã xuất < cần. Dùng để tự đóng thông báo "xuất sắt" của thủ kho khi thủ kho xuất đủ.
   */
  async steelGapsByPi(
    workshopId: bigint,
    cache?: CutSnapshotCache,
  ): Promise<Map<string, SteelGap[]>> {
    const out = new Map<string, SteelGap[]>();
    const ws = await this.findWorkshopRef(workshopId);
    if (!ws) return out;
    const snap = await loadSnapshotCached(this.prisma, ws, cache);
    const pairKeys = [
      ...new Set(
        snap.valid.map((r) => {
          const meta = snap.patterns.get(r.patternId.toString())!;
          return `${meta.piId}:${meta.materialId}`;
        }),
      ),
    ];
    const gaps = await loadSteelGaps(this.prisma, snap, pairKeys);
    for (const [key, gap] of gaps) {
      const piId = key.split(':')[0];
      const list = out.get(piId) ?? [];
      list.push(gap);
      out.set(piId, list);
    }
    return out;
  }

  // ─── Tự chia (auto) + chia thêm (add) ─────────────────────────────────────

  async auto(userId: string, dto: AutoCutAllocationDto): Promise<CutAllocationBoard> {
    const workshop = await this.resolveWorkshop(userId, dto.workshopId);
    const warnings = await this.runPlan(userId, workshop, dto.mode, null);
    return this.buildBoard(this.prisma, workshop, warnings);
  }

  async add(userId: string, dto: AddCutAllocationDto): Promise<CutAllocationBoard> {
    const workshop = await this.resolveWorkshop(userId, dto.workshopId);
    const pairKey = `${parseBigIntId(dto.productionInvoiceId)}:${parseBigIntId(dto.materialId)}`;
    const warnings = await this.runPlan(userId, workshop, 'append', pairKey);
    return this.buildBoard(this.prisma, workshop, warnings);
  }

  /**
   * Chia trong 1 transaction (khoá theo xưởng). `onlyPair` = chia ngay đúng (lệnh, loại sắt) đó dù
   * chưa thấy đủ sắt (khoá `${piId}:${materialId}`); null = mọi cặp đủ sắt. Trả về cảnh báo của lần
   * chia.
   */
  private async runPlan(
    userId: string,
    workshop: WorkshopRef,
    mode: 'append' | 'redo',
    onlyPair: string | null,
  ): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `cut-allocation:${workshop.id}`);
      const snap = await loadSnapshot(tx, workshop);
      this.assertPlannable(snap, workshop, onlyPair);
      const held = await this.dropOldRows(tx, snap, mode);

      const info = await loadProcessInfo(tx, snap, true);
      const { orders, unitMeta } = buildUnits(snap, info, held, (pairKey) =>
        onlyPair ? pairKey === onlyPair : isPairSufficient(snap, pairKey),
      );
      // Tải = số cây CÒN LẠI (ước): máy đã cắt hết dòng nhận việc mới trước máy còn dòng chưa cắt.
      const reported = await loadReported(tx, snap);
      const heldIds = new Set(held.map((r) => r.id.toString()));
      const plan = planAllocation({
        orders,
        machines: snap.machines.map((m) => ({
          id: m.id.toString(),
          type: toMachineType(m.cutMachineType),
        })),
        laserAllowed: snap.laserAllowed,
        initialLoad: remainingLoad(snap, reported, (r) => heldIds.has(String(r.id))),
      });

      const created = await this.createPlannedRows(
        tx,
        userId,
        workshop,
        plan.rows,
        unitMeta,
        onlyPair,
      );
      // "Chia luôn" là sửa tay của QLSX nên ghi nhật ký; hệ thống tự chia (auto) thì không.
      if (onlyPair != null && created.length > 0) {
        await this.logAddedRows(tx, userId, workshop, snap, created);
      }
      await this.resequence(tx, snap, info, [...held, ...created]);
      return plan.warnings;
    }, TX_OPTIONS);
  }

  private assertPlannable(snap: Snapshot, workshop: WorkshopRef, onlyPair: string | null): void {
    if (snap.machines.length === 0) {
      throw new BadRequestException(
        `${workshopLabel(workshop.name)} chưa khai máy cắt (Sản lượng xưởng › Máy & tem QR)`,
      );
    }
    if (onlyPair && !snap.pairs.get(onlyPair)?.hasPatterns) {
      throw new BadRequestException(
        'Lệnh này không có kiểu cắt nào của loại sắt đã chọn trong xưởng (lệnh không thuộc xưởng, đã xong Phôi hoặc chưa có phương án cắt được duyệt)',
      );
    }
  }

  /** Xoá dòng cũ (+ dòng tự chia khi "Chia lại"); trả về các dòng được giữ. */
  private async dropOldRows(
    tx: PrismaTx,
    snap: Snapshot,
    mode: 'append' | 'redo',
  ): Promise<AllocationRecord[]> {
    const dropIds = snap.stale.map((r) => r.id);
    let held = snap.valid;
    if (mode === 'redo') {
      dropIds.push(...held.filter((r) => !r.isManual).map((r) => r.id));
      held = held.filter((r) => r.isManual);
    }
    if (dropIds.length > 0) {
      await tx.cutAllocation.deleteMany({ where: { id: { in: dropIds } } });
    }
    return held;
  }

  private async createPlannedRows(
    tx: PrismaTx,
    userId: string,
    workshop: WorkshopRef,
    planRows: Array<{ unitKey: string; machineId: string; bars: number }>,
    unitMeta: Map<string, UnitMeta>,
    onlyPair: string | null,
  ): Promise<AllocationRecord[]> {
    if (planRows.length === 0) return [];
    return tx.cutAllocation.createManyAndReturn({
      data: planRows.map((pr) => {
        const u = unitMeta.get(pr.unitKey)!;
        return {
          workshopId: workshop.id,
          workstationId: BigInt(pr.machineId),
          productionInvoiceId: BigInt(u.meta.piId),
          cuttingProposalId: BigInt(u.meta.proposalId),
          patternId: BigInt(u.meta.patternId),
          machineClass: u.machineClass,
          barCount: pr.bars,
          punchedSegments: u.machineClass === CutMachineClass.LASER ? u.punched : Prisma.DbNull,
          seq: 0,
          // "Chia luôn" là quyết định của QLSX: "Chia lại" phải giữ như dòng sửa tay.
          isManual: onlyPair != null,
          updatedById: onlyPair != null ? userId : null,
        };
      }),
    });
  }

  private async logAddedRows(
    tx: PrismaTx,
    userId: string,
    workshop: WorkshopRef,
    snap: Snapshot,
    created: AllocationRecord[],
  ): Promise<void> {
    await tx.cutAllocationLog.createMany({
      data: created.map((c) => ({
        workshopId: workshop.id,
        productionInvoiceId: c.productionInvoiceId,
        cutAllocationId: c.id,
        patternId: c.patternId,
        action: CutAllocationLogAction.ADD,
        toWorkstationId: c.workstationId,
        barCount: c.barCount,
        isBundle: snap.patterns.get(c.patternId.toString())?.pattern.bundles != null,
        createdById: userId,
      })),
    });
  }

  /** Xếp lại seq (1..n) mọi dòng trên các máy của xưởng theo khoá ưu tiên. */
  private async resequence(
    tx: PrismaTx,
    snap: Snapshot,
    info: Map<string, SegmentProcessInfo>,
    rows: AllocationRecord[],
  ): Promise<void> {
    const orderRank = new Map(snap.orders.map((o, i) => [o.id.toString(), i]));
    const byMachine = new Map<string, AllocationRecord[]>();
    for (const r of rows) {
      const k = r.workstationId.toString();
      const list = byMachine.get(k) ?? [];
      list.push(r);
      byMachine.set(k, list);
    }
    const updates: Array<{ id: bigint; seq: number }> = [];
    for (const list of byMachine.values()) {
      const sorted = sortMachineRows(
        list.map((r) => {
          const meta = snap.patterns.get(r.patternId.toString())!;
          return {
            id: r.id,
            record: r,
            orderRank: orderRank.get(r.productionInvoiceId.toString()) ?? 0,
            materialId: meta.materialId,
            hasBend: hasBend(info, meta),
            patternIndex: meta.pattern.patternIndex,
            machineClass: r.machineClass,
            barCount: r.barCount,
          };
        }),
      );
      for (let i = 0; i < sorted.length; i++) {
        const rec = sorted[i].record;
        if (rec.seq !== i + 1) updates.push({ id: rec.id, seq: i + 1 });
      }
    }
    await this.setSeqBulk(tx, updates);
  }

  /** Đặt seq hàng loạt, 1 câu UPDATE mỗi 1000 dòng: xưởng vài trăm dòng vẫn nhanh trên DB thật. */
  private async setSeqBulk(
    tx: PrismaTx,
    updates: Array<{ id: bigint; seq: number }>,
  ): Promise<void> {
    for (let i = 0; i < updates.length; i += 1000) {
      const values = Prisma.join(
        updates.slice(i, i + 1000).map((u) => Prisma.sql`(${u.id}::bigint, ${u.seq}::int)`),
      );
      await tx.$executeRaw(Prisma.sql`
        UPDATE "cut_allocations" AS c SET "seq" = v.seq, "updatedAt" = NOW()
        FROM (VALUES ${values}) AS v(id, seq)
        WHERE c."id" = v.id`);
    }
  }

  // ─── Máy rảnh tự kéo lệnh ──────────────────────────────────────────────────

  /**
   * FloorAlertsService gọi khi máy IDLE/EMPTY. Chỉ THÊM dòng chia (không xoá, không resequence dòng
   * cũ). Lệnh được kéo: cặp (lệnh, loại sắt) đủ sắt và lệnh đã "Bắt đầu" ở xưởng. Luôn tự nạp
   * snapshot trong transaction có khoá (không dùng cache) vì đây là đường ghi. Không có gì để kéo
   * -> null.
   */
  async autoPull(workshopId: bigint, idleMachineIds: string[]): Promise<CutAutoPullResult | null> {
    if (idleMachineIds.length === 0) return null;
    const ws = await this.prisma.workshop.findUnique({
      where: { id: workshopId },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!ws || !ws.isActive) return null;
    const workshop = { id: ws.id, code: ws.code, name: ws.name };
    return this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `cut-allocation:${workshop.id}`);
      return this.pullInTx(tx, workshop, idleMachineIds);
    }, TX_OPTIONS);
  }

  private async pullInTx(
    tx: PrismaTx,
    workshop: WorkshopRef,
    idleMachineIds: string[],
  ): Promise<CutAutoPullResult | null> {
    const snap = await loadSnapshot(tx, workshop);
    const machineName = new Map(snap.machines.map((m) => [m.id.toString(), m.name]));
    const idle = new Set(idleMachineIds.filter((id) => machineName.has(id)));
    if (idle.size === 0) return null;

    const reported = await loadReported(tx, snap);
    const load = remainingLoad(snap, reported);
    const needWork = new Set([...idle].filter((id) => (load.get(id) ?? 0) <= 0));
    if (needWork.size === 0) return null;
    const idleStart = new Set(needWork);

    const startedPis = await this.loadStartedPis(tx, workshop.id, snap);
    if (startedPis.size === 0) return null;

    const info = await loadProcessInfo(tx, snap, true);
    const { orders, unitMeta } = buildUnits(
      snap,
      info,
      snap.valid,
      (pairKey) => startedPis.has(pairKey.split(':')[0]) && isPairSufficient(snap, pairKey),
    );
    const picks = planPulls({
      orders,
      machines: snap.machines.map((m) => ({
        id: m.id.toString(),
        type: toMachineType(m.cutMachineType),
      })),
      laserAllowed: snap.laserAllowed,
      load,
      needWork,
    });
    if (picks.length === 0) return null;

    const seqOf = assignPullSeq(picks, snap, info, unitMeta);
    const created = await this.writePulledRows(tx, workshop, snap, picks, unitMeta, seqOf);
    const pulledPairs = new Set(
      created.map((c) => {
        const meta = snap.patterns.get(c.patternId.toString())!;
        return `${meta.piId}:${meta.materialId}`;
      }),
    );
    const gaps = await loadSteelGaps(tx, snap, [...pulledPairs]);
    return buildPullResult({ workshop, snap, created, gaps, machineName, idleStart, load });
  }

  /**
   * Lệnh đã "Bắt đầu" (có lệnh SX ACTIVE thuộc xưởng): chưa Bắt đầu hoặc đang tạm dừng thì không
   * kéo. Lệnh đang chờ KHSX "Đã kiểm" lại phương án cắt (vừa đổi xưởng) cũng không kéo vì kho chưa
   * được chuyển / xuất sắt.
   */
  private async loadStartedPis(
    tx: PrismaTx,
    workshopId: bigint,
    snap: Snapshot,
  ): Promise<Set<string>> {
    const started = await tx.productionOrder.findMany({
      where: {
        floorStage: ProductionOrderFloorStage.ACTIVE,
        productionInvoiceItem: {
          workshopId,
          productionInvoiceId: { in: snap.orders.map((o) => o.id) },
          productionInvoice: { cuttingRecheckRequired: false },
        },
      },
      select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
    });
    return new Set(
      started.flatMap((o) => {
        const id = o.productionInvoiceItem.productionInvoiceId;
        return id == null ? [] : [id.toString()];
      }),
    );
  }

  private async writePulledRows(
    tx: PrismaTx,
    workshop: WorkshopRef,
    snap: Snapshot,
    picks: PullPick[],
    unitMeta: Map<string, UnitMeta>,
    seqOf: Map<number, number>,
  ): Promise<AllocationRecord[]> {
    const created = await tx.cutAllocation.createManyAndReturn({
      data: picks.map((p, i) => {
        const u = unitMeta.get(p.unitKey)!;
        return {
          workshopId: workshop.id,
          workstationId: BigInt(p.machineId),
          productionInvoiceId: BigInt(u.meta.piId),
          cuttingProposalId: BigInt(u.meta.proposalId),
          patternId: BigInt(u.meta.patternId),
          machineClass: u.machineClass,
          barCount: p.bars,
          punchedSegments: u.machineClass === CutMachineClass.LASER ? u.punched : Prisma.DbNull,
          seq: seqOf.get(i)!,
          isManual: false,
          updatedById: null,
        };
      }),
    });
    await tx.cutAllocationLog.createMany({
      data: created.map((c) => ({
        workshopId: workshop.id,
        productionInvoiceId: c.productionInvoiceId,
        cutAllocationId: c.id,
        patternId: c.patternId,
        action: CutAllocationLogAction.AUTO_PULL,
        toWorkstationId: c.workstationId,
        barCount: c.barCount,
        isBundle: snap.patterns.get(c.patternId.toString())?.pattern.bundles != null,
        createdById: null,
      })),
    });
    return created;
  }

  // ─── Sửa tay ───────────────────────────────────────────────────────────────

  private async loadGuardedRow(tx: PrismaTx, id: bigint, workshopId: bigint) {
    const row = await tx.cutAllocation.findUnique({
      where: { id },
      include: ROW_GUARD_SELECT(workshopId),
    });
    if (!row) throw new NotFoundException('Không tìm thấy dòng chia máy');
    if (isGuardedRowStale(row)) throw new ConflictException(STALE_MESSAGE);
    return row;
  }

  /**
   * Số cây còn có thể thêm cho pattern của dòng (pattern.barCount − Σ barCount các dòng còn hiệu
   * lực).
   */
  private async freeBarsOfPattern(
    tx: PrismaTx,
    workshopId: bigint,
    patternId: bigint,
    patternBarCount: number,
  ): Promise<number> {
    const others = await tx.cutAllocation.findMany({
      where: { workshopId, patternId, workstation: { isActive: true } },
      select: { barCount: true },
    });
    return patternBarCount - others.reduce((s, r) => s + r.barCount, 0);
  }

  private async nextSeq(tx: PrismaTx, workstationId: bigint): Promise<number> {
    const agg = await tx.cutAllocation.aggregate({
      where: { workstationId },
      _max: { seq: true },
    });
    return (agg._max.seq ?? 0) + 1;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCutAllocationDto,
  ): Promise<CutAllocationBoard> {
    const rowId = parseBigIntId(id);
    if (dto.workstationId === undefined && dto.barCount === undefined) {
      throw new BadRequestException('Chọn máy hoặc số cây cần đổi');
    }
    const note = dto.note?.trim() || null;
    const workshop = await this.resolveRowWorkshop(userId, rowId);
    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `cut-allocation:${workshop.id}`);
      const row = await this.loadGuardedRow(tx, rowId, workshop.id);
      const data: Prisma.CutAllocationUncheckedUpdateInput = {
        isManual: true,
        updatedById: userId,
      };
      const logs: Prisma.CutAllocationLogUncheckedCreateInput[] = [];
      const logBase: LogBase = {
        workshopId: workshop.id,
        productionInvoiceId: row.productionInvoiceId,
        cutAllocationId: rowId,
        patternId: row.patternId,
        isBundle: row.pattern.bundles != null,
        reason: dto.reason ?? null,
        note,
        createdById: userId,
      };
      this.assertBundleEditAllowed(row, dto);
      if (dto.barCount !== undefined) {
        await this.applyBarCount(tx, workshop.id, row, dto.barCount, data, logs, logBase);
      }
      if (dto.workstationId !== undefined) {
        const target = parseBigIntId(dto.workstationId);
        await assertTargetMachine(tx, workshop, row.machineClass, target);
        if (target !== row.workstationId) {
          data.workstationId = target;
          data.seq = await this.nextSeq(tx, target);
          logs.push({
            ...logBase,
            action: CutAllocationLogAction.MOVE,
            fromWorkstationId: row.workstationId,
            toWorkstationId: target,
            barCount: dto.barCount ?? row.barCount,
          });
        }
      }
      await tx.cutAllocation.update({ where: { id: rowId }, data });
      if (logs.length > 0) await tx.cutAllocationLog.createMany({ data: logs });
    }, TX_OPTIONS);
    return this.buildBoard(this.prisma, workshop, []);
  }

  /** Dòng theo bó: không đổi số cây tay (đó là tách/gộp bó), đổi máy chỉ khi máy hư. */
  private assertBundleEditAllowed(row: GuardedRow, dto: UpdateCutAllocationDto): void {
    if (row.pattern.bundles == null) return;
    if (dto.barCount !== undefined && dto.barCount !== row.barCount) {
      throw new BadRequestException(BUNDLE_LOCKED_MESSAGE);
    }
    if (
      dto.workstationId !== undefined &&
      parseBigIntId(dto.workstationId) !== row.workstationId &&
      dto.reason !== CutAllocationChangeReason.MACHINE_BROKEN
    ) {
      throw new BadRequestException(BUNDLE_MOVE_REASON_MESSAGE);
    }
  }

  private async applyBarCount(
    tx: PrismaTx,
    workshopId: bigint,
    row: GuardedRow,
    barCount: number,
    data: Prisma.CutAllocationUncheckedUpdateInput,
    logs: Prisma.CutAllocationLogUncheckedCreateInput[],
    logBase: LogBase,
  ): Promise<void> {
    const free = await this.freeBarsOfPattern(tx, workshopId, row.patternId, row.pattern.barCount);
    const max = row.barCount + free;
    if (barCount > max) {
      throw new BadRequestException(
        `Số cây tối đa của dòng này là ${max} (kiểu cắt có ${row.pattern.barCount} cây)`,
      );
    }
    data.barCount = barCount;
    if (barCount !== row.barCount) {
      logs.push({
        ...logBase,
        action: CutAllocationLogAction.BARS,
        fromWorkstationId: row.workstationId,
        toWorkstationId: row.workstationId,
        barCount,
        previousBarCount: row.barCount,
      });
    }
  }

  async split(userId: string, id: string, dto: SplitCutAllocationDto): Promise<CutAllocationBoard> {
    const rowId = parseBigIntId(id);
    const targetId = parseBigIntId(dto.workstationId);
    const workshop = await this.resolveRowWorkshop(userId, rowId);
    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `cut-allocation:${workshop.id}`);
      const row = await this.loadGuardedRow(tx, rowId, workshop.id);
      const isBundle = row.pattern.bundles != null;
      // Kiểu cắt theo bó không tự tách: máy hư thì Đổi máy với lý do Máy hư.
      if (isBundle) throw new BadRequestException(BUNDLE_LOCKED_MESSAGE);
      if (dto.barCount < 1 || dto.barCount > row.barCount - 1) {
        throw new BadRequestException(
          `Số cây tách phải từ 1 đến ${row.barCount - 1} (dòng có ${row.barCount} cây)`,
        );
      }
      await assertTargetMachine(tx, workshop, row.machineClass, targetId);
      await tx.cutAllocation.update({
        where: { id: rowId },
        data: { barCount: row.barCount - dto.barCount, isManual: true, updatedById: userId },
      });
      const created = await tx.cutAllocation.create({
        data: {
          workshopId: row.workshopId,
          workstationId: targetId,
          productionInvoiceId: row.productionInvoiceId,
          cuttingProposalId: row.cuttingProposalId,
          patternId: row.patternId,
          machineClass: row.machineClass,
          barCount: dto.barCount,
          punchedSegments:
            row.punchedSegments === null
              ? Prisma.DbNull
              : (row.punchedSegments as Prisma.InputJsonValue),
          seq: await this.nextSeq(tx, targetId),
          isManual: true,
          updatedById: userId,
        },
      });
      // Mọi lần chia ra đều được thống kê lại.
      await tx.cutAllocationLog.create({
        data: {
          workshopId: row.workshopId,
          productionInvoiceId: row.productionInvoiceId,
          cutAllocationId: created.id,
          patternId: row.patternId,
          action: CutAllocationLogAction.SPLIT,
          fromWorkstationId: row.workstationId,
          toWorkstationId: targetId,
          barCount: dto.barCount,
          previousBarCount: row.barCount,
          isBundle,
          reason: dto.reason ?? null,
          note: dto.note?.trim() || null,
          createdById: userId,
        },
      });
    }, TX_OPTIONS);
    return this.buildBoard(this.prisma, workshop, []);
  }

  async reorder(userId: string, dto: ReorderCutAllocationDto): Promise<CutAllocationBoard> {
    const machineId = parseBigIntId(dto.workstationId);
    const machine = await this.prisma.workstation.findUnique({
      where: { id: machineId },
      select: { workshopId: true, kind: true, isActive: true },
    });
    if (
      !machine ||
      machine.kind !== WorkstationKind.CUT ||
      !machine.isActive ||
      machine.workshopId == null
    ) {
      throw new BadRequestException('Máy phải là máy cắt đang dùng của một xưởng');
    }
    const scope = await this.workshopScope.getScope(userId);
    if (scope.workshopId != null && scope.workshopId !== machine.workshopId) {
      throw this.scopeError(scope);
    }
    const workshop = await this.loadWorkshop(machine.workshopId);
    const wanted = dto.rowIds.map(parseBigIntId);
    if (new Set(wanted.map(String)).size !== wanted.length) {
      throw new BadRequestException('Danh sách dòng bị trùng');
    }

    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `cut-allocation:${workshop.id}`);
      const rows = await tx.cutAllocation.findMany({
        where: { workstationId: machineId },
        include: ROW_GUARD_SELECT(workshop.id),
      });
      const current = rows.filter((r) => !isGuardedRowStale(r));
      const currentIds = new Set(current.map((r) => r.id.toString()));
      const missing = [...currentIds].filter((x) => !wanted.some((w) => w.toString() === x));
      const extra = wanted.filter((w) => !currentIds.has(w.toString()));
      if (missing.length > 0 || extra.length > 0) {
        throw new BadRequestException(
          'Danh sách dòng phải đúng bằng các dòng đang có trên máy này (có dòng thiếu hoặc thừa, tải lại bảng)',
        );
      }
      const byId = new Map(current.map((r) => [r.id.toString(), r]));
      const updates: Array<{ id: bigint; seq: number }> = [];
      for (let i = 0; i < wanted.length; i++) {
        const row = byId.get(wanted[i].toString())!;
        if (row.seq !== i + 1) updates.push({ id: row.id, seq: i + 1 });
      }
      await this.setSeqBulk(tx, updates);
    }, TX_OPTIONS);
    return this.buildBoard(this.prisma, workshop, []);
  }

  async remove(userId: string, id: string): Promise<CutAllocationBoard> {
    const rowId = parseBigIntId(id);
    const workshop = await this.resolveRowWorkshop(userId, rowId);
    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `cut-allocation:${workshop.id}`);
      const row = await tx.cutAllocation.findUnique({
        where: { id: rowId },
        include: { pattern: { select: { bundles: true } } },
      });
      if (row) {
        await tx.cutAllocationLog.create({
          data: {
            workshopId: row.workshopId,
            productionInvoiceId: row.productionInvoiceId,
            cutAllocationId: row.id,
            patternId: row.patternId,
            action: CutAllocationLogAction.REMOVE,
            fromWorkstationId: row.workstationId,
            barCount: row.barCount,
            isBundle: row.pattern.bundles != null,
            createdById: userId,
          },
        });
      }
      await tx.cutAllocation.deleteMany({ where: { id: rowId } });
    }, TX_OPTIONS);
    return this.buildBoard(this.prisma, workshop, []);
  }

  // ─── Nhật ký điều chuyển ───────────────────────────────────────────────────

  /**
   * Nhật ký sửa tay của xưởng (cùng quyền/phạm vi xưởng với bảng): mặc định 30 ngày gần nhất, tối
   * đa 500 dòng, mới nhất trước; `byOrder` thống kê "lệnh có điều chuyển" theo số lần giảm dần.
   */
  async getLog(userId: string, query: CutAllocationLogQueryDto): Promise<CutAllocationLogResult> {
    const workshop = await this.resolveWorkshop(userId, query.workshopId);
    const range = resolveLogRange(query);
    const entries = await loadLogEntries(
      this.prisma,
      workshop.id,
      range,
      query.productionInvoiceId,
    );
    return { entries, byOrder: summarizeByOrder(entries) };
  }
}
