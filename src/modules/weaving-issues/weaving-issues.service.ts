import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { auditEvent } from '../../common/utils/audit-event.util';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import {
  AuditAction,
  IssueSlipLineKind,
  IssueSlipStatus,
  MfgStage,
  Piece,
  Prisma,
  ProductionBatchStatus,
  ProductionOrder,
  StockLedgerRefType,
  SteelSubGroup,
  TransferStatus,
  WarehouseKind,
  WeavingPoint,
} from '../../generated/prisma/client';
import { MATERIAL_GROUP_SYSTEM_KEYS } from '../../common/constants/material-group-system-keys.constant';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { assertItemPiHasActiveFloor } from '../../common/utils/floor-gate.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { warehouseFamilyOf } from '../../common/utils/warehouse-family.util';
import { paginate } from '../../common/utils/paginate.util';
import {
  loadSkuPriorityHoldback,
  SiblingOrder,
  skuHoldbackMessage,
} from '../stock/sku-priority.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { loadBomOptionExclusions } from '../bom-revisions/bom-option.util';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { WorkshopWarehouseResolver } from '../stock/workshop-warehouse.util';
import { RealtimeEntity, RealtimeEntityAction } from '../../realtime/realtime.contract';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { CreateWeavingReceiptDto } from './dto/create-weaving-receipt.dto';
import { WeavingAllocationItemResponseDto } from './dto/weaving-allocation-item-response.dto';
import { WeavingIssuePlanItemResponseDto } from './dto/weaving-issue-plan-item-response.dto';
import { WeavingIssueResponseDto } from './dto/weaving-issue-response.dto';
import { WeavingPieceMaterialLineResponseDto } from './dto/weaving-piece-material-line-response.dto';
import { WeavingPointAssignmentResponseDto } from './dto/weaving-point-assignment-response.dto';
import { WeavingPointGroupResponseDto } from './dto/weaving-point-group-response.dto';
import { WeavingReceiptResponseDto } from './dto/weaving-receipt-response.dto';
import { PIECE_TRANSFER_LEAVES_FRAME } from '../warehouse-transfers/transfer-routes.constant';

// Mã đơn Sales gốc (hiển thị cột "PO" cho người dùng) - xem toIssueResponseDto/toReceiptResponseDto.
const PRODUCTION_ORDER_WITH_SALES_CODE = {
  include: { productionInvoiceItem: { select: { salesOrder: { select: { orderCode: true } } } } },
} satisfies Prisma.ProductionOrderDefaultArgs;

const WEAVING_ISSUE_INCLUDE = {
  productionOrder: PRODUCTION_ORDER_WITH_SALES_CODE,
  piece: true,
  weavingPoint: true,
} satisfies Prisma.WeavingIssueInclude;

const WEAVING_RECEIPT_INCLUDE = {
  productionOrder: PRODUCTION_ORDER_WITH_SALES_CODE,
  piece: true,
  weavingPoint: true,
} satisfies Prisma.WeavingReceiptInclude;

export type WeavingIssueRow = Prisma.WeavingIssueGetPayload<{
  include: typeof WEAVING_ISSUE_INCLUDE;
}>;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** 1 dòng mảnh của phiếu xuất đan đã kiểm xong (ngoài transaction) - IssueSlipsService ghi trong transaction xác nhận. */
export interface PreparedWeavingPiece {
  order: ProductionOrder;
  pieceId: bigint;
  pieceName: string;
  weavingPointId: bigint;
  qty: number;
  plannedQty: number;
  finalStage: MfgStage;
  /** Kho đang giữ mảnh (nơi xuất). */
  warehouse: { id: bigint; code: string };
}

/** 1 dòng vật tư kèm (phiếu 2) đã kiểm xong. */
export interface PreparedWeavingMaterial {
  order: ProductionOrder;
  productionInvoiceId: bigint;
  pieceId: bigint;
  weavingPointId: bigint;
  materialId: bigint;
  materialCode: string;
  warehouseId: bigint;
  qty: number;
}
type WeavingReceiptRow = Prisma.WeavingReceiptGetPayload<{
  include: typeof WEAVING_RECEIPT_INCLUDE;
}>;

// Cùng PRODUCTION_ORDER_WITH_SALES_CODE + tên sản phẩm (productLabel) - chỉ cần cho
// findAllGroupedByPoint(), các hàm theo 1 PO ở trên không cần tên sản phẩm.
const PRODUCTION_ORDER_WITH_SALES_CODE_AND_PRODUCT = {
  include: {
    productionInvoiceItem: { select: { salesOrder: { select: { orderCode: true } } } },
    mfgProduct: { select: { name: true } },
  },
} satisfies Prisma.ProductionOrderDefaultArgs;

const WEAVING_ISSUE_BY_POINT_INCLUDE = {
  productionOrder: PRODUCTION_ORDER_WITH_SALES_CODE_AND_PRODUCT,
  piece: true,
  weavingPoint: true,
} satisfies Prisma.WeavingIssueInclude;

const WEAVING_RECEIPT_BY_POINT_INCLUDE = {
  productionOrder: PRODUCTION_ORDER_WITH_SALES_CODE_AND_PRODUCT,
  piece: true,
  weavingPoint: true,
} satisfies Prisma.WeavingReceiptInclude;

type WeavingIssueByPointRow = Prisma.WeavingIssueGetPayload<{
  include: typeof WEAVING_ISSUE_BY_POINT_INCLUDE;
}>;
type WeavingReceiptByPointRow = Prisma.WeavingReceiptGetPayload<{
  include: typeof WEAVING_RECEIPT_BY_POINT_INCLUDE;
}>;

/// Nhận lại mảnh đã đan từ điểm đan về kho thành phẩm (thủ kho 'thanh-pham' quản). Xuất đan (09/11/2026) đi phiếu XK của kho
/// giữ mảnh / kho Phụ kiện - xem prepareWeavingPiece()/prepareWeavingMaterial().
const WEAVING_RECEIVE_WAREHOUSE_CODE = 'thanh-pham';

/// Kho ảo cố định (protected-warehouse-codes.constant.ts) - điểm đến khi trừ tồn Dây/Đinh/Nút
/// nhựa thật thủ kho mang kèm mảnh (WeavingIssueMaterial), mirror MaterialIssuesService
/// (PRODUCTION_WAREHOUSE_CODE ở đó) - vật tư coi như "đã tiêu thụ vào sản xuất" khi rời kho.
const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';

/**
 * Phân bổ/nhận hàng đan (M2 ưu tiên 1, thay manh.service.ts mock) - lớp theo dõi THỰC THI của
 * kho vật tư-TP xuất khung cho điểm đan ngoài ("xuất đan") và nhận lại hàng đã đan xong ("nhập
 * đan"). Append-only, KHÔNG có state machine (khác SteelIssue) - mọi vi phạm nghiệp vụ là 400
 * (validate số lượng), không có transition trạng thái nào để 409. KHÔNG ghi StockLedger, cùng
 * lý do SteelIssue không ghi (xem comment đầu schema.prisma "Phase 9b").
 */
@Injectable()
export class WeavingIssuesService {
  private readonly logger = new Logger(WeavingIssuesService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
    private readonly stockReservationsService: StockReservationsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** Phát realtime SAU KHI transaction đã commit (xem RealtimeService). */
  private publishRealtime(
    entity: RealtimeEntity,
    entityId: bigint | string,
    action: RealtimeEntityAction,
    actorId: string | null,
  ): void {
    this.realtime.publishEntityChanged({ entity, entityId, action, actorId });
  }

  /**
   * Phiếu 1 xuất đan (anh Nhân 09/11/2026): mảnh đã xong công đoạn cuối xuất THẲNG từ kho đang giữ mảnh (thường là kho Sơn) ra
   * điểm đan, không còn đi qua kho Phụ kiện. Kiểm trước khi cấp số phiếu (IssueSlipsService.create) và kiểm lại lúc xác nhận.
   * Trần số lượng thật (định mức, số mảnh đã qua KCS còn ở kho) tính trong transaction có khoá - xem assertPieceCapInTx().
   */
  async prepareWeavingPiece(
    productionOrderId: string,
    pieceId: string,
    weavingPointId: bigint,
    qty: number,
    scope: string | null,
  ): Promise<PreparedWeavingPiece> {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new BadRequestException('Số mảnh xuất đan phải là số nguyên dương');
    }
    const order = await this.findOrderOrThrow(productionOrderId);
    await assertItemPiHasActiveFloor(this.prisma, order.productionInvoiceItemId, 'xuất đan');
    const pieceBigId = parseBigIntId(pieceId);
    const piece = await this.findPieceOrThrow(pieceBigId);
    const weavingPoint = await this.findWeavingPointOrThrow(weavingPointId);
    if (!weavingPoint.isActive) {
      throw new BadRequestException(
        `Điểm đan ${weavingPoint.fullName ?? weavingPoint.code} đã ngừng hoạt động - không xuất đan mới được`,
      );
    }
    // isWoven đọc từ SNAPSHOT trên BomPiece của đúng bomRevisionId lệnh này (không đọc piece.isWoven dùng chung giữa revision).
    const bomPiece = await this.findBomPieceOrThrow(order.bomRevisionId, pieceBigId);
    if (!bomPiece.isWoven) {
      throw new BadRequestException(
        `Mảnh ${piece.name} không thuộc công đoạn Đan trong định mức của lệnh này - không xuất đan được`,
      );
    }
    const source = await this.weavingSourceOf(this.prisma, order, bomPiece);
    if (!source) {
      throw new BadRequestException(
        `Chưa có kho giữ mảnh ${piece.name} của lệnh này (thiếu kho Sơn/Hàn/Phôi của xưởng) - báo Admin`,
      );
    }
    if (scope && source.warehouse.code !== scope) {
      throw new ForbiddenException(
        `Mảnh ${piece.name} của lệnh này nằm ở kho ${source.warehouse.code} - bạn đang làm kho ${scope}`,
      );
    }
    return {
      order,
      pieceId: pieceBigId,
      pieceName: piece.name,
      weavingPointId,
      qty,
      plannedQty: bomPiece.qtyPerUnit * order.quantity,
      finalStage: source.finalStage,
      warehouse: source.warehouse,
    };
  }

  /**
   * Chặn vượt trần (gọi TRONG transaction - tự khoá theo lệnh + mảnh). `excludeSlipId` = phiếu đang xác nhận (không đếm chính nó
   * vào phần "đang nằm trên phiếu chờ ký"). Xem pieceCaps().
   */
  async assertPieceCapInTx(
    tx: PrismaTx,
    p: PreparedWeavingPiece,
    excludeSlipId: bigint | null,
  ): Promise<void> {
    await lockBusinessKey(tx, `weaving-issue:${p.order.id}:${p.pieceId}`);
    const cap = await this.pieceCaps(
      tx,
      p.order.id,
      p.pieceId,
      p.plannedQty,
      p.finalStage,
      excludeSlipId,
    );
    if (p.qty > cap.byPlan) {
      throw new BadRequestException(
        `Mảnh ${p.pieceName}: xuất ${p.qty} vượt định mức còn lại ${Math.max(0, cap.byPlan)} (định mức ${p.plannedQty}, đã xuất ${cap.issued}, đang trên phiếu chờ ký ${cap.onDraft})`,
      );
    }
    if (p.qty > cap.byStock) {
      throw new BadRequestException(
        `Mảnh ${p.pieceName}: xuất ${p.qty} vượt số mảnh đã qua KCS còn ở kho ${p.warehouse.code} (còn ${Math.max(0, cap.byStock)})`,
      );
    }
  }

  /**
   * Trần xuất đan của 1 (lệnh, mảnh):
   *  - theo định mức: định mức − đã xuất (mọi lần, kể cả lần cũ trước 09/11) − đang trên phiếu chờ ký;
   *  - theo kho: mảnh đã qua KCS công đoạn cuối − đã chuyển ra khỏi nhóm Phôi-Hàn-Sơn bằng phiếu chuyển (luồng cũ qua kho Phụ
   *    kiện, mảnh đó xuất đan từ kho Phụ kiện) − đã/đang nằm trên phiếu xuất đan.
   */
  private async pieceCaps(
    db: PrismaTx | PrismaServiceType,
    orderId: bigint,
    pieceId: bigint,
    plannedQty: number,
    finalStage: MfgStage,
    excludeSlipId: bigint | null,
  ): Promise<{ byPlan: number; byStock: number; issued: number; onDraft: number }> {
    const slipLine = (status: IssueSlipStatus) => ({
      kind: IssueSlipLineKind.WEAVING_PIECE,
      productionOrderId: orderId,
      pieceId,
      slip: { status, ...(excludeSlipId ? { id: { not: excludeSlipId } } : {}) },
    });
    const [issued, ready, transferredOut, onDraft, onIssued] = await Promise.all([
      db.weavingIssue.aggregate({
        where: { productionOrderId: orderId, pieceId },
        _sum: { qty: true },
      }),
      db.productionBatch.aggregate({
        where: {
          productionOrderId: orderId,
          pieceId,
          stage: finalStage,
          status: ProductionBatchStatus.QC_DONE,
        },
        _sum: { reportedQty: true },
      }),
      db.warehouseTransferPieceItem.aggregate({
        where: {
          productionOrderId: orderId,
          pieceId,
          transfer: {
            status: { in: [TransferStatus.PENDING, TransferStatus.CONFIRMED] },
            ...PIECE_TRANSFER_LEAVES_FRAME,
          },
        },
        _sum: { quantity: true },
      }),
      db.issueSlipLine.aggregate({ where: slipLine(IssueSlipStatus.DRAFT), _sum: { qty: true } }),
      db.issueSlipLine.aggregate({ where: slipLine(IssueSlipStatus.ISSUED), _sum: { qty: true } }),
    ]);
    const issuedQty = issued._sum.qty ?? 0;
    const draftQty = onDraft._sum.qty?.toNumber() ?? 0;
    const viaSlips = draftQty + (onIssued._sum.qty?.toNumber() ?? 0);
    return {
      byPlan: plannedQty - issuedQty - draftQty,
      byStock: (ready._sum.reportedQty ?? 0) - (transferredOut._sum.quantity ?? 0) - viaSlips,
      issued: issuedQty,
      onDraft: draftQty,
    };
  }

  /**
   * Kho đang giữ mảnh đã xong (nơi xuất đan): cùng quy tắc ProductionBatchesService.postPieceOutputIfFinal() - mảnh cần sơn ở kho
   * Sơn (xưởng không có kho Sơn như Phước An: mảnh đã chuyển sang kho Sơn Phú An), mảnh chỉ hàn ở kho Hàn của xưởng, mảnh không
   * hàn ở kho Phôi.
   */
  async weavingSourceOf(
    db: PrismaTx | PrismaServiceType,
    order: { productionInvoiceItemId: bigint },
    bp: { needsHan: boolean; needsSon: boolean },
  ): Promise<{ warehouse: { id: bigint; code: string }; finalStage: MfgStage } | null> {
    const finalStage = !bp.needsHan ? MfgStage.PHOI : bp.needsSon ? MfgStage.SON : MfgStage.HAN;
    const item = await db.productionInvoiceItem.findUnique({
      where: { id: order.productionInvoiceItemId },
      select: { productionInvoiceId: true },
    });
    const resolver = new WorkshopWarehouseResolver(db);
    let workshopId = await resolver.workshopIdOfPi(item?.productionInvoiceId);
    if (finalStage === MfgStage.SON && !(await resolver.workshopHasPaint(workshopId))) {
      workshopId = null;
    }
    const kind =
      finalStage === MfgStage.PHOI
        ? WarehouseKind.PHOI
        : finalStage === MfgStage.HAN
          ? WarehouseKind.HAN
          : WarehouseKind.SON;
    const w = await resolver.kindWarehouseOf(kind, workshopId);
    return w ? { warehouse: { id: w.id, code: w.code }, finalStage } : null;
  }

  /** Ghi 1 dòng mảnh của phiếu 1 lúc xác nhận: WeavingIssue + trừ tồn mảnh ở kho giữ mảnh -> kho ảo PRODUCTION. */
  async createPieceIssueInTx(
    tx: PrismaTx,
    p: PreparedWeavingPiece,
    userId: string,
    idempotencyKey: string,
  ): Promise<WeavingIssueRow> {
    const issue = await tx.weavingIssue.create({
      data: {
        productionOrderId: p.order.id,
        pieceId: p.pieceId,
        weavingPointId: p.weavingPointId,
        qty: p.qty,
        issuedById: userId,
        idempotencyKey,
      },
      include: WEAVING_ISSUE_INCLUDE,
    });
    const production = await tx.warehouse.findUniqueOrThrow({
      where: { code: PRODUCTION_WAREHOUSE_CODE },
    });
    await this.stockLedgerService.postEntry(
      {
        fromWarehouseId: p.warehouse.id,
        toWarehouseId: production.id,
        pieceId: p.pieceId,
        qty: p.qty,
        refType: StockLedgerRefType.WEAVING_ISSUE,
        refId: issue.id.toString(),
        createdById: userId,
        idempotencyKey: `weaving-issue-piece:${issue.id}`,
      },
      tx,
    );
    return issue;
  }

  /** Sau commit: nhật ký, báo kho Thành phẩm chờ nhận hàng đan, realtime. */
  async afterPieceIssue(issue: WeavingIssueRow, userId: string): Promise<void> {
    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.CREATE,
      tableName: 'WeavingIssue',
      recordId: issue.id,
      newValue: {
        productionOrderId: issue.productionOrderId.toString(),
        pieceId: issue.pieceId.toString(),
        weavingPointId: issue.weavingPointId.toString(),
        qty: issue.qty,
      },
    });
    await this.notifyWeavingIssueToPoint(issue);
    this.publishRealtime('WEAVING_ISSUE', issue.id, 'CREATED', userId);
  }

  /**
   * Phiếu 2 xuất đan: dây, gỗ, đinh, nút cấp kèm (anh Nhân 09/11) - phiếu riêng của kho giữ vật tư (kho Phụ kiện), cùng điểm đan
   * với phiếu mảnh. Chỉ nhận vật tư nằm trong danh sách "đi kèm khi đan" của đúng mảnh trong định mức lệnh (Dây/Đinh luôn đi kèm,
   * Nút nhựa/Vật tư thành phẩm khi có tick); loại dây/nệm lệnh không chọn thì chặn.
   */
  async prepareWeavingMaterial(
    productionOrderId: string,
    pieceId: string,
    materialId: string,
    weavingPointId: bigint,
    qty: number,
    scope: string | null,
  ): Promise<PreparedWeavingMaterial> {
    if (!(qty > 0)) throw new BadRequestException('Số lượng vật tư kèm phải lớn hơn 0');
    const order = await this.findOrderOrThrow(productionOrderId);
    await assertItemPiHasActiveFloor(this.prisma, order.productionInvoiceItemId, 'xuất đan');
    const pieceBigId = parseBigIntId(pieceId);
    const materialBigId = parseBigIntId(materialId);
    const bomPiece = await this.findBomPieceOrThrow(order.bomRevisionId, pieceBigId);
    if (!bomPiece.isWoven) {
      throw new BadRequestException(`Mảnh ${pieceId} không thuộc công đoạn Đan của lệnh này`);
    }
    const lines = (await this.getWovenMaterialLinesByPiece([order.bomRevisionId])).get(
      `${order.bomRevisionId}:${pieceBigId}`,
    );
    const all = lines
      ? [...lines.wire, ...lines.nail, ...lines.plasticButton, ...lines.finishedComponent]
      : [];
    const line = all.find((l) => l.materialId === materialBigId.toString());
    if (!line) {
      throw new BadRequestException(
        `Vật tư ${materialId} không nằm trong danh sách đi kèm khi đan của mảnh này trong định mức`,
      );
    }
    const excluded =
      (await loadBomOptionExclusions(this.prisma, [order])).get(order.id.toString()) ??
      new Set<string>();
    if (excluded.has(materialBigId.toString())) {
      throw new BadRequestException(
        `Vật tư ${line.materialCode} không thuộc màu dây/vải nệm đã chọn cho lệnh này - không cấp kèm được`,
      );
    }
    const material = await this.prisma.material.findUnique({
      where: { id: materialBigId },
      select: { code: true, warehouseId: true, warehouse: { select: { code: true } } },
    });
    if (!material?.warehouseId || !material.warehouse) {
      throw new BadRequestException(
        `Vật tư ${line.materialCode} chưa được gán Kho - vào Admin > Vật tư để gán Kho trước khi xuất`,
      );
    }
    if (scope && material.warehouse.code !== scope) {
      throw new ForbiddenException(
        `Vật tư ${material.code} thuộc kho ${material.warehouse.code} - bạn đang làm kho ${scope}`,
      );
    }
    const piItem = await this.prisma.productionInvoiceItem.findUniqueOrThrow({
      where: { id: order.productionInvoiceItemId },
      select: { productionInvoiceId: true },
    });
    return {
      order,
      productionInvoiceId: piItem.productionInvoiceId!,
      pieceId: pieceBigId,
      weavingPointId,
      materialId: materialBigId,
      materialCode: material.code,
      warehouseId: material.warehouseId,
      qty,
    };
  }

  /** Ghi 1 dòng vật tư của phiếu 2 lúc xác nhận - giữ các chốt tồn cũ: FOR UPDATE, tồn khả dụng (trừ giữ chỗ PI khác), ưu tiên
   *  SKU sớm (YC11), rồi trả giữ chỗ đề xuất mua. */
  async createMaterialIssueInTx(
    tx: PrismaTx,
    p: PreparedWeavingMaterial,
    userId: string,
    idempotencyKey: string,
  ): Promise<{ id: bigint }> {
    const [stockRow] = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
      SELECT "qty" FROM "stock_quant"
      WHERE "warehouseId" = ${p.warehouseId} AND "materialId" = ${p.materialId}
        AND "stockLengthMm" = 0 AND "spec" = ''
      FOR UPDATE
    `;
    const onHand = stockRow?.qty.toNumber() ?? 0;
    const availableQty = await this.stockReservationsService.getAvailableQty(
      tx,
      p.warehouseId,
      p.materialId,
      onHand,
      undefined,
      p.productionInvoiceId,
    );
    if (p.qty > availableQty) {
      throw new ConflictException(
        `Tồn kho khả dụng của ${p.materialCode} (${round4(availableQty)}) không đủ cấp kèm ${p.qty}`,
      );
    }
    // YC11: chừa phần SKU cần sớm hơn trong cùng lệnh gộp còn cần - xem sku-priority.util.ts.
    const holdback = await loadSkuPriorityHoldback(tx, {
      orderId: p.order.id,
      productionInvoiceItemId: p.order.productionInvoiceItemId,
      productionInvoiceId: p.productionInvoiceId,
      materialId: p.materialId,
      remainingOf: (sib) => this.remainingWeavingMaterialForSibling(tx, sib, p.materialId),
    });
    if (holdback.qty > 0 && p.qty > availableQty - holdback.qty) {
      throw new ConflictException(
        skuHoldbackMessage(holdback, availableQty, p.qty, p.materialCode),
      );
    }
    const row = await tx.weavingIssueMaterial.create({
      data: {
        productionOrderId: p.order.id,
        pieceId: p.pieceId,
        weavingPointId: p.weavingPointId,
        materialId: p.materialId,
        qty: p.qty,
      },
    });
    const production = await tx.warehouse.findUniqueOrThrow({
      where: { code: PRODUCTION_WAREHOUSE_CODE },
    });
    await this.stockLedgerService.postEntry(
      {
        fromWarehouseId: p.warehouseId,
        toWarehouseId: production.id,
        materialId: p.materialId,
        qty: p.qty,
        refType: StockLedgerRefType.WEAVING_ISSUE_MATERIAL,
        refId: row.id.toString(),
        createdById: userId,
        idempotencyKey,
      },
      tx,
    );
    await this.stockReservationsService.drainPoolBestEffort(tx, {
      productionInvoiceId: p.productionInvoiceId,
      materialId: p.materialId,
      qty: p.qty,
    });
    return { id: row.id };
  }

  /**
   * Phần SKU khác trong cùng PI còn cần mang kèm vật tư này khi đan (YC11): Σ định mức vật tư/mảnh × số mảnh đan (Dây/Đinh luôn
   * đi kèm, nhóm khác chỉ khi tick includeInWeaving - cùng quy tắc getWovenMaterialLinesByPiece) − đã mang kèm. Dây/nệm SKU đó
   * không chọn thì 0.
   */
  private async remainingWeavingMaterialForSibling(
    tx: PrismaTx,
    sib: SiblingOrder,
    materialId: bigint,
  ): Promise<number> {
    const excluded = (await loadBomOptionExclusions(tx, [sib])).get(sib.id.toString());
    if (excluded?.has(materialId.toString())) return 0;
    const [rows, wovenPieces, issued] = await Promise.all([
      tx.pieceMaterialItem.findMany({
        where: { bomRevisionId: sib.bomRevisionId, materialId },
        select: {
          pieceId: true,
          qtyPerPiece: true,
          includeInWeaving: true,
          material: { select: { materialGroup: { select: { systemKey: true } } } },
        },
      }),
      tx.bomPiece.findMany({
        where: { bomRevisionId: sib.bomRevisionId, isWoven: true },
        select: { pieceId: true, qtyPerUnit: true },
      }),
      tx.weavingIssueMaterial.aggregate({
        where: { materialId, productionOrderId: sib.id },
        _sum: { qty: true },
      }),
    ]);
    const piecesPerUnit = new Map(wovenPieces.map((bp) => [bp.pieceId.toString(), bp.qtyPerUnit]));
    let planned = 0;
    for (const r of rows) {
      const perUnit = piecesPerUnit.get(r.pieceId.toString());
      if (perUnit == null) continue;
      const key = r.material.materialGroup?.systemKey;
      const always =
        key === MATERIAL_GROUP_SYSTEM_KEYS.WIRE || key === MATERIAL_GROUP_SYSTEM_KEYS.NAIL;
      if (!always && !r.includeInWeaving) continue;
      planned += r.qtyPerPiece.toNumber() * perUnit * sib.quantity;
    }
    return planned - (issued._sum.qty?.toNumber() ?? 0);
  }

  async receive(
    productionOrderId: string,
    dto: CreateWeavingReceiptDto,
    receivedById: string,
    warehouseScope: string | null,
    idempotencyKey?: string,
  ): Promise<WeavingReceiptResponseDto> {
    this.assertWarehouseScope(warehouseScope, 'nhập đan', WEAVING_RECEIVE_WAREHOUSE_CODE);

    if (idempotencyKey) {
      const existing = await this.prisma.weavingReceipt.findUnique({
        where: { idempotencyKey },
        include: WEAVING_RECEIPT_INCLUDE,
      });
      if (existing) {
        return this.toReceiptResponseDto(existing);
      }
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    await assertItemPiHasActiveFloor(this.prisma, order.productionInvoiceItemId, 'nhập đan');
    const pieceBigId = parseBigIntId(dto.pieceId);
    const weavingPointBigId = parseBigIntId(dto.weavingPointId);

    await this.findPieceOrThrow(pieceBigId);
    await this.findWeavingPointOrThrow(weavingPointBigId);

    // Khoá advisory (H4 fix) - cùng khoá key với create() phía trên (đủ để chặn nhập đan race với
    // nhau; không cần chặn chéo với xuất đan vì "remaining" ở đây tính trên issuedAtPoint đã có
    // sẵn, không đổi qtyPerUnit/plannedQty).
    const created = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `weaving-receipt:${order.id}:${pieceBigId}:${weavingPointBigId}`);

      const issuedAtPoint = await this.sumIssuedForPoint(
        tx,
        order.id,
        pieceBigId,
        weavingPointBigId,
      );
      const receivedAtPoint = await this.sumReceivedForPoint(
        tx,
        order.id,
        pieceBigId,
        weavingPointBigId,
      );
      const remaining = issuedAtPoint - receivedAtPoint;
      if (dto.qty > remaining) {
        throw new BadRequestException(
          `Số lượng nhập đan (${dto.qty}) vượt quá số lượng điểm đan ${dto.weavingPointId} còn giữ ` +
            `cho mảnh ${dto.pieceId} (đã xuất ${issuedAtPoint}, đã nhập ${receivedAtPoint}, còn ${remaining})`,
        );
      }

      return tx.weavingReceipt.create({
        data: {
          productionOrderId: order.id,
          pieceId: pieceBigId,
          weavingPointId: weavingPointBigId,
          qty: dto.qty,
          receivedById,
          idempotencyKey,
        },
        include: WEAVING_RECEIPT_INCLUDE,
      });
    });

    await this.resolveWeavingIssueToPoint(
      created.productionOrderId,
      created.pieceId,
      created.weavingPointId,
    );
    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.CREATE,
      tableName: 'WeavingReceipt',
      recordId: created.id,
      newValue: {
        productionOrderId: created.productionOrderId.toString(),
        pieceId: created.pieceId.toString(),
        weavingPointId: created.weavingPointId.toString(),
        qty: created.qty,
      },
    });
    this.publishRealtime('WEAVING_ISSUE', created.id, 'RECEIVED', receivedById);

    return this.toReceiptResponseDto(created);
  }

  /** Best-effort NGOÀI transaction - cùng lý do kỹ thuật đã ghi ở nhiều nơi khác (mục 15.2/16.2/
   *  17.2/19.2/22.2/23.2 changelog notification): catch bên trong 1 Prisma interactive transaction
   *  không cứu được transaction đó nếu nó đã abort, nên luôn gọi SAU KHI phần ghi chính đã commit. */
  private async notifyWeavingIssueToPoint(issue: WeavingIssueRow): Promise<void> {
    try {
      const outstandingQty = await this.recomputeOutstandingAtPoint(
        issue.productionOrderId,
        issue.pieceId,
        issue.weavingPointId,
      );
      const warehouseCodes = await this.resolveThanhPhamWarehouseCodes();
      const entityId = this.weavingAllocationEntityId(
        issue.productionOrderId,
        issue.pieceId,
        issue.weavingPointId,
      );
      await this.notifications.emit('WEAVING_ISSUE_TO_POINT', {
        entityId,
        actorId: issue.issuedById,
        dedupeKey: `WEAVING_ISSUE_TO_POINT:${entityId}`,
        params: {
          poNumber: issue.productionOrder.poNumber,
          pieceName: issue.piece.name,
          weavingPointName: issue.weavingPoint.fullName?.trim() || issue.weavingPoint.code,
          outstandingQty,
          warehouseCodes,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create WEAVING_ISSUE_TO_POINT notification (issue ${issue.id}): ${(error as Error).message}`,
      );
    }
  }

  /** Tự đóng khi tổng đã nhận tại ĐÚNG điểm đan này bắt kịp tổng đã xuất (outstanding về đúng 0) -
   *  KHÔNG re-emit số đã giảm khi nhận MỘT PHẦN (hạn chế đã chấp nhận ở mục 16.2, mirror
   *  resolvePiNotifications ở production-invoices.service.ts). */
  private async resolveWeavingIssueToPoint(
    productionOrderId: bigint,
    pieceId: bigint,
    weavingPointId: bigint,
  ): Promise<void> {
    try {
      const outstandingQty = await this.recomputeOutstandingAtPoint(
        productionOrderId,
        pieceId,
        weavingPointId,
      );
      if (outstandingQty > 0) return;
      await this.notifications.resolve({
        entityType: 'WEAVING_ALLOCATION',
        entityId: this.weavingAllocationEntityId(productionOrderId, pieceId, weavingPointId),
        types: ['WEAVING_ISSUE_TO_POINT'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to resolve WEAVING_ISSUE_TO_POINT (order ${productionOrderId}, piece ${pieceId}, point ${weavingPointId}): ${(error as Error).message}`,
      );
    }
  }

  private weavingAllocationEntityId(
    productionOrderId: bigint,
    pieceId: bigint,
    weavingPointId: bigint,
  ): string {
    return `${productionOrderId}:${pieceId}:${weavingPointId}`;
  }

  private async recomputeOutstandingAtPoint(
    productionOrderId: bigint,
    pieceId: bigint,
    weavingPointId: bigint,
  ): Promise<number> {
    const issued = await this.sumIssuedForPoint(
      this.prisma,
      productionOrderId,
      pieceId,
      weavingPointId,
    );
    const received = await this.sumReceivedForPoint(
      this.prisma,
      productionOrderId,
      pieceId,
      weavingPointId,
    );
    return issued - received;
  }

  /** Mọi kho vật lý thuộc gia đình 'thanh-pham' (kho gốc + các kho phụ '-N', xem
   *  warehouseFamilyOf()) - WeavingIssue/WeavingReceipt không lưu warehouseId nào nên không nhắm
   *  được đích danh 1 kho vật lý cụ thể như WAREHOUSE_TRANSFER_CREATED, phải báo CẢ gia đình. */
  private async resolveThanhPhamWarehouseCodes(): Promise<string[]> {
    const warehouses = await this.prisma.warehouse.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { code: WEAVING_RECEIVE_WAREHOUSE_CODE },
          { code: { startsWith: `${WEAVING_RECEIVE_WAREHOUSE_CODE}-` } },
        ],
      },
      select: { code: true },
    });
    return warehouses.map((w) => w.code);
  }

  /** "Cần xuất đan bao nhiêu" theo mảnh - query trực tiếp, không có bảng cache riêng. */
  async getIssuePlan(productionOrderId: string): Promise<WeavingIssuePlanItemResponseDto[]> {
    const order = await this.findOrderOrThrow(productionOrderId);
    return (await this.getIssuePlanBatch([order.id.toString()]))[order.id.toString()] ?? [];
  }

  /** Σ WeavingIssueMaterial.qty theo materialId - đã lọc sẵn đúng (lệnh, mảnh). */
  private sumIssuedMaterialQty(
    rows: { materialId: bigint; qty: Prisma.Decimal }[],
  ): Map<string, number> {
    const result = new Map<string, number>();
    for (const m of rows) {
      const key = m.materialId.toString();
      result.set(key, (result.get(key) ?? 0) + m.qty.toNumber());
    }
    return result;
  }

  /** Gắn đúng issuedQty theo ORDER hiện tại lên các dòng wire/nail/plasticButton (BOM-scoped, tự
   *  mặc định 0 - xem getWovenMaterialLinesByPiece) - trả mảng DTO MỚI, không mutate map dùng
   *  chung giữa nhiều order trong getIssuePlanBatch(). */
  private mergeIssuedQty(
    lines: WeavingPieceMaterialLineResponseDto[] | undefined,
    issuedByMaterial: Map<string, number>,
    excluded: Set<string> = new Set(),
  ): WeavingPieceMaterialLineResponseDto[] {
    // excluded = loại dây/nệm đã tick nhưng lệnh này không chọn - bỏ khỏi kế hoạch xuất đan.
    return (lines ?? [])
      .filter((l) => !excluded.has(l.materialId))
      .map(
        (l) =>
          new WeavingPieceMaterialLineResponseDto({
            ...l,
            issuedQty: issuedByMaterial.get(l.materialId) ?? 0,
          }),
      );
  }

  /** Định mức Dây (WIRE) + Đinh (NAIL), luôn đi kèm + Nút nhựa (PLASTIC_BUTTON) CÓ tick
   *  `includeInWeaving` /1 mảnh, gom theo `${bomRevisionId}:${pieceId}` - dùng chung cho
   *  getIssuePlan()/getIssuePlanBatch() để hiển thị kèm mảnh trên màn hình xuất đan (xem comment
   *  field `wire`/`nail`/`plasticButton`/`finishedComponent` ở WeavingIssuePlanItemResponseDto).
   *  Nút nhựa/Vật tư thành phẩm CHƯA tick không xuất hiện ở đây (khác Dây/Đinh, không có điều
   *  kiện). Cùng pattern truy vấn/nhóm với SkusService (toPieceMaterialLine + groupIdByKey), thu
   *  hẹp lại chỉ 4 nhóm cần. Vật tư thành phẩm (2026-10-01) nhận diện qua
   *  `material.steelSubGroup === FINISHED_COMPONENT` (material.materialGroupId === nhóm Sắt), KHÁC
   *  3 nhóm kia nhận diện qua materialGroupId riêng - xem enum SteelSubGroup. */
  async getWovenMaterialLinesByPiece(bomRevisionIds: bigint[]): Promise<
    Map<
      string,
      {
        wire: WeavingPieceMaterialLineResponseDto[];
        nail: WeavingPieceMaterialLineResponseDto[];
        plasticButton: WeavingPieceMaterialLineResponseDto[];
        finishedComponent: WeavingPieceMaterialLineResponseDto[];
      }
    >
  > {
    const result = new Map<
      string,
      {
        wire: WeavingPieceMaterialLineResponseDto[];
        nail: WeavingPieceMaterialLineResponseDto[];
        plasticButton: WeavingPieceMaterialLineResponseDto[];
        finishedComponent: WeavingPieceMaterialLineResponseDto[];
      }
    >();
    if (bomRevisionIds.length === 0) return result;

    const [systemGroups, lineItems] = await Promise.all([
      this.prisma.materialGroup.findMany({
        where: {
          systemKey: {
            in: [
              MATERIAL_GROUP_SYSTEM_KEYS.WIRE,
              MATERIAL_GROUP_SYSTEM_KEYS.NAIL,
              MATERIAL_GROUP_SYSTEM_KEYS.PLASTIC_BUTTON,
              MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR,
            ],
          },
        },
      }),
      this.prisma.pieceMaterialItem.findMany({
        where: { bomRevisionId: { in: bomRevisionIds } },
        include: { material: true },
      }),
    ]);
    const wireGroupId = systemGroups.find(
      (g) => g.systemKey === MATERIAL_GROUP_SYSTEM_KEYS.WIRE,
    )?.id;
    const nailGroupId = systemGroups.find(
      (g) => g.systemKey === MATERIAL_GROUP_SYSTEM_KEYS.NAIL,
    )?.id;
    const plasticButtonGroupId = systemGroups.find(
      (g) => g.systemKey === MATERIAL_GROUP_SYSTEM_KEYS.PLASTIC_BUTTON,
    )?.id;
    const steelGroupId = systemGroups.find(
      (g) => g.systemKey === MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR,
    )?.id;

    // Tồn kho hiện có (2026-09-11, hiển thị tham khảo cạnh ô nhập số lượng thật ở màn xuất đan) -
    // batch 1 lần cho MỌI dòng thay vì N truy vấn riêng (getIssuePlanBatch() có thể gọi hàm này
    // cho hàng chục PI cùng lúc). Chỉ tham khảo hiển thị, KHÔNG trừ giữ chỗ
    // (StockReservation/WarehouseTransferReservation) - số dùng để CHẶN xuất thật nằm ở
    // issueMaterialsForWeaving() (getAvailableQty(), tại thời điểm ghi sổ).
    const warehouseIds = [
      ...new Set(
        lineItems.map((r) => r.material.warehouseId).filter((id): id is bigint => id != null),
      ),
    ];
    const materialIdsForStock = [...new Set(lineItems.map((r) => r.materialId))];
    const stockRows =
      warehouseIds.length > 0
        ? await this.prisma.stockQuant.findMany({
            where: { warehouseId: { in: warehouseIds }, materialId: { in: materialIdsForStock } },
            select: { warehouseId: true, materialId: true, qty: true },
          })
        : [];
    const onHandByMaterialWarehouse = new Map<string, number>();
    for (const s of stockRows) {
      if (s.materialId == null) continue;
      onHandByMaterialWarehouse.set(`${s.materialId}:${s.warehouseId}`, s.qty.toNumber());
    }

    const toLine = (r: (typeof lineItems)[number]) =>
      new WeavingPieceMaterialLineResponseDto({
        materialId: r.materialId.toString(),
        materialCode: r.material.code,
        materialName: r.material.name,
        materialSpec: r.material.spec,
        materialUnit: r.material.unit,
        qtyPerPiece: r.qtyPerPiece.toNumber(),
        // Merge lại đúng theo order ở getIssuePlan()/getIssuePlanBatch() (hàm này BOM-scoped,
        // không biết productionOrderId) - mặc định 0 ở đây.
        issuedQty: 0,
        onHandQty: onHandByMaterialWarehouse.get(`${r.materialId}:${r.material.warehouseId}`) ?? 0,
      });

    for (const r of lineItems) {
      const key = `${r.bomRevisionId}:${r.pieceId}`;
      const entry = result.get(key) ?? {
        wire: [],
        nail: [],
        plasticButton: [],
        finishedComponent: [],
      };
      if (wireGroupId != null && r.material.materialGroupId === wireGroupId) {
        entry.wire.push(toLine(r));
      } else if (nailGroupId != null && r.material.materialGroupId === nailGroupId) {
        entry.nail.push(toLine(r));
      } else if (
        plasticButtonGroupId != null &&
        r.material.materialGroupId === plasticButtonGroupId &&
        r.includeInWeaving
      ) {
        entry.plasticButton.push(toLine(r));
      } else if (
        steelGroupId != null &&
        r.material.materialGroupId === steelGroupId &&
        r.material.steelSubGroup === SteelSubGroup.FINISHED_COMPONENT &&
        r.includeInWeaving
      ) {
        entry.finishedComponent.push(toLine(r));
      } else {
        continue;
      }
      result.set(key, entry);
    }
    return result;
  }

  /**
   * Kế hoạch xuất đan cho nhiều ProductionOrder 1 lần - màn xuất đan (1 lệnh) và "Bảng thống kê" (ThongKePagePlan.tsx, nhiều SKU
   * cùng lúc). "Có thể xuất" theo cùng công thức chặn thật ở assertPieceCapInTx() (xem pieceCaps()), tính gộp trong bộ nhớ.
   */
  async getIssuePlanBatch(
    productionOrderIds: string[],
  ): Promise<Record<string, WeavingIssuePlanItemResponseDto[]>> {
    const result: Record<string, WeavingIssuePlanItemResponseDto[]> = {};
    for (const id of productionOrderIds) result[id] = [];
    if (productionOrderIds.length === 0) return result;

    const orderBigIds = productionOrderIds.map((id) => parseBigIntId(id));
    const orders = await this.prisma.productionOrder.findMany({
      where: { id: { in: orderBigIds } },
      select: {
        id: true,
        bomRevisionId: true,
        quantity: true,
        productionInvoiceItemId: true,
        wireMaterialId: true,
        cushionMaterialId: true,
      },
    });
    const revisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const orderIds = orders.map((o) => o.id);

    const [
      bomPieces,
      issues,
      receipts,
      materialLinesByPiece,
      issuedMaterials,
      batches,
      transfers,
      slipLines,
      exclusions,
    ] = await Promise.all([
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId: { in: revisionIds } },
        include: { piece: true },
      }),
      this.prisma.weavingIssue.findMany({
        where: { productionOrderId: { in: orderIds } },
        include: { weavingPoint: true },
      }),
      this.prisma.weavingReceipt.findMany({
        where: { productionOrderId: { in: orderIds } },
        include: { weavingPoint: true },
      }),
      this.getWovenMaterialLinesByPiece(revisionIds),
      this.prisma.weavingIssueMaterial.findMany({
        where: { productionOrderId: { in: orderIds } },
        select: { productionOrderId: true, pieceId: true, materialId: true, qty: true },
      }),
      this.prisma.productionBatch.findMany({
        where: { productionOrderId: { in: orderIds }, status: ProductionBatchStatus.QC_DONE },
        select: { productionOrderId: true, pieceId: true, stage: true, reportedQty: true },
      }),
      this.prisma.warehouseTransferPieceItem.findMany({
        where: {
          productionOrderId: { in: orderIds },
          transfer: {
            status: { in: [TransferStatus.PENDING, TransferStatus.CONFIRMED] },
            ...PIECE_TRANSFER_LEAVES_FRAME,
          },
        },
        select: { productionOrderId: true, pieceId: true, quantity: true },
      }),
      this.prisma.issueSlipLine.findMany({
        where: {
          kind: IssueSlipLineKind.WEAVING_PIECE,
          productionOrderId: { in: orderIds },
          slip: { status: { in: [IssueSlipStatus.DRAFT, IssueSlipStatus.ISSUED] } },
        },
        select: {
          productionOrderId: true,
          pieceId: true,
          qty: true,
          slip: { select: { status: true } },
        },
      }),
      // Mỗi lệnh có tập loại dây/nệm bị loại riêng - 2 lệnh cùng SKU/revision khác dây dùng chung
      // map materialLinesByPiece (khoá theo revision) nhưng được lọc khác nhau ở bước dựng kế hoạch.
      loadBomOptionExclusions(this.prisma, orders),
    ]);

    const add = (m: Map<string, number>, key: string, n: number) =>
      m.set(key, (m.get(key) ?? 0) + n);
    const readyByKey = new Map<string, number>();
    for (const b of batches)
      add(readyByKey, `${b.productionOrderId}:${b.pieceId}:${b.stage}`, b.reportedQty);
    const transferredByKey = new Map<string, number>();
    for (const t of transfers)
      add(transferredByKey, `${t.productionOrderId}:${t.pieceId}`, t.quantity);
    const draftByKey = new Map<string, number>();
    const onSlipsByKey = new Map<string, number>();
    for (const l of slipLines) {
      const key = `${l.productionOrderId}:${l.pieceId}`;
      add(onSlipsByKey, key, l.qty.toNumber());
      if (l.slip.status === IssueSlipStatus.DRAFT) add(draftByKey, key, l.qty.toNumber());
    }

    const bomPiecesByRevision = new Map<string, typeof bomPieces>();
    for (const bp of bomPieces) {
      const key = bp.bomRevisionId.toString();
      const arr = bomPiecesByRevision.get(key);
      if (arr) arr.push(bp);
      else bomPiecesByRevision.set(key, [bp]);
    }

    const sourceMemo = new Map<
      string,
      Awaited<ReturnType<WeavingIssuesService['weavingSourceOf']>>
    >();
    for (const order of orders) {
      const wovenBomPieces = (bomPiecesByRevision.get(order.bomRevisionId.toString()) ?? []).filter(
        (bp) => bp.isWoven,
      );
      const orderIssues = issues.filter((i) => i.productionOrderId === order.id);
      const orderReceipts = receipts.filter((r) => r.productionOrderId === order.id);
      const excluded = exclusions.get(order.id.toString()) ?? new Set<string>();

      const items: WeavingIssuePlanItemResponseDto[] = [];
      for (const bp of wovenBomPieces) {
        const pieceKey = bp.pieceId.toString();
        const opKey = `${order.id}:${bp.pieceId}`;
        const pieceIssues = orderIssues.filter((i) => i.pieceId === bp.pieceId);
        const pieceReceipts = orderReceipts.filter((r) => r.pieceId === bp.pieceId);

        const pointIds = new Set<string>([
          ...pieceIssues.map((i) => i.weavingPointId.toString()),
          ...pieceReceipts.map((r) => r.weavingPointId.toString()),
        ]);
        const allocations = [...pointIds].map((pointIdStr) => {
          const pointIssues = pieceIssues.filter((i) => i.weavingPointId.toString() === pointIdStr);
          const pointReceipts = pieceReceipts.filter(
            (r) => r.weavingPointId.toString() === pointIdStr,
          );
          const issuedQty = pointIssues.reduce((s, i) => s + i.qty, 0);
          const receivedQty = pointReceipts.reduce((s, r) => s + r.qty, 0);
          const point = pointIssues[0]?.weavingPoint ?? pointReceipts[0]?.weavingPoint;
          return new WeavingAllocationItemResponseDto({
            weavingPointId: pointIdStr,
            weavingPointCode: point?.code ?? '',
            weavingPointName: point?.fullName ?? null,
            issuedQty,
            receivedQty,
            remainingToReceive: issuedQty - receivedQty,
          });
        });

        const sourceKey = `${order.id}:${bp.needsHan}:${bp.needsSon}`;
        if (!sourceMemo.has(sourceKey)) {
          sourceMemo.set(sourceKey, await this.weavingSourceOf(this.prisma, order, bp));
        }
        const source = sourceMemo.get(sourceKey) ?? null;
        const finalStage = source?.finalStage ?? (bp.needsSon ? MfgStage.SON : MfgStage.HAN);
        const totalQty = bp.qtyPerUnit * order.quantity;
        const issuedQty = pieceIssues.reduce((s, i) => s + i.qty, 0);
        const draftQty = draftByKey.get(opKey) ?? 0;
        const byPlan = totalQty - issuedQty - draftQty;
        const byStock =
          (readyByKey.get(`${opKey}:${finalStage}`) ?? 0) -
          (transferredByKey.get(opKey) ?? 0) -
          (onSlipsByKey.get(opKey) ?? 0);
        const materialLines = materialLinesByPiece.get(`${bp.bomRevisionId}:${bp.pieceId}`);
        const issuedMaterialQty = this.sumIssuedMaterialQty(
          issuedMaterials.filter(
            (m) => m.productionOrderId === order.id && m.pieceId === bp.pieceId,
          ),
        );

        items.push(
          new WeavingIssuePlanItemResponseDto({
            pieceId: pieceKey,
            pieceCode: bp.piece.code,
            pieceName: bp.piece.name,
            totalQty,
            issuedQty,
            remainingToIssue: totalQty - issuedQty,
            onDraftQty: draftQty,
            canIssueQty: Math.max(0, Math.min(byPlan, byStock)),
            sourceWarehouseCode: source?.warehouse.code ?? null,
            allocations,
            wire: this.mergeIssuedQty(materialLines?.wire, issuedMaterialQty, excluded),
            nail: this.mergeIssuedQty(materialLines?.nail, issuedMaterialQty, excluded),
            plasticButton: this.mergeIssuedQty(
              materialLines?.plasticButton,
              issuedMaterialQty,
              excluded,
            ),
            finishedComponent: this.mergeIssuedQty(
              materialLines?.finishedComponent,
              issuedMaterialQty,
              excluded,
            ),
          }),
        );
      }
      result[order.id.toString()] = items;
    }
    return result;
  }

  /** "Quản lý điểm đan" (thay WeavingService.getByPoint() mock) - gộp WeavingIssue+WeavingReceipt
   *  theo weavingPointId qua MỌI production order, rồi theo (productionOrderId, pieceId) trong mỗi
   *  điểm - cùng idiom in-memory group đã dùng ở getIssuePlan(), chỉ đổi trục gộp. Không paginate
   *  (số điểm đan + số dòng đang giữ hàng còn nhỏ, cùng lý do getIssuePlan() cũng không paginate). */
  async findAllGroupedByPoint(): Promise<WeavingPointGroupResponseDto[]> {
    const [issues, receipts, points] = await Promise.all([
      this.prisma.weavingIssue.findMany({ include: WEAVING_ISSUE_BY_POINT_INCLUDE }),
      this.prisma.weavingReceipt.findMany({ include: WEAVING_RECEIPT_BY_POINT_INCLUDE }),
      this.prisma.weavingPoint.findMany(),
    ]);

    const pointIds = new Set<string>([
      ...issues.map((i) => i.weavingPointId.toString()),
      ...receipts.map((r) => r.weavingPointId.toString()),
    ]);

    return [...pointIds].map((pointIdStr) => {
      const point = points.find((p) => p.id.toString() === pointIdStr);
      const pointIssues = issues.filter((i) => i.weavingPointId.toString() === pointIdStr);
      const pointReceipts = receipts.filter((r) => r.weavingPointId.toString() === pointIdStr);

      const assignmentKeys = new Set<string>([
        ...pointIssues.map((i) => `${i.productionOrderId}-${i.pieceId}`),
        ...pointReceipts.map((r) => `${r.productionOrderId}-${r.pieceId}`),
      ]);

      const assignments = [...assignmentKeys].map((key) => {
        const assignIssues = pointIssues.filter(
          (i) => `${i.productionOrderId}-${i.pieceId}` === key,
        );
        const assignReceipts = pointReceipts.filter(
          (r) => `${r.productionOrderId}-${r.pieceId}` === key,
        );
        const sample: WeavingIssueByPointRow | WeavingReceiptByPointRow =
          assignIssues[0] ?? assignReceipts[0];
        const quantity = assignIssues.reduce((s, i) => s + i.qty, 0);
        const completed = assignReceipts.reduce((s, r) => s + r.qty, 0);
        return new WeavingPointAssignmentResponseDto({
          poNumber:
            sample.productionOrder.productionInvoiceItem.salesOrder?.orderCode ??
            sample.productionOrder.poNumber,
          productLabel: sample.productionOrder.mfgProduct.name,
          pieceCode: sample.piece.code,
          pieceName: sample.piece.name,
          quantity,
          completed,
          holding: quantity - completed,
        });
      });

      return new WeavingPointGroupResponseDto({
        id: pointIdStr,
        code: point?.code ?? '',
        fullName: point?.fullName ?? null,
        phone: point?.phone ?? null,
        totalHolding: assignments.reduce((s, a) => s + a.holding, 0),
        assignments,
      });
    });
  }

  async findAllForOrder(
    productionOrderId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<WeavingIssueResponseDto>> {
    const bigId = parseBigIntId(productionOrderId);
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.weavingIssue.findMany({ ...args, include: WEAVING_ISSUE_INCLUDE }),
        count: (args) => this.prisma.weavingIssue.count(args),
      },
      query,
      { productionOrderId: bigId },
      { issuedAt: 'desc' as const },
    );
    return { data: result.data.map((r) => this.toIssueResponseDto(r)), meta: result.meta };
  }

  async findAllReceiptsForOrder(
    productionOrderId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<WeavingReceiptResponseDto>> {
    const bigId = parseBigIntId(productionOrderId);
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.weavingReceipt.findMany({ ...args, include: WEAVING_RECEIPT_INCLUDE }),
        count: (args) => this.prisma.weavingReceipt.count(args),
      },
      query,
      { productionOrderId: bigId },
      { receivedAt: 'desc' as const },
    );
    return { data: result.data.map((r) => this.toReceiptResponseDto(r)), meta: result.meta };
  }

  async findOne(id: string): Promise<WeavingIssueResponseDto> {
    return this.toIssueResponseDto(await this.findIssueRowOrThrow(id));
  }

  async findOneReceipt(id: string): Promise<WeavingReceiptResponseDto> {
    return this.toReceiptResponseDto(await this.findReceiptRowOrThrow(id));
  }

  private assertWarehouseScope(
    warehouseScope: string | null,
    action: string,
    expectedWarehouseCode: string,
  ): void {
    // null = tổng kho (BOSS/ADMIN) - không có gì để chặn. Cả 'vat-tu-tp' lẫn 'thanh-pham' đều là
    // gốc đa-instance (Admin tạo thêm được '{gia-đình}-{n}', 2026-09-03 mở rộng cho cả vat-tu-tp)
    // - Thủ kho của kho phụ phải được coi như đúng kho, không chỉ đúng literal gốc (xem
    // warehouseFamilyOf, sự cố 403 2026-08-31 ở đầu file - lúc đó chỉ vá được nhánh thanh-pham).
    const matches = warehouseFamilyOf(warehouseScope) === warehouseFamilyOf(expectedWarehouseCode);
    if (warehouseScope && !matches) {
      throw new ForbiddenException(
        `Bạn bị giới hạn ở kho '${warehouseScope}', không được ${action} từ kho '${expectedWarehouseCode}'`,
      );
    }
  }

  private async findBomPieceOrThrow(
    bomRevisionId: bigint,
    pieceId: bigint,
  ): Promise<{ qtyPerUnit: number; isWoven: boolean; needsHan: boolean; needsSon: boolean }> {
    const bomPiece = await this.prisma.bomPiece.findUnique({
      where: { bomRevisionId_pieceId: { bomRevisionId, pieceId } },
    });
    if (!bomPiece) {
      throw new NotFoundException(
        `Mảnh ${pieceId} không thuộc định mức (BOM) của lệnh sản xuất này`,
      );
    }
    return bomPiece;
  }

  private async sumIssuedForPoint(
    tx: PrismaTx,
    productionOrderId: bigint,
    pieceId: bigint,
    weavingPointId: bigint,
  ): Promise<number> {
    const result = await tx.weavingIssue.aggregate({
      where: { productionOrderId, pieceId, weavingPointId },
      _sum: { qty: true },
    });
    return result._sum.qty ?? 0;
  }

  private async sumReceivedForPoint(
    tx: PrismaTx,
    productionOrderId: bigint,
    pieceId: bigint,
    weavingPointId: bigint,
  ): Promise<number> {
    const result = await tx.weavingReceipt.aggregate({
      where: { productionOrderId, pieceId, weavingPointId },
      _sum: { qty: true },
    });
    return result._sum.qty ?? 0;
  }

  private async findOrderOrThrow(id: string): Promise<ProductionOrder> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({ where: { id: bigId } });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy lệnh xưởng ${id}`);
    }
    return order;
  }

  private async findPieceOrThrow(id: bigint): Promise<Piece> {
    const piece = await this.prisma.piece.findUnique({ where: { id } });
    if (!piece) {
      throw new NotFoundException(`Không tìm thấy mảnh ${id}`);
    }
    return piece;
  }

  private async findWeavingPointOrThrow(id: bigint): Promise<WeavingPoint> {
    const weavingPoint = await this.prisma.weavingPoint.findUnique({ where: { id } });
    if (!weavingPoint) {
      throw new NotFoundException(`Không tìm thấy điểm đan ${id}`);
    }
    return weavingPoint;
  }

  private async findIssueRowOrThrow(id: string): Promise<WeavingIssueRow> {
    const bigId = parseBigIntId(id);
    const issue = await this.prisma.weavingIssue.findUnique({
      where: { id: bigId },
      include: WEAVING_ISSUE_INCLUDE,
    });
    if (!issue) {
      throw new NotFoundException(`Không tìm thấy phiếu xuất đan ${id}`);
    }
    return issue;
  }

  private async findReceiptRowOrThrow(id: string): Promise<WeavingReceiptRow> {
    const bigId = parseBigIntId(id);
    const receipt = await this.prisma.weavingReceipt.findUnique({
      where: { id: bigId },
      include: WEAVING_RECEIPT_INCLUDE,
    });
    if (!receipt) {
      throw new NotFoundException(`Không tìm thấy phiếu nhập đan ${id}`);
    }
    return receipt;
  }

  private toIssueResponseDto(issue: WeavingIssueRow): WeavingIssueResponseDto {
    return new WeavingIssueResponseDto({
      id: issue.id.toString(),
      productionOrderId: issue.productionOrderId.toString(),
      poNumber: issue.productionOrder.poNumber,
      salesOrderCode: issue.productionOrder.productionInvoiceItem.salesOrder?.orderCode ?? null,
      pieceId: issue.pieceId.toString(),
      pieceCode: issue.piece.code,
      pieceName: issue.piece.name,
      weavingPointId: issue.weavingPointId.toString(),
      weavingPointCode: issue.weavingPoint.code,
      weavingPointName: issue.weavingPoint.fullName,
      qty: issue.qty,
      issuedAt: issue.issuedAt,
      issuedById: issue.issuedById,
    });
  }

  private toReceiptResponseDto(receipt: WeavingReceiptRow): WeavingReceiptResponseDto {
    return new WeavingReceiptResponseDto({
      id: receipt.id.toString(),
      productionOrderId: receipt.productionOrderId.toString(),
      poNumber: receipt.productionOrder.poNumber,
      salesOrderCode: receipt.productionOrder.productionInvoiceItem.salesOrder?.orderCode ?? null,
      pieceId: receipt.pieceId.toString(),
      pieceCode: receipt.piece.code,
      pieceName: receipt.piece.name,
      weavingPointId: receipt.weavingPointId.toString(),
      weavingPointCode: receipt.weavingPoint.code,
      weavingPointName: receipt.weavingPoint.fullName,
      qty: receipt.qty,
      receivedAt: receipt.receivedAt,
      receivedById: receipt.receivedById,
    });
  }
}
