import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  AuditAction,
  BookingStatus,
  CuttingProposalStatus,
  Prisma,
  PrismaClient,
  ProductionInvoiceStatus,
  ProductionOrderCancelStatus,
  ProductionOrderStatus,
  PurchaseProposalStatus,
} from '../../../generated/prisma/client';
import { AppClsStore } from '../../../common/interfaces/cls-store.interface';
import { lockBusinessKey } from '../../../common/utils/advisory-lock.util';
import { loadLenhDisplayCodes } from '../../../common/utils/lenh-code.util';
import { parseBigIntId } from '../../../common/utils/parse-bigint-id.util';
import {
  applySignedLowering,
  isUnsignedStatus,
  planSignedLowering,
  toRecomputeItem,
} from '../../../common/utils/purchase-recompute.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../../prisma/prisma.service';
import { writeAuditLog } from '../../../prisma/extensions/audit-log.extension';
import { RealtimeService } from '../../../realtime/realtime.service';
import { CuttingProposalsService } from '../../cutting-proposals/cutting-proposals.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ProductionOrdersService } from '../../production-orders/production-orders.service';
import { cancelEmptiedDraftOrders } from '../../purchase-proposals/supplier-order-cleanup.util';
import { recomputeProposalStatus } from '../../purchase-proposals/purchase-proposal-status.util';
import { ProductionInvoicesService } from '../production-invoices.service';

/** Người gọi (KHSX / Admin / Sếp) - roles để biết có được thao tác đề nghị của người khác không. */
export interface CancelActor {
  id: string;
  roles: string[];
}

export interface OrderCancelRequestDto {
  id: string;
  productionOrderId: string;
  poNumber: string;
  productionInvoiceId: string | null;
  productionInvoiceCode: string | null;
  productionInvoiceItemId: string;
  lsxCode: string | null;
  /** Mã lệnh để hiện: số LSX của dòng; số đã chuyển sang dòng mới (chưa dùng) thì lấy ở dòng mới; không có số thì mã PI. */
  lenhCode: string;
  factoryCode: string;
  quantity: number;
  status: ProductionOrderCancelStatus;
  reason: string;
  requestedById: string;
  requestedByName: string;
  requestedAt: Date;
  decidedById: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  replacementItemId: string | null;
  wipSnapshot: unknown;
}

/** Số hàng của SKU đang nằm ở từng công đoạn lúc Sếp duyệt huỷ - đợt 2 dùng để đưa vào tồn. Chỉ đọc, không đổi gì. */
export interface CancelWipSnapshot {
  takenAt: string;
  floorStage: string;
  floorStartedAt: string | null;
  /** Đoạn đã báo cắt cho SKU này, theo quy cách đoạn + trạng thái đợt cắt. */
  cutSegments: { segmentSpecId: string; status: string; qty: number }[];
  /** Mảnh đã báo Hàn/Sơn/... (ProductionBatch), theo công đoạn + mảnh + trạng thái. */
  pieceBatches: { stage: string; pieceId: string; status: string; qty: number }[];
  /** Mảnh vật tư thành phẩm (PieceStepBatch) đã báo. */
  pieceStepQty: { pieceId: string; qty: number }[];
  weavingIssued: { pieceId: string; qty: number }[];
  weavingReceived: { pieceId: string; qty: number }[];
  transferChecked: { pieceId: string; qty: number }[];
  boxesPacked: number;
  /** Phiếu XK sắt của CẢ lệnh (PI) - sắt xuất theo lệnh, không theo SKU. */
  steelIssuedForInvoice: {
    materialId: string;
    barLengthMm: number;
    bars: number;
    receivedBars: number;
  }[];
}

const REQUEST_INCLUDE = {
  requestedBy: { select: { firstName: true, lastName: true } },
  decidedBy: { select: { firstName: true, lastName: true } },
  replacementItem: { select: { lsxCode: true } },
  productionOrder: {
    select: {
      id: true,
      poNumber: true,
      quantity: true,
      productionInvoiceItem: {
        select: {
          id: true,
          lsxCode: true,
          productionInvoice: { select: { id: true, code: true } },
          mfgProduct: { select: { factoryCode: true } },
        },
      },
    },
  },
} satisfies Prisma.ProductionOrderCancelRequestInclude;

type RequestRow = Prisma.ProductionOrderCancelRequestGetPayload<{
  include: typeof REQUEST_INCLUDE;
}>;

const fullName = (u: { firstName: string; lastName: string } | null | undefined) =>
  u ? `${u.lastName} ${u.firstName}`.trim() : '';

/**
 * Huỷ lệnh theo SKU - đợt 1 (23/11/2026, anh Nhân trả lời 7 câu + user chốt):
 *  - câu 1: KHSX bấm "Đề nghị huỷ" kèm lý do, Sếp duyệt mới huỷ.
 *  - câu 2: huỷ theo TỪNG SKU (1 lệnh SX); SKU còn lại chạy tiếp. Lệnh gộp chưa xuất sắt thì tính lại phương án cắt cho phần còn
 *    lại; đã xuất sắt thì GIỮ phương án, tổ cắt cắt hết, phần của SKU huỷ thành dư (user chốt 23/11).
 *  - câu 3: dòng mua chưa ký tự giảm theo nhu cầu mới; dòng đã ký hạ "số cần" (buyQty) về nhu cầu mới, giữ số đã ký NCC - người
 *    mua liên hệ NCC: bớt được thì "Đóng phần thiếu" (không sinh dòng mua bù), không bớt được thì hàng về vào tồn chung.
 *  - câu 4: dòng đơn bán được cấp 1 dòng SKU MỚI "chưa lên lệnh" (ProductionOrder.productionInvoiceItemId @unique nên không lên
 *    lệnh lại trên dòng cũ được); số LSX chuyển sang dòng mới nếu chưa dùng.
 *  - câu 5: huỷ được bất kỳ lúc nào trước khi giao hàng (chưa có booking nào xuất SKU này).
 *  - câu 6/7: hàng đã làm ra GIỮ NGUYÊN tại kho công đoạn, chụp số lượng vào wipSnapshot - đợt 2 mới cho lệnh khác dùng lại.
 */
@Injectable()
export class OrderCancellationService {
  private readonly logger = new Logger(OrderCancellationService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly cls: ClsService<AppClsStore>,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly cuttingProposals: CuttingProposalsService,
    private readonly productionOrders: ProductionOrdersService,
    private readonly productionInvoices: ProductionInvoicesService,
  ) {}

  // ─── Đọc ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  async list(filter: {
    status?: ProductionOrderCancelStatus;
    productionInvoiceId?: string;
    productionOrderId?: string;
  }): Promise<OrderCancelRequestDto[]> {
    const where: Prisma.ProductionOrderCancelRequestWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.productionOrderId) {
      where.productionOrderId = parseBigIntId(filter.productionOrderId);
    }
    if (filter.productionInvoiceId) {
      where.productionOrder = {
        productionInvoiceItem: { productionInvoiceId: parseBigIntId(filter.productionInvoiceId) },
      };
    }
    const rows = await this.prisma.productionOrderCancelRequest.findMany({
      where,
      include: REQUEST_INCLUDE,
      orderBy: { id: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toDto(r));
  }

  // ─── KHSX đề nghị / rút lại ─────────────────────────────────────────────────────────────────────────────────────────────

  async request(
    actor: CancelActor,
    input: { productionOrderId: string; reason: string },
  ): Promise<OrderCancelRequestDto> {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('Phải ghi lý do huỷ');
    const orderId = parseBigIntId(input.productionOrderId);
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        productionInvoiceItemId: true,
        productionInvoiceItem: {
          select: {
            lsxCode: true,
            productionInvoice: { select: { code: true } },
            mfgProduct: { select: { factoryCode: true } },
          },
        },
      },
    });
    if (!order)
      throw new NotFoundException(`Không tìm thấy lệnh sản xuất ${input.productionOrderId}`);
    if (order.status === ProductionOrderStatus.CANCELLED) {
      throw new ConflictException('Lệnh này đã huỷ');
    }
    await this.assertNotShipped(this.prisma, order.productionInvoiceItemId);

    let created: RequestRow;
    try {
      created = await this.prisma.productionOrderCancelRequest.create({
        data: { productionOrderId: orderId, reason, requestedById: actor.id },
        include: REQUEST_INCLUDE,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Lệnh này đã có đề nghị huỷ đang chờ Sếp duyệt');
      }
      throw error;
    }

    const item = order.productionInvoiceItem;
    try {
      await this.notifications.emit('PO_CANCEL_PENDING', {
        entityId: orderId.toString(),
        actorId: actor.id,
        dedupeKey: `PO_CANCEL_PENDING:${created.id}`,
        params: {
          lenhCode: item.lsxCode ?? item.productionInvoice?.code ?? `#${orderId}`,
          factoryCode: item.mfgProduct.factoryCode,
          requestedByName: fullName(created.requestedBy),
          reason,
        },
      });
    } catch (error) {
      this.logger.error(`Không báo được đề nghị huỷ ${created.id}: ${(error as Error).message}`);
    }
    this.publish(orderId, actor.id);
    return this.toDto(created);
  }

  async withdraw(actor: CancelActor, requestId: string): Promise<OrderCancelRequestDto> {
    const id = parseBigIntId(requestId);
    const row = await this.prisma.productionOrderCancelRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Không tìm thấy đề nghị huỷ ${requestId}`);
    if (row.requestedById !== actor.id && !actor.roles.includes('ADMIN')) {
      throw new ConflictException('Chỉ người đề nghị (hoặc Admin) được rút lại đề nghị huỷ');
    }
    const { count } = await this.prisma.productionOrderCancelRequest.updateMany({
      where: { id, status: ProductionOrderCancelStatus.PENDING },
      data: { status: ProductionOrderCancelStatus.WITHDRAWN, decidedAt: new Date() },
    });
    if (count === 0) throw new ConflictException('Đề nghị huỷ không còn chờ duyệt - tải lại trang');
    await this.resolvePending(row.productionOrderId, id);
    this.publish(row.productionOrderId, actor.id);
    return this.toDto(
      await this.prisma.productionOrderCancelRequest.findUniqueOrThrow({
        where: { id },
        include: REQUEST_INCLUDE,
      }),
    );
  }

  // ─── Sếp quyết ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  async decide(
    actor: CancelActor,
    requestId: string,
    input: { approve: boolean; note?: string },
  ): Promise<OrderCancelRequestDto> {
    const id = parseBigIntId(requestId);
    const note = input.note?.trim() || undefined;
    const row = await this.prisma.productionOrderCancelRequest.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Không tìm thấy đề nghị huỷ ${requestId}`);
    if (row.status !== ProductionOrderCancelStatus.PENDING) {
      throw new ConflictException(`Đề nghị huỷ đã ở trạng thái ${row.status} - tải lại trang`);
    }
    const item = row.productionOrder.productionInvoiceItem;
    const lenhCode = item.lsxCode ?? item.productionInvoice?.code ?? row.productionOrder.poNumber;
    const factoryCode = item.mfgProduct.factoryCode;

    if (!input.approve) {
      if (!note) throw new BadRequestException('Từ chối phải ghi lý do');
      const { count } = await this.prisma.productionOrderCancelRequest.updateMany({
        where: { id, status: ProductionOrderCancelStatus.PENDING },
        data: {
          status: ProductionOrderCancelStatus.REJECTED,
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: note,
        },
      });
      if (count === 0)
        throw new ConflictException('Đề nghị huỷ vừa được xử lý ở nơi khác - tải lại trang');
      await this.resolvePending(row.productionOrderId, id);
      await this.emitSafe('PO_CANCEL_DECIDED', row.productionOrderId, actor.id, {
        lenhCode,
        factoryCode,
        approved: false,
        note,
        requestedById: row.requestedById,
      });
      this.publish(row.productionOrderId, actor.id);
      return this.toDto(
        await this.prisma.productionOrderCancelRequest.findUniqueOrThrow({
          where: { id },
          include: REQUEST_INCLUDE,
        }),
      );
    }

    const outcome = await this.prisma.$transaction(
      async (tx) => this.approveInTx(tx, actor, id, row.productionOrderId, note),
      { timeout: 30_000 },
    );

    // Sau commit, best-effort (cùng kiểu Kết thúc lệnh): lỗi ở đây chỉ log, không làm hỏng việc huỷ đã ghi.
    await this.afterApproved(outcome, actor.id);

    await this.resolvePending(row.productionOrderId, id);
    for (const batchId of outcome.closedDeadlineBatchIds) {
      await this.step('đóng thông báo đổi mốc', () =>
        this.notifications.resolve({
          entityType: 'DEADLINE_CHANGE_BATCH',
          entityId: batchId.toString(),
          types: ['DEADLINE_CHANGE_PENDING'],
        }),
      );
    }
    await this.emitSafe('PO_CANCEL_DECIDED', row.productionOrderId, actor.id, {
      lenhCode,
      factoryCode,
      approved: true,
      note: [note, outcome.replanNote].filter(Boolean).join('. ') || undefined,
      requestedById: row.requestedById,
    });
    await this.emitSafe('PO_CANCELLED', row.productionOrderId, actor.id, {
      lenhCode,
      factoryCode,
      reason: row.reason,
      signedLineCount: outcome.signedLineCount,
    });
    this.publish(row.productionOrderId, actor.id);
    if (outcome.productionInvoiceId != null) {
      this.realtime.publishEntityChanged({
        entity: 'PRODUCTION_INVOICE',
        entityId: outcome.productionInvoiceId,
        action: 'UPDATED',
        actorId: actor.id,
      });
    }
    return this.toDto(
      await this.prisma.productionOrderCancelRequest.findUniqueOrThrow({
        where: { id },
        include: REQUEST_INCLUDE,
      }),
    );
  }

  /** Phần ghi trong 1 transaction: đổi trạng thái lệnh/dòng, cấp dòng SKU mới, chụp số hàng từng công đoạn. */
  private async approveInTx(
    tx: PrismaTx,
    actor: CancelActor,
    requestId: bigint,
    orderId: bigint,
    note: string | undefined,
  ): Promise<ApproveOutcome> {
    // Khoá dòng lệnh: chặn 2 lượt duyệt / Kết thúc / Bắt đầu chen giữa lúc đang huỷ.
    await tx.$queryRaw`SELECT "id" FROM "production_orders" WHERE "id" = ${orderId} FOR UPDATE`;
    const order = await tx.productionOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { productionInvoiceItem: true },
    });
    if (order.status === ProductionOrderStatus.CANCELLED) {
      throw new ConflictException('Lệnh này đã huỷ');
    }
    const item = order.productionInvoiceItem;
    await this.assertNotShipped(tx, item.id);
    await this.assertNoOpenBookingLines(tx, item.id);

    const { count } = await tx.productionOrderCancelRequest.updateMany({
      where: { id: requestId, status: ProductionOrderCancelStatus.PENDING },
      data: {
        status: ProductionOrderCancelStatus.APPROVED,
        decidedById: actor.id,
        decidedAt: new Date(),
        decisionNote: note ?? null,
      },
    });
    if (count === 0)
      throw new ConflictException('Đề nghị huỷ vừa được xử lý ở nơi khác - tải lại trang');

    const snapshot = await this.snapshotWip(tx, order, item.productionInvoiceId);
    const lsxUsed =
      order.floorStartedAt != null ||
      snapshot.steelIssuedForInvoice.length > 0 ||
      snapshot.cutSegments.length > 0 ||
      snapshot.pieceBatches.length > 0 ||
      snapshot.boxesPacked > 0;
    const moveLsx = item.lsxCode != null && !lsxUsed;

    await tx.productionOrder.update({
      where: { id: orderId },
      data: {
        status: ProductionOrderStatus.CANCELLED,
        floorStage: 'FINISHED',
        ...(order.floorFinishedAt == null ? { floorFinishedAt: new Date() } : {}),
      },
    });
    await tx.productionInvoiceItem.update({
      where: { id: item.id },
      data: { cancelledAt: new Date(), ...(moveLsx ? { lsxCode: null } : {}) },
    });

    // Dòng SKU mới cho dòng đơn bán - "chưa lên lệnh" (productionInvoiceId NULL, chưa gửi QLSX). Dòng tạo tay (không gắn dòng
    // đơn) thì không cấp: không có đơn nào chờ hàng.
    let replacementItemId: bigint | null = null;
    if (item.salesOrderItemId != null) {
      const replacement = await tx.productionInvoiceItem.create({
        data: {
          salesOrderId: item.salesOrderId,
          salesOrderItemId: item.salesOrderItemId,
          mfgProductId: item.mfgProductId,
          productVariantId: item.productVariantId,
          wireMaterialId: item.wireMaterialId,
          cushionMaterialId: item.cushionMaterialId,
          quantity: item.quantity,
          materialDeadline: item.materialDeadline,
          finishedMaterialDeadline: item.finishedMaterialDeadline,
          deliveryDeadline: item.deliveryDeadline,
          lsxCode: moveLsx ? item.lsxCode : null,
        },
      });
      replacementItemId = replacement.id;
    }

    await tx.productionOrderCancelRequest.update({
      where: { id: requestId },
      data: {
        wipSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        replacementItemId,
      },
    });

    const closedDeadlineBatchIds = await this.cancelPendingDeadlineChanges(tx, item.id);

    // Lệnh không còn dòng SKU nào chạy -> cả lệnh Huỷ.
    let invoiceCancelled = false;
    if (item.productionInvoiceId != null) {
      const live = await tx.productionInvoiceItem.count({
        where: { productionInvoiceId: item.productionInvoiceId, cancelledAt: null },
      });
      if (live === 0) {
        await tx.productionInvoice.update({
          where: { id: item.productionInvoiceId },
          data: { status: ProductionInvoiceStatus.CANCELLED },
        });
        invoiceCancelled = true;
      }
    }

    const auditClient = tx as unknown as Pick<PrismaClient, 'auditLog'>;
    await writeAuditLog(auditClient, this.cls, {
      action: AuditAction.UPDATE,
      tableName: 'ProductionOrder',
      recordId: orderId.toString(),
      oldValue: { status: order.status, floorStage: order.floorStage },
      newValue: {
        status: ProductionOrderStatus.CANCELLED,
        floorStage: 'FINISHED',
        cancelRequestId: requestId.toString(),
        replacementItemId: replacementItemId?.toString() ?? null,
        lsxMoved: moveLsx,
      },
    });

    return {
      orderId,
      itemId: item.id,
      productionInvoiceId: item.productionInvoiceId,
      invoiceCancelled,
      steelIssued: snapshot.steelIssuedForInvoice.length > 0,
      signedLineCount: 0,
      replanNote: undefined,
      closedDeadlineBatchIds,
    };
  }

  /**
   * Yêu cầu đổi mốc còn chờ Sếp của dòng vừa huỷ hết ý nghĩa -> huỷ theo (cùng cách DeadlineChangesService.cancelRequest: khoá lô,
   * lô hết yêu cầu chờ thì đóng). Thử sống 23/11: dòng đã huỷ vẫn hiện "Chờ Sếp duyệt lại". Trả id lô vừa đóng để đóng thông báo.
   */
  private async cancelPendingDeadlineChanges(tx: PrismaTx, itemId: bigint): Promise<bigint[]> {
    const pending = await tx.deadlineChangeRequest.findMany({
      where: { productionInvoiceItemId: itemId, status: 'PENDING' },
      select: { id: true, batchId: true },
    });
    const closed: bigint[] = [];
    for (const req of pending) {
      await lockBusinessKey(tx, `deadline-change:batch:${req.batchId.toString()}`);
      await tx.deadlineChangeRequest.updateMany({
        where: { id: req.id, status: 'PENDING' },
        data: { status: 'CANCELLED', decidedAt: new Date() },
      });
      const siblings = await tx.deadlineChangeRequest.findMany({
        where: { batchId: req.batchId },
        select: { status: true },
      });
      if (!siblings.some((s) => s.status === 'PENDING')) {
        const anyDecided = siblings.some((s) => s.status === 'APPROVED' || s.status === 'REJECTED');
        await tx.deadlineChangeBatch.update({
          where: { id: req.batchId },
          data: { status: anyDecided ? 'DECIDED' : 'CANCELLED' },
        });
        closed.push(req.batchId);
      }
    }
    return closed;
  }

  /**
   * Sau commit: nhả / tính lại phần của lệnh. Mỗi bước try/catch riêng (cùng kiểu releaseReservationsIfPiFinished) - bước sau
   * vẫn chạy khi bước trước lỗi; mọi bước idempotent.
   */
  private async afterApproved(outcome: ApproveOutcome, actorId: string): Promise<void> {
    const piId = outcome.productionInvoiceId;
    if (piId == null) return;

    // Mọi lệnh SX còn lại của PI đã Kết thúc (hoặc cả lệnh huỷ) -> nhả giữ chỗ vật tư + giữ đoạn như luồng Kết thúc.
    await this.productionOrders.releaseReservationsIfPiFinished(outcome.itemId);

    if (outcome.invoiceCancelled) {
      await this.step('gỡ phương án cắt chưa duyệt', () =>
        this.prisma.$transaction((tx) => this.cuttingProposals.releaseForInvoice(tx, piId)),
      );
      await this.step('đóng dòng mua của lệnh huỷ', async () => {
        outcome.signedLineCount = await this.closePurchaseLinesOfCancelledInvoice(piId);
      });
      return;
    }

    // Còn SKU chạy tiếp: tính lại phương án cắt (lệnh gộp, chưa xuất sắt) rồi mới tính lại 3 nguồn mua ngoài sắt - cùng thứ tự
    // với lúc duyệt (sắt trước, ngoài sắt trong onComplete).
    const replan = await this.replanSteelIfPossible(piId, actorId, outcome);
    if (!replan) {
      await this.step('tính lại dòng mua ngoài sắt', () =>
        this.productionInvoices.computeNonSteelPurchaseProposals(
          piId,
          `huỷ lệnh ${outcome.orderId}`,
          {
            lowerSignedOnDrop: true,
          },
        ),
      );
    }
    await this.step('đếm dòng mua đã ký', async () => {
      outcome.signedLineCount = await this.prisma.purchaseProposalItem.count({
        where: {
          proposal: { productionInvoiceId: piId },
          status: PurchaseProposalStatus.PURCHASING,
        },
      });
    });
  }

  /**
   * Lệnh GỘP chưa xuất sắt: tính lại phương án cho các SKU còn lại (requestForInvoice bỏ lệnh đã huỷ - xem buildInvoiceJob), xong
   * thì duyệt thay nếu sạch rồi tính lại mua ngoài sắt. Đã xuất sắt / không phải lệnh gộp: giữ phương án (user chốt 23/11). Trả
   * true khi đã giao việc tính lại mua ngoài sắt cho onComplete.
   */
  private async replanSteelIfPossible(
    piId: bigint,
    actorId: string,
    outcome: ApproveOutcome,
  ): Promise<boolean> {
    if (outcome.steelIssued) {
      outcome.replanNote =
        'Lệnh đã xuất sắt nên giữ phương án cắt: tổ cắt cắt hết, phần của SKU huỷ thành dư';
      return false;
    }
    const pi = await this.prisma.productionInvoice.findUnique({
      where: { id: piId },
      select: { isMerged: true },
    });
    const approved = await this.prisma.cuttingProposal.count({
      where: { productionInvoiceId: piId, status: CuttingProposalStatus.APPROVED },
    });
    if (!pi?.isMerged || approved === 0) {
      if (!pi?.isMerged) {
        outcome.replanNote = 'Lệnh không gộp nên giữ phương án cắt của các SKU còn lại';
      }
      return false;
    }
    try {
      const context = `huỷ lệnh ${outcome.orderId}`;
      let proposalId: bigint | null = null;
      const created = await this.cuttingProposals.requestForInvoice(piId, {
        requestedById: actorId,
        onComplete: async () => {
          if (proposalId != null) {
            // Duyệt thay lỗi (vd xung đột chiều dài cây) cũng coi như "giữ phương án cũ" - vẫn báo KHSX và vẫn tính lại mua
            // ngoài sắt bên dưới (lỗi ném ra ở đây trước kia bỏ qua cả 2, thử sống 23/11).
            let res: { approved: boolean; reason?: string };
            try {
              res = await this.cuttingProposals.approveCancellationReplan(proposalId, actorId);
            } catch (error) {
              res = { approved: false, reason: (error as Error).message };
            }
            if (!res.approved) {
              this.logger.warn(`Không thay phương án cắt sau ${context}: ${res.reason}`);
              await this.emitReplanKept(piId, res.reason ?? 'không rõ');
            }
          }
          await this.productionInvoices.computeNonSteelPurchaseProposals(piId, context, {
            lowerSignedOnDrop: true,
          });
        },
      });
      proposalId = BigInt(created.id);
      outcome.replanNote = 'Đang tính lại phương án cắt cho các SKU còn lại của lệnh gộp';
      return true;
    } catch (error) {
      this.logger.error(
        `Không tính lại được phương án cắt (PI ${piId}): ${(error as Error).message}`,
      );
      outcome.replanNote = `Chưa tính lại được phương án cắt (${(error as Error).message}) - giữ phương án cũ`;
      return false;
    }
  }

  /** Phương án mới không sạch (vượt ngưỡng / vô nghiệm / lỗi) -> giữ phương án cũ, báo KHSX tự quyết "Tính lại" hay giữ. */
  private async emitReplanKept(piId: bigint, reason: string): Promise<void> {
    try {
      const codes = await loadLenhDisplayCodes(this.prisma, [piId]);
      await this.notifications.emit('PO_CANCEL_REPLAN_KEPT', {
        entityId: piId.toString(),
        dedupeKey: `PO_CANCEL_REPLAN_KEPT:${piId}`,
        params: { lenhCode: codes.get(piId.toString()) ?? `#${piId}`, reason },
      });
    } catch (error) {
      this.logger.error(
        `Không báo được giữ phương án cũ (PI ${piId}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Cả lệnh huỷ: dòng mua chưa ký -> đóng (số mua 0, rời đơn đặt hàng nháp); dòng đã ký -> hạ "số cần" về số đã nhận (phần còn về
   * thành tồn chung, "Đóng phần thiếu" không sinh dòng mua bù) và giữ nguyên số đã ký với NCC. Trả số dòng đã ký còn chờ hàng.
   */
  private async closePurchaseLinesOfCancelledInvoice(piId: bigint): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const items = await tx.purchaseProposalItem.findMany({
        where: {
          proposal: { productionInvoiceId: piId },
          status: { not: PurchaseProposalStatus.PURCHASED },
        },
        select: {
          id: true,
          proposalId: true,
          status: true,
          buyQty: true,
          orderQty: true,
          receivedQty: true,
          supplierOrderId: true,
        },
        orderBy: { id: 'asc' },
      });
      const detachedOrderIds: (bigint | null)[] = [];
      let signedPending = 0;
      const now = new Date();
      for (const it of items) {
        if (isUnsignedStatus(it.status)) {
          detachedOrderIds.push(it.supplierOrderId);
          await tx.purchaseProposalItem.update({
            where: { id: it.id },
            data: {
              buyQty: 0,
              orderQty: null,
              status: PurchaseProposalStatus.PURCHASED,
              purchasedAt: now,
              supplierOrderId: null,
            },
          });
        } else if (it.status === PurchaseProposalStatus.PURCHASING) {
          const rec = toRecomputeItem(it);
          if (rec.receivedQty < (rec.orderQty ?? rec.buyQty)) signedPending += 1;
          await applySignedLowering(tx, planSignedLowering([rec], rec.receivedQty));
        }
      }
      await cancelEmptiedDraftOrders(tx, detachedOrderIds, 'Huỷ lệnh sản xuất: mọi dòng đã đóng');
      for (const pid of [...new Set(items.map((i) => i.proposalId))]) {
        await recomputeProposalStatus(tx, pid);
      }
      return signedPending;
    });
  }

  // ─── Kiểm ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Câu 5: đã giao (booking đã xuất dòng của SKU này) thì không huỷ. */
  private async assertNotShipped(
    db: PrismaServiceType | PrismaTx,
    productionInvoiceItemId: bigint,
  ): Promise<void> {
    const shipped = await db.bookingLine.aggregate({
      where: { productionInvoiceItemId },
      _sum: { shippedQty: true },
    });
    if ((shipped._sum.shippedQty ?? 0) > 0) {
      throw new ConflictException(
        `SKU này đã xuất ${shipped._sum.shippedQty} cái theo booking - không huỷ được sau khi đã giao hàng`,
      );
    }
  }

  /** Booking chưa xuất còn dòng của SKU này -> phải gỡ dòng khỏi booking trước (không tự gỡ: booking là việc của Sales). */
  private async assertNoOpenBookingLines(
    tx: PrismaTx,
    productionInvoiceItemId: bigint,
  ): Promise<void> {
    const lines = await tx.bookingLine.findMany({
      where: {
        productionInvoiceItemId,
        qty: { gt: 0 },
        booking: { status: { in: [BookingStatus.DRAFT, BookingStatus.CONFIRMED] } },
      },
      select: { booking: { select: { bookingNo: true } } },
    });
    if (lines.length > 0) {
      const nos = [...new Set(lines.map((l) => l.booking.bookingNo))].join(', ');
      throw new ConflictException(
        `SKU này còn nằm trong booking ${nos} - gỡ SKU khỏi booking trước rồi duyệt huỷ`,
      );
    }
  }

  // ─── Chụp số hàng từng công đoạn (đợt 2 dùng) ──────────────────────────────────────────────────────────────────────────

  private async snapshotWip(
    tx: PrismaTx,
    order: {
      id: bigint;
      floorStage: string;
      floorStartedAt: Date | null;
      productionInvoiceItemId: bigint;
    },
    productionInvoiceId: bigint | null,
  ): Promise<CancelWipSnapshot> {
    const orderId = order.id;
    const [cut, batches, steps, weaveOut, weaveIn, checks, packed, steel] = await Promise.all([
      tx.cutPatternSegment.findMany({
        where: { cutBundle: { productionOrderId: orderId } },
        select: { segmentSpecId: true, qty: true, cutBundle: { select: { status: true } } },
      }),
      tx.productionBatch.groupBy({
        by: ['stage', 'pieceId', 'status'],
        where: { productionOrderId: orderId },
        _sum: { reportedQty: true },
      }),
      tx.pieceStepBatch.groupBy({
        by: ['pieceId'],
        where: { productionOrderId: orderId },
        _sum: { qty: true },
      }),
      tx.weavingIssue.groupBy({
        by: ['pieceId'],
        where: { productionOrderId: orderId },
        _sum: { qty: true },
      }),
      tx.weavingReceipt.groupBy({
        by: ['pieceId'],
        where: { productionOrderId: orderId },
        _sum: { qty: true },
      }),
      tx.transferCheckResult.groupBy({
        by: ['pieceId'],
        where: { productionInvoiceItemId: order.productionInvoiceItemId },
        _sum: { checkedQty: true },
      }),
      tx.packagingRecord.aggregate({
        where: { productionInvoiceItemId: order.productionInvoiceItemId },
        _sum: { boxesPacked: true },
      }),
      productionInvoiceId == null
        ? Promise.resolve([])
        : tx.steelIssue.groupBy({
            by: ['materialId', 'barLengthMm'],
            where: { productionInvoiceId },
            _sum: { barCount: true, receivedBarCount: true },
          }),
    ]);

    const cutAgg = new Map<string, { segmentSpecId: string; status: string; qty: number }>();
    for (const c of cut) {
      const key = `${c.segmentSpecId}|${c.cutBundle.status}`;
      const prev = cutAgg.get(key);
      if (prev) prev.qty += c.qty;
      else
        cutAgg.set(key, {
          segmentSpecId: c.segmentSpecId.toString(),
          status: c.cutBundle.status,
          qty: c.qty,
        });
    }
    return {
      takenAt: new Date().toISOString(),
      floorStage: order.floorStage,
      floorStartedAt: order.floorStartedAt?.toISOString() ?? null,
      cutSegments: [...cutAgg.values()],
      pieceBatches: batches.map((b) => ({
        stage: b.stage,
        pieceId: b.pieceId.toString(),
        status: b.status,
        qty: b._sum.reportedQty ?? 0,
      })),
      pieceStepQty: steps.map((s) => ({ pieceId: s.pieceId.toString(), qty: s._sum.qty ?? 0 })),
      weavingIssued: weaveOut.map((w) => ({ pieceId: w.pieceId.toString(), qty: w._sum.qty ?? 0 })),
      weavingReceived: weaveIn.map((w) => ({
        pieceId: w.pieceId.toString(),
        qty: w._sum.qty ?? 0,
      })),
      transferChecked: checks.map((c) => ({
        pieceId: c.pieceId.toString(),
        qty: c._sum.checkedQty ?? 0,
      })),
      boxesPacked: packed._sum.boxesPacked ?? 0,
      steelIssuedForInvoice: steel.map((s) => ({
        materialId: s.materialId.toString(),
        barLengthMm: s.barLengthMm,
        bars: s._sum.barCount ?? 0,
        receivedBars: s._sum.receivedBarCount ?? 0,
      })),
    };
  }

  // ─── Phụ ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async step(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(`Huỷ lệnh - bước "${label}" lỗi: ${(error as Error).message}`);
    }
  }

  private async resolvePending(orderId: bigint, requestId: bigint): Promise<void> {
    try {
      await this.notifications.resolve({
        entityType: 'PRODUCTION_ORDER',
        entityId: orderId.toString(),
        types: ['PO_CANCEL_PENDING'],
      });
    } catch (error) {
      this.logger.error(
        `Không đóng được thông báo đề nghị huỷ ${requestId}: ${(error as Error).message}`,
      );
    }
  }

  private async emitSafe(
    type: 'PO_CANCEL_DECIDED' | 'PO_CANCELLED',
    orderId: bigint,
    actorId: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.notifications.emit(type, { entityId: orderId.toString(), actorId, params });
    } catch (error) {
      this.logger.error(`Không gửi được ${type} (lệnh ${orderId}): ${(error as Error).message}`);
    }
  }

  private publish(orderId: bigint, actorId: string): void {
    this.realtime.publishEntityChanged({
      entity: 'PRODUCTION_ORDER',
      entityId: orderId,
      action: 'UPDATED',
      actorId,
    });
    // Xưởng (KCS / Sản lượng xưởng) tự tải lại - cùng kiểu recordFloorChange.
    this.realtime.publishEntityChanged({
      entity: 'FLOOR_REPORT',
      entityId: orderId,
      action: 'UPDATED',
      actorId: null,
    });
  }

  private toDto(r: RequestRow): OrderCancelRequestDto {
    const item = r.productionOrder.productionInvoiceItem;
    return {
      id: r.id.toString(),
      productionOrderId: r.productionOrderId.toString(),
      poNumber: r.productionOrder.poNumber,
      productionInvoiceId: item.productionInvoice?.id.toString() ?? null,
      productionInvoiceCode: item.productionInvoice?.code ?? null,
      productionInvoiceItemId: item.id.toString(),
      lsxCode: item.lsxCode,
      lenhCode:
        item.lsxCode ??
        r.replacementItem?.lsxCode ??
        item.productionInvoice?.code ??
        r.productionOrder.poNumber,
      factoryCode: item.mfgProduct.factoryCode,
      quantity: r.productionOrder.quantity,
      status: r.status,
      reason: r.reason,
      requestedById: r.requestedById,
      requestedByName: fullName(r.requestedBy),
      requestedAt: r.requestedAt,
      decidedById: r.decidedById,
      decidedByName: r.decidedBy ? fullName(r.decidedBy) : null,
      decidedAt: r.decidedAt,
      decisionNote: r.decisionNote,
      replacementItemId: r.replacementItemId?.toString() ?? null,
      wipSnapshot: r.wipSnapshot,
    };
  }
}

interface ApproveOutcome {
  orderId: bigint;
  itemId: bigint;
  productionInvoiceId: bigint | null;
  invoiceCancelled: boolean;
  steelIssued: boolean;
  /** Ghi sau commit (afterApproved) - số dòng mua đã ký NCC còn chờ hàng, để báo Mua hàng. */
  signedLineCount: number;
  /** Ghi chú về phương án cắt (giữ / đang tính lại) - gửi kèm thông báo cho KHSX. */
  replanNote: string | undefined;
  /** Lô đổi mốc vừa đóng vì dòng huỷ - đóng thông báo chờ Sếp sau commit. */
  closedDeadlineBatchIds: bigint[];
}
