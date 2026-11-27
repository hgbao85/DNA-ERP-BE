import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SegmentReservationLogKind,
  StockLedgerRefType,
  WarehouseKind,
} from '../../generated/prisma/client';
import { isStageHandoverEnabled } from '../stage-handover/stage-handover.config';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import {
  compareSegmentCodes,
  isNormalizedSegmentSteps,
  segmentBucketLockKey,
  segmentCodeKey,
  segmentCodeLabel,
  segmentProductionLockKey,
  segmentStepsLabel,
} from '../../common/utils/segment-code.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { SegmentBalanceResponseDto } from './dto/segment-balance-response.dto';
import {
  SegmentHoldingWarehouseDto,
  SegmentOrderHoldingLogDto,
  SegmentOrderHoldingRowDto,
  SegmentOrderHoldingsResponseDto,
} from './dto/segment-order-holdings-response.dto';
import type {
  AllocateSurplusInput,
  AllocateSurplusResult,
  ConsumeForOrderInput,
  ConsumeForOrderResult,
  HandoverOrderHoldingsInput,
  HandoverOrderHoldingsResult,
  OrderCellState,
  ReleaseOrderHoldingsInput,
  ReleaseOrderHoldingsResult,
  SegmentSyncChange,
  SyncOrderProductionInput,
  SyncOrderProductionResult,
  TransferOrderHoldingsInput,
  TransferOrderHoldingsResult,
} from './segment-stock.types';

/** Kho ảo sản xuất - cùng hằng PRODUCTION_WAREHOUSE_CODE ở material-issues.service.ts (đoạn từ đây vào kho Phôi / từ kho Phôi ra đây). */
const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';

/** Số đoạn lưu Decimal(16,4): làm tròn 4 số lẻ sau mỗi phép tính để float không để lại phần dư 1e-12. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4 + 0; // "+ 0" đổi -0 thành 0
const EPS = 1e-9;

/** refType nhật ký giữ đoạn khi phương án cắt lấy đoạn dư trong kho (câu 14a, 24/11/2026) - refId = id phương án. */
export const CUTTING_PROPOSAL_SEGMENT_REF = 'CUTTING_PROPOSAL';

/** Số nhật ký tối đa trả về ở getOrderHoldings. */
const ORDER_LOG_LIMIT = 100;

/** Trạng thái 1 ô (kho, mã đoạn) đọc SAU khi khoá: q = tồn, held = Σ còn giữ mọi lệnh, surplus = max(0, q - held) = dư dùng được. */
interface CellState {
  q: number;
  held: number;
  surplus: number;
}

interface CellRef {
  warehouseId: bigint;
  segmentSpecId: bigint;
  segmentSteps: string;
}

interface ReservationLogInput {
  kind: SegmentReservationLogKind;
  qty: number;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  actorId?: string | null;
}

function assertSegmentSteps(segmentSteps: string): void {
  if (!isNormalizedSegmentSteps(segmentSteps)) {
    throw new BadRequestException(`Bộ công đoạn '${segmentSteps}' không đúng dạng mã đoạn`);
  }
}

function assertQty(qty: number, label: string, allowZero: boolean): void {
  if (!Number.isFinite(qty) || (allowZero ? qty < 0 : qty <= 0)) {
    throw new BadRequestException(
      `${label} phải là số hữu hạn ${allowZero ? 'không âm' : 'lớn hơn 0'} (nhận ${qty})`,
    );
  }
}

/** Thứ tự cố định khi khoá nhiều ô: kho tăng dần, rồi mã đoạn - 2 transaction cùng khoá nhiều ô không khoá chéo nhau. */
function compareCells(a: CellRef, b: CellRef): number {
  if (a.warehouseId !== b.warehouseId) return a.warehouseId < b.warehouseId ? -1 : 1;
  return compareSegmentCodes(a, b);
}

const cellKey = (c: CellRef): string =>
  `${c.warehouseId.toString()}|${segmentCodeKey(c.segmentSpecId, c.segmentSteps)}`;

/**
 * Tồn đoạn kho Phôi theo MÃ ĐOẠN và giữ đoạn theo LỆNH (13/11/2026) - mô hình 1 ô (kho, mã đoạn) xem segment-stock.types.ts:
 * tồn = stock_quant.qty; còn giữ = Σ (reservedQty - consumedQty) của mọi lệnh; dư = tồn - còn giữ.
 * Mọi hàm ghi chạy TRONG transaction của caller (`tx`) và khoá advisory từng ô trước khi đọc / ghi (segmentBucketLockKey).
 */
@Injectable()
export class SegmentStockService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
  ) {}

  // ---------------------------------------------------------------------------
  // Dùng chung
  // ---------------------------------------------------------------------------

  /** Khoá ô rồi đọc trạng thái (BẮT BUỘC theo thứ tự này). ownRemaining(lệnh) = còn giữ (reserved - consumed) của 1 lệnh, 0 nếu chưa có dòng. */
  private async lockAndReadCell(
    tx: PrismaTx,
    cell: CellRef,
  ): Promise<{ state: CellState; ownRemaining: (productionInvoiceId: bigint) => number }> {
    await lockBusinessKey(
      tx,
      segmentBucketLockKey(cell.warehouseId, cell.segmentSpecId, cell.segmentSteps),
    );
    const quant = await tx.stockQuant.findFirst({
      where: {
        warehouseId: cell.warehouseId,
        segmentSpecId: cell.segmentSpecId,
        segmentSteps: cell.segmentSteps,
      },
      select: { qty: true },
    });
    const reservations = await tx.segmentReservation.findMany({
      where: {
        warehouseId: cell.warehouseId,
        segmentSpecId: cell.segmentSpecId,
        segmentSteps: cell.segmentSteps,
      },
      select: {
        productionInvoiceId: true,
        cuttingProposalId: true,
        reservedQty: true,
        consumedQty: true,
      },
    });
    const q = quant ? quant.qty.toNumber() : 0;
    const remainingByOrder = new Map<string, number>();
    let held = 0;
    for (const r of reservations) {
      const remaining = round4(r.reservedQty.toNumber() - r.consumedQty.toNumber());
      held += remaining;
      // Dòng giữ của phương án tính trước (chưa có lệnh) cũng trừ khỏi dư - nghiệp vụ 26/11 câu 4.
      if (r.productionInvoiceId != null) {
        remainingByOrder.set(r.productionInvoiceId.toString(), remaining);
      }
    }
    held = round4(held);
    return {
      state: { q, held, surplus: Math.max(0, round4(q - held)) },
      ownRemaining: (id) => remainingByOrder.get(id.toString()) ?? 0,
    };
  }

  private async productionWarehouseId(tx: PrismaTx): Promise<bigint> {
    const wh = await tx.warehouse.findUniqueOrThrow({ where: { code: PRODUCTION_WAREHOUSE_CODE } });
    return wh.id;
  }

  /**
   * Cộng `delta` (có dấu) vào dòng giữ đoạn của lệnh (tạo nếu chưa có) rồi ghi nhật ký. Trả id dòng giữ.
   *
   * KHÔNG dùng upsert: Postgres kiểm CHECK segment_reservations_qty_chk trên bộ giá trị "tạo mới" của INSERT ... ON CONFLICT
   * ngay cả khi rơi vào nhánh cập nhật - Hàn dùng 8 đoạn của dòng đã giữ 10 (tạo mới = giữ 0, dùng 8) hay tính lại giảm phần
   * giữ (tạo mới = giữ âm) bị chặn oan (bắt được khi thử trên DB thật 13/11). Caller đã giữ khoá ô nên đọc rồi ghi không đua.
   */
  private async bumpReservation(
    tx: PrismaTx,
    cell: CellRef,
    productionInvoiceId: bigint,
    delta: { reserved?: number; consumed?: number },
    logs: ReservationLogInput[],
  ): Promise<bigint> {
    const reserved = delta.reserved ?? 0;
    const consumed = delta.consumed ?? 0;
    const existing = await tx.segmentReservation.findUnique({
      where: {
        warehouseId_productionInvoiceId_segmentSpecId_segmentSteps: {
          warehouseId: cell.warehouseId,
          productionInvoiceId,
          segmentSpecId: cell.segmentSpecId,
          segmentSteps: cell.segmentSteps,
        },
      },
      select: { id: true },
    });
    const row = existing
      ? await tx.segmentReservation.update({
          where: { id: existing.id },
          data: {
            ...(reserved !== 0 ? { reservedQty: { increment: reserved } } : {}),
            ...(consumed !== 0 ? { consumedQty: { increment: consumed } } : {}),
          },
          select: { id: true },
        })
      : await tx.segmentReservation.create({
          data: {
            warehouseId: cell.warehouseId,
            productionInvoiceId,
            segmentSpecId: cell.segmentSpecId,
            segmentSteps: cell.segmentSteps,
            reservedQty: reserved,
            consumedQty: consumed,
          },
          select: { id: true },
        });
    for (const l of logs) {
      await tx.segmentReservationLog.create({
        data: {
          reservationId: row.id,
          kind: l.kind,
          qty: l.qty,
          refType: l.refType ?? null,
          refId: l.refId ?? null,
          note: l.note ?? null,
          createdById: l.actorId ?? null,
        },
      });
    }
    return row.id;
  }

  // ---------------------------------------------------------------------------
  // Phía cộng
  // ---------------------------------------------------------------------------

  /**
   * Phía cộng: đưa số ĐÍCH (giữ cho lệnh + dư) của lệnh vào sổ kho + giữ đoạn, chỉ ghi PHẦN CHÊNH so với lần ghi trước
   * (SegmentProduction) nên tính lại nhiều lần không cộng đôi. Caller (SegmentProductionService) đã giữ khoá lệnh
   * segmentProductionLockKey; hàm này khoá thêm từng ô theo thứ tự cố định.
   *
   * Với mỗi mã có before (h0, s0) khác đích (h1, s1), sau khi khoá ô đọc q (tồn), a (dư dùng được), r (còn giữ của lệnh):
   *  - x = đổi phần giữ, L = đổi tồn (số đoạn ghi sổ); giảm bị chặn để tồn không âm, không nhả quá phần lệnh còn giữ (phần đã
   *    dùng không lấy lại được), không lấy dư đã chia cho lệnh khác, không để surplus âm; tăng giữ nhiều hơn số đoạn vào thêm
   *    thì phần chênh lấy từ dư còn lại.
   *  - Phần chưa ghi được trả ở unappliedHeldQty / unappliedSurplusQty.
   */
  async syncOrderProduction(
    tx: PrismaTx,
    input: SyncOrderProductionInput,
  ): Promise<SyncOrderProductionResult> {
    const { productionInvoiceId } = input;
    const targetByKey = new Map<
      string,
      { segmentSpecId: bigint; segmentSteps: string; h: number; s: number }
    >();
    for (const t of input.targets) {
      assertSegmentSteps(t.segmentSteps);
      assertQty(t.heldQty, 'heldQty', true);
      assertQty(t.surplusQty, 'surplusQty', true);
      const key = segmentCodeKey(t.segmentSpecId, t.segmentSteps);
      if (targetByKey.has(key)) {
        throw new BadRequestException(
          `Mã đoạn ${key} bị trùng trong danh sách đích của lệnh ${productionInvoiceId}`,
        );
      }
      targetByKey.set(key, {
        segmentSpecId: t.segmentSpecId,
        segmentSteps: t.segmentSteps,
        h: round4(t.heldQty),
        s: round4(t.surplusQty),
      });
    }

    const existing = await tx.segmentProduction.findMany({ where: { productionInvoiceId } });
    const existingByKey = new Map(
      existing.map((p) => [segmentCodeKey(p.segmentSpecId, p.segmentSteps), p] as const),
    );

    // Tập mã = đích ∪ mã đã có dòng (mã không còn trong đích = đích 0/0). Kho: dòng đã có thì kho của dòng, chưa có thì kho của lệnh.
    const keys = new Set<string>([...targetByKey.keys(), ...existingByKey.keys()]);
    const plan = [...keys].map((key) => {
      const prev = existingByKey.get(key);
      const target = targetByKey.get(key);
      const segmentSpecId = (prev?.segmentSpecId ?? target?.segmentSpecId) as bigint;
      const segmentSteps = (prev?.segmentSteps ?? target?.segmentSteps) as string;
      return {
        warehouseId: prev ? prev.warehouseId : input.warehouseId,
        segmentSpecId,
        segmentSteps,
        h0: prev ? prev.heldQty.toNumber() : 0,
        s0: prev ? prev.surplusQty.toNumber() : 0,
        h1: target?.h ?? 0,
        s1: target?.s ?? 0,
      };
    });
    plan.sort(compareCells);

    const changes: SegmentSyncChange[] = [];
    let productionWarehouse: bigint | null = null;

    // C4 (17/11): dư của lệnh còn ở kho Phôi CŨ (đổi xưởng). Tổng dư GIẢM thì trừ ở kho cũ trước (đúng nơi đoạn đang nằm), phần
    // dư còn ở kho cũ được trừ khỏi đích dư của dòng chính - dòng chính (kho mới) chỉ giữ phần dư ngoài phần đó.
    const leftovers = await tx.segmentProductionLeftover.findMany({
      where: { productionInvoiceId },
    });
    if (leftovers.length > 0) {
      // Khoá trước MỌI ô sắp đụng (kho cũ + kho của dòng chính) theo cùng 1 thứ tự cố định - không khoá chéo với lượt khác.
      // Khoá advisory trong transaction lấy lại được nhiều lần nên lockAndReadCell bên dưới không tự chờ mình.
      const cells = [...leftovers, ...plan].sort(compareCells);
      for (const c of cells) {
        await lockBusinessKey(
          tx,
          segmentBucketLockKey(c.warehouseId, c.segmentSpecId, c.segmentSteps),
        );
      }
      const keptByKey = new Map<string, number>();
      for (const lo of [...leftovers].sort(compareCells)) {
        const key = segmentCodeKey(lo.segmentSpecId, lo.segmentSteps);
        const targetSurplus = targetByKey.get(key)?.s ?? 0;
        const keptSoFar = keptByKey.get(key) ?? 0;
        const f0 = lo.surplusQty.toNumber();
        // Phần dư kho cũ còn được giữ = phần đích dư chưa được các dòng kho cũ trước đó "chiếm".
        const wantKeep = round4(Math.max(0, Math.min(f0, targetSurplus - keptSoFar)));
        let applied = 0;
        if (f0 - wantKeep > EPS) {
          const { state } = await this.lockAndReadCell(tx, lo);
          applied = round4(Math.min(f0 - wantKeep, state.surplus, Math.max(0, state.q)));
          if (applied > EPS) {
            productionWarehouse ??= await this.productionWarehouseId(tx);
            await this.stockLedgerService.postEntry(
              {
                fromWarehouseId: lo.warehouseId,
                toWarehouseId: productionWarehouse,
                segmentSpecId: lo.segmentSpecId,
                segmentSteps: lo.segmentSteps,
                qty: applied,
                refType: StockLedgerRefType.SEGMENT_PRODUCE,
                refId: productionInvoiceId.toString(),
                createdById: input.actorId ?? undefined,
                note: `Phía cộng tồn đoạn (${input.reason}): dư ở kho Phôi cũ (sau đổi xưởng) -${applied}`,
              },
              tx,
            );
          }
        }
        const f2 = round4(f0 - applied);
        keptByKey.set(key, round4(keptSoFar + f2));
        if (applied > EPS) {
          if (f2 > EPS) {
            await tx.segmentProductionLeftover.update({
              where: { id: lo.id },
              data: { surplusQty: f2 },
            });
          } else {
            await tx.segmentProductionLeftover.delete({ where: { id: lo.id } });
          }
          changes.push({
            warehouseId: lo.warehouseId,
            segmentSpecId: lo.segmentSpecId,
            segmentSteps: lo.segmentSteps,
            before: { heldQty: 0, surplusQty: f0 },
            target: { heldQty: 0, surplusQty: wantKeep },
            after: { heldQty: 0, surplusQty: f2 },
            ledgerQty: -applied,
            unappliedHeldQty: 0,
            unappliedSurplusQty: round4(wantKeep - f2),
          });
        }
      }
      for (const p of plan) {
        const kept = keptByKey.get(segmentCodeKey(p.segmentSpecId, p.segmentSteps)) ?? 0;
        p.s1 = round4(Math.max(0, p.s1 - kept));
      }
    }

    for (const p of plan) {
      if (Math.abs(p.h1 - p.h0) < EPS && Math.abs(p.s1 - p.s0) < EPS) continue;
      const cell: CellRef = p;
      const { state, ownRemaining } = await this.lockAndReadCell(tx, cell);
      const { q, surplus: a } = state;
      const r = ownRemaining(productionInvoiceId);

      const xWanted = round4(p.h1 - p.h0);
      const lWanted = round4(p.h1 + p.s1 - (p.h0 + p.s0));
      let x = Math.max(xWanted, -r);
      let l: number;
      if (lWanted >= 0) {
        l = lWanted;
      } else {
        // Rà soát 14/11 TĐ1: tổng của lệnh GIẢM thì không bao giờ nhập thêm đoạn. Trước đây khi phần giữ tăng (x > 0) mà dư dùng
        // được a không đủ, chặn "x - a" đẩy l lên DƯƠNG -> ghi SEGMENT_PRODUCE nhập đoạn không có thật. Nay l <= 0; phần giữ
        // không đủ dư để tăng thì kẹp ở dòng dưới (x <= l + a), phần chưa ghi được trả ở unapplied.
        l = Math.min(0, Math.max(lWanted, -Math.max(0, q), round4(x - a), round4(x - p.s0)));
      }
      x = round4(Math.min(x, round4(l + a)));
      l = round4(l);

      const h2 = round4(p.h0 + x);
      const s2 = round4(p.s0 + (l - x));
      if (h2 < -EPS || s2 < -EPS) {
        throw new BadRequestException(
          `Tính lại đoạn ${segmentCodeKey(p.segmentSpecId, p.segmentSteps)} của lệnh ${productionInvoiceId} ra số âm (giữ ${h2}, dư ${s2})`,
        );
      }

      if (Math.abs(l) > EPS) {
        productionWarehouse ??= await this.productionWarehouseId(tx);
        const surplusDelta = round4(l - x);
        await this.stockLedgerService.postEntry(
          {
            fromWarehouseId: l > 0 ? productionWarehouse : p.warehouseId,
            toWarehouseId: l > 0 ? p.warehouseId : productionWarehouse,
            segmentSpecId: p.segmentSpecId,
            segmentSteps: p.segmentSteps,
            qty: Math.abs(l),
            refType: StockLedgerRefType.SEGMENT_PRODUCE,
            refId: productionInvoiceId.toString(),
            createdById: input.actorId ?? undefined,
            note: `Phía cộng tồn đoạn (${input.reason}): giữ cho lệnh ${x >= 0 ? '+' : ''}${x}, dư ${surplusDelta >= 0 ? '+' : ''}${surplusDelta}`,
          },
          tx,
        );
      }
      if (Math.abs(x) > EPS) {
        await this.bumpReservation(tx, cell, productionInvoiceId, { reserved: x }, [
          {
            kind: SegmentReservationLogKind.PRODUCE,
            qty: x,
            refType: 'SEGMENT_PRODUCTION',
            refId: productionInvoiceId.toString(),
            note: input.reason,
            actorId: input.actorId,
          },
        ]);
      }
      await tx.segmentProduction.upsert({
        where: {
          productionInvoiceId_segmentSpecId_segmentSteps: {
            productionInvoiceId,
            segmentSpecId: p.segmentSpecId,
            segmentSteps: p.segmentSteps,
          },
        },
        create: {
          productionInvoiceId,
          segmentSpecId: p.segmentSpecId,
          segmentSteps: p.segmentSteps,
          warehouseId: p.warehouseId,
          heldQty: h2,
          surplusQty: s2,
        },
        update: { warehouseId: p.warehouseId, heldQty: h2, surplusQty: s2 },
      });

      changes.push({
        warehouseId: p.warehouseId,
        segmentSpecId: p.segmentSpecId,
        segmentSteps: p.segmentSteps,
        before: { heldQty: p.h0, surplusQty: p.s0 },
        target: { heldQty: p.h1, surplusQty: p.s1 },
        after: { heldQty: h2, surplusQty: s2 },
        ledgerQty: l,
        unappliedHeldQty: round4(p.h1 - h2),
        unappliedSurplusQty: round4(p.s1 - s2),
      });
    }

    return { productionInvoiceId, changes };
  }

  // ---------------------------------------------------------------------------
  // Phía trừ
  // ---------------------------------------------------------------------------

  /**
   * Phía trừ: lệnh dùng `qty` đoạn (Hàn / Sơn báo). Lấy trước từ phần lệnh còn giữ (trong giới hạn tồn thật), thiếu thì lấy thêm
   * từ dư chung của xưởng (ghi SURPLUS_IN rồi CONSUME), còn thiếu nữa thì trả shortageQty.
   *
   * Phần thiếu KHÔNG ghi sổ (tồn không được âm). Vì vậy khi taken = 0 không có bút toán nào, gọi lại cùng idempotencyKey sẽ
   * KHÔNG nhận ra là trùng và báo thiếu lần nữa - phía trừ phải tự chống trùng theo đợt báo (vd theo ProductionBatch.id).
   */
  async consumeForOrder(tx: PrismaTx, input: ConsumeForOrderInput): Promise<ConsumeForOrderResult> {
    assertSegmentSteps(input.segmentSteps);
    assertQty(input.qty, 'qty', false);

    if (input.idempotencyKey) {
      const dup = await tx.stockLedger.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (dup) {
        return { takenQty: 0, fromHeldQty: 0, fromSurplusQty: 0, shortageQty: 0, duplicate: true };
      }
    }

    const cell: CellRef = input;
    const { state, ownRemaining } = await this.lockAndReadCell(tx, cell);
    const r = ownRemaining(input.productionInvoiceId);
    const qty = round4(input.qty);
    const fromHeldQty = round4(Math.min(qty, r, Math.max(0, state.q)));
    const fromSurplusQty = round4(Math.min(qty - fromHeldQty, state.surplus));
    const takenQty = round4(fromHeldQty + fromSurplusQty);
    const shortageQty = round4(qty - takenQty);

    if (takenQty > 0) {
      const refType = input.ledgerRefType ?? StockLedgerRefType.SEGMENT_CONSUME;
      const logs: ReservationLogInput[] = [];
      if (fromSurplusQty > 0) {
        logs.push({
          kind: SegmentReservationLogKind.SURPLUS_IN,
          qty: fromSurplusQty,
          refType,
          refId: input.refId,
          note: input.note,
          actorId: input.actorId,
        });
      }
      logs.push({
        kind: SegmentReservationLogKind.CONSUME,
        qty: takenQty,
        refType,
        refId: input.refId,
        note: input.note,
        actorId: input.actorId,
      });
      await this.bumpReservation(
        tx,
        cell,
        input.productionInvoiceId,
        { reserved: fromSurplusQty, consumed: takenQty },
        logs,
      );
      const productionWarehouse = await this.productionWarehouseId(tx);
      await this.stockLedgerService.postEntry(
        {
          fromWarehouseId: input.warehouseId,
          toWarehouseId: productionWarehouse,
          segmentSpecId: input.segmentSpecId,
          segmentSteps: input.segmentSteps,
          qty: takenQty,
          refType,
          refId: input.refId,
          idempotencyKey: input.idempotencyKey,
          note: input.note,
          createdById: input.actorId ?? undefined,
        },
        tx,
      );
    }

    return { takenQty, fromHeldQty, fromSurplusQty, shortageQty, duplicate: false };
  }

  // ---------------------------------------------------------------------------
  // Giao nhận giữa tổ (24/11/2026)
  // ---------------------------------------------------------------------------

  /** Khoá ô rồi đọc phần của 1 lệnh (tồn, còn giữ của lệnh trong giới hạn tồn thật, dư dùng được) - cho phép giao lúc lập phiếu. */
  async lockAndReadOrderCell(
    tx: PrismaTx,
    cell: { warehouseId: bigint; segmentSpecId: bigint; segmentSteps: string },
    productionInvoiceId: bigint,
  ): Promise<OrderCellState> {
    assertSegmentSteps(cell.segmentSteps);
    const { state, ownRemaining } = await this.lockAndReadCell(tx, cell);
    return {
      onHandQty: state.q,
      ownRemainingQty: round4(
        Math.max(0, Math.min(ownRemaining(productionInvoiceId), Math.max(0, state.q))),
      ),
      surplusQty: state.surplus,
    };
  }

  /**
   * Giao nhận giữa tổ (24/11/2026, docs THIET-KE-GIAO-NHAN-GIUA-TO mục 3.2): kho Phôi giao `qty` đoạn của lệnh cho tổ nhận -
   * bút toán SEGMENT_HANDOVER kho Phôi -> kho tổ nhận, phần giữ của lệnh chuyển theo (kho Phôi giảm, kho nhận tăng) để Hàn / Sơn
   * trừ đoạn ở kho của mình (consumeForOrder). Lấy trước phần lệnh còn giữ, thiếu thì lấy dư của kho Phôi (ghi SURPLUS_IN như
   * consumeForOrder) - vẫn thiếu thì 409, KHÔNG ghi gì (giao là việc thủ kho đếm tay, không cho tồn âm).
   * Thứ tự khoá: khoá lệnh (segmentProductionLockKey, cùng phía cộng / đổi xưởng) rồi 2 ô theo compareCells. Chạy TRONG transaction
   * xác nhận phiếu (caller đã khoá phiếu + dòng lệnh). Idempotent theo idempotencyKey của bút toán.
   */
  async handoverOrderHoldings(
    tx: PrismaTx,
    input: HandoverOrderHoldingsInput,
  ): Promise<HandoverOrderHoldingsResult> {
    assertSegmentSteps(input.segmentSteps);
    assertQty(input.qty, 'qty', false);
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new BadRequestException('Kho giao và kho nhận đoạn không được trùng nhau');
    }
    const dup = await tx.stockLedger.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (dup) return { movedQty: 0, fromHeldQty: 0, fromSurplusQty: 0, duplicate: true };

    const { productionInvoiceId } = input;
    await lockBusinessKey(tx, segmentProductionLockKey(productionInvoiceId));
    const from: CellRef = {
      warehouseId: input.fromWarehouseId,
      segmentSpecId: input.segmentSpecId,
      segmentSteps: input.segmentSteps,
    };
    const to: CellRef = { ...from, warehouseId: input.toWarehouseId };
    const [first, second] = compareCells(from, to) <= 0 ? [from, to] : [to, from];
    await lockBusinessKey(
      tx,
      segmentBucketLockKey(first.warehouseId, first.segmentSpecId, first.segmentSteps),
    );
    await lockBusinessKey(
      tx,
      segmentBucketLockKey(second.warehouseId, second.segmentSpecId, second.segmentSteps),
    );
    const { state, ownRemaining } = await this.lockAndReadCell(tx, from);
    const qty = round4(input.qty);
    const fromHeldQty = round4(
      Math.max(0, Math.min(qty, ownRemaining(productionInvoiceId), Math.max(0, state.q))),
    );
    const fromSurplusQty = round4(Math.min(qty - fromHeldQty, state.surplus));
    if (round4(fromHeldQty + fromSurplusQty) + EPS < qty) {
      throw new ConflictException(
        `Kho Phôi chỉ còn ${round4(fromHeldQty + fromSurplusQty)} đoạn ${segmentStepsLabel(input.segmentSteps)} cho lệnh này (phần giữ của lệnh + dư) - không đủ giao ${qty}. Kiểm lại tồn đoạn rồi sửa số trên phiếu.`,
      );
    }
    const refType = StockLedgerRefType.SEGMENT_HANDOVER;
    const logs: ReservationLogInput[] = [];
    if (fromSurplusQty > 0) {
      logs.push({
        kind: SegmentReservationLogKind.SURPLUS_IN,
        qty: fromSurplusQty,
        refType,
        refId: input.refId,
        note: input.note,
        actorId: input.actorId,
      });
    }
    logs.push({
      kind: SegmentReservationLogKind.HANDOVER,
      qty: -qty,
      refType,
      refId: input.refId,
      note: input.note,
      actorId: input.actorId,
    });
    // Kho Phôi: phần dư lấy thêm vào giữ rồi giao cả số -> phần giữ giảm đúng fromHeldQty.
    await this.bumpReservation(
      tx,
      from,
      productionInvoiceId,
      { reserved: round4(fromSurplusQty - qty) },
      logs,
    );
    await this.stockLedgerService.postEntry(
      {
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        segmentSpecId: input.segmentSpecId,
        segmentSteps: input.segmentSteps,
        qty,
        refType,
        refId: input.refId,
        idempotencyKey: input.idempotencyKey,
        note: input.note ?? 'Giao đoạn cho tổ nhận theo phiếu XK',
        createdById: input.actorId ?? undefined,
      },
      tx,
    );
    await this.bumpReservation(tx, to, productionInvoiceId, { reserved: qty }, [
      {
        kind: SegmentReservationLogKind.HANDOVER,
        qty,
        refType,
        refId: input.refId,
        note: input.note,
        actorId: input.actorId,
      },
    ]);
    return { movedQty: qty, fromHeldQty, fromSurplusQty, duplicate: false };
  }

  // ---------------------------------------------------------------------------
  // Chia dư / nhả
  // ---------------------------------------------------------------------------

  /**
   * Nghiệp vụ câu 14a + mục 2 (24/11/2026): đọc dư dùng được (tồn - Σ còn giữ mọi lệnh) của nhiều ô trong 1 kho, KHÔNG khoá - dùng
   * lúc tính phương án cắt (trừ đoạn dư khỏi nhu cầu trước khi gửi bộ giải). Lúc duyệt mới khoá + giữ thật (allocateSurplusToOrder).
   * Khoá trả về `${segmentSpecId}|${segmentSteps}`.
   */
  async readSurplusMany(
    db: PrismaTx | PrismaServiceType,
    warehouseId: bigint,
    segmentSpecIds: bigint[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (segmentSpecIds.length === 0) return out;
    const [quants, reservations] = await Promise.all([
      db.stockQuant.findMany({
        where: { warehouseId, segmentSpecId: { in: segmentSpecIds } },
        select: { segmentSpecId: true, segmentSteps: true, qty: true },
      }),
      db.segmentReservation.findMany({
        where: { warehouseId, segmentSpecId: { in: segmentSpecIds } },
        select: { segmentSpecId: true, segmentSteps: true, reservedQty: true, consumedQty: true },
      }),
    ]);
    const key = (spec: bigint | null, steps: string | null) => `${spec}|${steps ?? ''}`;
    for (const q of quants) {
      if (q.segmentSpecId == null) continue;
      const k = key(q.segmentSpecId, q.segmentSteps);
      out.set(k, round4((out.get(k) ?? 0) + q.qty.toNumber()));
    }
    for (const r of reservations) {
      const k = key(r.segmentSpecId, r.segmentSteps);
      out.set(k, round4((out.get(k) ?? 0) - (r.reservedQty.toNumber() - r.consumedQty.toNumber())));
    }
    for (const [k, v] of out) if (v <= EPS) out.delete(k);
    return out;
  }

  /**
   * Đoạn dư lệnh (PI) đang giữ do PHƯƠNG ÁN CẮT lấy từ kho (câu 14a): Σ SURPLUS_IN refType CUTTING_PROPOSAL − Σ RELEASE cùng
   * refType, theo ô. Khoá `${segmentSpecId}|${segmentSteps}`. Dùng để: tính lại thì coi phần này là "có" (sắp được nhả khi phương
   * án mới thay), và trừ khỏi số cần cắt của lệnh.
   */
  async allocatedFromStockByPi(
    db: PrismaTx | PrismaServiceType,
    productionInvoiceId: bigint,
    /** Chỉ tính phần của các phương án này (review IT 26/11 mục 3.2: phương án sẽ bị thay lúc duyệt). Thiếu = mọi phương án. */
    cuttingProposalIds?: readonly bigint[],
  ): Promise<Map<string, { warehouseId: bigint; qty: number }>> {
    if (cuttingProposalIds && cuttingProposalIds.length === 0) return new Map();
    const logs = await db.segmentReservationLog.findMany({
      where: {
        refType: CUTTING_PROPOSAL_SEGMENT_REF,
        ...(cuttingProposalIds
          ? { refId: { in: cuttingProposalIds.map((id) => id.toString()) } }
          : {}),
        kind: { in: [SegmentReservationLogKind.SURPLUS_IN, SegmentReservationLogKind.RELEASE] },
        reservation: { productionInvoiceId },
      },
      select: {
        kind: true,
        qty: true,
        reservation: { select: { warehouseId: true, segmentSpecId: true, segmentSteps: true } },
      },
    });
    const out = new Map<string, { warehouseId: bigint; qty: number }>();
    for (const l of logs) {
      const k = `${l.reservation.segmentSpecId}|${l.reservation.segmentSteps}`;
      const cur = out.get(k) ?? { warehouseId: l.reservation.warehouseId, qty: 0 };
      const sign = l.kind === SegmentReservationLogKind.SURPLUS_IN ? 1 : -1;
      cur.qty = round4(cur.qty + sign * l.qty.toNumber());
      out.set(k, cur);
    }
    for (const [k, v] of out) if (v.qty <= EPS) out.delete(k);
    return out;
  }

  /**
   * Nhả phần đoạn dư 1 phương án cắt đã lấy từ kho (phương án bị thay khi Tính lại / huỷ SKU tính lại): còn giữ của mỗi ô giảm
   * min(phần phương án lấy chưa nhả, phần còn giữ), nhật ký RELEASE refType CUTTING_PROPOSAL. Idempotent. Không ghi sổ kho.
   */
  async releaseProposalAllocations(
    tx: PrismaTx,
    cuttingProposalId: bigint,
    actorId?: string | null,
  ): Promise<number> {
    const logs = await tx.segmentReservationLog.findMany({
      where: {
        refType: CUTTING_PROPOSAL_SEGMENT_REF,
        refId: cuttingProposalId.toString(),
        kind: { in: [SegmentReservationLogKind.SURPLUS_IN, SegmentReservationLogKind.RELEASE] },
      },
      select: {
        kind: true,
        qty: true,
        reservation: {
          select: {
            id: true,
            warehouseId: true,
            productionInvoiceId: true,
            segmentSpecId: true,
            segmentSteps: true,
          },
        },
      },
    });
    const net = new Map<
      string,
      { cell: CellRef & { id: bigint; pi: bigint | null }; qty: number }
    >();
    for (const l of logs) {
      const r = l.reservation;
      const cur = net.get(r.id.toString()) ?? {
        cell: { ...r, pi: r.productionInvoiceId },
        qty: 0,
      };
      cur.qty = round4(
        cur.qty + (l.kind === SegmentReservationLogKind.SURPLUS_IN ? 1 : -1) * l.qty.toNumber(),
      );
      net.set(r.id.toString(), cur);
    }
    const open = [...net.values()]
      .filter((v) => v.qty > EPS)
      .sort((a, b) => compareCells(a.cell, b.cell));
    let released = 0;
    for (const { cell, qty } of open) {
      await lockBusinessKey(
        tx,
        segmentBucketLockKey(cell.warehouseId, cell.segmentSpecId, cell.segmentSteps),
      );
      const fresh = await tx.segmentReservation.findUnique({
        where: { id: cell.id },
        select: { reservedQty: true, consumedQty: true },
      });
      if (!fresh) continue;
      const amount = round4(
        Math.min(qty, fresh.reservedQty.toNumber() - fresh.consumedQty.toNumber()),
      );
      if (amount <= EPS) continue;
      await tx.segmentReservation.update({
        where: { id: cell.id },
        data: { reservedQty: { decrement: amount } },
      });
      await tx.segmentReservationLog.create({
        data: {
          reservationId: cell.id,
          kind: SegmentReservationLogKind.RELEASE,
          qty: amount,
          refType: CUTTING_PROPOSAL_SEGMENT_REF,
          refId: cuttingProposalId.toString(),
          note: 'Phương án cắt bị thay - nhả đoạn dư đã lấy từ kho',
          createdById: actorId ?? null,
        },
      });
      released = round4(released + amount);
    }
    return released;
  }

  /**
   * Nghiệp vụ trả lời 26/11 câu 4: phương án cắt tính TRƯỚC khi có lệnh giữ đoạn dư ngay lúc tính - lệnh khác không thấy nữa. Dòng giữ
   * không có PI (productionInvoiceId null, cuttingProposalId = phương án), nhật ký SURPLUS_IN refType CUTTING_PROPOSAL như lúc duyệt.
   * Giữ tối đa bằng dư hiện có (đọc sau khoá ô). Nhả: releaseProposalAllocations; tạo lệnh: attachProposalHolds.
   */
  async holdForProposal(
    tx: PrismaTx,
    input: {
      warehouseId: bigint;
      segmentSpecId: bigint;
      segmentSteps: string;
      cuttingProposalId: bigint;
      qty: number;
      actorId?: string | null;
    },
  ): Promise<number> {
    assertSegmentSteps(input.segmentSteps);
    if (!(input.qty > 0)) return 0;
    const cell: CellRef = input;
    const { state } = await this.lockAndReadCell(tx, cell);
    const qty = round4(Math.min(input.qty, state.surplus));
    if (qty <= EPS) return 0;
    const existing = await tx.segmentReservation.findFirst({
      where: {
        warehouseId: cell.warehouseId,
        segmentSpecId: cell.segmentSpecId,
        segmentSteps: cell.segmentSteps,
        productionInvoiceId: null,
        cuttingProposalId: input.cuttingProposalId,
      },
      select: { id: true },
    });
    const row = existing
      ? await tx.segmentReservation.update({
          where: { id: existing.id },
          data: { reservedQty: { increment: qty } },
          select: { id: true },
        })
      : await tx.segmentReservation.create({
          data: {
            warehouseId: cell.warehouseId,
            productionInvoiceId: null,
            cuttingProposalId: input.cuttingProposalId,
            segmentSpecId: cell.segmentSpecId,
            segmentSteps: cell.segmentSteps,
            reservedQty: qty,
            consumedQty: 0,
          },
          select: { id: true },
        });
    await tx.segmentReservationLog.create({
      data: {
        reservationId: row.id,
        kind: SegmentReservationLogKind.SURPLUS_IN,
        qty,
        refType: CUTTING_PROPOSAL_SEGMENT_REF,
        refId: input.cuttingProposalId.toString(),
        note: 'Phương án cắt tính trước giữ đoạn dư trong kho ngay lúc tính',
        createdById: input.actorId ?? null,
      },
    });
    return qty;
  }

  /**
   * Tạo lệnh (PI) từ phương án tính trước: các dòng giữ của phương án gắn sang PI. Trùng ô với dòng giữ sẵn có của PI (hiếm - PI vừa
   * tạo) thì cộng dồn vào dòng của PI và chuyển nhật ký sang. Trả tổng đoạn đã gắn.
   */
  async attachProposalHolds(
    tx: PrismaTx,
    cuttingProposalId: bigint,
    productionInvoiceId: bigint,
  ): Promise<number> {
    const rows = await tx.segmentReservation.findMany({
      where: { cuttingProposalId, productionInvoiceId: null },
      select: {
        id: true,
        warehouseId: true,
        segmentSpecId: true,
        segmentSteps: true,
        reservedQty: true,
        consumedQty: true,
      },
    });
    let total = 0;
    for (const r of [...rows].sort(compareCells)) {
      await lockBusinessKey(
        tx,
        segmentBucketLockKey(r.warehouseId, r.segmentSpecId, r.segmentSteps),
      );
      const remaining = round4(r.reservedQty.toNumber() - r.consumedQty.toNumber());
      const target = await tx.segmentReservation.findUnique({
        where: {
          warehouseId_productionInvoiceId_segmentSpecId_segmentSteps: {
            warehouseId: r.warehouseId,
            productionInvoiceId,
            segmentSpecId: r.segmentSpecId,
            segmentSteps: r.segmentSteps,
          },
        },
        select: { id: true },
      });
      if (target) {
        await tx.segmentReservation.update({
          where: { id: target.id },
          data: { reservedQty: { increment: remaining } },
        });
        await tx.segmentReservationLog.updateMany({
          where: { reservationId: r.id },
          data: { reservationId: target.id },
        });
        await tx.segmentReservation.delete({ where: { id: r.id } });
      } else {
        await tx.segmentReservation.update({
          where: { id: r.id },
          data: { productionInvoiceId, cuttingProposalId: null },
        });
      }
      total = round4(total + remaining);
    }
    return total;
  }

  /** Chia chủ động `qty` đoạn từ cột dư của xưởng sang giữ cho 1 lệnh (tối đa bằng dư hiện có). Không ghi sổ kho (đoạn vẫn nằm trong kho). */
  async allocateSurplusToOrder(
    tx: PrismaTx,
    input: AllocateSurplusInput,
  ): Promise<AllocateSurplusResult> {
    assertSegmentSteps(input.segmentSteps);
    assertQty(input.qty, 'qty', false);
    const cell: CellRef = input;
    const { state } = await this.lockAndReadCell(tx, cell);
    const allocatedQty = round4(Math.min(input.qty, state.surplus));
    if (allocatedQty > 0) {
      await this.bumpReservation(tx, cell, input.productionInvoiceId, { reserved: allocatedQty }, [
        {
          kind: SegmentReservationLogKind.SURPLUS_IN,
          qty: allocatedQty,
          refType: input.refType,
          refId: input.refId,
          note: input.note,
          actorId: input.actorId,
        },
      ]);
    }
    return { allocatedQty, remainingSurplusQty: round4(state.surplus - allocatedQty) };
  }

  /**
   * Lệnh kết thúc: nhả mọi phần còn giữ về dư chung (reservedQty = consumedQty, nhật ký RELEASE). Idempotent. KHÔNG ghi sổ kho -
   * đoạn vẫn nằm trong kho, tự thành dư. SegmentProduction của lệnh chuyển phần vừa nhả từ giữ sang dư (rà soát 14/11 TĐ4).
   */
  async releaseOrderHoldings(
    tx: PrismaTx,
    input: ReleaseOrderHoldingsInput,
  ): Promise<ReleaseOrderHoldingsResult> {
    // Rà soát 14/11 TĐ6: khoá lệnh (cùng khoá "tính lại" SegmentProductionService.recomputeInTx giữ) TRƯỚC mọi khoá ô - không thì
    // lượt tính lại đã đọc SegmentProduction cũ ghi đè phần vừa chuyển giữ -> dư, hoặc tạo dòng giữ mới sau khi đã nhả.
    await lockBusinessKey(tx, segmentProductionLockKey(input.productionInvoiceId));
    const rows = await tx.segmentReservation.findMany({
      where: { productionInvoiceId: input.productionInvoiceId },
      select: {
        id: true,
        warehouseId: true,
        segmentSpecId: true,
        segmentSteps: true,
        reservedQty: true,
        consumedQty: true,
      },
    });
    const open = rows
      .filter((r) => r.reservedQty.toNumber() > r.consumedQty.toNumber())
      .sort(compareCells);

    let releasedQty = 0;
    let reservationCount = 0;
    for (const row of open) {
      await lockBusinessKey(
        tx,
        segmentBucketLockKey(row.warehouseId, row.segmentSpecId, row.segmentSteps),
      );
      // Đọc lại sau khoá: lượt khác có thể đã dùng / nhả phần này trong lúc chờ khoá.
      const fresh = await tx.segmentReservation.findUnique({
        where: { id: row.id },
        select: { reservedQty: true, consumedQty: true },
      });
      if (!fresh) continue;
      const consumed = fresh.consumedQty.toNumber();
      const remaining = round4(fresh.reservedQty.toNumber() - consumed);
      if (remaining <= 0) continue;
      await tx.segmentReservation.update({
        where: { id: row.id },
        data: { reservedQty: consumed },
      });
      await tx.segmentReservationLog.create({
        data: {
          reservationId: row.id,
          kind: SegmentReservationLogKind.RELEASE,
          qty: remaining,
          refType: input.reason,
          refId: input.productionInvoiceId.toString(),
          createdById: input.actorId ?? null,
        },
      });
      // Rà soát 14/11 TĐ4: phần vừa nhả chuyển từ "giữ" sang "dư" của lệnh trong SegmentProduction (tổng không đổi -> không ghi
      // sổ). Trước đây SegmentProduction vẫn ghi phần giữ cũ: QLSX mở lại lệnh thì tính lại thấy đích = số cũ, không giữ lại được
      // gì. Nay tính lại sau khi mở (ProductionOrdersService.startFloor) thấy phần giữ thiếu và lấy lại từ dư nếu còn.
      const production = await tx.segmentProduction.findUnique({
        where: {
          productionInvoiceId_segmentSpecId_segmentSteps: {
            productionInvoiceId: input.productionInvoiceId,
            segmentSpecId: row.segmentSpecId,
            segmentSteps: row.segmentSteps,
          },
        },
        select: { heldQty: true, surplusQty: true },
      });
      if (production) {
        const moved = round4(Math.min(remaining, production.heldQty.toNumber()));
        if (moved > 0) {
          await tx.segmentProduction.update({
            where: {
              productionInvoiceId_segmentSpecId_segmentSteps: {
                productionInvoiceId: input.productionInvoiceId,
                segmentSpecId: row.segmentSpecId,
                segmentSteps: row.segmentSteps,
              },
            },
            data: {
              heldQty: round4(production.heldQty.toNumber() - moved),
              surplusQty: round4(production.surplusQty.toNumber() + moved),
            },
          });
        }
      }
      releasedQty = round4(releasedQty + remaining);
      reservationCount += 1;
    }
    return { releasedQty, reservationCount };
  }

  /**
   * Đổi xưởng (nghiệp vụ 13/11/2026 câu 8: thủ kho không chỉnh tay - phần đã làm giữ nguyên, phần còn lại tính cho xưởng mới):
   * chuyển phần đoạn lệnh CÒN GIỮ ở kho Phôi khác sang kho Phôi xưởng mới - bút toán WAREHOUSE_TRANSFER kho cũ → kho mới, giữ
   * cho lệnh ở kho mới, nhật ký TRANSFER cả 2 dòng (kho cũ âm, kho mới dương). Phần đã dùng (consumedQty) ở lại kho cũ.
   *  - Kho cũ không đủ tồn thật cho phần còn giữ (dữ liệu cũ âm): chỉ chuyển phần có, phần còn lại nhả (RELEASE) để kho cũ không
   *    còn giữ ảo.
   *  - SegmentProduction của lệnh đổi sang kho mới để phía cộng lần sau ghi vào kho mới. Cột dư (đoạn cắt vượt) KHÔNG chuyển: dư
   *    là của chung xưởng cũ.
   * Idempotent: chạy lại không còn dòng giữ nào ở kho khác nên không làm gì. Chạy TRONG transaction đổi xưởng.
   */
  async transferOrderHoldings(
    tx: PrismaTx,
    input: TransferOrderHoldingsInput,
  ): Promise<TransferOrderHoldingsResult> {
    const { productionInvoiceId, toWarehouseId } = input;
    // Rà soát 14/11 TĐ6: khoá lệnh trước mọi khoá ô (cùng thứ tự "tính lại") - không thì lượt tính lại đọc dòng trước khi đổi xưởng
    // ghi warehouseId cũ đè lại.
    await lockBusinessKey(tx, segmentProductionLockKey(productionInvoiceId));
    // C4 (17/11): dòng phía cộng trỏ sang kho mới nhưng phần DƯ ở lại kho cũ -> tách vào SegmentProductionLeftover (đúng kho
    // cũ), dòng chính về dư 0. Đổi về lại đúng kho đã từng làm: phần dư để lại ở kho đó gộp ngược vào dòng chính.
    const productions = await tx.segmentProduction.findMany({ where: { productionInvoiceId } });
    for (const p of productions) {
      let surplus = p.surplusQty.toNumber();
      const moving = p.warehouseId !== toWarehouseId;
      if (moving && surplus > EPS) {
        await tx.segmentProductionLeftover.upsert({
          where: {
            productionInvoiceId_segmentSpecId_segmentSteps_warehouseId: {
              productionInvoiceId,
              segmentSpecId: p.segmentSpecId,
              segmentSteps: p.segmentSteps,
              warehouseId: p.warehouseId,
            },
          },
          create: {
            productionInvoiceId,
            segmentSpecId: p.segmentSpecId,
            segmentSteps: p.segmentSteps,
            warehouseId: p.warehouseId,
            surplusQty: surplus,
          },
          update: { surplusQty: { increment: surplus } },
        });
        surplus = 0;
      }
      const back = moving
        ? await tx.segmentProductionLeftover.findUnique({
            where: {
              productionInvoiceId_segmentSpecId_segmentSteps_warehouseId: {
                productionInvoiceId,
                segmentSpecId: p.segmentSpecId,
                segmentSteps: p.segmentSteps,
                warehouseId: toWarehouseId,
              },
            },
          })
        : null;
      if (back) {
        surplus = round4(surplus + back.surplusQty.toNumber());
        await tx.segmentProductionLeftover.delete({ where: { id: back.id } });
      }
      if (moving) {
        await tx.segmentProduction.update({
          where: { id: p.id },
          data: { warehouseId: toWarehouseId, surplusQty: surplus },
        });
      }
    }
    const rows = await tx.segmentReservation.findMany({
      where: {
        productionInvoiceId,
        warehouseId: { not: toWarehouseId },
        // Giao nhận giữa tổ (24/11/2026): đoạn đã giao nằm ở kho Hàn / Sơn của tổ nhận - đổi xưởng chỉ chuyển phần còn giữ ở kho
        // PHÔI cũ, không kéo đoạn đã giao (đang nằm thật ở kho tổ nhận) về kho Phôi mới. Tắt công tắc: như cũ.
        ...(isStageHandoverEnabled() ? { warehouse: { kind: WarehouseKind.PHOI } } : {}),
      },
      select: {
        id: true,
        warehouseId: true,
        segmentSpecId: true,
        segmentSteps: true,
        reservedQty: true,
        consumedQty: true,
      },
    });
    const open = rows
      .filter((r) => r.reservedQty.toNumber() > r.consumedQty.toNumber())
      .sort(compareCells);

    let movedQty = 0;
    let droppedQty = 0;
    let reservationCount = 0;
    for (const row of open) {
      const from: CellRef = row;
      const to: CellRef = { ...row, warehouseId: toWarehouseId };
      // Khoá 2 ô theo thứ tự cố định (compareCells) - đổi xưởng 2 lệnh ngược chiều không khoá chéo.
      const [first, second] = compareCells(from, to) <= 0 ? [from, to] : [to, from];
      await lockBusinessKey(
        tx,
        segmentBucketLockKey(first.warehouseId, first.segmentSpecId, first.segmentSteps),
      );
      await lockBusinessKey(
        tx,
        segmentBucketLockKey(second.warehouseId, second.segmentSpecId, second.segmentSteps),
      );
      const fresh = await tx.segmentReservation.findUnique({
        where: { id: row.id },
        select: { reservedQty: true, consumedQty: true },
      });
      if (!fresh) continue;
      const consumed = fresh.consumedQty.toNumber();
      const remaining = round4(fresh.reservedQty.toNumber() - consumed);
      if (remaining <= 0) continue;
      const quant = await tx.stockQuant.findFirst({
        where: {
          warehouseId: from.warehouseId,
          segmentSpecId: from.segmentSpecId,
          segmentSteps: from.segmentSteps,
        },
        select: { qty: true },
      });
      const moved = round4(Math.min(remaining, Math.max(0, quant ? quant.qty.toNumber() : 0)));
      const dropped = round4(remaining - moved);

      await tx.segmentReservation.update({
        where: { id: row.id },
        data: { reservedQty: consumed },
      });
      if (moved > 0) {
        await tx.segmentReservationLog.create({
          data: {
            reservationId: row.id,
            kind: SegmentReservationLogKind.TRANSFER,
            qty: -moved,
            refType: 'WORKSHOP_CHANGE',
            refId: input.refId,
            note: input.note ?? null,
            createdById: input.actorId ?? null,
          },
        });
        await this.stockLedgerService.postEntry(
          {
            fromWarehouseId: from.warehouseId,
            toWarehouseId,
            segmentSpecId: from.segmentSpecId,
            segmentSteps: from.segmentSteps,
            qty: moved,
            refType: StockLedgerRefType.WAREHOUSE_TRANSFER,
            refId: input.refId,
            note: input.note ?? 'Đổi xưởng: chuyển đoạn còn giữ của lệnh sang kho Phôi xưởng mới',
            createdById: input.actorId ?? undefined,
          },
          tx,
        );
        await this.bumpReservation(tx, to, productionInvoiceId, { reserved: moved }, [
          {
            kind: SegmentReservationLogKind.TRANSFER,
            qty: moved,
            refType: 'WORKSHOP_CHANGE',
            refId: input.refId,
            note: input.note,
            actorId: input.actorId,
          },
        ]);
      }
      if (dropped > 0) {
        await tx.segmentReservationLog.create({
          data: {
            reservationId: row.id,
            kind: SegmentReservationLogKind.RELEASE,
            qty: dropped,
            refType: 'WORKSHOP_CHANGE',
            refId: input.refId,
            note: 'Đổi xưởng: kho cũ không đủ tồn thật cho phần còn giữ - nhả phần thiếu',
            createdById: input.actorId ?? null,
          },
        });
      }
      movedQty = round4(movedQty + moved);
      droppedQty = round4(droppedQty + dropped);
      reservationCount += 1;
    }
    return { movedQty, droppedQty, reservationCount };
  }

  // ---------------------------------------------------------------------------
  // Đọc
  // ---------------------------------------------------------------------------

  /** Tra kho + cỡ đoạn (kèm sắt) theo lô id - 2 truy vấn cho cả danh sách, tránh N+1. */
  private async loadRefs(warehouseIds: bigint[], segmentSpecIds: bigint[]) {
    const [warehouses, specs] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.segmentSpec.findMany({
        where: { id: { in: segmentSpecIds } },
        select: {
          id: true,
          cutLengthMm: true,
          material: { select: { id: true, code: true, name: true } },
        },
      }),
    ]);
    return {
      warehouseById: new Map(warehouses.map((w) => [w.id.toString(), w] as const)),
      specById: new Map(specs.map((s) => [s.id.toString(), s] as const)),
    };
  }

  /**
   * Số dư theo ô (kho Phôi, cỡ đoạn, bộ công đoạn): mọi ô có dòng stock_quant hoặc có lệnh còn giữ > 0. surplusQty = tồn - còn
   * giữ, KHÔNG kẹp về 0 - dữ liệu cũ tồn âm phải lộ ra chứ không bị che.
   */
  async getBalances(query: {
    warehouseId?: bigint;
    materialId?: bigint;
    segmentSpecId?: bigint;
  }): Promise<SegmentBalanceResponseDto[]> {
    const specFilter = query.materialId ? { segmentSpec: { materialId: query.materialId } } : {};
    const [quants, reservations] = await Promise.all([
      this.prisma.stockQuant.findMany({
        where: {
          segmentSpecId: query.segmentSpecId ?? { not: null },
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
          ...specFilter,
        },
        select: { warehouseId: true, segmentSpecId: true, segmentSteps: true, qty: true },
      }),
      this.prisma.segmentReservation.findMany({
        where: {
          // Chỉ dòng còn giữ (reserved > consumed) - so 2 cột ngay trong DB, không tải dòng của lệnh đã dùng / nhả hết.
          reservedQty: { gt: this.prisma.segmentReservation.fields.consumedQty },
          ...(query.segmentSpecId ? { segmentSpecId: query.segmentSpecId } : {}),
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
          ...specFilter,
        },
        select: {
          warehouseId: true,
          segmentSpecId: true,
          segmentSteps: true,
          reservedQty: true,
          consumedQty: true,
        },
      }),
    ]);

    interface Cell extends CellRef {
      onHand: number;
      held: number;
      orders: number;
    }
    const cells = new Map<string, Cell>();
    const cellOf = (ref: CellRef): Cell => {
      const key = cellKey(ref);
      let c = cells.get(key);
      if (!c) {
        c = {
          warehouseId: ref.warehouseId,
          segmentSpecId: ref.segmentSpecId,
          segmentSteps: ref.segmentSteps,
          onHand: 0,
          held: 0,
          orders: 0,
        };
        cells.set(key, c);
      }
      return c;
    };
    for (const qr of quants) {
      if (qr.segmentSpecId === null) continue;
      cellOf({
        warehouseId: qr.warehouseId,
        segmentSpecId: qr.segmentSpecId,
        segmentSteps: qr.segmentSteps,
      }).onHand += qr.qty.toNumber();
    }
    for (const r of reservations) {
      const remaining = round4(r.reservedQty.toNumber() - r.consumedQty.toNumber());
      if (remaining <= 0) continue;
      const c = cellOf(r);
      c.held += remaining;
      c.orders += 1;
    }

    const list = [...cells.values()];
    if (list.length === 0) return [];
    const { warehouseById, specById } = await this.loadRefs(
      [...new Set(list.map((c) => c.warehouseId))],
      [...new Set(list.map((c) => c.segmentSpecId))],
    );

    const rows = list.flatMap((c) => {
      const wh = warehouseById.get(c.warehouseId.toString());
      const spec = specById.get(c.segmentSpecId.toString());
      if (!wh || !spec) return [];
      const cutLengthMm = spec.cutLengthMm.toNumber();
      const onHandQty = round4(c.onHand);
      const heldQty = round4(c.held);
      return [
        new SegmentBalanceResponseDto({
          warehouseId: wh.id.toString(),
          warehouseCode: wh.code,
          warehouseName: wh.name,
          segmentSpecId: spec.id.toString(),
          materialId: spec.material.id.toString(),
          materialCode: spec.material.code,
          materialName: spec.material.name,
          cutLengthMm,
          segmentSteps: c.segmentSteps,
          segmentStepsLabel: segmentStepsLabel(c.segmentSteps),
          label: segmentCodeLabel(spec.material.code, cutLengthMm, c.segmentSteps),
          onHandQty,
          heldQty,
          surplusQty: round4(onHandQty - heldQty),
          holdingOrderCount: c.orders,
        }),
      ];
    });
    rows.sort(
      (a, b) =>
        a.warehouseCode.localeCompare(b.warehouseCode) ||
        a.materialCode.localeCompare(b.materialCode) ||
        b.cutLengthMm - a.cutLengthMm ||
        a.segmentSteps.localeCompare(b.segmentSteps),
    );
    return rows;
  }

  /** Giữ đoạn của 1 lệnh theo từng mã đoạn (gộp cả mã mới chỉ có SegmentProduction) + 100 dòng nhật ký gần nhất. */
  async getOrderHoldings(productionInvoiceId: bigint): Promise<SegmentOrderHoldingsResponseDto> {
    const invoice = await this.prisma.productionInvoice.findUnique({
      where: { id: productionInvoiceId },
      select: { id: true, code: true },
    });
    if (!invoice) {
      throw new NotFoundException(`Không tìm thấy lệnh sản xuất ${productionInvoiceId}`);
    }
    const [reservations, productions, leftovers, logs] = await Promise.all([
      this.prisma.segmentReservation.findMany({ where: { productionInvoiceId } }),
      this.prisma.segmentProduction.findMany({ where: { productionInvoiceId } }),
      // C4: phần dư ở kho Phôi cũ sau đổi xưởng - hiện ở đúng ô kho cũ.
      this.prisma.segmentProductionLeftover.findMany({ where: { productionInvoiceId } }),
      this.prisma.segmentReservationLog.findMany({
        where: { reservation: { productionInvoiceId } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ORDER_LOG_LIMIT,
        include: {
          reservation: { select: { warehouseId: true, segmentSpecId: true, segmentSteps: true } },
        },
      }),
    ]);

    interface Row extends CellRef {
      reserved: number;
      consumed: number;
      producedHeld: number;
      producedSurplus: number;
    }
    const byKey = new Map<string, Row>();
    const rowOf = (c: CellRef): Row => {
      const key = cellKey(c);
      let row = byKey.get(key);
      if (!row) {
        row = {
          warehouseId: c.warehouseId,
          segmentSpecId: c.segmentSpecId,
          segmentSteps: c.segmentSteps,
          reserved: 0,
          consumed: 0,
          producedHeld: 0,
          producedSurplus: 0,
        };
        byKey.set(key, row);
      }
      return row;
    };
    for (const r of reservations) {
      const row = rowOf(r);
      row.reserved += r.reservedQty.toNumber();
      row.consumed += r.consumedQty.toNumber();
    }
    for (const p of productions) {
      const row = rowOf(p);
      row.producedHeld += p.heldQty.toNumber();
      row.producedSurplus += p.surplusQty.toNumber();
    }
    for (const lo of leftovers) {
      rowOf(lo).producedSurplus += lo.surplusQty.toNumber();
    }

    const rowList = [...byKey.values()];
    const { warehouseById, specById } = await this.loadRefs(
      [
        ...new Set([
          ...rowList.map((r) => r.warehouseId),
          ...logs.map((l) => l.reservation.warehouseId),
        ]),
      ],
      [
        ...new Set([
          ...rowList.map((r) => r.segmentSpecId),
          ...logs.map((l) => l.reservation.segmentSpecId),
        ]),
      ],
    );
    const labelOf = (specId: bigint, steps: string): string => {
      const spec = specById.get(specId.toString());
      return spec
        ? segmentCodeLabel(spec.material.code, spec.cutLengthMm.toNumber(), steps)
        : `#${specId} · ${segmentStepsLabel(steps)}`;
    };

    const rows = rowList.map((r) => {
      const wh = warehouseById.get(r.warehouseId.toString());
      const spec = specById.get(r.segmentSpecId.toString());
      return {
        warehouseCode: wh?.code ?? '',
        materialCode: spec?.material.code ?? '',
        cutLengthMm: spec?.cutLengthMm.toNumber() ?? 0,
        segmentSteps: r.segmentSteps,
        dto: new SegmentOrderHoldingRowDto({
          warehouse: new SegmentHoldingWarehouseDto({
            id: r.warehouseId.toString(),
            code: wh?.code ?? '',
            name: wh?.name ?? '',
          }),
          segmentSpecId: r.segmentSpecId.toString(),
          segmentSteps: r.segmentSteps,
          label: labelOf(r.segmentSpecId, r.segmentSteps),
          reservedQty: round4(r.reserved),
          consumedQty: round4(r.consumed),
          remainingQty: round4(r.reserved - r.consumed),
          producedHeldQty: round4(r.producedHeld),
          producedSurplusQty: round4(r.producedSurplus),
        }),
      };
    });
    rows.sort(
      (a, b) =>
        a.warehouseCode.localeCompare(b.warehouseCode) ||
        a.materialCode.localeCompare(b.materialCode) ||
        b.cutLengthMm - a.cutLengthMm ||
        a.segmentSteps.localeCompare(b.segmentSteps),
    );

    return new SegmentOrderHoldingsResponseDto({
      productionInvoiceId: invoice.id.toString(),
      productionInvoiceCode: invoice.code,
      rows: rows.map((r) => r.dto),
      logs: logs.map(
        (l) =>
          new SegmentOrderHoldingLogDto({
            id: l.id.toString(),
            kind: l.kind,
            qty: l.qty.toNumber(),
            warehouseId: l.reservation.warehouseId.toString(),
            segmentSpecId: l.reservation.segmentSpecId.toString(),
            segmentSteps: l.reservation.segmentSteps,
            label: labelOf(l.reservation.segmentSpecId, l.reservation.segmentSteps),
            refType: l.refType,
            refId: l.refId,
            note: l.note,
            createdAt: l.createdAt,
            createdById: l.createdById,
          }),
      ),
    });
  }
}
