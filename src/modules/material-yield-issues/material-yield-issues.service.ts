import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MaterialYieldIssueStatus,
  Prisma,
  ProductionOrder,
  StockLedgerRefType,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import {
  assertItemPiHasActiveFloor,
  assertItemPiHasActiveFloorLocked,
} from '../../common/utils/floor-gate.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { CreateMaterialYieldIssueDto } from './dto/create-material-yield-issue.dto';
import { ListMaterialYieldIssuesQueryDto } from './dto/list-material-yield-issues-query.dto';
import { MaterialYieldIssuePlanItemResponseDto } from './dto/material-yield-issue-plan-item-response.dto';
import { MaterialYieldIssueResponseDto } from './dto/material-yield-issue-response.dto';
import { ReceiveMaterialYieldIssueDto } from './dto/receive-material-yield-issue.dto';

const MATERIAL_YIELD_ISSUE_INCLUDE = {
  productionOrder: {
    include: { productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } } },
  },
  material: true,
} satisfies Prisma.MaterialYieldIssueInclude;

type MaterialYieldIssueRow = Prisma.MaterialYieldIssueGetPayload<{
  include: typeof MATERIAL_YIELD_ISSUE_INCLUDE;
}>;

/// Kho ảo cố định (protected-warehouse-codes.constant.ts) - cùng điểm đến STEEL_ISSUE/
/// MATERIAL_ISSUE dùng cho mọi luồng "tiêu hao tại xưởng".
const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';

/**
 * Xuất kho nguyên liệu thô Vật tư thành phẩm (Sắt La → Pat, Thanh nhôm → chân nhôm) cho Phôi -
 * thêm 2026-09-04, mirror MaterialIssuesService (KHÔNG mirror SteelIssuesService): xuất TỰ DO theo
 * định mức PieceMaterialYield, KHÔNG cần qua bước đề xuất/duyệt phương án trước (khác Sắt bắt buộc
 * CuttingProposal đã duyệt - Sắt La/thanh nhôm không có bài toán tối ưu cắt cần solver giải).
 *
 * KHÁC MaterialIssue: kho nguồn KHÔNG phải hằng số cố định (MATERIAL_WAREHOUSE_CODE) mà lấy TỪ
 * `Material.warehouseId` của chính material đó - mỗi material Vật tư thành phẩm tự có kho riêng
 * (đúng cách ProductionBatchesService.postMaterialYieldConsumeEntry() CŨ từng làm, nay đã xoá hàm
 * đó để tránh trừ tồn 2 lần - đây là điểm trừ tồn DUY NHẤT còn lại cho Vật tư thành phẩm).
 *
 * State machine chỉ ISSUED -> RECEIVED (không qua AWAITING_QC/QC_PASSED như SteelIssue) - KCS xảy
 * ra ở bước "Chốt & gửi KCS" (ProductionBatchesService.create(), đã có từ trước), không phải ở đây.
 */
@Injectable()
export class MaterialYieldIssuesService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
  ) {}

  async create(
    productionOrderId: string,
    dto: CreateMaterialYieldIssueDto,
    issuedById: string,
    warehouseScope: string | null,
    idempotencyKey?: string,
  ): Promise<MaterialYieldIssueResponseDto> {
    if (idempotencyKey) {
      const existing = await this.prisma.materialYieldIssue.findUnique({
        where: { idempotencyKey },
        include: MATERIAL_YIELD_ISSUE_INCLUDE,
      });
      if (existing) {
        // Vẫn gọi lại postLedgerEntry() (retry-safety, cùng idiom MaterialIssuesService.create()) -
        // postEntry() tự resolve-or-return theo idempotencyKey riêng, an toàn gọi lại nhiều lần.
        // Nếu KHÔNG gọi lại: request đầu tạo materialYieldIssue thành công nhưng lỡ mất mạng TRƯỚC
        // khi ghi StockLedger, request retry sau sẽ thấy `existing` và trả về luôn - StockLedger
        // vĩnh viễn không bao giờ được ghi cho đợt đó.
        await this.postLedgerEntry(existing, issuedById);
        return this.toResponseDto(existing);
      }
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    await assertItemPiHasActiveFloor(this.prisma, order.productionInvoiceItemId, 'xuất vật tư');
    const materialBigId = parseBigIntId(dto.materialId);
    const material = await this.prisma.material.findUnique({
      where: { id: materialBigId },
      include: { warehouse: true },
    });
    if (!material) {
      throw new NotFoundException(`Vật tư ${dto.materialId} not found`);
    }
    if (!material.warehouse) {
      throw new BadRequestException(
        `Vật tư ${material.name} chưa được gán kho (Material.warehouseId) - báo Admin cấu hình trước khi xuất`,
      );
    }
    this.assertWarehouseScope(warehouseScope, material.warehouse.code);

    // Khoá advisory theo (order, material) - đọc-rồi-ghi (plannedQty/sumIssued) không transaction/
    // lock sẽ có khe TOCTOU khi 2 người cùng xuất gần đồng thời, cùng idiom
    // MaterialIssuesService.create() (lockBusinessKey ở đó).
    const created = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `material-yield-issue:${order.id}:${materialBigId}`);
      await assertItemPiHasActiveFloorLocked(tx, order.productionInvoiceItemId, 'xuất vật tư');

      const requiredQty = await this.resolveRequiredQty(
        tx,
        order.bomRevisionId,
        materialBigId,
        order.quantity,
      );
      const issuedSoFar = await this.sumIssued(tx, order.id, materialBigId);
      const remaining = requiredQty - issuedSoFar;
      if (dto.issuedQty > remaining) {
        throw new BadRequestException(
          `Số lượng xuất (${dto.issuedQty}) vượt quá số lượng còn có thể xuất cho vật tư ${material.name} ` +
            `(định mức ${requiredQty}, đã xuất ${issuedSoFar}, còn ${remaining})`,
        );
      }

      return tx.materialYieldIssue.create({
        data: {
          productionOrderId: order.id,
          materialId: materialBigId,
          issuedQty: dto.issuedQty,
          issuedById,
          idempotencyKey,
        },
        include: MATERIAL_YIELD_ISSUE_INCLUDE,
      });
    });

    await this.postLedgerEntry(created, issuedById);
    return this.toResponseDto(created);
  }

  private async postLedgerEntry(issue: MaterialYieldIssueRow, createdById: string): Promise<void> {
    if (!issue.material.warehouseId) return;
    const productionWarehouse = await this.prisma.warehouse.findUniqueOrThrow({
      where: { code: PRODUCTION_WAREHOUSE_CODE },
    });
    await this.stockLedgerService.postEntry({
      fromWarehouseId: issue.material.warehouseId,
      toWarehouseId: productionWarehouse.id,
      materialId: issue.materialId,
      qty: issue.issuedQty.toNumber(),
      refType: StockLedgerRefType.MATERIAL_YIELD_CONSUME,
      refId: issue.id.toString(),
      createdById,
      idempotencyKey: `material-yield-issue:${issue.id}`,
    });
  }

  async receive(
    id: string,
    dto: ReceiveMaterialYieldIssueDto,
    receivedById: string,
    callerMfgRole: string | null,
  ): Promise<MaterialYieldIssueResponseDto> {
    const issue = await this.findOneOrThrow(id);
    if (issue.status !== MaterialYieldIssueStatus.ISSUED) {
      throw new ConflictException(
        `Material yield issue ${id} đang ở trạng thái ${issue.status} - chỉ ISSUED mới xác nhận nhận được`,
      );
    }
    this.assertMfgRoleIsPhoi(callerMfgRole);
    await assertItemPiHasActiveFloor(
      this.prisma,
      issue.productionOrder.productionInvoiceItemId,
      'xác nhận nhận vật tư',
    );

    const issuedQty = issue.issuedQty.toNumber();
    const receivedQty = dto.receivedQty ?? issuedQty;
    if (receivedQty > issuedQty) {
      throw new BadRequestException(
        `Số lượng nhận (${receivedQty}) vượt quá số lượng đã xuất (${issuedQty}) của đợt ${id}`,
      );
    }

    const updated = await this.prisma.materialYieldIssue.update({
      where: { id: issue.id },
      data: {
        status: MaterialYieldIssueStatus.RECEIVED,
        receivedQty,
        receivedAt: new Date(),
        receivedById,
      },
      include: MATERIAL_YIELD_ISSUE_INCLUDE,
    });
    return this.toResponseDto(updated);
  }

  /** "Cần xuất bao nhiêu" theo material - dùng công thức PieceMaterialYieldPurchaseService.compute
   *  (Σ ceil(plannedQty(piece) × qtyPerPiece / piecesPerBar)), KHÔNG trừ tồn kho hiện có (khác ngữ
   *  cảnh "cần mua thêm") - giống MaterialIssuePlanItemResponseDto chỉ so với BOM, không so tồn. */
  async getIssuePlan(productionOrderId: string): Promise<MaterialYieldIssuePlanItemResponseDto[]> {
    const order = await this.findOrderOrThrow(productionOrderId);

    const [yieldRows, issues] = await Promise.all([
      this.prisma.pieceMaterialYield.findMany({
        where: { bomRevisionId: order.bomRevisionId },
        include: { material: true },
      }),
      this.prisma.materialYieldIssue.findMany({
        where: { productionOrderId: order.id },
        select: { materialId: true, issuedQty: true },
      }),
    ]);
    if (yieldRows.length === 0) return [];

    const pieceIds = [...new Set(yieldRows.map((y) => y.pieceId))];
    const bomPieces = await this.prisma.bomPiece.findMany({
      where: { bomRevisionId: order.bomRevisionId, pieceId: { in: pieceIds } },
    });
    const qtyPerUnitByPiece = new Map(
      bomPieces.map((bp) => [bp.pieceId.toString(), bp.qtyPerUnit]),
    );

    const issuedByMaterial = new Map<string, number>();
    for (const i of issues) {
      const key = i.materialId.toString();
      issuedByMaterial.set(key, (issuedByMaterial.get(key) ?? 0) + i.issuedQty.toNumber());
    }

    const requiredByMaterial = new Map<string, { code: string; name: string; required: number }>();
    for (const y of yieldRows) {
      const qtyPerUnit = qtyPerUnitByPiece.get(y.pieceId.toString());
      if (qtyPerUnit == null) continue;
      const plannedQty = qtyPerUnit * order.quantity;
      const neededMaterial = Math.ceil((plannedQty * (y.qtyPerPiece ?? 1)) / y.piecesPerBar);
      const key = y.materialId.toString();
      const acc = requiredByMaterial.get(key) ?? {
        code: y.material.code,
        name: y.material.name,
        required: 0,
      };
      acc.required += neededMaterial;
      requiredByMaterial.set(key, acc);
    }

    return [...requiredByMaterial.entries()].map(([materialId, v]) => {
      const issuedQty = issuedByMaterial.get(materialId) ?? 0;
      return new MaterialYieldIssuePlanItemResponseDto({
        materialId,
        materialCode: v.code,
        materialName: v.name,
        requiredQty: v.required,
        issuedQty,
        remainingToIssue: v.required - issuedQty,
      });
    });
  }

  /** Flat, KHÔNG cần productionOrderId - xem ListMaterialYieldIssuesQueryDto. */
  async findAll(
    query: ListMaterialYieldIssuesQueryDto,
  ): Promise<Paginated<MaterialYieldIssueResponseDto>> {
    const where: Prisma.MaterialYieldIssueWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.materialYieldIssue.findMany({
            ...args,
            include: MATERIAL_YIELD_ISSUE_INCLUDE,
          }),
        count: (args) => this.prisma.materialYieldIssue.count(args),
      },
      query,
      where,
      { issuedAt: 'desc' as const },
    );
    return { data: result.data.map((r) => this.toResponseDto(r)), meta: result.meta };
  }

  async findAllForOrder(
    productionOrderId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<MaterialYieldIssueResponseDto>> {
    const bigId = parseBigIntId(productionOrderId);
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.materialYieldIssue.findMany({
            ...args,
            include: MATERIAL_YIELD_ISSUE_INCLUDE,
          }),
        count: (args) => this.prisma.materialYieldIssue.count(args),
      },
      query,
      { productionOrderId: bigId },
      { issuedAt: 'desc' as const },
    );
    return { data: result.data.map((r) => this.toResponseDto(r)), meta: result.meta };
  }

  async findOne(id: string): Promise<MaterialYieldIssueResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  /** Tổng đã RECEIVED cho (order, material) - dùng bởi ProductionBatchesService để chặn "chưa
   *  nhận thì chưa báo được" (recordPieceStepBatch()/create()). Export public vì gọi chéo module. */
  async sumReceived(productionOrderId: bigint, materialId: bigint): Promise<number> {
    const result = await this.prisma.materialYieldIssue.aggregate({
      where: { productionOrderId, materialId, status: MaterialYieldIssueStatus.RECEIVED },
      _sum: { receivedQty: true },
    });
    return result._sum.receivedQty?.toNumber() ?? 0;
  }

  private async resolveRequiredQty(
    tx: PrismaTx,
    bomRevisionId: bigint,
    materialId: bigint,
    orderQuantity: number,
  ): Promise<number> {
    const yieldRows = await tx.pieceMaterialYield.findMany({
      where: { bomRevisionId, materialId },
    });
    if (yieldRows.length === 0) {
      throw new NotFoundException(
        `Vật tư ${materialId} không thuộc định mức vật tư thành phẩm (PieceMaterialYield) của lệnh sản xuất này`,
      );
    }
    const pieceIds = yieldRows.map((y) => y.pieceId);
    const bomPieces = await tx.bomPiece.findMany({
      where: { bomRevisionId, pieceId: { in: pieceIds } },
    });
    const qtyPerUnitByPiece = new Map(
      bomPieces.map((bp) => [bp.pieceId.toString(), bp.qtyPerUnit]),
    );

    let required = 0;
    for (const y of yieldRows) {
      const qtyPerUnit = qtyPerUnitByPiece.get(y.pieceId.toString());
      if (qtyPerUnit == null) continue;
      const plannedQty = qtyPerUnit * orderQuantity;
      required += Math.ceil((plannedQty * (y.qtyPerPiece ?? 1)) / y.piecesPerBar);
    }
    return required;
  }

  private async sumIssued(
    tx: PrismaTx,
    productionOrderId: bigint,
    materialId: bigint,
  ): Promise<number> {
    const result = await tx.materialYieldIssue.aggregate({
      where: { productionOrderId, materialId },
      _sum: { issuedQty: true },
    });
    return result._sum.issuedQty?.toNumber() ?? 0;
  }

  /** null = tổng kho (BOSS/ADMIN) - không có gì để chặn, cùng idiom SteelIssuesService/
   *  MaterialIssuesService.assertWarehouseScope(). Khác 2 nơi đó: kho không phải hằng số cố định
   *  mà lấy TỪ material.warehouse.code (mỗi material tự có kho riêng). */
  private assertWarehouseScope(warehouseScope: string | null, materialWarehouseCode: string): void {
    if (warehouseScope && warehouseScope !== materialWarehouseCode) {
      throw new ForbiddenException(
        `Caller bị giới hạn ở kho '${warehouseScope}', không được xuất vật tư từ kho '${materialWarehouseCode}'`,
      );
    }
  }

  private assertMfgRoleIsPhoi(mfgRole: string | null): void {
    if (!mfgRole) return;
    if (mfgRole !== 'PHOI') {
      throw new ForbiddenException(
        `Caller có mfgRole '${mfgRole}', không được xác nhận nhận vật tư thành phẩm (chỉ Phôi)`,
      );
    }
  }

  private async findOrderOrThrow(id: string): Promise<ProductionOrder> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({ where: { id: bigId } });
    if (!order) {
      throw new NotFoundException(`Production order ${id} not found`);
    }
    return order;
  }

  private async findOneOrThrow(id: string): Promise<MaterialYieldIssueRow> {
    const bigId = parseBigIntId(id);
    const issue = await this.prisma.materialYieldIssue.findUnique({
      where: { id: bigId },
      include: MATERIAL_YIELD_ISSUE_INCLUDE,
    });
    if (!issue) {
      throw new NotFoundException(`Material yield issue ${id} not found`);
    }
    return issue;
  }

  private toResponseDto(issue: MaterialYieldIssueRow): MaterialYieldIssueResponseDto {
    return new MaterialYieldIssueResponseDto({
      id: issue.id.toString(),
      productionOrderId: issue.productionOrderId.toString(),
      poNumber: issue.productionOrder.poNumber,
      salesOrderCode: issue.productionOrder.productionInvoiceItem.salesOrder?.code ?? null,
      materialId: issue.materialId.toString(),
      materialCode: issue.material.code,
      materialName: issue.material.name,
      issuedQty: issue.issuedQty.toNumber(),
      status: issue.status,
      issuedAt: issue.issuedAt,
      issuedById: issue.issuedById,
      receivedQty: issue.receivedQty?.toNumber() ?? null,
      receivedAt: issue.receivedAt,
      receivedById: issue.receivedById,
    });
  }
}
