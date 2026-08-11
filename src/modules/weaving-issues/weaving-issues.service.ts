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
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateWeavingIssueDto } from './dto/create-weaving-issue.dto';
import { CreateWeavingReceiptDto } from './dto/create-weaving-receipt.dto';
import { WeavingAllocationItemResponseDto } from './dto/weaving-allocation-item-response.dto';
import { WeavingIssuePlanItemResponseDto } from './dto/weaving-issue-plan-item-response.dto';
import { WeavingIssueResponseDto } from './dto/weaving-issue-response.dto';
import { WeavingReceiptResponseDto } from './dto/weaving-receipt-response.dto';

const WEAVING_ISSUE_INCLUDE = {
  productionOrder: true,
  piece: true,
  weavingPoint: true,
} satisfies Prisma.WeavingIssueInclude;

const WEAVING_RECEIPT_INCLUDE = {
  productionOrder: true,
  piece: true,
  weavingPoint: true,
} satisfies Prisma.WeavingReceiptInclude;

type WeavingIssueRow = Prisma.WeavingIssueGetPayload<{ include: typeof WEAVING_ISSUE_INCLUDE }>;
type WeavingReceiptRow = Prisma.WeavingReceiptGetPayload<{
  include: typeof WEAVING_RECEIPT_INCLUDE;
}>;

/// Kho vật lý duy nhất liên quan - nơi khung chờ xuất/nhận về sau Đan, giữa phoi-son-han và
/// thanh-pham theo TRANSFER_ROUTES (transfer-routes.constant.ts).
const WEAVING_WAREHOUSE_CODE = 'vat-tu-tp';

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
    this.assertWarehouseScope(warehouseScope, 'xuất đan');

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
    const pieceBigId = parseBigIntId(dto.pieceId);
    const weavingPointBigId = parseBigIntId(dto.weavingPointId);

    const piece = await this.findPieceOrThrow(pieceBigId);
    if (!piece.isWoven) {
      throw new BadRequestException(
        `Mảnh ${dto.pieceId} không thuộc công đoạn Đan (isWoven=false) - không thể xuất đan mảnh này`,
      );
    }

    const weavingPoint = await this.findWeavingPointOrThrow(weavingPointBigId);
    if (!weavingPoint.isActive) {
      throw new BadRequestException(
        `Điểm đan ${dto.weavingPointId} đã ngừng hoạt động - không thể xuất đan mới cho điểm này`,
      );
    }

    const plannedQty = await this.resolvePlannedQty(
      order.bomRevisionId,
      pieceBigId,
      order.quantity,
    );
    const issuedSoFar = await this.sumIssuedForPiece(order.id, pieceBigId);
    const remaining = plannedQty - issuedSoFar;
    if (dto.qty > remaining) {
      throw new BadRequestException(
        `Số lượng xuất đan (${dto.qty}) vượt quá số lượng còn có thể xuất cho mảnh ${dto.pieceId} ` +
          `(định mức ${plannedQty}, đã xuất ${issuedSoFar}, còn ${remaining})`,
      );
    }

    const created = await this.prisma.weavingIssue.create({
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

    return this.toIssueResponseDto(created);
  }

  async receive(
    productionOrderId: string,
    dto: CreateWeavingReceiptDto,
    receivedById: string,
    warehouseScope: string | null,
    idempotencyKey?: string,
  ): Promise<WeavingReceiptResponseDto> {
    this.assertWarehouseScope(warehouseScope, 'nhập đan');

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
    const pieceBigId = parseBigIntId(dto.pieceId);
    const weavingPointBigId = parseBigIntId(dto.weavingPointId);

    await this.findPieceOrThrow(pieceBigId);
    await this.findWeavingPointOrThrow(weavingPointBigId);

    const issuedAtPoint = await this.sumIssuedForPoint(order.id, pieceBigId, weavingPointBigId);
    const receivedAtPoint = await this.sumReceivedForPoint(order.id, pieceBigId, weavingPointBigId);
    const remaining = issuedAtPoint - receivedAtPoint;
    if (dto.qty > remaining) {
      throw new BadRequestException(
        `Số lượng nhập đan (${dto.qty}) vượt quá số lượng điểm đan ${dto.weavingPointId} còn giữ ` +
          `cho mảnh ${dto.pieceId} (đã xuất ${issuedAtPoint}, đã nhập ${receivedAtPoint}, còn ${remaining})`,
      );
    }

    const created = await this.prisma.weavingReceipt.create({
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

    const wovenBomPieces = bomPieces.filter((bp) => bp.piece.isWoven);

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

  private assertWarehouseScope(warehouseScope: string | null, action: string): void {
    // null = tổng kho (BOSS/ADMIN) - không có gì để chặn.
    if (warehouseScope && warehouseScope !== WEAVING_WAREHOUSE_CODE) {
      throw new ForbiddenException(
        `Caller bị giới hạn ở kho '${warehouseScope}', không được ${action} từ kho '${WEAVING_WAREHOUSE_CODE}'`,
      );
    }
  }

  private async resolvePlannedQty(
    bomRevisionId: bigint,
    pieceId: bigint,
    orderQuantity: number,
  ): Promise<number> {
    const bomPiece = await this.prisma.bomPiece.findUnique({
      where: { bomRevisionId_pieceId: { bomRevisionId, pieceId } },
    });
    if (!bomPiece) {
      throw new NotFoundException(
        `Mảnh ${pieceId} không thuộc định mức (BOM) của lệnh sản xuất này`,
      );
    }
    return bomPiece.qtyPerUnit * orderQuantity;
  }

  private async sumIssuedForPiece(productionOrderId: bigint, pieceId: bigint): Promise<number> {
    const result = await this.prisma.weavingIssue.aggregate({
      where: { productionOrderId, pieceId },
      _sum: { qty: true },
    });
    return result._sum.qty ?? 0;
  }

  private async sumIssuedForPoint(
    productionOrderId: bigint,
    pieceId: bigint,
    weavingPointId: bigint,
  ): Promise<number> {
    const result = await this.prisma.weavingIssue.aggregate({
      where: { productionOrderId, pieceId, weavingPointId },
      _sum: { qty: true },
    });
    return result._sum.qty ?? 0;
  }

  private async sumReceivedForPoint(
    productionOrderId: bigint,
    pieceId: bigint,
    weavingPointId: bigint,
  ): Promise<number> {
    const result = await this.prisma.weavingReceipt.aggregate({
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
