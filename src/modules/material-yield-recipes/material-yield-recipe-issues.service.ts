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
  AuditAction,
  MaterialYieldIssueStatus,
  Prisma,
  StockLedgerRefType,
} from '../../generated/prisma/client';
import { ClsService } from 'nestjs-cls';
import { auditEvent } from '../../common/utils/audit-event.util';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import {
  assertPiHasActiveFloor,
  assertPiHasActiveFloorLocked,
} from '../../common/utils/floor-gate.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { CreateMaterialYieldRecipeIssueDto } from './dto/create-material-yield-recipe-issue.dto';
import { ListMaterialYieldRecipeIssuesQueryDto } from './dto/list-material-yield-recipe-issues-query.dto';
import { MaterialYieldRecipeIssueResponseDto } from './dto/material-yield-recipe-issue-response.dto';
import { ReceiveMaterialYieldRecipeIssueDto } from './dto/receive-material-yield-recipe-issue.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MaterialYieldRecipesService } from './material-yield-recipes.service';

const ISSUE_INCLUDE = {
  productionInvoice: { select: { code: true } },
  recipe: { include: { inputMaterial: { include: { warehouse: true } } } },
} satisfies Prisma.MaterialYieldRecipeIssueInclude;
type IssueRow = Prisma.MaterialYieldRecipeIssueGetPayload<{ include: typeof ISSUE_INCLUDE }>;

const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';

/**
 * Xuất kho inputMaterial (vd thanh nhôm) theo MaterialYieldRecipe - mirror MaterialYieldIssuesService
 * nhưng khoá theo (productionInvoiceId, recipeId) thay vì (productionOrderId, materialId), vì
 * outputMaterial (vd chân nhôm) không gắn 1 SKU/piece cụ thể nào (xem doc comment model
 * MaterialYieldRecipeIssue, schema.prisma).
 *
 * Giản lược có chủ đích so với MaterialYieldIssuesService (phạm vi "trong ngày", 2026-10-01): CHƯA
 * nối StockReservationsService (giữ chỗ cho đề xuất mua tự động/drainPoolBestEffort) - giữ nguyên
 * bước kiểm tồn kho FOR UPDATE (điểm sửa đúng của audit 28/08 #4) nhưng availableQty = onHand thô,
 * không trừ giữ chỗ của các nguồn khác. Bổ sung sau nếu phát sinh xung đột thực tế.
 */
@Injectable()
export class MaterialYieldRecipeIssuesService {
  private readonly logger = new Logger(MaterialYieldRecipeIssuesService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
    private readonly materialYieldRecipesService: MaterialYieldRecipesService,
    private readonly notifications: NotificationsService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async create(
    productionInvoiceId: string,
    dto: CreateMaterialYieldRecipeIssueDto,
    issuedById: string,
    warehouseScope: string | null,
    idempotencyKey?: string,
  ): Promise<MaterialYieldRecipeIssueResponseDto> {
    if (idempotencyKey) {
      const existing = await this.prisma.materialYieldRecipeIssue.findUnique({
        where: { idempotencyKey },
        include: ISSUE_INCLUDE,
      });
      if (existing) {
        await this.postLedgerEntry(existing, issuedById);
        return this.toResponseDto(existing);
      }
    }

    const piId = parseBigIntId(productionInvoiceId);
    await assertPiHasActiveFloor(this.prisma, piId, 'xuất vật tư');
    const recipe = await this.materialYieldRecipesService.findOneRowOrThrow(dto.recipeId);
    const recipeBigId = parseBigIntId(dto.recipeId);
    const inputMaterial = recipe.inputMaterial;
    if (!inputMaterial.warehouse || !inputMaterial.warehouseId) {
      throw new BadRequestException(
        `Vật tư ${inputMaterial.name} chưa được gán kho (Material.warehouseId) - báo Admin cấu hình trước khi xuất`,
      );
    }
    const materialWarehouseId = inputMaterial.warehouseId;
    this.assertWarehouseScope(warehouseScope, inputMaterial.warehouse.code);

    const created = await this.prisma.$transaction(
      async (tx) => {
        await lockBusinessKey(tx, `material-yield-recipe-issue:${piId}:${recipeBigId}`);
        await assertPiHasActiveFloorLocked(tx, piId, 'xuất vật tư');

        const [stockRow] = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
        SELECT "qty" FROM "stock_quant"
        WHERE "warehouseId" = ${materialWarehouseId} AND "materialId" = ${inputMaterial.id}
        FOR UPDATE
      `;
        const onHand = stockRow?.qty.toNumber() ?? 0;
        if (dto.issuedQty > onHand) {
          throw new ConflictException(
            `Tồn kho (${onHand}) không đủ xuất ${dto.issuedQty} cho vật tư ${inputMaterial.name} - kiểm tra lại tồn kho thực tế trước khi xuất`,
          );
        }

        const issue = await tx.materialYieldRecipeIssue.create({
          data: {
            productionInvoiceId: piId,
            recipeId: recipeBigId,
            issuedQty: dto.issuedQty,
            issuedById,
            idempotencyKey,
          },
          include: ISSUE_INCLUDE,
        });
        await this.postLedgerEntry(issue, issuedById, tx);
        this.logger.log(
          `recipe issue ${issue.id} (pi ${piId}, recipe ${recipeBigId}, qty ${dto.issuedQty}) ghi ledger, chờ commit`,
        );
        return issue;
      },
      { timeout: 20000 },
    );
    this.logger.log(`recipe issue ${created.id} đã commit cùng ledger consume`);
    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.CREATE,
      tableName: 'MaterialYieldRecipeIssue',
      recordId: created.id,
      newValue: {
        productionInvoiceId: piId.toString(),
        recipeId: recipeBigId.toString(),
        issuedQty: dto.issuedQty,
      },
    });
    await this.notifyIssuedToPhoi(created);

    return this.toResponseDto(created);
  }

  private async postLedgerEntry(
    issue: IssueRow,
    createdById: string,
    tx?: PrismaTx,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const productionWarehouse = await db.warehouse.findUniqueOrThrow({
      where: { code: PRODUCTION_WAREHOUSE_CODE },
    });
    await this.stockLedgerService.postEntry(
      {
        fromWarehouseId: issue.recipe.inputMaterial.warehouseId!,
        toWarehouseId: productionWarehouse.id,
        materialId: issue.recipe.inputMaterialId,
        qty: issue.issuedQty.toNumber(),
        refType: StockLedgerRefType.MATERIAL_YIELD_CONSUME,
        refId: issue.id.toString(),
        createdById,
        idempotencyKey: `material-yield-recipe-issue:${issue.id}`,
      },
      tx,
    );
  }

  async receive(
    id: string,
    dto: ReceiveMaterialYieldRecipeIssueDto,
    receivedById: string,
    callerMfgRole: string | null,
  ): Promise<MaterialYieldRecipeIssueResponseDto> {
    const issue = await this.findOneOrThrow(id);
    if (issue.status !== MaterialYieldIssueStatus.ISSUED) {
      throw new ConflictException(
        `Material yield recipe issue ${id} đang ở trạng thái ${issue.status} - chỉ ISSUED mới xác nhận nhận được`,
      );
    }
    this.assertMfgRoleIsPhoi(callerMfgRole);
    await assertPiHasActiveFloor(this.prisma, issue.productionInvoiceId, 'xác nhận nhận vật tư');

    const issuedQty = issue.issuedQty.toNumber();
    const receivedQty = dto.receivedQty ?? issuedQty;
    if (receivedQty > issuedQty) {
      throw new BadRequestException(
        `Số lượng nhận (${receivedQty}) vượt quá số lượng đã xuất (${issuedQty}) của đợt ${id}`,
      );
    }

    const { count } = await this.prisma.materialYieldRecipeIssue.updateMany({
      where: { id: issue.id, status: MaterialYieldIssueStatus.ISSUED },
      data: {
        status: MaterialYieldIssueStatus.RECEIVED,
        receivedQty,
        receivedAt: new Date(),
        receivedById,
      },
    });
    if (count === 0) {
      throw new ConflictException(
        `Material yield recipe issue ${id} đã được xác nhận nhận bởi 1 request khác trong lúc xử lý - không ghi đè`,
      );
    }

    const updated = await this.prisma.materialYieldRecipeIssue.findUniqueOrThrow({
      where: { id: issue.id },
      include: ISSUE_INCLUDE,
    });
    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.UPDATE,
      tableName: 'MaterialYieldRecipeIssue',
      recordId: issue.id,
      oldValue: { status: issue.status },
      newValue: { status: MaterialYieldIssueStatus.RECEIVED, receivedQty, issuedQty },
    });
    await this.resolveIssuedToPhoi(issue.id);
    return this.toResponseDto(updated);
  }

  /** Best-effort NGOÀI transaction (cùng lý do kỹ thuật như MaterialYieldIssuesService) - báo Phôi có nguyên liệu
   *  thành phẩm (thanh nhôm...) chờ nhận; trước đây nhánh này im lặng hoàn toàn (N-1 báo cáo 07/10). */
  private async notifyIssuedToPhoi(issue: IssueRow): Promise<void> {
    try {
      await this.notifications.emit('MATERIAL_YIELD_RECIPE_ISSUE_TO_PHOI', {
        entityId: issue.id.toString(),
        params: {
          piCode: issue.productionInvoice.code,
          materialCode: issue.recipe.inputMaterial.code,
          qty: issue.issuedQty.toNumber(),
          unit: issue.recipe.inputMaterial.unit,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create MATERIAL_YIELD_RECIPE_ISSUE_TO_PHOI notification (issue ${issue.id}): ${(error as Error).message}`,
      );
    }
  }

  private async resolveIssuedToPhoi(issueId: bigint): Promise<void> {
    try {
      await this.notifications.resolve({
        entityType: 'MATERIAL_YIELD_RECIPE_ISSUE',
        entityId: issueId.toString(),
        types: ['MATERIAL_YIELD_RECIPE_ISSUE_TO_PHOI'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to resolve MATERIAL_YIELD_RECIPE_ISSUE_TO_PHOI (issue ${issueId}): ${(error as Error).message}`,
      );
    }
  }

  /** Dùng bởi MaterialYieldRecipeProductionService để chặn "chưa nhận thì chưa báo được". */
  async sumReceived(productionInvoiceId: bigint, recipeId: bigint): Promise<number> {
    const result = await this.prisma.materialYieldRecipeIssue.aggregate({
      where: { productionInvoiceId, recipeId, status: MaterialYieldIssueStatus.RECEIVED },
      _sum: { receivedQty: true },
    });
    return result._sum.receivedQty?.toNumber() ?? 0;
  }

  async findAll(
    query: ListMaterialYieldRecipeIssuesQueryDto,
  ): Promise<Paginated<MaterialYieldRecipeIssueResponseDto>> {
    const where: Prisma.MaterialYieldRecipeIssueWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.materialYieldRecipeIssue.findMany({ ...args, include: ISSUE_INCLUDE }),
        count: (args) => this.prisma.materialYieldRecipeIssue.count(args),
      },
      query,
      where,
      { issuedAt: 'desc' as const },
    );
    return { data: result.data.map((r) => this.toResponseDto(r)), meta: result.meta };
  }

  async findAllForInvoice(
    productionInvoiceId: string,
  ): Promise<MaterialYieldRecipeIssueResponseDto[]> {
    const piId = parseBigIntId(productionInvoiceId);
    const rows = await this.prisma.materialYieldRecipeIssue.findMany({
      where: { productionInvoiceId: piId },
      include: ISSUE_INCLUDE,
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((r) => this.toResponseDto(r));
  }

  async findOne(id: string): Promise<MaterialYieldRecipeIssueResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

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

  private async findOneOrThrow(id: string): Promise<IssueRow> {
    const bigId = parseBigIntId(id);
    const issue = await this.prisma.materialYieldRecipeIssue.findUnique({
      where: { id: bigId },
      include: ISSUE_INCLUDE,
    });
    if (!issue) {
      throw new NotFoundException(`Material yield recipe issue ${id} not found`);
    }
    return issue;
  }

  private toResponseDto(issue: IssueRow): MaterialYieldRecipeIssueResponseDto {
    return new MaterialYieldRecipeIssueResponseDto({
      id: issue.id.toString(),
      productionInvoiceId: issue.productionInvoiceId.toString(),
      piCode: issue.productionInvoice.code,
      recipeId: issue.recipeId.toString(),
      inputMaterialId: issue.recipe.inputMaterialId.toString(),
      inputMaterialCode: issue.recipe.inputMaterial.code,
      inputMaterialName: issue.recipe.inputMaterial.name,
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
