import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SteelSubGroup } from '../../generated/prisma/client';
import { MATERIAL_GROUP_SYSTEM_KEYS } from '../../common/constants/material-group-system-keys.constant';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateMaterialYieldRecipeDto } from './dto/create-material-yield-recipe.dto';
import { MaterialYieldRecipeDemandItemResponseDto } from './dto/material-yield-recipe-demand-item-response.dto';
import { MaterialYieldRecipeResponseDto } from './dto/material-yield-recipe-response.dto';
import { UpdateMaterialYieldRecipeDto } from './dto/update-material-yield-recipe.dto';

const RECIPE_INCLUDE = {
  outputMaterial: { include: { warehouse: true } },
  inputMaterial: { include: { warehouse: true } },
} satisfies Prisma.MaterialYieldRecipeInclude;
type RecipeWithRefs = Prisma.MaterialYieldRecipeGetPayload<{ include: typeof RECIPE_INCLUDE }>;

/**
 * Định mức "vật tư thành phẩm không gắn piece" (2026-10-01, nhóm con VTTP của Sắt - xem doc comment
 * model MaterialYieldRecipe, schema.prisma). Khác PieceMaterialYield (luôn gắn 1 pieceId/bomRevisionId
 * cụ thể): recipe này dùng CHUNG cho mọi mảnh cần đan có khai dòng PieceMaterialItem trỏ tới
 * outputMaterialId - xem getProductionDemand() và WeavingIssuesService.getWovenMaterialLinesByPiece
 * nhánh FINISHED_COMPONENT.
 */
@Injectable()
export class MaterialYieldRecipesService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateMaterialYieldRecipeDto): Promise<MaterialYieldRecipeResponseDto> {
    const outputMaterialId = parseBigIntId(dto.outputMaterialId);
    const inputMaterialId = parseBigIntId(dto.inputMaterialId);
    if (outputMaterialId === inputMaterialId) {
      throw new BadRequestException('Vật tư ra và vật tư vào không được trùng nhau');
    }

    const outputMaterial = await this.assertFinishedComponentSteel(outputMaterialId);
    await this.findMaterialOrThrow(inputMaterialId);

    const existing = await this.prisma.materialYieldRecipe.findUnique({
      where: { outputMaterialId },
    });
    if (existing) {
      throw new ConflictException(
        `Vật tư "${outputMaterial.code}" đã có định mức sản xuất (MaterialYieldRecipe) - mỗi vật tư ra chỉ có đúng 1 recipe`,
      );
    }

    const recipe = await this.prisma.materialYieldRecipe.create({
      data: {
        outputMaterialId,
        inputMaterialId,
        piecesPerBar: dto.piecesPerBar,
        processSteps: dto.processSteps ?? [],
      },
      include: RECIPE_INCLUDE,
    });
    return this.toResponseDto(recipe);
  }

  async findAll(): Promise<MaterialYieldRecipeResponseDto[]> {
    const rows = await this.prisma.materialYieldRecipe.findMany({
      include: RECIPE_INCLUDE,
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => this.toResponseDto(r));
  }

  async findOne(id: string): Promise<MaterialYieldRecipeResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async update(
    id: string,
    dto: UpdateMaterialYieldRecipeDto,
  ): Promise<MaterialYieldRecipeResponseDto> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);

    const outputMaterialId =
      dto.outputMaterialId !== undefined ? parseBigIntId(dto.outputMaterialId) : undefined;
    const inputMaterialId =
      dto.inputMaterialId !== undefined ? parseBigIntId(dto.inputMaterialId) : undefined;
    if (outputMaterialId) await this.assertFinishedComponentSteel(outputMaterialId);
    if (inputMaterialId) await this.findMaterialOrThrow(inputMaterialId);

    const recipe = await this.prisma.materialYieldRecipe.update({
      where: { id: bigId },
      data: {
        outputMaterialId,
        inputMaterialId,
        piecesPerBar: dto.piecesPerBar,
        processSteps: dto.processSteps,
        isActive: dto.isActive,
      },
      include: RECIPE_INCLUDE,
    });
    return this.toResponseDto(recipe);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);
    await this.prisma.materialYieldRecipe.delete({ where: { id: bigId } });
  }

  /**
   * "Cần sản xuất/xuất bao nhiêu" cho MỌI recipe đang dùng trong 1 PI - gộp theo
   * (PI -> mọi order -> mọi BomPiece có PieceMaterialItem.materialId = outputMaterialId), KHÔNG qua
   * pieceId cụ thể (khác MaterialYieldIssuesService.resolveRequiredQty) - mirror cách
   * WeavingIssuesService tính nhu cầu Dây/Đinh (Σ qtyPerPiece × order.quantity qua mọi piece dùng
   * material này trong PI).
   */
  async getProductionDemand(
    productionInvoiceId: string,
  ): Promise<MaterialYieldRecipeDemandItemResponseDto[]> {
    const piId = parseBigIntId(productionInvoiceId);

    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: piId } },
      select: { id: true, bomRevisionId: true, quantity: true },
    });
    if (orders.length === 0) return [];

    const recipes = await this.prisma.materialYieldRecipe.findMany({
      where: { isActive: true },
      include: RECIPE_INCLUDE,
    });
    if (recipes.length === 0) return [];
    const outputMaterialIds = recipes.map((r) => r.outputMaterialId);

    const bomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const lines = await this.prisma.pieceMaterialItem.findMany({
      where: {
        bomRevisionId: { in: bomRevisionIds },
        materialId: { in: outputMaterialIds },
        includeInWeaving: true,
      },
    });
    if (lines.length === 0) return [];

    const bomPieces = await this.prisma.bomPiece.findMany({
      where: { bomRevisionId: { in: bomRevisionIds } },
    });
    const qtyPerUnitByRevisionPiece = new Map(
      bomPieces.map((bp) => [`${bp.bomRevisionId}:${bp.pieceId}`, bp.qtyPerUnit]),
    );
    const ordersByRevision = new Map<string, { quantity: number }[]>();
    for (const o of orders) {
      const key = o.bomRevisionId.toString();
      const arr = ordersByRevision.get(key) ?? [];
      arr.push({ quantity: o.quantity });
      ordersByRevision.set(key, arr);
    }

    const requiredByMaterial = new Map<string, number>();
    for (const line of lines) {
      const qtyPerUnit = qtyPerUnitByRevisionPiece.get(`${line.bomRevisionId}:${line.pieceId}`);
      if (qtyPerUnit == null) continue;
      const ordersForRevision = ordersByRevision.get(line.bomRevisionId.toString()) ?? [];
      const totalQtyPerUnit = qtyPerUnit * line.qtyPerPiece.toNumber();
      const required = ordersForRevision.reduce((s, o) => s + totalQtyPerUnit * o.quantity, 0);
      const key = line.materialId.toString();
      requiredByMaterial.set(key, (requiredByMaterial.get(key) ?? 0) + required);
    }
    if (requiredByMaterial.size === 0) return [];

    const stockRows = await this.prisma.stockQuant.findMany({
      where: { materialId: { in: outputMaterialIds } },
    });
    // Chỉ tính tồn thật ở kho gốc của vật tư ra (Material.warehouseId). Kho PRODUCTION là kho ảo: vật
    // tư ra đã sản xuất xong được ghi âm ở đó nên cộng dồn cả kho sẽ triệt tiêu tồn thật (vd 600 ở
    // Phôi Sơn Hàn + (−600) ở PRODUCTION = 0), làm đề xuất mua đòi thêm nguyên liệu không cần thiết.
    const onHandByMaterialWarehouse = new Map<string, number>();
    for (const s of stockRows) {
      if (s.materialId == null) continue;
      const key = `${s.materialId}:${s.warehouseId}`;
      onHandByMaterialWarehouse.set(
        key,
        (onHandByMaterialWarehouse.get(key) ?? 0) + s.qty.toNumber(),
      );
    }

    const result: MaterialYieldRecipeDemandItemResponseDto[] = [];
    for (const recipe of recipes) {
      const key = recipe.outputMaterialId.toString();
      const requiredOutputQty = requiredByMaterial.get(key);
      if (requiredOutputQty == null) continue;
      const ownWarehouseId = recipe.outputMaterial.warehouseId;
      const onHandOutputQty =
        (ownWarehouseId != null && onHandByMaterialWarehouse.get(`${key}:${ownWarehouseId}`)) || 0;
      const shortfallOutputQty = Math.max(0, requiredOutputQty - onHandOutputQty);
      result.push(
        new MaterialYieldRecipeDemandItemResponseDto({
          recipeId: recipe.id.toString(),
          outputMaterialId: recipe.outputMaterialId.toString(),
          outputMaterialCode: recipe.outputMaterial.code,
          outputMaterialName: recipe.outputMaterial.name,
          requiredOutputQty,
          onHandOutputQty,
          shortfallOutputQty,
          inputMaterialId: recipe.inputMaterialId.toString(),
          inputMaterialCode: recipe.inputMaterial.code,
          inputMaterialName: recipe.inputMaterial.name,
          requiredInputQty: Math.ceil(shortfallOutputQty / recipe.piecesPerBar),
        }),
      );
    }
    return result;
  }

  /** Dùng bởi MaterialYieldRecipeIssuesService/MaterialYieldRecipeProductionService - tránh query
   *  lặp lại cùng logic include. */
  async findOneRowOrThrow(id: string): Promise<RecipeWithRefs> {
    return this.findOneOrThrow(id);
  }

  private async findOneOrThrow(id: string): Promise<RecipeWithRefs> {
    const bigId = parseBigIntId(id);
    const recipe = await this.prisma.materialYieldRecipe.findUnique({
      where: { id: bigId },
      include: RECIPE_INCLUDE,
    });
    if (!recipe) {
      throw new NotFoundException(`Material yield recipe ${id} not found`);
    }
    return recipe;
  }

  private async findMaterialOrThrow(id: bigint) {
    const material = await this.prisma.material.findUnique({ where: { id } });
    if (!material) {
      throw new NotFoundException(`Material ${id} not found`);
    }
    return material;
  }

  /** outputMaterial PHẢI thuộc nhóm Sắt + nhóm con FINISHED_COMPONENT (VTTP) - mirror
   *  SegmentSpecsService.assertSteelGroup(), đảo điều kiện ngược lại (SegmentSpec chặn FINISHED_
   *  COMPONENT/SELF_CALC, ở đây chặn ngược lại SOFTWARE/SELF_CALC). */
  private async assertFinishedComponentSteel(materialId: bigint) {
    const material = await this.prisma.material.findUnique({
      where: { id: materialId },
      include: { materialGroup: true },
    });
    if (!material) {
      throw new NotFoundException(`Material ${materialId} not found`);
    }
    if (
      material.materialGroup?.systemKey !== MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR ||
      material.steelSubGroup !== SteelSubGroup.FINISHED_COMPONENT
    ) {
      throw new BadRequestException(
        `Material "${material.code}" phải thuộc nhóm Sắt, nhóm con Vật tư thành phẩm (FINISHED_COMPONENT) để gán làm vật tư ra của 1 recipe`,
      );
    }
    return material;
  }

  private toResponseDto(recipe: RecipeWithRefs): MaterialYieldRecipeResponseDto {
    return new MaterialYieldRecipeResponseDto({
      id: recipe.id.toString(),
      outputMaterialId: recipe.outputMaterialId.toString(),
      outputMaterialCode: recipe.outputMaterial.code,
      outputMaterialName: recipe.outputMaterial.name,
      inputMaterialId: recipe.inputMaterialId.toString(),
      inputMaterialCode: recipe.inputMaterial.code,
      inputMaterialName: recipe.inputMaterial.name,
      piecesPerBar: recipe.piecesPerBar,
      processSteps: recipe.processSteps,
      isActive: recipe.isActive,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
    });
  }
}
