import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { StockLedgerRefType } from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { loadLenhDisplayCodes } from '../../common/utils/lenh-code.util';
import { segmentCodeLabel } from '../../common/utils/segment-code.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { isSegmentStockEnabled } from '../segment-stock/segment-stock.config';
import { SegmentProductionService } from '../segment-stock/segment-production.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { ProductionBatchesService } from './production-batches.service';

const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';
const LEGACY_REF = 'SEGMENT_LEGACY_CONVERSION';
/** Kho ảo "Cân đối tồn kho" - đối ứng của bút toán chỉnh tay / kiểm kê (đưa số cũ về 0 cũng là chỉnh). */
const ADJUST_WAREHOUSE_CODE = 'OPENING_BALANCE';
const OLD_CONSUME_KEY_PREFIX = 'production-batch-segment-consume:';
const round4 = (n: number) => Math.round(n * 1e4) / 1e4 + 0;

export interface LegacyCellReport {
  warehouseName: string;
  segmentLabel: string;
  /** Tồn cũ trước khi đưa về 0 (âm = phần Hàn / Sơn đã trừ theo cách cũ; dương = chỉnh tay / kiểm kê cũ). */
  oldQty: number;
}

export interface LegacyOrderReport {
  productionInvoiceId: string;
  lenhCode: string;
  closed: boolean;
  /** Phía cộng: số đoạn đủ công đoạn + KCS đạt đưa vào tồn (giữ cho lệnh + dư). */
  producedQty: number;
  /** Phía trừ phát lại: số đoạn các đợt Hàn / Sơn cũ cần / đã lấy được / còn thiếu. */
  neededQty: number;
  takenQty: number;
  shortageQty: number;
}

export interface LegacyConversionReport {
  dryRun: boolean;
  zeroedCells: LegacyCellReport[];
  orders: LegacyOrderReport[];
  replayedBatches: number;
  totals: { producedQty: number; neededQty: number; takenQty: number; shortageQty: number };
}

/** Lỗi nội bộ để rollback lượt xem thử mà vẫn trả báo cáo. */
class DryRunRollback extends Error {
  constructor(readonly report: LegacyConversionReport) {
    super('dry-run rollback');
  }
}

/**
 * Chuyển đổi dữ liệu tồn đoạn cũ sang tồn đoạn theo lệnh (anh Nhân 13/11/2026 câu 10: tồn không được âm, số âm cũ sửa lại theo
 * nguyên tắc mới). Cả lượt chạy trong 1 transaction; xem thử (dryRun) chạy y hệt rồi rollback.
 *  1. Đưa mọi ô tồn đoạn cũ (trừ kho ảo PRODUCTION / OPENING_BALANCE) về 0 bằng bút toán ADJUST - số âm cũ là phần Hàn / Sơn trừ theo cách cũ vào dòng
 *     trơn. Ô dương cũ (chỉnh tay) cũng về 0: tồn đoạn từ nay chỉ vào qua KCS + kiểm kê đoạn.
 *  2. Phía cộng cho mọi lệnh chưa kết thúc (SegmentProductionService.recomputeInTx): đoạn đủ công đoạn + KCS đạt vào tồn.
 *  3. Phát lại phía trừ theo MÃ ĐOẠN cho các đợt Hàn / Sơn cũ đã trừ đoạn (có bút toán SEGMENT_CONSUME khoá cũ) của lệnh chưa kết
 *     thúc. Thiếu không ghi sổ báo vượt - trả trong báo cáo.
 * Chỉ chạy được khi chưa có dữ liệu tồn đoạn theo lệnh (bảng giữ đoạn / phía cộng còn trống) - chạy 1 lần trước khi dùng thật.
 */
@Injectable()
export class SegmentLegacyConversionService {
  private readonly logger = new Logger(SegmentLegacyConversionService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedger: StockLedgerService,
    private readonly segmentProduction: SegmentProductionService,
    private readonly productionBatches: ProductionBatchesService,
  ) {}

  async run(opts: { dryRun: boolean; actorId: string }): Promise<LegacyConversionReport> {
    if (!opts.dryRun && !isSegmentStockEnabled()) {
      throw new ConflictException(
        'Tồn đoạn theo lệnh chưa bật (SEGMENT_STOCK_ENABLED) - bật trước khi chuyển đổi thật',
      );
    }
    try {
      const report = await this.prisma.$transaction((tx) => this.convert(tx, opts), {
        maxWait: 10_000,
        timeout: 600_000,
      });
      this.logger.log(
        `Đã chuyển đổi tồn đoạn cũ: ${report.zeroedCells.length} ô về 0, ${report.orders.length} lệnh, ${report.replayedBatches} đợt trừ lại`,
      );
      return report;
    } catch (e) {
      if (e instanceof DryRunRollback) return e.report;
      throw e;
    }
  }

  private async convert(
    tx: PrismaTx,
    opts: { dryRun: boolean; actorId: string },
  ): Promise<LegacyConversionReport> {
    await lockBusinessKey(tx, 'segment-legacy-conversion');
    const [reservations, productions] = await Promise.all([
      tx.segmentReservation.count(),
      tx.segmentProduction.count(),
    ]);
    if (reservations + productions > 0) {
      throw new ConflictException(
        'Đã có dữ liệu tồn đoạn theo lệnh - chuyển đổi chỉ chạy 1 lần trên dữ liệu cũ (dùng "Tính lại" từng lệnh để sửa lệch)',
      );
    }
    const [productionWh, adjustWh] = await Promise.all([
      tx.warehouse.findUniqueOrThrow({
        where: { code: PRODUCTION_WAREHOUSE_CODE },
        select: { id: true },
      }),
      tx.warehouse.findUniqueOrThrow({
        where: { code: ADJUST_WAREHOUSE_CODE },
        select: { id: true },
      }),
    ]);

    // 1. Ô cũ về 0.
    const quants = await tx.stockQuant.findMany({
      where: {
        segmentSpecId: { not: null },
        warehouseId: { notIn: [productionWh.id, adjustWh.id] },
        NOT: { qty: 0 },
      },
      select: {
        warehouseId: true,
        segmentSpecId: true,
        segmentSteps: true,
        qty: true,
        warehouse: { select: { name: true } },
        segmentSpec: { select: { cutLengthMm: true, material: { select: { code: true } } } },
      },
      orderBy: [{ warehouseId: 'asc' }, { segmentSpecId: 'asc' }, { segmentSteps: 'asc' }],
    });
    const zeroedCells: LegacyCellReport[] = [];
    for (const q of quants) {
      const qty = Number(q.qty);
      const label = q.segmentSpec
        ? segmentCodeLabel(
            q.segmentSpec.material.code,
            Number(q.segmentSpec.cutLengthMm),
            q.segmentSteps,
          )
        : String(q.segmentSpecId);
      await this.stockLedger.postEntry(
        {
          fromWarehouseId: qty > 0 ? q.warehouseId : adjustWh.id,
          toWarehouseId: qty > 0 ? adjustWh.id : q.warehouseId,
          segmentSpecId: q.segmentSpecId!,
          segmentSteps: q.segmentSteps,
          qty: Math.abs(qty),
          refType: StockLedgerRefType.ADJUST,
          refId: LEGACY_REF,
          note: `Chuyển đổi tồn đoạn theo lệnh: đưa tồn cũ ${qty} về 0 (tính lại từ KCS + đợt Hàn / Sơn)`,
          createdById: opts.actorId,
        },
        tx,
      );
      zeroedCells.push({ warehouseName: q.warehouse.name, segmentLabel: label, oldQty: qty });
    }

    // 2. Phía cộng mọi lệnh có lệnh SX.
    const orderRows = await tx.productionOrder.findMany({
      select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
    });
    const piIds = [
      ...new Set(
        orderRows
          .map((o) => o.productionInvoiceItem.productionInvoiceId)
          .filter((id): id is bigint => id != null)
          .map((id) => id.toString()),
      ),
    ]
      .map((s) => BigInt(s))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const byPi = new Map<string, LegacyOrderReport>();
    const codes = await loadLenhDisplayCodes(tx, piIds);
    for (const piId of piIds) {
      const res = await this.segmentProduction.recomputeInTx(tx, piId, {
        actorId: opts.actorId,
        reason: LEGACY_REF,
      });
      byPi.set(piId.toString(), {
        productionInvoiceId: piId.toString(),
        lenhCode: codes.get(piId.toString()) ?? piId.toString(),
        closed: res === null,
        producedQty: res ? round4(res.changes.reduce((n, c) => n + c.ledgerQty, 0)) : 0,
        neededQty: 0,
        takenQty: 0,
        shortageQty: 0,
      });
    }

    // 3. Phát lại phía trừ cho đợt cũ đã trừ đoạn (khoá cũ "production-batch-segment-consume:{đợt}:{cỡ}").
    const oldEntries = await tx.stockLedger.findMany({
      where: {
        refType: StockLedgerRefType.SEGMENT_CONSUME,
        idempotencyKey: { startsWith: OLD_CONSUME_KEY_PREFIX },
      },
      select: { refId: true },
      distinct: ['refId'],
    });
    const batchIds = oldEntries
      .map((e) => e.refId)
      .filter((id): id is string => !!id && /^\d+$/.test(id))
      .map((id) => BigInt(id))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    let replayedBatches = 0;
    for (const batchId of batchIds) {
      const exists = await tx.productionBatch.findUnique({
        where: { id: batchId },
        select: {
          productionOrder: {
            select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
          },
        },
      });
      const piKey = exists?.productionOrder.productionInvoiceItem.productionInvoiceId?.toString();
      const order = piKey ? byPi.get(piKey) : undefined;
      if (!order || order.closed) continue;
      const r = await this.productionBatches.replayLegacySegmentConsume(tx, batchId, opts.actorId);
      order.neededQty = round4(order.neededQty + r.neededQty);
      order.takenQty = round4(order.takenQty + r.takenQty);
      order.shortageQty = round4(order.shortageQty + r.shortageQty);
      replayedBatches += 1;
    }

    const orders = [...byPi.values()].filter(
      (o) => o.closed || o.producedQty !== 0 || o.neededQty !== 0,
    );
    const sum = (f: (o: LegacyOrderReport) => number) =>
      round4(orders.reduce((n, o) => n + f(o), 0));
    const report: LegacyConversionReport = {
      dryRun: opts.dryRun,
      zeroedCells,
      orders,
      replayedBatches,
      totals: {
        producedQty: sum((o) => o.producedQty),
        neededQty: sum((o) => o.neededQty),
        takenQty: sum((o) => o.takenQty),
        shortageQty: sum((o) => o.shortageQty),
      },
    };
    if (opts.dryRun) throw new DryRunRollback(report);
    return report;
  }
}
