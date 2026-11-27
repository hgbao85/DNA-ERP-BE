import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  IssueSlipLineKind,
  IssueSlipStatus,
  MfgStage,
  Prisma,
  ProductionBatchStatus,
  ProductionInvoiceStatus,
  StockLedgerRefType,
  TransferStatus,
  WarehouseKind,
} from '../../generated/prisma/client';
import { lockBusinessKey, lockBusinessKeyShared } from '../../common/utils/advisory-lock.util';
import { NOT_CANCELLED_ORDER } from '../../common/utils/cancelled-order.util';
import { loadLenhDisplayCodes } from '../../common/utils/lenh-code.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import {
  compareSegmentCodes,
  isNormalizedSegmentSteps,
  normalizeSegmentSteps,
  segmentBucketLockKey,
  segmentCodeKey,
  segmentCodeLabel,
  segmentProductionLockKey,
  segmentStepsLabel,
} from '../../common/utils/segment-code.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SEGMENT_LEGACY_CONVERSION_LOCK } from '../segment-stock/segment-stock.config';
import { SegmentStockService } from '../segment-stock/segment-stock.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { WarehouseLike, WorkshopWarehouseResolver } from '../stock/workshop-warehouse.util';
import { loadSteelUsage, steelReportLimitMm } from '../steel-issues/steel-usage.util';
import {
  CreateStageHandoverOverrideDto,
  HandoverKind,
  StageHandoverPlanQueryDto,
} from './dto/stage-handover.dto';
import {
  framePieceCap,
  PieceReceivedCap,
  SegmentPieceInput,
  segmentPieceCaps,
  segmentPool,
  SegmentPoolRow,
} from './stage-handover-caps.util';
import { isStageHandoverEnabled, PHOI_STEEL_TOLERANCE } from './stage-handover.config';
import { requireStageWarehouseOfPi } from './stage-handover-warehouse.util';

type Db = PrismaTx | PrismaServiceType;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4 + 0;
const EPS = 1e-9;
const pad = (n: bigint) => n.toString().padStart(20, '0');
const STAGE_LABEL: Record<MfgStage, string> = {
  PHOI: 'Phôi',
  HAN: 'Hàn',
  SON: 'Sơn',
  DAN: 'Đan',
  CHUYEN_KIEM: 'Chuyền kiểm',
  DONG_GOI: 'Đóng gói',
};

export const STAGE_HANDOVER_DISABLED_MESSAGE =
  'Giao nhận giữa tổ chưa bật (STAGE_HANDOVER_ENABLED, cần bật cả tồn đoạn) - chưa lập phiếu giao đoạn / giao mảnh được';

/** Dòng phiếu giao ĐOẠN đã kiểm (lúc lập phiếu và lúc xác nhận). */
export interface PreparedSegmentHandover {
  productionInvoiceId: bigint;
  segmentSpecId: bigint;
  segmentSteps: string;
  /** Tổ nhận: HAN (kho Hàn) hoặc SON (kho Sơn, mảnh không qua Hàn). */
  stage: MfgStage;
  qty: number;
  /** Kho giao (kho Phôi của xưởng làm lệnh) = kho của phiếu. */
  warehouse: WarehouseLike;
  toWarehouse: WarehouseLike;
  label: string;
}

/** Dòng phiếu giao MẢNH đã hàn cho Sơn đã kiểm. */
export interface PreparedFrameHandover {
  productionInvoiceId: bigint;
  productionOrderId: bigint;
  pieceId: bigint;
  pieceName: string;
  qty: number;
  /** Kho Hàn của xưởng (xưởng có kho Sơn) = kho của phiếu. */
  warehouse: WarehouseLike;
  toWarehouse: WarehouseLike;
}

export type PieceCapMode = 'SEGMENT' | 'FRAME';

export interface PieceCapInfo extends PieceReceivedCap {
  mode: PieceCapMode;
}

interface PiCaps {
  caps: Map<string, PieceCapInfo>;
  /** Kho đoạn đã nhận theo mã đoạn (chỉ mảnh dùng đoạn). */
  pool: Map<string, SegmentPoolRow>;
}

interface PiPieceRow {
  orderId: bigint;
  pieceId: bigint;
  bomRevisionId: bigint;
  needsHan: boolean;
  needsSon: boolean;
  qtyPerUnit: number;
  orderQty: number;
  cancelled: boolean;
  /** mã đoạn -> số đoạn / mảnh. */
  codes: Map<string, { segmentSpecId: bigint; segmentSteps: string; qtyPerPiece: number }>;
}

/** Mảnh trừ đoạn ở tổ nào (cùng quy tắc ProductionBatchesService.postSegmentConsumeEntries): cần Hàn -> Hàn, chỉ cần Sơn -> Sơn. */
function segmentConsumeStage(p: { needsHan: boolean; needsSon: boolean }): MfgStage | null {
  if (p.needsHan) return MfgStage.HAN;
  if (p.needsSon) return MfgStage.SON;
  return null;
}

/** Cổng nhận của 1 (SKU, mảnh) ở tổ `stage`: theo đoạn đã nhận / theo mảnh đã hàn đã nhận / không có. */
function capModeOf(row: PiPieceRow, stage: MfgStage): PieceCapMode | null {
  if (stage === MfgStage.HAN) return row.needsHan && row.codes.size > 0 ? 'SEGMENT' : null;
  if (stage === MfgStage.SON) {
    if (!row.needsSon) return null;
    if (row.needsHan) return 'FRAME';
    return row.codes.size > 0 ? 'SEGMENT' : null;
  }
  return null;
}

/**
 * Giao nhận giữa tổ (24/11/2026 - docs THIET-KE-GIAO-NHAN-GIUA-TO-2026-11-24; bật bằng STAGE_HANDOVER_ENABLED):
 *  - phiếu XK dòng SEGMENT_HANDOVER (kho Phôi giao đoạn của lệnh cho công nhân Hàn / Sơn) và FRAME_HANDOVER (kho Hàn Phú An giao
 *    mảnh đã hàn cho công nhân Sơn) - IssueSlipsService gọi prepare / assert*CapInTx / confirm*InTx ở đây;
 *  - trần báo Hàn / Sơn theo hàng đã nhận (ProductionBatchesService gọi assertReceivedCapInTx, sau cổng kế hoạch);
 *  - QLSX mở chặn có lý do (chỉ nâng trần theo hàng đã nhận, không nâng trần kế hoạch), báo Sếp + QLSX;
 *  - các màn đọc: kế hoạch giao của thủ kho, bảng theo dõi của QLSX, số "đã nhận / đã làm / còn" cho màn công nhân.
 */
@Injectable()
export class StageHandoverService {
  private readonly logger = new Logger(StageHandoverService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly segmentStock: SegmentStockService,
    private readonly stockLedger: StockLedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  assertEnabled(): void {
    if (!isStageHandoverEnabled()) throw new BadRequestException(STAGE_HANDOVER_DISABLED_MESSAGE);
  }

  // ─── Phiếu giao ĐOẠN (SEGMENT_HANDOVER) ──────────────────────────────────────────────────────

  async prepareSegmentHandover(
    input: {
      productionInvoiceId?: string;
      segmentSpecId?: string;
      segmentSteps?: string;
      stage?: MfgStage;
      qty: number;
    },
    scope: string | null,
  ): Promise<PreparedSegmentHandover> {
    this.assertEnabled();
    if (!input.productionInvoiceId || !input.segmentSpecId || !input.stage) {
      throw new BadRequestException('Dòng giao đoạn cần lệnh, mã đoạn (cỡ đoạn) và tổ nhận');
    }
    if (input.stage !== MfgStage.HAN && input.stage !== MfgStage.SON) {
      throw new BadRequestException('Dòng giao đoạn: tổ nhận phải là Hàn hoặc Sơn');
    }
    assertWholeQty(input.qty, 'Số đoạn giao');
    const segmentSteps = input.segmentSteps ?? '';
    if (!isNormalizedSegmentSteps(segmentSteps)) {
      throw new BadRequestException(`Bộ công đoạn '${segmentSteps}' không đúng dạng mã đoạn`);
    }
    const piId = parseBigIntId(input.productionInvoiceId);
    const segmentSpecId = parseBigIntId(input.segmentSpecId);
    const [pi, spec] = await Promise.all([
      this.prisma.productionInvoice.findUnique({
        where: { id: piId },
        select: { id: true, code: true, status: true },
      }),
      this.prisma.segmentSpec.findUnique({
        where: { id: segmentSpecId },
        select: { cutLengthMm: true, material: { select: { code: true } } },
      }),
    ]);
    if (!pi)
      throw new NotFoundException(`Không tìm thấy lệnh sản xuất ${input.productionInvoiceId}`);
    if (!spec) throw new NotFoundException(`Không tìm thấy cỡ đoạn ${input.segmentSpecId}`);
    this.assertPiOpen(pi);
    const label = segmentCodeLabel(spec.material.code, spec.cutLengthMm.toNumber(), segmentSteps);
    const rows = await this.loadPiPieces(this.prisma, piId);
    const code = segmentCodeKey(segmentSpecId, segmentSteps);
    const used = rows.some(
      (r) => !r.cancelled && r.codes.has(code) && segmentConsumeStage(r) === input.stage,
    );
    if (!used) {
      throw new BadRequestException(
        `Đoạn ${label} không dùng cho mảnh nào của tổ ${STAGE_LABEL[input.stage]} trong lệnh ${pi.code} - chọn đúng tổ nhận / mã đoạn`,
      );
    }
    const warehouse = await new WorkshopWarehouseResolver(this.prisma).phoiWarehouseOfPi(piId);
    const toWarehouse = await requireStageWarehouseOfPi(this.prisma, piId, input.stage);
    this.assertScope(warehouse, scope, `Đoạn của lệnh ${pi.code}`);
    return {
      productionInvoiceId: piId,
      segmentSpecId,
      segmentSteps,
      stage: input.stage,
      qty: input.qty,
      warehouse,
      toWarehouse,
      label,
    };
  }

  /**
   * Trần giao đoạn (gọi TRONG transaction lập phiếu / xác nhận - khoá ô tồn kho Phôi). `excludeSlipId` = phiếu đang xác nhận.
   * Giao được = phần lệnh còn giữ + dư dùng được của ô − đoạn của lệnh đang nằm trên phiếu giao chờ ký khác. Đoạn Phôi đạt KCS tự
   * vào kho Phôi (tồn đoạn theo lệnh), không có bước thủ kho xác nhận nhập kho.
   */
  async assertSegmentCapInTx(
    tx: PrismaTx,
    p: PreparedSegmentHandover,
    excludeSlipId: bigint | null,
  ): Promise<void> {
    const cell = await this.segmentStock.lockAndReadOrderCell(
      tx,
      {
        warehouseId: p.warehouse.id,
        segmentSpecId: p.segmentSpecId,
        segmentSteps: p.segmentSteps,
      },
      p.productionInvoiceId,
    );
    const draft = await tx.issueSlipLine.aggregate({
      where: {
        kind: IssueSlipLineKind.SEGMENT_HANDOVER,
        productionInvoiceId: p.productionInvoiceId,
        segmentSpecId: p.segmentSpecId,
        segmentSteps: p.segmentSteps,
        slip: {
          status: IssueSlipStatus.DRAFT,
          warehouseId: p.warehouse.id,
          ...(excludeSlipId ? { id: { not: excludeSlipId } } : {}),
        },
      },
      _sum: { qty: true },
    });
    const draftQty = draft._sum.qty?.toNumber() ?? 0;
    const byStock = round4(cell.ownRemainingQty + cell.surplusQty - draftQty);
    if (p.qty > byStock + EPS) {
      throw new BadRequestException(
        `Đoạn ${p.label}: kho ${p.warehouse.code} còn ${round4(cell.ownRemainingQty)} đoạn giữ cho lệnh + ${round4(cell.surplusQty)} dư, đang trên phiếu chờ ký ${draftQty} - còn giao được ${Math.max(0, byStock)}, phiếu ghi ${p.qty}.`,
      );
    }
  }

  /** Xác nhận 1 dòng giao đoạn (TRONG transaction xác nhận phiếu, sau lockForConfirmInTx). */
  async confirmSegmentInTx(
    tx: PrismaTx,
    p: PreparedSegmentHandover,
    lineId: bigint,
    slipId: bigint,
    userId: string,
    key: string,
  ): Promise<void> {
    await this.assertSegmentCapInTx(tx, p, slipId);
    await this.segmentStock.handoverOrderHoldings(tx, {
      productionInvoiceId: p.productionInvoiceId,
      fromWarehouseId: p.warehouse.id,
      toWarehouseId: p.toWarehouse.id,
      segmentSpecId: p.segmentSpecId,
      segmentSteps: p.segmentSteps,
      qty: p.qty,
      refId: lineId.toString(),
      idempotencyKey: `${key}:handover`,
      note: `Giao đoạn cho tổ ${STAGE_LABEL[p.stage]} (phiếu XK, dòng ${lineId})`,
      actorId: userId,
    });
  }

  // ─── Phiếu giao MẢNH đã hàn cho Sơn (FRAME_HANDOVER) ───────────────────────────────────────

  async prepareFrameHandover(
    input: { productionOrderId?: string; pieceId?: string; qty: number },
    scope: string | null,
  ): Promise<PreparedFrameHandover> {
    this.assertEnabled();
    if (!input.productionOrderId || !input.pieceId) {
      throw new BadRequestException('Dòng giao mảnh cho Sơn cần SKU (lệnh sản xuất) và mảnh');
    }
    assertWholeQty(input.qty, 'Số mảnh giao');
    const orderId = parseBigIntId(input.productionOrderId);
    const pieceId = parseBigIntId(input.pieceId);
    const order = await this.prisma.productionOrder.findFirst({
      where: { id: orderId, ...NOT_CANCELLED_ORDER },
      select: {
        id: true,
        bomRevisionId: true,
        productionInvoiceItem: {
          select: {
            productionInvoiceId: true,
            productionInvoice: { select: { code: true, status: true } },
          },
        },
      },
    });
    const piId = order?.productionInvoiceItem.productionInvoiceId;
    const pi = order?.productionInvoiceItem.productionInvoice;
    if (!order || !piId || !pi) {
      throw new NotFoundException(
        `Không tìm thấy SKU (lệnh sản xuất) ${input.productionOrderId} còn chạy`,
      );
    }
    this.assertPiOpen(pi);
    const [bp, piece] = await Promise.all([
      this.prisma.bomPiece.findUnique({
        where: { bomRevisionId_pieceId: { bomRevisionId: order.bomRevisionId, pieceId } },
        select: { needsHan: true, needsSon: true },
      }),
      this.prisma.piece.findUnique({ where: { id: pieceId }, select: { name: true } }),
    ]);
    const pieceName = piece?.name ?? `mảnh ${pieceId}`;
    if (!bp || !bp.needsHan || !bp.needsSon) {
      throw new BadRequestException(
        `${pieceName} không qua cả Hàn và Sơn trong định mức của SKU - không giao cho Sơn được`,
      );
    }
    const resolver = new WorkshopWarehouseResolver(this.prisma);
    const workshopId = await resolver.workshopIdOfPi(piId);
    if (!(await resolver.workshopHasPaint(workshopId))) {
      throw new BadRequestException(
        `Lệnh ${pi.code} làm ở xưởng không có kho Sơn - mảnh sang Sơn bằng phiếu chuyển kho (Hàn -> Sơn) như hiện nay, không lập phiếu giao`,
      );
    }
    const warehouse = await resolver.kindWarehouseOf(WarehouseKind.HAN, workshopId);
    if (!warehouse) {
      throw new BadRequestException('Xưởng của lệnh chưa có kho Hàn - báo Admin tạo kho trước');
    }
    const toWarehouse = await requireStageWarehouseOfPi(this.prisma, piId, MfgStage.SON);
    this.assertScope(warehouse, scope, `${pieceName} của lệnh ${pi.code}`);
    return {
      productionInvoiceId: piId,
      productionOrderId: order.id,
      pieceId,
      pieceName,
      qty: input.qty,
      warehouse,
      toWarehouse,
    };
  }

  /**
   * Trần giao mảnh (TRONG transaction - khoá theo SKU + mảnh rồi dòng tồn mảnh kho Hàn), cùng cách xuất đan HS2 19/11: tồn mảnh thật
   * ở kho Hàn (mảnh Hàn đạt KCS tự vào kho Hàn khi bật công tắc) − mảnh đó trên phiếu chờ ký khác cùng kho (giao Sơn / xuất đan) −
   * phiếu chuyển chờ nhận rời kho.
   */
  async assertFrameCapInTx(
    tx: PrismaTx,
    p: PreparedFrameHandover,
    excludeSlipId: bigint | null,
  ): Promise<void> {
    await lockBusinessKey(tx, `frame-handover:${p.productionOrderId}:${p.pieceId}`);
    const quants = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
      SELECT "qty" FROM "stock_quant"
      WHERE "warehouseId" = ${p.warehouse.id} AND "pieceId" = ${p.pieceId}
      FOR UPDATE
    `;
    const notThisSlip = excludeSlipId ? { id: { not: excludeSlipId } } : {};
    const [draftWh, pendingTransfer] = await Promise.all([
      tx.issueSlipLine.aggregate({
        where: {
          kind: { in: [IssueSlipLineKind.FRAME_HANDOVER, IssueSlipLineKind.WEAVING_PIECE] },
          pieceId: p.pieceId,
          slip: { status: IssueSlipStatus.DRAFT, warehouseId: p.warehouse.id, ...notThisSlip },
        },
        _sum: { qty: true },
      }),
      tx.warehouseTransferPieceItem.aggregate({
        where: {
          pieceId: p.pieceId,
          transfer: { status: TransferStatus.PENDING, fromWarehouseId: p.warehouse.id },
        },
        _sum: { quantity: true },
      }),
    ]);
    const onHand = quants.reduce((s, q) => s + q.qty.toNumber(), 0);
    const draftQty = draftWh._sum.qty?.toNumber() ?? 0;
    const pendingQty = pendingTransfer._sum.quantity ?? 0;
    const physical = round4(onHand - draftQty - pendingQty);
    if (p.qty > physical + EPS) {
      throw new BadRequestException(
        `${p.pieceName}: kho ${p.warehouse.code} còn ${round4(onHand)} mảnh, đang trên phiếu chờ ký ${draftQty}, phiếu chuyển chờ nhận ${pendingQty} - còn giao được ${Math.max(0, physical)}, phiếu ghi ${p.qty}.`,
      );
    }
  }

  async confirmFrameInTx(
    tx: PrismaTx,
    p: PreparedFrameHandover,
    lineId: bigint,
    slipId: bigint,
    userId: string,
    key: string,
  ): Promise<void> {
    const idempotencyKey = `${key}:handover`;
    const dup = await tx.stockLedger.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (dup) return;
    await this.assertFrameCapInTx(tx, p, slipId);
    await this.stockLedger.postEntry(
      {
        fromWarehouseId: p.warehouse.id,
        toWarehouseId: p.toWarehouse.id,
        pieceId: p.pieceId,
        qty: p.qty,
        refType: StockLedgerRefType.FRAME_HANDOVER,
        refId: lineId.toString(),
        idempotencyKey,
        note: `Giao mảnh đã hàn cho tổ Sơn (phiếu XK, dòng ${lineId})`,
        createdById: userId,
      },
      tx,
    );
  }

  /**
   * Khoá trước khi xác nhận phiếu có dòng giao (SAU khoá phiếu + dòng lệnh, TRƯỚC mọi khoá ô): khoá chuyển đổi tồn đoạn (dùng chung),
   * khoá phía cộng của từng lệnh (id tăng dần), rồi MỌI ô đoạn (kho giao + kho nhận) theo thứ tự cố định - cùng thứ tự phía cộng
   * (khoá lệnh -> ô) và phía trừ (ô theo thứ tự mã đoạn), nên phiếu nhiều dòng / nhiều lệnh không khoá chéo với KCS chấm.
   */
  async lockForConfirmInTx(tx: PrismaTx, lines: readonly PreparedSegmentHandover[]): Promise<void> {
    if (lines.length === 0) return;
    await lockBusinessKeyShared(tx, SEGMENT_LEGACY_CONVERSION_LOCK);
    const pis = [...new Set(lines.map((l) => l.productionInvoiceId.toString()))]
      .map((s) => BigInt(s))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const pi of pis) await lockBusinessKey(tx, segmentProductionLockKey(pi));
    const cells = new Map<
      string,
      { warehouseId: bigint; segmentSpecId: bigint; segmentSteps: string }
    >();
    for (const l of lines) {
      for (const warehouseId of [l.warehouse.id, l.toWarehouse.id]) {
        const c = { warehouseId, segmentSpecId: l.segmentSpecId, segmentSteps: l.segmentSteps };
        cells.set(`${pad(warehouseId)}|${segmentCodeKey(l.segmentSpecId, l.segmentSteps)}`, c);
      }
    }
    const sorted = [...cells.values()].sort((a, b) =>
      a.warehouseId !== b.warehouseId
        ? a.warehouseId < b.warehouseId
          ? -1
          : 1
        : compareSegmentCodes(a, b),
    );
    for (const c of sorted) {
      await lockBusinessKey(
        tx,
        segmentBucketLockKey(c.warehouseId, c.segmentSpecId, c.segmentSteps),
      );
    }
  }

  // ─── Cổng báo Hàn / Sơn theo hàng đã nhận ───────────────────────────────────────────────────

  /**
   * Chặn báo Hàn / Sơn vượt hàng đã nhận (3.3b) - gọi TRONG transaction báo, SAU cổng kế hoạch (assertPieceReportWithinPlanInTx,
   * khoá production-batch-open). Khoá thêm `stage-handover-cap:{lệnh}:{tổ}` vì đoạn đã nhận là của CẢ lệnh (nhiều mảnh / SKU dùng
   * chung mã đoạn): 2 người báo 2 mảnh khác nhau cùng lúc không cùng lọt. Thứ tự khoá: production-batch-open -> cap. Phiếu giao chỉ
   * cộng thêm hàng đã nhận nên không cần khoá này. Tắt công tắc / mảnh không có cổng nhận -> không làm gì.
   */
  async assertReceivedCapInTx(
    tx: PrismaTx,
    p: { productionOrderId: bigint; pieceId: bigint; stage: MfgStage; qty: number },
  ): Promise<void> {
    if (!isStageHandoverEnabled()) return;
    if (p.stage !== MfgStage.HAN && p.stage !== MfgStage.SON) return;
    const order = await tx.productionOrder.findUnique({
      where: { id: p.productionOrderId },
      select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
    });
    const piId = order?.productionInvoiceItem.productionInvoiceId;
    if (!piId) return;
    await lockBusinessKey(tx, `stage-handover-cap:${piId}:${p.stage}`);
    const { caps } = await this.pieceCapsForPi(tx, piId, p.stage);
    const cap = caps.get(`${p.productionOrderId}:${p.pieceId}`);
    if (!cap || p.qty <= cap.receivedLeft) return;
    const piece = await tx.piece.findUnique({
      where: { id: p.pieceId },
      select: { name: true, code: true },
    });
    const pieceLabel = piece?.name ?? piece?.code ?? `mảnh ${p.pieceId}`;
    const from = p.stage === MfgStage.HAN || cap.mode === 'SEGMENT' ? 'kho Phôi' : 'kho Hàn';
    this.logger.warn(
      `Chặn báo vượt hàng đã nhận: lệnh ${piId}, SKU ${p.productionOrderId}, mảnh ${p.pieceId}, tổ ${p.stage}, còn ${cap.receivedLeft}, nhập ${p.qty}`,
    );
    throw new BadRequestException(
      `${pieceLabel} (tổ ${STAGE_LABEL[p.stage]}): đã nhận ${cap.receivedQty}, đã làm ${cap.usedQty}, còn ${cap.receivedLeft} - lần này báo được tối đa ${cap.receivedLeft}, bạn nhập ${p.qty}. Chưa nhận đủ hàng - qua ${from} ký phiếu lấy thêm, hoặc báo QLSX mở chặn.`,
    );
  }

  /** Trần theo hàng đã nhận của mọi (SKU, mảnh) có cổng nhận ở tổ `stage` của lệnh. Khoá `${SKU}:${mảnh}`. */
  async pieceCapsForPi(db: Db, piId: bigint, stage: MfgStage): Promise<PiCaps> {
    const rows = await this.loadPiPieces(db, piId);
    const orderIds = [...new Set(rows.map((r) => r.orderId))];
    const caps = new Map<string, PieceCapInfo>();
    if (orderIds.length === 0) return { caps, pool: new Map() };
    const [used, overrides] = await Promise.all([
      db.productionBatch.groupBy({
        by: ['productionOrderId', 'pieceId'],
        where: { stage, productionOrderId: { in: orderIds } },
        _sum: { reportedQty: true },
      }),
      db.stageHandoverOverride.groupBy({
        by: ['productionOrderId', 'pieceId'],
        where: { productionInvoiceId: piId, stage },
        _sum: { qty: true },
      }),
    ]);
    const usedOf = new Map(
      used.map((u) => [`${u.productionOrderId}:${u.pieceId}`, u._sum.reportedQty ?? 0]),
    );
    const overrideOf = new Map(
      overrides.map((o) => [`${o.productionOrderId}:${o.pieceId}`, o._sum.qty?.toNumber() ?? 0]),
    );
    const segmentPieces: SegmentPieceInput[] = [];
    const framePieces: PiPieceRow[] = [];
    for (const r of rows) {
      const mode = capModeOf(r, stage);
      const key = `${r.orderId}:${r.pieceId}`;
      if (mode === 'SEGMENT') {
        segmentPieces.push({
          key,
          usedQty: usedOf.get(key) ?? 0,
          overrideQty: overrideOf.get(key) ?? 0,
          qtyPerPieceByCode: new Map([...r.codes].map(([c, v]) => [c, v.qtyPerPiece])),
        });
      } else if (mode === 'FRAME') {
        framePieces.push(r);
      }
    }

    let pool = new Map<string, SegmentPoolRow>();
    if (segmentPieces.length > 0) {
      const received = await db.issueSlipLine.groupBy({
        by: ['segmentSpecId', 'segmentSteps'],
        where: {
          kind: IssueSlipLineKind.SEGMENT_HANDOVER,
          productionInvoiceId: piId,
          stage,
          slip: { status: IssueSlipStatus.ISSUED },
        },
        _sum: { qty: true },
      });
      const receivedByCode = new Map<string, number>();
      for (const g of received) {
        if (g.segmentSpecId == null) continue;
        receivedByCode.set(
          segmentCodeKey(g.segmentSpecId, g.segmentSteps),
          g._sum.qty?.toNumber() ?? 0,
        );
      }
      pool = segmentPool(segmentPieces, receivedByCode);
      for (const [key, c] of segmentPieceCaps(segmentPieces, receivedByCode)) {
        caps.set(key, { ...c, mode: 'SEGMENT' });
      }
    }

    if (framePieces.length > 0) {
      const frameOrderIds = [...new Set(framePieces.map((r) => r.orderId))];
      const [viaSlip, viaTransfer] = await Promise.all([
        db.issueSlipLine.groupBy({
          by: ['productionOrderId', 'pieceId'],
          where: {
            kind: IssueSlipLineKind.FRAME_HANDOVER,
            productionOrderId: { in: frameOrderIds },
            slip: { status: IssueSlipStatus.ISSUED },
          },
          _sum: { qty: true },
        }),
        // Phước An: mảnh sang Sơn Phú An bằng phiếu chuyển kho (giữ nguyên) - số Sơn đã nhận cộng cả phiếu chuyển đã xác nhận.
        db.warehouseTransferPieceItem.groupBy({
          by: ['productionOrderId', 'pieceId'],
          where: {
            productionOrderId: { in: frameOrderIds },
            transfer: {
              status: TransferStatus.CONFIRMED,
              toWarehouse: { kind: WarehouseKind.SON },
            },
          },
          _sum: { quantity: true },
        }),
      ]);
      const recvOf = new Map<string, number>();
      for (const g of viaSlip) {
        const k = `${g.productionOrderId}:${g.pieceId}`;
        recvOf.set(k, (recvOf.get(k) ?? 0) + (g._sum.qty?.toNumber() ?? 0));
      }
      for (const g of viaTransfer) {
        const k = `${g.productionOrderId}:${g.pieceId}`;
        recvOf.set(k, (recvOf.get(k) ?? 0) + (g._sum.quantity ?? 0));
      }
      for (const r of framePieces) {
        const key = `${r.orderId}:${r.pieceId}`;
        caps.set(key, {
          ...framePieceCap({
            receivedQty: recvOf.get(key) ?? 0,
            overrideQty: overrideOf.get(key) ?? 0,
            usedQty: usedOf.get(key) ?? 0,
          }),
          mode: 'FRAME',
        });
      }
    }
    return { caps, pool };
  }

  /** Cho màn quét của công nhân (floor-scan): trần theo hàng đã nhận của các SKU của 1 lệnh. Tắt công tắc -> null. */
  async receivedCapsForWorker(
    productionInvoiceId: bigint,
    stage: MfgStage,
  ): Promise<Map<string, PieceCapInfo> | null> {
    if (!isStageHandoverEnabled()) return null;
    if (stage !== MfgStage.HAN && stage !== MfgStage.SON) return null;
    return (await this.pieceCapsForPi(this.prisma, productionInvoiceId, stage)).caps;
  }

  // ─── QLSX mở chặn ─────────────────────────────────────────────────────────────────────────

  async createOverride(dto: CreateStageHandoverOverrideDto, userId: string) {
    this.assertEnabled();
    const piId = parseBigIntId(dto.productionInvoiceId);
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException('Cần ghi lý do mở chặn (ít nhất 3 ký tự)');
    if (!(dto.qty > 0)) throw new BadRequestException('Số mở chặn phải lớn hơn 0');
    const pi = await this.prisma.productionInvoice.findUnique({
      where: { id: piId },
      select: { id: true, code: true, status: true },
    });
    if (!pi) throw new NotFoundException(`Không tìm thấy lệnh sản xuất ${dto.productionInvoiceId}`);
    this.assertPiOpen(pi);

    if (dto.stage === MfgStage.DAN) {
      throw new BadRequestException('Mở chặn chỉ cho tổ Phôi, Hàn, Sơn');
    }
    let data: Prisma.StageHandoverOverrideUncheckedCreateInput;
    let target: string;
    let unit: string;
    if (dto.stage === MfgStage.PHOI) {
      if (!dto.materialId) throw new BadRequestException('Mở chặn tổ Phôi cần chọn loại sắt');
      const materialId = parseBigIntId(dto.materialId);
      const material = await this.prisma.material.findUnique({
        where: { id: materialId },
        select: { code: true },
      });
      if (!material) throw new NotFoundException(`Không tìm thấy vật tư ${dto.materialId}`);
      data = {
        productionInvoiceId: piId,
        stage: MfgStage.PHOI,
        materialId,
        qty: dto.qty,
        reason,
        createdById: userId,
      };
      target = `sắt ${material.code}`;
      unit = 'mm';
    } else {
      if (!dto.productionOrderId || !dto.pieceId) {
        throw new BadRequestException('Mở chặn tổ Hàn / Sơn cần SKU (lệnh sản xuất) và mảnh');
      }
      assertWholeQty(dto.qty, 'Số mảnh mở chặn');
      const orderId = parseBigIntId(dto.productionOrderId);
      const pieceId = parseBigIntId(dto.pieceId);
      const order = await this.prisma.productionOrder.findFirst({
        where: { id: orderId, productionInvoiceItem: { productionInvoiceId: piId } },
        select: { bomRevisionId: true, mfgProduct: { select: { factoryCode: true } } },
      });
      if (!order) throw new BadRequestException('SKU không thuộc lệnh này');
      const [bp, piece] = await Promise.all([
        this.prisma.bomPiece.findUnique({
          where: { bomRevisionId_pieceId: { bomRevisionId: order.bomRevisionId, pieceId } },
          select: { needsHan: true, needsSon: true },
        }),
        this.prisma.piece.findUnique({ where: { id: pieceId }, select: { name: true } }),
      ]);
      const needs = dto.stage === MfgStage.HAN ? bp?.needsHan : bp?.needsSon;
      if (!needs) {
        throw new BadRequestException(
          `Mảnh không qua tổ ${STAGE_LABEL[dto.stage]} trong định mức của SKU - không mở chặn được`,
        );
      }
      data = {
        productionInvoiceId: piId,
        productionOrderId: orderId,
        stage: dto.stage,
        pieceId,
        qty: dto.qty,
        reason,
        createdById: userId,
      };
      target = `${piece?.name ?? `mảnh ${pieceId}`} (SKU ${order.mfgProduct.factoryCode})`;
      unit = 'mảnh';
    }
    // StageHandoverOverride nằm trong AUDITED_MODELS - create() tự ghi nhật ký (ai, lúc nào, số, lý do).
    const row = await this.prisma.stageHandoverOverride.create({ data });
    try {
      await this.notifications.emit('STAGE_HANDOVER_OVERRIDE', {
        entityId: pi.id.toString(),
        actorId: userId,
        params: {
          piCode: pi.code,
          stageLabel: STAGE_LABEL[dto.stage],
          target,
          qty: dto.qty,
          unit,
          reason,
        },
      });
    } catch (error) {
      this.logger.error(
        `Không tạo được thông báo mở chặn giao nhận (lệnh ${pi.id}): ${(error as Error).message}`,
      );
    }
    return this.toOverrideDto(row);
  }

  async listOverrides(productionInvoiceId: string) {
    const rows = await this.prisma.stageHandoverOverride.findMany({
      where: { productionInvoiceId: parseBigIntId(productionInvoiceId) },
      orderBy: { id: 'desc' },
    });
    return this.decorateOverrides(rows);
  }

  private async decorateOverrides(
    rows: Prisma.StageHandoverOverrideGetPayload<Record<string, never>>[],
  ) {
    const userIds = [...new Set(rows.map((r) => r.createdById))];
    const pieceIds = [...new Set(rows.flatMap((r) => (r.pieceId ? [r.pieceId] : [])))];
    const materialIds = [...new Set(rows.flatMap((r) => (r.materialId ? [r.materialId] : [])))];
    const [users, pieces, materials] = await Promise.all([
      userIds.length > 0
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [],
      pieceIds.length > 0
        ? this.prisma.piece.findMany({
            where: { id: { in: pieceIds } },
            select: { id: true, code: true, name: true },
          })
        : [],
      materialIds.length > 0
        ? this.prisma.material.findMany({
            where: { id: { in: materialIds } },
            select: { id: true, code: true },
          })
        : [],
    ]);
    const userOf = new Map(users.map((u) => [u.id, `${u.lastName} ${u.firstName}`.trim()]));
    const pieceOf = new Map(pieces.map((p) => [p.id.toString(), p]));
    const materialOf = new Map(materials.map((m) => [m.id.toString(), m.code]));
    return rows.map((r) => ({
      ...this.toOverrideDto(r),
      createdByName: userOf.get(r.createdById) ?? null,
      pieceCode: r.pieceId ? (pieceOf.get(r.pieceId.toString())?.code ?? null) : null,
      pieceName: r.pieceId ? (pieceOf.get(r.pieceId.toString())?.name ?? null) : null,
      materialCode: r.materialId ? (materialOf.get(r.materialId.toString()) ?? null) : null,
    }));
  }

  private toOverrideDto(r: Prisma.StageHandoverOverrideGetPayload<Record<string, never>>) {
    return {
      id: r.id.toString(),
      productionInvoiceId: r.productionInvoiceId.toString(),
      productionOrderId: r.productionOrderId?.toString() ?? null,
      stage: r.stage,
      pieceId: r.pieceId?.toString() ?? null,
      materialId: r.materialId?.toString() ?? null,
      qty: r.qty.toNumber(),
      unit: r.stage === MfgStage.PHOI ? 'mm' : 'mảnh',
      reason: r.reason,
      createdById: r.createdById,
      createdAt: r.createdAt,
    };
  }

  /** Mảnh Hàn đạt KCS đã ghi vào kho Hàn (FRAME_OUTPUT của các lô Hàn của SKU + mảnh). */
  private async framePassedQty(
    db: Db,
    orderId: bigint,
    pieceId: bigint,
    warehouseId: bigint,
  ): Promise<number> {
    const batches = await db.productionBatch.findMany({
      where: {
        productionOrderId: orderId,
        pieceId,
        stage: MfgStage.HAN,
        status: ProductionBatchStatus.QC_DONE,
      },
      select: { id: true },
    });
    if (batches.length === 0) return 0;
    const agg = await db.stockLedger.aggregate({
      where: {
        refType: StockLedgerRefType.FRAME_OUTPUT,
        toWarehouseId: warehouseId,
        pieceId,
        refId: { in: batches.map((b) => b.id.toString()) },
      },
      _sum: { qty: true },
    });
    return agg._sum.qty?.toNumber() ?? 0;
  }

  // ─── Màn đọc ────────────────────────────────────────────────────────────────────────────────

  /**
   * Kế hoạch giao của thủ kho (kho đang làm): SEGMENT = kho Phôi giao đoạn cho Hàn / Sơn, FRAME = kho Hàn giao mảnh cho Sơn.
   * Không có lệnh: danh sách lệnh có hàng ở kho. Có lệnh: từng mã đoạn / mảnh - cần, đạt KCS, đã giao, chờ ký, còn
   * trong kho, giao được.
   */
  async getPlan(query: StageHandoverPlanQueryDto, scope: string | null) {
    const code = scope ?? query.warehouseCode;
    if (!code) {
      throw new BadRequestException('Chọn kho (warehouseCode) - tài khoản không gắn kho đang làm');
    }
    if (scope && query.warehouseCode && query.warehouseCode !== scope) {
      throw new ForbiddenException(`Bạn đang làm kho ${scope}`);
    }
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { code },
      select: { id: true, code: true, name: true, kind: true, workshopId: true },
    });
    if (!warehouse) throw new NotFoundException(`Không tìm thấy kho ${code}`);
    const kind = query.kind;
    if (kind === HandoverKind.SEGMENT && warehouse.kind !== WarehouseKind.PHOI) {
      throw new BadRequestException('Giao đoạn chỉ làm ở kho Phôi');
    }
    if (kind === HandoverKind.FRAME && warehouse.kind !== WarehouseKind.HAN) {
      throw new BadRequestException('Giao mảnh cho Sơn chỉ làm ở kho Hàn');
    }
    const whDto = {
      id: warehouse.id.toString(),
      code: warehouse.code,
      name: warehouse.name,
      kind: warehouse.kind,
    };
    const enabled = isStageHandoverEnabled();
    if (!query.productionInvoiceId) {
      // Tắt công tắc: FE chỉ hỏi để biết có hiện tab mới không - trả ngay, không tính kế hoạch giao của từng lệnh.
      if (!enabled) return { enabled, kind, warehouse: whDto, pis: [] };
      const piIds = await this.piIdsAtWarehouse(warehouse.id, kind);
      const lenh = await loadLenhDisplayCodes(this.prisma, piIds);
      const pis = [];
      for (const piId of piIds) {
        const rows =
          kind === HandoverKind.SEGMENT
            ? await this.segmentPlanRows(piId, warehouse.id)
            : await this.framePlanRows(piId, warehouse.id);
        const sum = (f: (r: (typeof rows)[number]) => number) =>
          round4(rows.reduce((s, r) => s + f(r), 0));
        const pi = await this.prisma.productionInvoice.findUnique({
          where: { id: piId },
          select: { code: true },
        });
        pis.push({
          productionInvoiceId: piId.toString(),
          code: pi?.code ?? '',
          lenhCode: lenh.get(piId.toString()) ?? pi?.code ?? '',
          inStockQty: sum((r) => r.inStockQty),
          availableQty: sum((r) => r.availableQty),
          draftQty: sum((r) => r.draftQty),
        });
      }
      return { enabled, kind, warehouse: whDto, pis };
    }
    const piId = parseBigIntId(query.productionInvoiceId);
    const pi = await this.prisma.productionInvoice.findUnique({
      where: { id: piId },
      select: { id: true, code: true },
    });
    if (!pi)
      throw new NotFoundException(`Không tìm thấy lệnh sản xuất ${query.productionInvoiceId}`);
    const lenh = await loadLenhDisplayCodes(this.prisma, [piId]);
    const rows =
      kind === HandoverKind.SEGMENT
        ? await this.segmentPlanRows(piId, warehouse.id)
        : await this.framePlanRows(piId, warehouse.id);
    return {
      enabled,
      kind,
      warehouse: whDto,
      productionInvoiceId: pi.id.toString(),
      code: pi.code,
      lenhCode: lenh.get(pi.id.toString()) ?? pi.code,
      rows,
    };
  }

  /** Lệnh còn chạy có hàng ở kho: SEGMENT = có dòng phía cộng / giữ đoạn ở kho Phôi; FRAME = có mảnh Hàn ghi vào kho Hàn. */
  private async piIdsAtWarehouse(warehouseId: bigint, kind: HandoverKind): Promise<bigint[]> {
    const open = {
      status: { notIn: [ProductionInvoiceStatus.DONE, ProductionInvoiceStatus.CANCELLED] },
    };
    if (kind === HandoverKind.SEGMENT) {
      const [prods, res] = await Promise.all([
        this.prisma.segmentProduction.findMany({
          where: { warehouseId, productionInvoice: open },
          select: { productionInvoiceId: true },
          distinct: ['productionInvoiceId'],
        }),
        this.prisma.segmentReservation.findMany({
          where: {
            warehouseId,
            productionInvoice: open,
            reservedQty: { gt: this.prisma.segmentReservation.fields.consumedQty },
          },
          select: { productionInvoiceId: true },
          distinct: ['productionInvoiceId'],
        }),
      ]);
      return uniqIds(
        [...prods, ...res]
          .map((r) => r.productionInvoiceId)
          .filter((id): id is bigint => id != null),
      );
    }
    const ledgers = await this.prisma.stockLedger.findMany({
      where: { refType: StockLedgerRefType.FRAME_OUTPUT, toWarehouseId: warehouseId },
      select: { refId: true },
      distinct: ['refId'],
      orderBy: { refId: 'desc' },
      take: 2000,
    });
    const batchIds = ledgers.flatMap((l) =>
      l.refId && /^\d+$/.test(l.refId) ? [BigInt(l.refId)] : [],
    );
    if (batchIds.length === 0) return [];
    const batches = await this.prisma.productionBatch.findMany({
      where: {
        id: { in: batchIds },
        stage: MfgStage.HAN,
        productionOrder: { productionInvoiceItem: { productionInvoice: open } },
      },
      select: {
        productionOrder: {
          select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
        },
      },
    });
    return uniqIds(
      batches.flatMap((b) => {
        const id = b.productionOrder.productionInvoiceItem.productionInvoiceId;
        return id ? [id] : [];
      }),
    );
  }

  private async segmentPlanRows(piId: bigint, warehouseId: bigint) {
    const rows = await this.loadPiPieces(this.prisma, piId);
    const [prods, leftovers, reservations, quants, lines] = await Promise.all([
      this.prisma.segmentProduction.findMany({ where: { productionInvoiceId: piId, warehouseId } }),
      this.prisma.segmentProductionLeftover.findMany({
        where: { productionInvoiceId: piId, warehouseId },
      }),
      this.prisma.segmentReservation.findMany({ where: { warehouseId } }),
      this.prisma.stockQuant.findMany({
        where: { warehouseId, segmentSpecId: { not: null } },
        select: { segmentSpecId: true, segmentSteps: true, qty: true },
      }),
      this.prisma.issueSlipLine.groupBy({
        by: ['segmentSpecId', 'segmentSteps', 'stage'],
        where: {
          kind: IssueSlipLineKind.SEGMENT_HANDOVER,
          productionInvoiceId: piId,
          slip: { status: { in: [IssueSlipStatus.DRAFT, IssueSlipStatus.ISSUED] }, warehouseId },
        },
        _sum: { qty: true },
      }),
    ]);
    // Dòng giao theo trạng thái phiếu (groupBy không gom theo cột của bảng cha) - đọc riêng phần chờ ký.
    const draftLines = await this.prisma.issueSlipLine.groupBy({
      by: ['segmentSpecId', 'segmentSteps', 'stage'],
      where: {
        kind: IssueSlipLineKind.SEGMENT_HANDOVER,
        productionInvoiceId: piId,
        slip: { status: IssueSlipStatus.DRAFT, warehouseId },
      },
      _sum: { qty: true },
    });

    interface Row {
      segmentSpecId: bigint;
      segmentSteps: string;
      required: Map<MfgStage, number>;
      passed: number;
      handed: Map<MfgStage, number>;
      draft: Map<MfgStage, number>;
      ownHeld: number;
      cellOnHand: number;
      cellHeld: number;
    }
    const byCode = new Map<string, Row>();
    const rowOf = (segmentSpecId: bigint, segmentSteps: string): Row => {
      const k = segmentCodeKey(segmentSpecId, segmentSteps);
      let r = byCode.get(k);
      if (!r) {
        r = {
          segmentSpecId,
          segmentSteps,
          required: new Map(),
          passed: 0,
          handed: new Map(),
          draft: new Map(),
          ownHeld: 0,
          cellOnHand: 0,
          cellHeld: 0,
        };
        byCode.set(k, r);
      }
      return r;
    };
    const bump = (m: Map<MfgStage, number>, s: MfgStage, q: number) =>
      m.set(s, round4((m.get(s) ?? 0) + q));
    for (const p of rows) {
      if (p.cancelled) continue;
      const stage = segmentConsumeStage(p);
      if (!stage) continue;
      for (const c of p.codes.values()) {
        bump(
          rowOf(c.segmentSpecId, c.segmentSteps).required,
          stage,
          c.qtyPerPiece * p.qtyPerUnit * p.orderQty,
        );
      }
    }
    for (const p of prods) {
      rowOf(p.segmentSpecId, p.segmentSteps).passed +=
        p.heldQty.toNumber() + p.surplusQty.toNumber();
    }
    for (const lo of leftovers)
      rowOf(lo.segmentSpecId, lo.segmentSteps).passed += lo.surplusQty.toNumber();
    const draftOf = new Map<string, number>();
    for (const d of draftLines) {
      if (d.segmentSpecId == null || !d.stage) continue;
      const k = `${segmentCodeKey(d.segmentSpecId, d.segmentSteps)}|${d.stage}`;
      draftOf.set(k, d._sum.qty?.toNumber() ?? 0);
      bump(rowOf(d.segmentSpecId, d.segmentSteps).draft, d.stage, d._sum.qty?.toNumber() ?? 0);
    }
    for (const l of lines) {
      if (l.segmentSpecId == null || !l.stage) continue;
      const k = `${segmentCodeKey(l.segmentSpecId, l.segmentSteps)}|${l.stage}`;
      const all = l._sum.qty?.toNumber() ?? 0;
      bump(rowOf(l.segmentSpecId, l.segmentSteps).handed, l.stage, all - (draftOf.get(k) ?? 0));
    }
    // Chỉ các ô của mã đoạn của lệnh - số tồn / còn giữ đọc cho mọi lệnh để tính dư của ô.
    for (const res of reservations) {
      const k = segmentCodeKey(res.segmentSpecId, res.segmentSteps);
      const r = byCode.get(k);
      if (!r) continue;
      const remaining = res.reservedQty.toNumber() - res.consumedQty.toNumber();
      r.cellHeld += remaining;
      if (res.productionInvoiceId === piId) r.ownHeld += remaining;
    }
    for (const q of quants) {
      if (q.segmentSpecId == null) continue;
      const r = byCode.get(segmentCodeKey(q.segmentSpecId, q.segmentSteps));
      if (r) r.cellOnHand += q.qty.toNumber();
    }
    const specs = await this.prisma.segmentSpec.findMany({
      where: { id: { in: [...byCode.values()].map((r) => r.segmentSpecId) } },
      select: { id: true, cutLengthMm: true, material: { select: { id: true, code: true } } },
    });
    const specOf = new Map(specs.map((s) => [s.id.toString(), s]));
    const sumMap = (m: Map<MfgStage, number>) => round4([...m.values()].reduce((a, b) => a + b, 0));
    const out = [...byCode.values()].map((r) => {
      const spec = specOf.get(r.segmentSpecId.toString());
      const cutLengthMm = spec?.cutLengthMm.toNumber() ?? 0;
      const ownHeld = round4(Math.max(0, Math.min(r.ownHeld, r.cellOnHand)));
      const surplus = round4(Math.max(0, r.cellOnHand - r.cellHeld));
      const handedOverQty = sumMap(r.handed);
      const draftQty = sumMap(r.draft);
      const passedQty = round4(r.passed);
      const inStockQty = round4(ownHeld + surplus);
      const stages = ([MfgStage.HAN, MfgStage.SON] as MfgStage[])
        .filter((s) => r.required.has(s) || r.handed.has(s) || r.draft.has(s))
        .map((s) => ({
          stage: s,
          requiredQty: r.required.get(s) ?? 0,
          handedOverQty: r.handed.get(s) ?? 0,
          draftQty: r.draft.get(s) ?? 0,
        }));
      return {
        segmentSpecId: r.segmentSpecId.toString(),
        segmentSteps: r.segmentSteps,
        materialCode: spec?.material.code ?? '',
        cutLengthMm,
        stepsLabel: segmentStepsLabel(r.segmentSteps),
        label: segmentCodeLabel(spec?.material.code ?? '', cutLengthMm, r.segmentSteps),
        stages,
        requiredQty: sumMap(r.required),
        /** Đoạn Phôi đạt KCS của lệnh đã vào kho Phôi (phía cộng: giữ cho lệnh + dư). */
        passedQty,
        handedOverQty,
        draftQty,
        ownHeldQty: ownHeld,
        surplusQty: surplus,
        inStockQty,
        /** Giao được = còn giữ + dư − đang trên phiếu chờ ký (cùng trần lúc lập phiếu). */
        availableQty: round4(Math.max(0, inStockQty - draftQty)),
      };
    });
    return out.sort(
      (a, b) =>
        a.materialCode.localeCompare(b.materialCode) ||
        b.cutLengthMm - a.cutLengthMm ||
        a.segmentSteps.localeCompare(b.segmentSteps),
    );
  }

  private async framePlanRows(piId: bigint, warehouseId: bigint) {
    const rows = (await this.loadPiPieces(this.prisma, piId)).filter(
      (r) => !r.cancelled && r.needsHan && r.needsSon,
    );
    if (rows.length === 0) return [];
    const orderIds = [...new Set(rows.map((r) => r.orderId))];
    const pieceIds = [...new Set(rows.map((r) => r.pieceId))];
    const [lines, draftLines, quants, pieces, orders] = await Promise.all([
      this.prisma.issueSlipLine.groupBy({
        by: ['productionOrderId', 'pieceId'],
        where: {
          kind: IssueSlipLineKind.FRAME_HANDOVER,
          productionOrderId: { in: orderIds },
          slip: { status: IssueSlipStatus.ISSUED },
        },
        _sum: { qty: true },
      }),
      this.prisma.issueSlipLine.groupBy({
        by: ['productionOrderId', 'pieceId'],
        where: {
          kind: IssueSlipLineKind.FRAME_HANDOVER,
          productionOrderId: { in: orderIds },
          slip: { status: IssueSlipStatus.DRAFT },
        },
        _sum: { qty: true },
      }),
      this.prisma.stockQuant.findMany({
        where: { warehouseId, pieceId: { in: pieceIds } },
        select: { pieceId: true, qty: true },
      }),
      this.prisma.piece.findMany({
        where: { id: { in: pieceIds } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.productionOrder.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, mfgProduct: { select: { factoryCode: true } } },
      }),
    ]);
    const k2 = (o: bigint | null, p: bigint | null) => `${o}:${p}`;
    const handedOf = new Map(
      lines.map((r) => [k2(r.productionOrderId, r.pieceId), r._sum.qty?.toNumber() ?? 0]),
    );
    const draftOf = new Map(
      draftLines.map((r) => [k2(r.productionOrderId, r.pieceId), r._sum.qty?.toNumber() ?? 0]),
    );
    const stockOf = new Map<string, number>();
    for (const q of quants) {
      if (q.pieceId == null) continue;
      stockOf.set(
        q.pieceId.toString(),
        (stockOf.get(q.pieceId.toString()) ?? 0) + q.qty.toNumber(),
      );
    }
    const pieceOf = new Map(pieces.map((p) => [p.id.toString(), p]));
    const skuOf = new Map(orders.map((o) => [o.id.toString(), o.mfgProduct.factoryCode]));
    const out = [];
    for (const r of rows) {
      const key = k2(r.orderId, r.pieceId);
      const passedQty = await this.framePassedQty(this.prisma, r.orderId, r.pieceId, warehouseId);
      const handedOverQty = handedOf.get(key) ?? 0;
      const draftQty = draftOf.get(key) ?? 0;
      const inStockQty = round4(stockOf.get(r.pieceId.toString()) ?? 0);
      const piece = pieceOf.get(r.pieceId.toString());
      out.push({
        productionOrderId: r.orderId.toString(),
        sku: skuOf.get(r.orderId.toString()) ?? '',
        pieceId: r.pieceId.toString(),
        pieceCode: piece?.code ?? '',
        pieceName: piece?.name ?? '',
        requiredQty: r.qtyPerUnit * r.orderQty,
        /** Mảnh Hàn đạt KCS đã ghi vào kho Hàn. */
        passedQty,
        handedOverQty,
        draftQty,
        /** Tồn mảnh ở kho Hàn (theo mã mảnh, chung mọi lệnh). */
        inStockQty,
        availableQty: round4(Math.max(0, inStockQty - draftQty)),
      });
    }
    return out;
  }

  /**
   * Bảng theo dõi của QLSX (3.4): theo lệnh - đoạn Phôi đạt KCS còn ở kho chờ giao, cân bằng sắt Phôi (chặn 102%),
   * từng tổ Hàn / Sơn: kho đoạn đã nhận (đã giao chưa làm), từng mảnh đã nhận / đã làm / còn, có bị chặn không, mở chặn đã cấp.
   * Không truyền lệnh: tóm tắt các lệnh đang chạy.
   */
  async getBoard(productionInvoiceId?: string) {
    const enabled = isStageHandoverEnabled();
    if (!productionInvoiceId) {
      // Tắt công tắc: QLSX mở "Sản lượng xưởng" chỉ để biết có tab Giao nhận không - trả ngay, không dựng bảng từng lệnh.
      if (!enabled) return { enabled, pis: [] };
      const pis = await this.prisma.productionInvoice.findMany({
        where: {
          status: { notIn: [ProductionInvoiceStatus.DONE, ProductionInvoiceStatus.CANCELLED] },
          items: { some: { productionOrder: { floorStage: 'ACTIVE' } } },
        },
        select: { id: true, code: true },
        orderBy: { id: 'desc' },
        take: 100,
      });
      const lenh = await loadLenhDisplayCodes(
        this.prisma,
        pis.map((p) => p.id),
      );
      const out = [];
      for (const pi of pis) {
        const b = await this.boardOfPi(pi.id);
        out.push({
          productionInvoiceId: pi.id.toString(),
          code: pi.code,
          lenhCode: lenh.get(pi.id.toString()) ?? pi.code,
          blockedPieceCount: b.stages.reduce(
            (n, s) => n + s.pieces.filter((p) => p.blocked).length,
            0,
          ),
          awaitingHandoverQty: round4(b.phoi.segments.reduce((n, s) => n + s.inKhoPhoiQty, 0)),
          handedNotUsedQty: round4(
            b.stages.reduce(
              (n, s) => n + s.pool.reduce((m, r) => m + Math.max(0, r.leftQty), 0),
              0,
            ),
          ),
          steelBlocked: b.phoi.steel.some((s) => s.blocked),
        });
      }
      return { enabled, pis: out };
    }
    const piId = parseBigIntId(productionInvoiceId);
    const pi = await this.prisma.productionInvoice.findUnique({
      where: { id: piId },
      select: { id: true, code: true },
    });
    if (!pi) throw new NotFoundException(`Không tìm thấy lệnh sản xuất ${productionInvoiceId}`);
    const lenh = await loadLenhDisplayCodes(this.prisma, [piId]);
    const board = await this.boardOfPi(piId);
    const overrides = await this.listOverrides(productionInvoiceId);
    return {
      enabled,
      productionInvoiceId: pi.id.toString(),
      code: pi.code,
      lenhCode: lenh.get(pi.id.toString()) ?? pi.code,
      ...board,
      overrides,
    };
  }

  private async boardOfPi(piId: bigint) {
    const phoiWh = await new WorkshopWarehouseResolver(this.prisma).phoiWarehouseOfPi(piId);
    const segRows = await this.segmentPlanRows(piId, phoiWh.id);
    const rows = await this.loadPiPieces(this.prisma, piId);

    // Cân bằng sắt Phôi theo loại sắt có trong định mức của lệnh.
    const materialIds = await this.prisma.segmentSpec.findMany({
      where: {
        id: { in: uniqIds(rows.flatMap((r) => [...r.codes.values()].map((c) => c.segmentSpecId))) },
      },
      select: { materialId: true, material: { select: { code: true } } },
      distinct: ['materialId'],
    });
    const steel = [];
    for (const m of materialIds) {
      const [usage, ovr] = await Promise.all([
        loadSteelUsage(this.prisma, piId, m.materialId),
        this.prisma.stageHandoverOverride.aggregate({
          where: { productionInvoiceId: piId, stage: MfgStage.PHOI, materialId: m.materialId },
          _sum: { qty: true },
        }),
      ]);
      const overrideMm = ovr._sum.qty?.toNumber() ?? 0;
      const limitMm = steelReportLimitMm(usage.usableMm, PHOI_STEEL_TOLERANCE, overrideMm);
      steel.push({
        materialId: m.materialId.toString(),
        materialCode: m.material.code,
        receivedBarCount: usage.receivedBarCount,
        usableMm: Math.round(usage.usableMm),
        reportedMm: Math.round(usage.reportedMm),
        overrideMm,
        limitMm: Math.round(limitMm),
        /** Đã chạm / vượt giới hạn: lần báo cắt tới bị chặn. */
        blocked: usage.reportedMm >= limitMm - 1e-6 && usage.receivedBarCount > 0,
      });
    }

    const orderIds = uniqIds(rows.map((r) => r.orderId));
    const [orders, pieces, plannedUsed] = await Promise.all([
      this.prisma.productionOrder.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, mfgProduct: { select: { factoryCode: true } } },
      }),
      this.prisma.piece.findMany({
        where: { id: { in: uniqIds(rows.map((r) => r.pieceId)) } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.productionBatch.groupBy({
        by: ['productionOrderId', 'pieceId', 'stage'],
        where: { productionOrderId: { in: orderIds } },
        _sum: { reportedQty: true },
      }),
    ]);
    const skuOf = new Map(orders.map((o) => [o.id.toString(), o.mfgProduct.factoryCode]));
    const pieceOf = new Map(pieces.map((p) => [p.id.toString(), p]));
    const reportedOf = new Map(
      plannedUsed.map((g) => [
        `${g.productionOrderId}:${g.pieceId}:${g.stage}`,
        g._sum.reportedQty ?? 0,
      ]),
    );
    const specIds = uniqIds(rows.flatMap((r) => [...r.codes.values()].map((c) => c.segmentSpecId)));
    const specs = await this.prisma.segmentSpec.findMany({
      where: { id: { in: specIds } },
      select: { id: true, cutLengthMm: true, material: { select: { code: true } } },
    });
    const specOf = new Map(specs.map((s) => [s.id.toString(), s]));

    const stages = [];
    for (const stage of [MfgStage.HAN, MfgStage.SON]) {
      const stageWh = await requireStageWarehouseOfPi(this.prisma, piId, stage).catch(() => null);
      const { caps, pool } = await this.pieceCapsForPi(this.prisma, piId, stage);
      const heldAtStage = stageWh
        ? await this.prisma.segmentReservation.findMany({
            where: { warehouseId: stageWh.id, productionInvoiceId: piId },
            select: {
              segmentSpecId: true,
              segmentSteps: true,
              reservedQty: true,
              consumedQty: true,
            },
          })
        : [];
      const heldOf = new Map(
        heldAtStage.map((h) => [
          segmentCodeKey(h.segmentSpecId, h.segmentSteps),
          round4(h.reservedQty.toNumber() - h.consumedQty.toNumber()),
        ]),
      );
      const stagePieces = [];
      for (const r of rows) {
        const key = `${r.orderId}:${r.pieceId}`;
        const cap = caps.get(key);
        const needs = stage === MfgStage.HAN ? r.needsHan : r.needsSon;
        if (!needs || r.cancelled) continue;
        const plannedQty = r.qtyPerUnit * r.orderQty;
        const reportedQty = reportedOf.get(`${key}:${stage}`) ?? 0;
        const maxNow = Math.max(0, plannedQty - reportedQty);
        const piece = pieceOf.get(r.pieceId.toString());
        stagePieces.push({
          productionOrderId: r.orderId.toString(),
          sku: skuOf.get(r.orderId.toString()) ?? '',
          pieceId: r.pieceId.toString(),
          pieceCode: piece?.code ?? '',
          pieceName: piece?.name ?? '',
          mode: cap?.mode ?? null,
          plannedQty,
          reportedQty,
          maxNow,
          receivedQty: cap?.receivedQty ?? null,
          usedQty: cap?.usedQty ?? null,
          receivedLeft: cap?.receivedLeft ?? null,
          overrideQty: cap?.overrideQty ?? 0,
          effectiveMaxNow: cap ? Math.min(maxNow, cap.receivedLeft) : maxNow,
          /** Còn kế hoạch mà hết hàng đã nhận: công nhân bị chặn báo. */
          blocked: enabledAnd(cap != null && maxNow > 0 && cap.receivedLeft <= 0),
        });
      }
      const poolRows = [...pool.entries()].map(([code, p]) => {
        const [specId, steps] = code.split('|');
        const spec = specOf.get(specId);
        return {
          segmentSpecId: specId,
          segmentSteps: steps,
          label: segmentCodeLabel(
            spec?.material.code ?? '',
            spec?.cutLengthMm.toNumber() ?? 0,
            steps,
          ),
          receivedQty: p.receivedQty,
          overrideQty: p.overrideQty,
          usedQty: p.usedQty,
          /** Đã giao chưa làm (âm = làm vượt số đã nhận, vd dữ liệu trước khi bật). */
          leftQty: p.leftQty,
          inStageWarehouseQty: heldOf.get(code) ?? 0,
        };
      });
      stages.push({
        stage,
        warehouseCode: stageWh?.code ?? null,
        pieces: stagePieces,
        pool: poolRows,
      });
    }
    return {
      phoi: {
        warehouseCode: phoiWh.code,
        segments: segRows.map((s) => ({
          segmentSpecId: s.segmentSpecId,
          segmentSteps: s.segmentSteps,
          label: s.label,
          requiredQty: s.requiredQty,
          passedQty: s.passedQty,
          /** Còn ở kho Phôi giữ cho lệnh - "Phôi đạt KCS chưa giao Hàn". */
          inKhoPhoiQty: s.ownHeldQty,
          handedOverQty: s.handedOverQty,
          draftQty: s.draftQty,
        })),
        steel,
      },
      stages,
    };
  }

  // ─── Dùng chung ─────────────────────────────────────────────────────────────────────────────

  /** Mọi (SKU, mảnh) của lệnh + định mức đoạn theo mã đoạn (gộp dòng cùng cỡ + cùng bộ công đoạn sau chuẩn hoá). */
  private async loadPiPieces(db: Db, piId: bigint): Promise<PiPieceRow[]> {
    const orders = await db.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: piId } },
      select: { id: true, bomRevisionId: true, quantity: true, status: true },
    });
    if (orders.length === 0) return [];
    const revs = uniqIds(orders.map((o) => o.bomRevisionId));
    const [bomPieces, pieceBoms] = await Promise.all([
      db.bomPiece.findMany({
        where: { bomRevisionId: { in: revs } },
        select: {
          bomRevisionId: true,
          pieceId: true,
          qtyPerUnit: true,
          needsHan: true,
          needsSon: true,
        },
      }),
      db.pieceBom.findMany({
        where: { bomRevisionId: { in: revs } },
        select: {
          bomRevisionId: true,
          pieceId: true,
          segmentSpecId: true,
          qtyPerPiece: true,
          processSteps: true,
        },
      }),
    ]);
    const codesOf = new Map<
      string,
      Map<string, { segmentSpecId: bigint; segmentSteps: string; qtyPerPiece: number }>
    >();
    for (const pb of pieceBoms) {
      const k = `${pb.bomRevisionId}:${pb.pieceId}`;
      const m: PiPieceRow['codes'] = codesOf.get(k) ?? new Map<string, never>();
      const segmentSteps = normalizeSegmentSteps(pb.processSteps);
      const code = segmentCodeKey(pb.segmentSpecId, segmentSteps);
      const cur = m.get(code);
      if (cur) cur.qtyPerPiece += pb.qtyPerPiece;
      else
        m.set(code, { segmentSpecId: pb.segmentSpecId, segmentSteps, qtyPerPiece: pb.qtyPerPiece });
      codesOf.set(k, m);
    }
    const out: PiPieceRow[] = [];
    for (const o of orders) {
      for (const bp of bomPieces) {
        if (bp.bomRevisionId !== o.bomRevisionId) continue;
        out.push({
          orderId: o.id,
          pieceId: bp.pieceId,
          bomRevisionId: o.bomRevisionId,
          needsHan: bp.needsHan,
          needsSon: bp.needsSon,
          qtyPerUnit: bp.qtyPerUnit,
          orderQty: o.quantity,
          cancelled: o.status === 'CANCELLED',
          codes: codesOf.get(`${o.bomRevisionId}:${bp.pieceId}`) ?? new Map<string, never>(),
        });
      }
    }
    return out;
  }

  private assertPiOpen(pi: { code: string; status: ProductionInvoiceStatus }): void {
    if (
      pi.status === ProductionInvoiceStatus.DONE ||
      pi.status === ProductionInvoiceStatus.CANCELLED
    ) {
      throw new ConflictException(`Lệnh ${pi.code} đã kết thúc - không giao / nhận hàng được`);
    }
  }

  private assertScope(warehouse: WarehouseLike, scope: string | null, what: string): void {
    if (scope && warehouse.code !== scope) {
      throw new ForbiddenException(
        `${what} nằm ở kho ${warehouse.code} - bạn đang làm kho ${scope}`,
      );
    }
  }
}

function assertWholeQty(qty: number, label: string): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new BadRequestException(`${label} phải là số nguyên lớn hơn 0`);
  }
}

function uniqIds(ids: readonly bigint[]): bigint[] {
  return [...new Set(ids.map((i) => i.toString()))].map((s) => BigInt(s));
}

/** Cờ "bị chặn" chỉ có nghĩa khi công tắc bật. */
function enabledAnd(v: boolean): boolean {
  return isStageHandoverEnabled() && v;
}
