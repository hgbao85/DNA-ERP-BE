import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MaterialIssueStatus,
  MfgRole,
  MfgStage,
  Prisma,
  ProductionOrder,
  StockLedgerRefType,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { CreateMaterialIssueDto } from './dto/create-material-issue.dto';
import { MaterialIssuePlanItemResponseDto } from './dto/material-issue-plan-item-response.dto';
import { MaterialIssueResponseDto } from './dto/material-issue-response.dto';
import { ReceiveMaterialIssueDto } from './dto/receive-material-issue.dto';

const MATERIAL_ISSUE_INCLUDE = {
  productionOrder: true,
  material: true,
} satisfies Prisma.MaterialIssueInclude;

type MaterialIssueRow = Prisma.MaterialIssueGetPayload<{ include: typeof MATERIAL_ISSUE_INCLUDE }>;

/// Kho vật lý duy nhất liên quan - đúng ghi chú SEED_WAREHOUSES "Sơn, dây, vật tư tiêu hao sản
/// xuất", cùng giá trị WEAVING_WAREHOUSE_CODE ở weaving-issues.service.ts (2 domain dùng chung
/// 1 kho vật lý, khác mục đích).
const MATERIAL_WAREHOUSE_CODE = 'vat-tu-tp';
/// Kho ảo cố định (protected-warehouse-codes.constant.ts) - cùng điểm đến STEEL_ISSUE dùng ở
/// CuttingProposalsService.approve(), PRODUCTION_WAREHOUSE_CODE ở đó.
const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';

/**
 * Xuất vật tư tiêu hao Hàn/Sơn (M2, thay vat-tu-noi-bo.service.ts mock) - CO₂, dây hàn, bột sơn,
 * dung môi... KHÁC WIP (đoạn/khung): không qua KCS, chỉ ISSUED -> RECEIVED. Định mức nằm ở
 * ConsumableBom (theo bomRevision của PO) - "còn xuất được bao nhiêu" = qtyPerUnit ×
 * order.quantity trừ SUM(MaterialIssue.issuedQty đã có), cùng idiom SteelIssuesService/
 * WeavingIssuesService.getIssuePlan().
 *
 * KHÁC steel_issue/weaving_issue: CÓ ghi StockLedger (ref_type=MATERIAL_ISSUE) - vật tư tiêu hao
 * chưa bị trừ tồn ở bước nào trước đó (khác sắt: CuttingProposal.approve() đã trừ tồn lúc duyệt
 * phương án cắt). postEntry() gọi NGOÀI transaction tạo material_issue (idempotencyKey riêng
 * theo id bản ghi) - cùng idiom WarehouseTransfersService.confirm(), an toàn khi gọi lại: nếu
 * postEntry() lỡ lỗi giữa chừng, retry create() với cùng Idempotency-Key sẽ tìm lại đúng bản ghi
 * rồi gọi lại postEntry() (tự resolve-or-return theo key riêng của nó).
 */
@Injectable()
export class MaterialIssuesService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
  ) {}

  async create(
    productionOrderId: string,
    dto: CreateMaterialIssueDto,
    issuedById: string,
    warehouseScope: string | null,
    idempotencyKey?: string,
  ): Promise<MaterialIssueResponseDto> {
    this.assertWarehouseScope(warehouseScope);
    this.assertConsumableStage(dto.stage);

    if (idempotencyKey) {
      const existing = await this.prisma.materialIssue.findUnique({
        where: { idempotencyKey },
        include: MATERIAL_ISSUE_INCLUDE,
      });
      if (existing) {
        await this.postLedgerEntry(existing, issuedById);
        return this.toResponseDto(existing);
      }
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    const materialBigId = parseBigIntId(dto.materialId);
    await this.findMaterialOrThrow(materialBigId);

    const plannedQty = await this.resolvePlannedQty(
      order.bomRevisionId,
      dto.stage,
      materialBigId,
      order.quantity,
    );
    const issuedSoFar = await this.sumIssued(order.id, dto.stage, materialBigId);
    const remaining = plannedQty - issuedSoFar;
    if (dto.issuedQty > remaining) {
      throw new BadRequestException(
        `Số lượng xuất (${dto.issuedQty}) vượt quá số lượng còn có thể xuất cho vật tư ${dto.materialId} ` +
          `công đoạn ${dto.stage} (định mức ${plannedQty}, đã xuất ${issuedSoFar}, còn ${remaining})`,
      );
    }

    const created = await this.prisma.materialIssue.create({
      data: {
        stage: dto.stage,
        productionOrderId: order.id,
        materialId: materialBigId,
        issuedQty: dto.issuedQty,
        issuedById,
        idempotencyKey,
      },
      include: MATERIAL_ISSUE_INCLUDE,
    });

    await this.postLedgerEntry(created, issuedById);
    return this.toResponseDto(created);
  }

  async receive(
    id: string,
    dto: ReceiveMaterialIssueDto,
    receivedById: string,
    callerMfgRole: string | null,
  ): Promise<MaterialIssueResponseDto> {
    const issue = await this.findOneOrThrow(id);
    if (issue.status !== MaterialIssueStatus.ISSUED) {
      throw new ConflictException(
        `Material issue ${id} đang ở trạng thái ${issue.status} - chỉ ISSUED mới xác nhận nhận được`,
      );
    }
    this.assertMfgRoleMatchesStage(callerMfgRole, issue.stage);

    const issuedQty = issue.issuedQty.toNumber();
    const receivedQty = dto.receivedQty ?? issuedQty;
    if (receivedQty > issuedQty) {
      throw new BadRequestException(
        `Số lượng nhận (${receivedQty}) vượt quá số lượng đã xuất (${issuedQty}) của đợt ${id}`,
      );
    }

    const updated = await this.prisma.materialIssue.update({
      where: { id: issue.id },
      data: {
        status: MaterialIssueStatus.RECEIVED,
        receivedQty,
        receivedAt: new Date(),
        receivedById,
      },
      include: MATERIAL_ISSUE_INCLUDE,
    });
    return this.toResponseDto(updated);
  }

  /** "Cần xuất bao nhiêu" theo (material, stage) - query trực tiếp, không có bảng cache riêng. */
  async getIssuePlan(productionOrderId: string): Promise<MaterialIssuePlanItemResponseDto[]> {
    const order = await this.findOrderOrThrow(productionOrderId);

    const [consumableBoms, issues] = await Promise.all([
      this.prisma.consumableBom.findMany({
        where: {
          bomRevisionId: order.bomRevisionId,
          stage: { in: [MfgStage.HAN, MfgStage.SON] },
        },
        include: { material: true },
      }),
      this.prisma.materialIssue.findMany({
        where: { productionOrderId: order.id },
        select: { stage: true, materialId: true, issuedQty: true },
      }),
    ]);

    const issuedByKey = new Map<string, number>();
    for (const i of issues) {
      const key = `${i.stage}:${i.materialId}`;
      issuedByKey.set(key, (issuedByKey.get(key) ?? 0) + i.issuedQty.toNumber());
    }

    return consumableBoms.map((cb) => {
      const key = `${cb.stage}:${cb.materialId}`;
      const requiredQty = cb.qtyPerUnit.toNumber() * order.quantity;
      const issuedQty = issuedByKey.get(key) ?? 0;
      return new MaterialIssuePlanItemResponseDto({
        stage: cb.stage,
        materialId: cb.materialId.toString(),
        materialCode: cb.material.code,
        materialName: cb.material.name,
        requiredQty,
        issuedQty,
        remainingToIssue: requiredQty - issuedQty,
      });
    });
  }

  async findAllForOrder(
    productionOrderId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<MaterialIssueResponseDto>> {
    const bigId = parseBigIntId(productionOrderId);
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.materialIssue.findMany({ ...args, include: MATERIAL_ISSUE_INCLUDE }),
        count: (args) => this.prisma.materialIssue.count(args),
      },
      query,
      { productionOrderId: bigId },
      { issuedAt: 'desc' as const },
    );
    return { data: result.data.map((r) => this.toResponseDto(r)), meta: result.meta };
  }

  async findOne(id: string): Promise<MaterialIssueResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  private async postLedgerEntry(issue: MaterialIssueRow, createdById: string): Promise<void> {
    const [fromWarehouse, toWarehouse] = await Promise.all([
      this.prisma.warehouse.findUniqueOrThrow({ where: { code: MATERIAL_WAREHOUSE_CODE } }),
      this.prisma.warehouse.findUniqueOrThrow({ where: { code: PRODUCTION_WAREHOUSE_CODE } }),
    ]);
    await this.stockLedgerService.postEntry({
      fromWarehouseId: fromWarehouse.id,
      toWarehouseId: toWarehouse.id,
      materialId: issue.materialId,
      qty: issue.issuedQty.toNumber(),
      refType: StockLedgerRefType.MATERIAL_ISSUE,
      refId: issue.id.toString(),
      createdById,
      idempotencyKey: `material-issue:${issue.id}`,
    });
  }

  /** null = tổng kho (BOSS/ADMIN) - không có gì để chặn, cùng idiom SteelIssuesService/
   *  WeavingIssuesService.assertWarehouseScope(). */
  private assertWarehouseScope(warehouseScope: string | null): void {
    if (warehouseScope && warehouseScope !== MATERIAL_WAREHOUSE_CODE) {
      throw new ForbiddenException(
        `Caller bị giới hạn ở kho '${warehouseScope}', không được xuất vật tư tiêu hao từ kho '${MATERIAL_WAREHOUSE_CODE}'`,
      );
    }
  }

  /** null = quản lý/tổng (PRODUCTION_MANAGER/BOSS/ADMIN) - không có gì để chặn, cùng idiom
   *  assertWarehouseScope() ở trên. Khác null: đúng tổ Hàn/Sơn mới xác nhận được đợt của công
   *  đoạn mình, HAN không xác nhận hộ SON và ngược lại. */
  private assertMfgRoleMatchesStage(mfgRole: string | null, stage: MfgStage): void {
    if (!mfgRole) return;
    const expected = stage === MfgStage.HAN ? MfgRole.HAN : MfgRole.SON;
    if (mfgRole !== expected) {
      throw new ForbiddenException(
        `Caller có mfgRole '${mfgRole}', không được xác nhận nhận vật tư của công đoạn ${stage}`,
      );
    }
  }

  private assertConsumableStage(stage: MfgStage): void {
    if (stage !== MfgStage.HAN && stage !== MfgStage.SON) {
      throw new BadRequestException(
        `Xuất vật tư tiêu hao chỉ áp dụng cho công đoạn HAN hoặc SON, nhận được '${stage}'`,
      );
    }
  }

  private async resolvePlannedQty(
    bomRevisionId: bigint,
    stage: MfgStage,
    materialId: bigint,
    orderQuantity: number,
  ): Promise<number> {
    const bom = await this.prisma.consumableBom.findUnique({
      where: { bomRevisionId_stage_materialId: { bomRevisionId, stage, materialId } },
    });
    if (!bom) {
      throw new NotFoundException(
        `Vật tư ${materialId} không thuộc định mức tiêu hao (ConsumableBom) công đoạn ${stage} của lệnh sản xuất này`,
      );
    }
    return bom.qtyPerUnit.toNumber() * orderQuantity;
  }

  private async sumIssued(
    productionOrderId: bigint,
    stage: MfgStage,
    materialId: bigint,
  ): Promise<number> {
    const result = await this.prisma.materialIssue.aggregate({
      where: { productionOrderId, stage, materialId },
      _sum: { issuedQty: true },
    });
    return result._sum.issuedQty?.toNumber() ?? 0;
  }

  private async findOrderOrThrow(id: string): Promise<ProductionOrder> {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({ where: { id: bigId } });
    if (!order) {
      throw new NotFoundException(`Production order ${id} not found`);
    }
    return order;
  }

  private async findMaterialOrThrow(id: bigint): Promise<void> {
    const material = await this.prisma.material.findUnique({ where: { id } });
    if (!material) {
      throw new NotFoundException(`Material ${id} not found`);
    }
  }

  private async findOneOrThrow(id: string): Promise<MaterialIssueRow> {
    const bigId = parseBigIntId(id);
    const issue = await this.prisma.materialIssue.findUnique({
      where: { id: bigId },
      include: MATERIAL_ISSUE_INCLUDE,
    });
    if (!issue) {
      throw new NotFoundException(`Material issue ${id} not found`);
    }
    return issue;
  }

  private toResponseDto(issue: MaterialIssueRow): MaterialIssueResponseDto {
    return new MaterialIssueResponseDto({
      id: issue.id.toString(),
      productionOrderId: issue.productionOrderId.toString(),
      poNumber: issue.productionOrder.poNumber,
      stage: issue.stage,
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
