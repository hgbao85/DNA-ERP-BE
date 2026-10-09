import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  MaterialYieldStepBatch,
  Prisma,
  StockLedgerRefType,
} from '../../generated/prisma/client';
import { ClsService } from 'nestjs-cls';
import { auditEvent } from '../../common/utils/audit-event.util';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { sortProcessSteps } from '../../common/constants/process-steps.constant';
import {
  assertPiHasActiveFloor,
  assertPiHasActiveFloorLocked,
} from '../../common/utils/floor-gate.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { CreateMaterialYieldStepBatchDto } from './dto/create-material-yield-step-batch.dto';
import { ListMaterialYieldStepBundlesQueryDto } from './dto/list-material-yield-step-bundles-query.dto';
import { MaterialYieldStepBatchResponseDto } from './dto/material-yield-step-batch-response.dto';
import { MaterialYieldStepBundleResponseDto } from './dto/material-yield-step-bundle-response.dto';
import { SubmitMaterialYieldStepDto } from './dto/submit-material-yield-step.dto';
import { MaterialYieldRecipeIssuesService } from './material-yield-recipe-issues.service';
import { MaterialYieldRecipesService } from './material-yield-recipes.service';

const BUNDLE_INCLUDE = {
  productionInvoice: { select: { code: true } },
  recipe: { include: { outputMaterial: true } },
} satisfies Prisma.MaterialYieldStepBundleInclude;
export type MaterialYieldStepBundleRow = Prisma.MaterialYieldStepBundleGetPayload<{
  include: typeof BUNDLE_INCLUDE;
}>;

const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';

/**
 * Báo tiến độ công đoạn + nhập kho thật cho vật tư KHÔNG gắn piece (2026-10-01, vd chân nhôm) -
 * mirror ProductionBatchesService.recordPieceStepBatch()/submitPieceStep()/
 * autoFinalizePieceOutputIfLastStepComplete(), khoá theo recipeId thay vì pieceId.
 *
 * KHÁC piece: không có khái niệm ProductionBatch.reportedQty (bảng đó luôn gắn pieceId) - khi công
 * đoạn CUỐI của recipe được KCS duyệt (QC_PASSED), credit THẲNG StockLedger/StockQuant cho
 * outputMaterial (kho của chính outputMaterial, vd vat-tu-tp) thay vì tạo ProductionBatch. Credit
 * theo TỪNG bundle riêng (không cộng dồn kiểu delta như bên piece) vì đây là đường DUY NHẤT sinh ra
 * output - không có path tạo thủ công nào khác cần khớp lại, nên không cần logic "đã chốt bao
 * nhiêu rồi" phức tạp.
 */
@Injectable()
export class MaterialYieldRecipeProductionService {
  private readonly logger = new Logger(MaterialYieldRecipeProductionService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
    private readonly materialYieldRecipesService: MaterialYieldRecipesService,
    private readonly materialYieldRecipeIssuesService: MaterialYieldRecipeIssuesService,
    private readonly notifications: NotificationsService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async recordStepBatch(
    productionInvoiceId: string,
    dto: CreateMaterialYieldStepBatchDto,
    reportedById: string,
    callerMfgRole: string | null,
    idempotencyKey?: string,
  ): Promise<MaterialYieldStepBatchResponseDto> {
    this.assertMfgRoleIsPhoi(callerMfgRole);

    if (idempotencyKey) {
      const existing = await this.prisma.materialYieldStepBatch.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return this.toBatchResponseDto(existing);
    }

    const piId = parseBigIntId(productionInvoiceId);
    await assertPiHasActiveFloor(this.prisma, piId, 'báo công đoạn');
    const recipe = await this.materialYieldRecipesService.findOneRowOrThrow(dto.recipeId);
    const recipeBigId = parseBigIntId(dto.recipeId);

    const received = await this.materialYieldRecipeIssuesService.sumReceived(piId, recipeBigId);
    if (received <= 0) {
      throw new BadRequestException(
        `Vật tư ${recipe.outputMaterial.name} chưa được xác nhận nhận nguyên liệu vào từ kho - xác nhận nhận trước khi báo công đoạn`,
      );
    }
    const orderedSteps = sortProcessSteps(recipe.processSteps);
    if (orderedSteps.length === 0) {
      throw new BadRequestException(`Recipe ${dto.recipeId} chưa khai công đoạn nào theo định mức`);
    }
    if (!orderedSteps.includes(dto.step)) {
      throw new BadRequestException(`Recipe ${dto.recipeId} không có công đoạn '${dto.step}'`);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `material-yield-step-batch:${piId}:${recipeBigId}:${dto.step}`);
      await assertPiHasActiveFloorLocked(tx, piId, 'báo công đoạn');

      return tx.materialYieldStepBatch.create({
        data: {
          productionInvoiceId: piId,
          recipeId: recipeBigId,
          step: dto.step,
          qty: dto.qty,
          reportedById,
          idempotencyKey,
        },
      });
    });

    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.CREATE,
      tableName: 'MaterialYieldStepBatch',
      recordId: created.id,
      newValue: {
        productionInvoiceId: piId.toString(),
        recipeId: recipeBigId.toString(),
        step: dto.step,
        qty: dto.qty,
      },
    });
    return this.toBatchResponseDto(created);
  }

  async submitStep(
    productionInvoiceId: string,
    dto: SubmitMaterialYieldStepDto,
    submittedById: string,
    callerMfgRole: string | null,
  ): Promise<MaterialYieldStepBundleResponseDto> {
    this.assertMfgRoleIsPhoi(callerMfgRole);
    const piId = parseBigIntId(productionInvoiceId);
    await assertPiHasActiveFloor(this.prisma, piId, 'gửi KCS công đoạn');
    const recipeBigId = parseBigIntId(dto.recipeId);

    const created = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `material-yield-step-bundle:${piId}:${recipeBigId}:${dto.step}`);
      await assertPiHasActiveFloorLocked(tx, piId, 'gửi KCS công đoạn');

      const pending = await tx.materialYieldStepBatch.findMany({
        where: {
          productionInvoiceId: piId,
          recipeId: recipeBigId,
          step: dto.step,
          materialYieldStepBundleId: null,
        },
      });
      const qty = pending.reduce((s, b) => s + b.qty, 0);
      if (qty <= 0) {
        throw new BadRequestException(
          `Recipe ${dto.recipeId} chưa có gì mới để gửi KCS ở công đoạn '${dto.step}'`,
        );
      }

      const bundle = await tx.materialYieldStepBundle.create({
        data: {
          productionInvoiceId: piId,
          recipeId: recipeBigId,
          step: dto.step,
          qty,
          submittedById,
        },
        include: BUNDLE_INCLUDE,
      });
      await tx.materialYieldStepBatch.updateMany({
        where: { id: { in: pending.map((b) => b.id) } },
        data: { materialYieldStepBundleId: bundle.id },
      });
      return bundle;
    });

    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.CREATE,
      tableName: 'MaterialYieldStepBundle',
      recordId: created.id,
      newValue: {
        productionInvoiceId: piId.toString(),
        recipeId: recipeBigId.toString(),
        step: dto.step,
        qty: created.qty,
        event: 'submit-to-kcs',
      },
    });
    await this.notifyBundleToKcs(created);
    return this.toBundleResponseDto(created);
  }

  /** Best-effort NGOÀI transaction - báo KCS có bundle vật tư thành phẩm không gắn mảnh chờ chấm (N-1). Tự đóng ở
   *  QcReviewsService.reviewMaterialYieldStep(). */
  private async notifyBundleToKcs(bundle: MaterialYieldStepBundleRow): Promise<void> {
    try {
      await this.notifications.emit('MATERIAL_YIELD_STEP_BUNDLE_TO_KCS', {
        entityId: bundle.id.toString(),
        params: { piCode: bundle.productionInvoice.code },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create MATERIAL_YIELD_STEP_BUNDLE_TO_KCS notification (bundle ${bundle.id}): ${(error as Error).message}`,
      );
    }
  }

  /** Phôi xem lại bundle theo PI (lịch sử + đang chờ KCS) - mirror
   *  ProductionBatchesService.findPieceStepBundlesForOrder(), dùng cho StepPanel bên FE. */
  async findBundlesForInvoice(
    productionInvoiceId: string,
  ): Promise<MaterialYieldStepBundleResponseDto[]> {
    const piId = parseBigIntId(productionInvoiceId);
    const rows = await this.prisma.materialYieldStepBundle.findMany({
      where: { productionInvoiceId: piId },
      include: BUNDLE_INCLUDE,
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map((r) => this.toBundleResponseDto(r));
  }

  /** Flat, không cần productionInvoiceId - mirror
   *  ProductionBatchesService.findAllPieceStepBundles(), dùng cho màn KCS. */
  async findAllBundles(
    query: ListMaterialYieldStepBundlesQueryDto,
  ): Promise<Paginated<MaterialYieldStepBundleResponseDto>> {
    const where = query.status ? { status: query.status } : {};
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.materialYieldStepBundle.findMany({ ...args, include: BUNDLE_INCLUDE }),
        count: (args) => this.prisma.materialYieldStepBundle.count(args),
      },
      query,
      where,
      { submittedAt: 'desc' as const },
    );
    return { data: result.data.map((r) => this.toBundleResponseDto(r)), meta: result.meta };
  }

  /** Dùng bởi QcReviewsService.reviewMaterialYieldStep(). */
  async findOneBundleRowOrThrow(id: string): Promise<MaterialYieldStepBundleRow> {
    const bigId = parseBigIntId(id);
    const bundle = await this.prisma.materialYieldStepBundle.findUnique({
      where: { id: bigId },
      include: BUNDLE_INCLUDE,
    });
    if (!bundle) {
      throw new NotFoundException(`Đợt gửi KCS ${id} not found`);
    }
    return bundle;
  }

  /**
   * NẾU step vừa duyệt là công đoạn CUỐI theo processSteps của recipe, credit StockLedger/StockQuant
   * cho outputMaterial (kho của chính outputMaterial) - xem doc comment class. Gọi NGAY TRONG
   * transaction duyệt KCS (QcReviewsService.reviewMaterialYieldStep()), SAU khi bundle chuyển
   * QC_PASSED.
   */
  async finalizeRecipeOutputIfLastStepComplete(
    tx: PrismaTx,
    bundle: MaterialYieldStepBundleRow,
    failedQty: number,
    createdById: string,
  ): Promise<void> {
    const orderedSteps = sortProcessSteps(bundle.recipe.processSteps);
    if (orderedSteps.length === 0 || orderedSteps[orderedSteps.length - 1] !== bundle.step) {
      return;
    }
    const passedQty = Math.max(bundle.qty - failedQty, 0);
    if (passedQty <= 0) return;

    const outputMaterial = bundle.recipe.outputMaterial;
    if (!outputMaterial.warehouseId) {
      throw new BadRequestException(
        `Vật tư ${outputMaterial.name} chưa được gán kho (Material.warehouseId) - báo Admin cấu hình trước khi duyệt KCS công đoạn cuối`,
      );
    }
    const productionWarehouse = await tx.warehouse.findUniqueOrThrow({
      where: { code: PRODUCTION_WAREHOUSE_CODE },
    });
    await this.stockLedgerService.postEntry(
      {
        fromWarehouseId: productionWarehouse.id,
        toWarehouseId: outputMaterial.warehouseId,
        materialId: outputMaterial.id,
        qty: passedQty,
        refType: StockLedgerRefType.MATERIAL_YIELD_RECIPE_OUTPUT,
        refId: bundle.id.toString(),
        createdById,
        idempotencyKey: `material-yield-recipe-output:${bundle.id}`,
      },
      tx,
    );
  }

  private assertMfgRoleIsPhoi(mfgRole: string | null): void {
    if (!mfgRole) return;
    if (mfgRole !== 'PHOI') {
      throw new ForbiddenException(`Caller có mfgRole '${mfgRole}', không được báo công đoạn Phôi`);
    }
  }

  private toBatchResponseDto(batch: MaterialYieldStepBatch): MaterialYieldStepBatchResponseDto {
    return new MaterialYieldStepBatchResponseDto({
      id: batch.id.toString(),
      productionInvoiceId: batch.productionInvoiceId.toString(),
      recipeId: batch.recipeId.toString(),
      step: batch.step,
      qty: batch.qty,
      reportedAt: batch.reportedAt,
      reportedById: batch.reportedById,
    });
  }

  private toBundleResponseDto(
    bundle: MaterialYieldStepBundleRow,
  ): MaterialYieldStepBundleResponseDto {
    return new MaterialYieldStepBundleResponseDto({
      id: bundle.id.toString(),
      productionInvoiceId: bundle.productionInvoiceId.toString(),
      piCode: bundle.productionInvoice.code,
      recipeId: bundle.recipeId.toString(),
      outputMaterialCode: bundle.recipe.outputMaterial.code,
      outputMaterialName: bundle.recipe.outputMaterial.name,
      step: bundle.step,
      qty: bundle.qty,
      status: bundle.status,
      submittedAt: bundle.submittedAt,
      submittedById: bundle.submittedById,
    });
  }
}
