import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Piece, Prisma, ProductionOrder, WeavingPoint } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { assertItemPiHasActiveFloor } from '../../common/utils/floor-gate.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { CreateWeavingIssueDto } from './dto/create-weaving-issue.dto';
import { CreateWeavingReceiptDto } from './dto/create-weaving-receipt.dto';
import { WeavingAllocationItemResponseDto } from './dto/weaving-allocation-item-response.dto';
import { WeavingIssuePlanItemResponseDto } from './dto/weaving-issue-plan-item-response.dto';
import { WeavingIssueResponseDto } from './dto/weaving-issue-response.dto';
import { WeavingPointAssignmentResponseDto } from './dto/weaving-point-assignment-response.dto';
import { WeavingPointGroupResponseDto } from './dto/weaving-point-group-response.dto';
import { WeavingReceiptResponseDto } from './dto/weaving-receipt-response.dto';

// Mã đơn Sales gốc (hiển thị cột "PO" cho người dùng) - xem toIssueResponseDto/toReceiptResponseDto.
const PRODUCTION_ORDER_WITH_SALES_CODE = {
  include: { productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } } },
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

type WeavingIssueRow = Prisma.WeavingIssueGetPayload<{ include: typeof WEAVING_ISSUE_INCLUDE }>;
type WeavingReceiptRow = Prisma.WeavingReceiptGetPayload<{
  include: typeof WEAVING_RECEIPT_INCLUDE;
}>;

// Cùng PRODUCTION_ORDER_WITH_SALES_CODE + tên sản phẩm (productLabel) - chỉ cần cho
// findAllGroupedByPoint(), các hàm theo 1 PO ở trên không cần tên sản phẩm.
const PRODUCTION_ORDER_WITH_SALES_CODE_AND_PRODUCT = {
  include: {
    productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } },
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

/// 2 đầu vật lý khác nhau của vòng Đan - xuất mảnh chưa đan từ kho vật tư-TP (thủ kho 'vat-tu-tp'
/// quản), nhận lại mảnh đã đan từ điểm đan gia công về kho thành phẩm (thủ kho 'thanh-pham' quản -
/// xem comment KhoNhapDanPage.tsx "Nhập đan = kho thành phẩm nhận..."). ĐÃ TỪNG dùng CHUNG 1 hằng
/// số cho cả assertWarehouseScope() của create() lẫn receive() (copy nhầm) - khiến role duy nhất
/// có UI cho "Theo dõi nhập đan" (thanh-pham) luôn bị BE từ chối 403, phát hiện qua browser thật
/// 2026-08-31. Tách riêng 2 hằng số để mỗi hành động check đúng kho của nó.
const WEAVING_ISSUE_WAREHOUSE_CODE = 'vat-tu-tp';
const WEAVING_RECEIVE_WAREHOUSE_CODE = 'thanh-pham';

/**
 * Phân bổ/nhận hàng đan (M2 ưu tiên 1, thay manh.service.ts mock) - lớp theo dõi THỰC THI của
 * kho vật tư-TP xuất khung cho điểm đan ngoài ("xuất đan") và nhận lại hàng đã đan xong ("nhập
 * đan"). Append-only, KHÔNG có state machine (khác SteelIssue) - mọi vi phạm nghiệp vụ là 400
 * (validate số lượng), không có transition trạng thái nào để 409. KHÔNG ghi StockLedger, cùng
 * lý do SteelIssue không ghi (xem comment đầu schema.prisma "Phase 9b").
 */
@Injectable()
export class WeavingIssuesService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(
    productionOrderId: string,
    dto: CreateWeavingIssueDto,
    issuedById: string,
    warehouseScope: string | null,
    idempotencyKey?: string,
  ): Promise<WeavingIssueResponseDto> {
    this.assertWarehouseScope(warehouseScope, 'xuất đan', WEAVING_ISSUE_WAREHOUSE_CODE);

    if (idempotencyKey) {
      const existing = await this.prisma.weavingIssue.findUnique({
        where: { idempotencyKey },
        include: WEAVING_ISSUE_INCLUDE,
      });
      if (existing) {
        return this.toIssueResponseDto(existing);
      }
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    await assertItemPiHasActiveFloor(this.prisma, order.productionInvoiceItemId, 'xuất đan');
    const pieceBigId = parseBigIntId(dto.pieceId);
    const weavingPointBigId = parseBigIntId(dto.weavingPointId);

    await this.findPieceOrThrow(pieceBigId);

    const weavingPoint = await this.findWeavingPointOrThrow(weavingPointBigId);
    if (!weavingPoint.isActive) {
      throw new BadRequestException(
        `Điểm đan ${dto.weavingPointId} đã ngừng hoạt động - không thể xuất đan mới cho điểm này`,
      );
    }

    // isWoven đọc từ SNAPSHOT trên BomPiece của chính bomRevisionId order này (ghi lúc lưu định
    // mức - xem SkusService.replacePieces), KHÔNG đọc piece.isWoven (global, dùng chung tên
    // piece giữa các revision) - tránh 1 SKU khác sửa lại định mức cùng tên mảnh làm order đang
    // xuất/nhập dở bỗng dưng bị coi là "không thuộc công đoạn Đan".
    const bomPiece = await this.findBomPieceOrThrow(order.bomRevisionId, pieceBigId);
    if (!bomPiece.isWoven) {
      throw new BadRequestException(
        `Mảnh ${dto.pieceId} không thuộc công đoạn Đan trong định mức của lệnh sản xuất này (isWoven=false) - không thể xuất đan mảnh này`,
      );
    }

    const plannedQty = bomPiece.qtyPerUnit * order.quantity;

    // Khoá advisory (H4 fix, cùng lý do H2/H3) - không có dòng có sẵn để FOR UPDATE cho lần xuất
    // đan đầu tiên của 1 khoá (order, piece) - xem lockBusinessKey().
    const created = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `weaving-issue:${order.id}:${pieceBigId}`);

      const issuedSoFar = await this.sumIssuedForPiece(tx, order.id, pieceBigId);
      const remaining = plannedQty - issuedSoFar;
      if (dto.qty > remaining) {
        throw new BadRequestException(
          `Số lượng xuất đan (${dto.qty}) vượt quá số lượng còn có thể xuất cho mảnh ${dto.pieceId} ` +
            `(định mức ${plannedQty}, đã xuất ${issuedSoFar}, còn ${remaining})`,
        );
      }

      return tx.weavingIssue.create({
        data: {
          productionOrderId: order.id,
          pieceId: pieceBigId,
          weavingPointId: weavingPointBigId,
          qty: dto.qty,
          issuedById,
          idempotencyKey,
        },
        include: WEAVING_ISSUE_INCLUDE,
      });
    });

    return this.toIssueResponseDto(created);
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

    return this.toReceiptResponseDto(created);
  }

  /** "Cần xuất đan bao nhiêu" theo mảnh - query trực tiếp, không có bảng cache riêng. */
  async getIssuePlan(productionOrderId: string): Promise<WeavingIssuePlanItemResponseDto[]> {
    const order = await this.findOrderOrThrow(productionOrderId);

    const [bomPieces, issues, receipts] = await Promise.all([
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId: order.bomRevisionId },
        include: { piece: true },
      }),
      this.prisma.weavingIssue.findMany({
        where: { productionOrderId: order.id },
        include: { weavingPoint: true },
      }),
      this.prisma.weavingReceipt.findMany({
        where: { productionOrderId: order.id },
        include: { weavingPoint: true },
      }),
    ]);

    const wovenBomPieces = bomPieces.filter((bp) => bp.isWoven);

    return wovenBomPieces.map((bp) => {
      const pieceKey = bp.pieceId.toString();
      const pieceIssues = issues.filter((i) => i.pieceId === bp.pieceId);
      const pieceReceipts = receipts.filter((r) => r.pieceId === bp.pieceId);

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

      const totalQty = bp.qtyPerUnit * order.quantity;
      const issuedQty = pieceIssues.reduce((s, i) => s + i.qty, 0);

      return new WeavingIssuePlanItemResponseDto({
        pieceId: pieceKey,
        pieceCode: bp.piece.code,
        pieceName: bp.piece.name,
        totalQty,
        issuedQty,
        remainingToIssue: totalQty - issuedQty,
        allocations,
      });
    });
  }

  /**
   * Gộp nhiều ProductionOrder 1 lần - "Bảng thống kê" (ThongKePagePlan.tsx) tải tiến độ Đan cho
   * nhiều SKU cùng lúc, trước đây mỗi SKU tự gọi getIssuePlan() riêng (N request). Cùng logic
   * gộp allocation theo (piece, weavingPoint) như getIssuePlan(), chỉ khác nguồn dữ liệu đã lọc
   * sẵn theo đúng order trước khi gộp.
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
      select: { id: true, bomRevisionId: true, quantity: true },
    });
    const revisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const orderIds = orders.map((o) => o.id);

    const [bomPieces, issues, receipts] = await Promise.all([
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
    ]);

    const bomPiecesByRevision = new Map<string, typeof bomPieces>();
    for (const bp of bomPieces) {
      const key = bp.bomRevisionId.toString();
      const arr = bomPiecesByRevision.get(key);
      if (arr) arr.push(bp);
      else bomPiecesByRevision.set(key, [bp]);
    }

    for (const order of orders) {
      const wovenBomPieces = (bomPiecesByRevision.get(order.bomRevisionId.toString()) ?? []).filter(
        (bp) => bp.isWoven,
      );
      const orderIssues = issues.filter((i) => i.productionOrderId === order.id);
      const orderReceipts = receipts.filter((r) => r.productionOrderId === order.id);

      result[order.id.toString()] = wovenBomPieces.map((bp) => {
        const pieceKey = bp.pieceId.toString();
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

        const totalQty = bp.qtyPerUnit * order.quantity;
        const issuedQty = pieceIssues.reduce((s, i) => s + i.qty, 0);

        return new WeavingIssuePlanItemResponseDto({
          pieceId: pieceKey,
          pieceCode: bp.piece.code,
          pieceName: bp.piece.name,
          totalQty,
          issuedQty,
          remainingToIssue: totalQty - issuedQty,
          allocations,
        });
      });
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
            sample.productionOrder.productionInvoiceItem.salesOrder?.code ??
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
    // null = tổng kho (BOSS/ADMIN) - không có gì để chặn.
    if (warehouseScope && warehouseScope !== expectedWarehouseCode) {
      throw new ForbiddenException(
        `Caller bị giới hạn ở kho '${warehouseScope}', không được ${action} từ kho '${expectedWarehouseCode}'`,
      );
    }
  }

  private async findBomPieceOrThrow(
    bomRevisionId: bigint,
    pieceId: bigint,
  ): Promise<{ qtyPerUnit: number; isWoven: boolean }> {
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

  private async sumIssuedForPiece(
    tx: PrismaTx,
    productionOrderId: bigint,
    pieceId: bigint,
  ): Promise<number> {
    const result = await tx.weavingIssue.aggregate({
      where: { productionOrderId, pieceId },
      _sum: { qty: true },
    });
    return result._sum.qty ?? 0;
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
      throw new NotFoundException(`Production order ${id} not found`);
    }
    return order;
  }

  private async findPieceOrThrow(id: bigint): Promise<Piece> {
    const piece = await this.prisma.piece.findUnique({ where: { id } });
    if (!piece) {
      throw new NotFoundException(`Piece ${id} not found`);
    }
    return piece;
  }

  private async findWeavingPointOrThrow(id: bigint): Promise<WeavingPoint> {
    const weavingPoint = await this.prisma.weavingPoint.findUnique({ where: { id } });
    if (!weavingPoint) {
      throw new NotFoundException(`Weaving point ${id} not found`);
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
      throw new NotFoundException(`Weaving issue ${id} not found`);
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
      throw new NotFoundException(`Weaving receipt ${id} not found`);
    }
    return receipt;
  }

  private toIssueResponseDto(issue: WeavingIssueRow): WeavingIssueResponseDto {
    return new WeavingIssueResponseDto({
      id: issue.id.toString(),
      productionOrderId: issue.productionOrderId.toString(),
      poNumber: issue.productionOrder.poNumber,
      salesOrderCode: issue.productionOrder.productionInvoiceItem.salesOrder?.code ?? null,
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
      salesOrderCode: receipt.productionOrder.productionInvoiceItem.salesOrder?.code ?? null,
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
