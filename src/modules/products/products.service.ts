import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MfgProduct, Part, Piece, ProductVariant } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreatePartDto } from './dto/create-part.dto';
import { CreatePieceDto } from './dto/create-piece.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { PartResponseDto } from './dto/part-response.dto';
import { PieceResponseDto } from './dto/piece-response.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { ProductVariantResponseDto } from './dto/product-variant-response.dto';
import { UpdatePartDto } from './dto/update-part.dto';
import { UpdatePieceDto } from './dto/update-piece.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';

/**
 * `mfg_products` (factory-code catalog) + its 3 nested collections (ProductVariant/Piece/
 * Part - docs/dna-erp-db-schema.html mục 1.2, P2 step 4 of the roadmap). All 3 always
 * belong to exactly one product, so mfgProductId comes from the route param everywhere,
 * never the request body, and they share PERMISSION_MODULES.PRODUCT rather than getting
 * their own module (same reasoning as MaterialSupplier nested under Material).
 *
 * No isActive/deletedAt on mfg_products itself - remove() is a real DELETE, gated by an
 * explicit pre-check for active variants (409, per roadmap §2.1) rather than letting the
 * DB's ON DELETE RESTRICT surface a generic 400 - RESTRICT still catches Piece/Part/
 * BomRevision references as a backstop (left to the global Prisma exception filter).
 */
@Injectable()
export class ProductsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateProductDto): Promise<ProductResponseDto> {
    const existing = await this.prisma.mfgProduct.findUnique({
      where: { factoryCode: dto.factoryCode },
    });
    if (existing) {
      throw new ConflictException(`Product "${dto.factoryCode}" already exists`);
    }

    const product = await this.prisma.mfgProduct.create({
      data: { factoryCode: dto.factoryCode, name: dto.name, description: dto.description },
    });
    return this.toResponseDto(product);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<ProductResponseDto>> {
    const where = query.search
      ? {
          OR: [
            { factoryCode: { contains: query.search, mode: 'insensitive' as const } },
            { name: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) => this.prisma.mfgProduct.findMany(args),
        count: (args) => this.prisma.mfgProduct.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );

    return { data: result.data.map((p) => this.toResponseDto(p)), meta: result.meta };
  }

  async findOne(id: string): Promise<ProductResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductResponseDto> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);

    if (dto.factoryCode) {
      const existing = await this.prisma.mfgProduct.findUnique({
        where: { factoryCode: dto.factoryCode },
      });
      if (existing && existing.id !== bigId) {
        throw new ConflictException(`Product "${dto.factoryCode}" already exists`);
      }
    }

    const product = await this.prisma.mfgProduct.update({
      where: { id: bigId },
      data: { factoryCode: dto.factoryCode, name: dto.name, description: dto.description },
    });
    return this.toResponseDto(product);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);

    const activeVariantCount = await this.prisma.productVariant.count({
      where: { mfgProductId: bigId, isActive: true },
    });
    if (activeVariantCount > 0) {
      throw new ConflictException(
        `Product ${id} still has ${activeVariantCount} active variant(s) and cannot be deleted`,
      );
    }

    await this.prisma.mfgProduct.delete({ where: { id: bigId } });
  }

  // ─── ProductVariant sub-resource ───────────────────────────────────────────

  async createVariant(
    productId: string,
    dto: CreateProductVariantDto,
  ): Promise<ProductVariantResponseDto> {
    const productBigId = parseBigIntId(productId);
    await this.findOneOrThrow(productId);

    const variant = await this.prisma.productVariant.create({
      data: {
        mfgProductId: productBigId,
        customerId: dto.customerId ? parseBigIntId(dto.customerId) : undefined,
        colorCode: dto.colorCode,
        description: dto.description,
      },
    });
    return this.toVariantResponseDto(variant);
  }

  async listVariants(productId: string): Promise<ProductVariantResponseDto[]> {
    const productBigId = parseBigIntId(productId);
    await this.findOneOrThrow(productId);

    const variants = await this.prisma.productVariant.findMany({
      where: { mfgProductId: productBigId },
      orderBy: { id: 'asc' },
    });
    return variants.map((v) => this.toVariantResponseDto(v));
  }

  async updateVariant(
    productId: string,
    id: string,
    dto: UpdateProductVariantDto,
  ): Promise<ProductVariantResponseDto> {
    const idBigId = parseBigIntId(id);
    await this.findVariantOrThrow(productId, id);

    const variant = await this.prisma.productVariant.update({
      where: { id: idBigId },
      data: {
        customerId: dto.customerId ? parseBigIntId(dto.customerId) : undefined,
        colorCode: dto.colorCode,
        description: dto.description,
        isActive: dto.isActive,
      },
    });
    return this.toVariantResponseDto(variant);
  }

  async removeVariant(productId: string, id: string): Promise<void> {
    const idBigId = parseBigIntId(id);
    await this.findVariantOrThrow(productId, id);
    await this.prisma.productVariant.delete({ where: { id: idBigId } });
  }

  // ─── Piece sub-resource ────────────────────────────────────────────────────

  async createPiece(productId: string, dto: CreatePieceDto): Promise<PieceResponseDto> {
    const productBigId = parseBigIntId(productId);
    await this.findOneOrThrow(productId);
    await this.assertPieceCodeFree(productBigId, dto.code);

    const piece = await this.prisma.piece.create({
      data: {
        mfgProductId: productBigId,
        code: dto.code,
        groupNumber: dto.groupNumber,
        pieceNumber: dto.pieceNumber,
        name: dto.name,
        isWoven: dto.isWoven,
        weavingPrice: dto.weavingPrice,
      },
    });
    return this.toPieceResponseDto(piece);
  }

  async listPieces(productId: string): Promise<PieceResponseDto[]> {
    const productBigId = parseBigIntId(productId);
    await this.findOneOrThrow(productId);

    const pieces = await this.prisma.piece.findMany({
      where: { mfgProductId: productBigId },
      orderBy: [{ groupNumber: 'asc' }, { pieceNumber: 'asc' }],
    });
    return pieces.map((p) => this.toPieceResponseDto(p));
  }

  async updatePiece(productId: string, id: string, dto: UpdatePieceDto): Promise<PieceResponseDto> {
    const productBigId = parseBigIntId(productId);
    const idBigId = parseBigIntId(id);
    await this.findPieceOrThrow(productId, id);

    if (dto.code) {
      await this.assertPieceCodeFree(productBigId, dto.code, idBigId);
    }

    const piece = await this.prisma.piece.update({
      where: { id: idBigId },
      data: {
        code: dto.code,
        groupNumber: dto.groupNumber,
        pieceNumber: dto.pieceNumber,
        name: dto.name,
        isWoven: dto.isWoven,
        weavingPrice: dto.weavingPrice,
      },
    });
    return this.toPieceResponseDto(piece);
  }

  async removePiece(productId: string, id: string): Promise<void> {
    const idBigId = parseBigIntId(id);
    await this.findPieceOrThrow(productId, id);
    await this.prisma.piece.delete({ where: { id: idBigId } });
  }

  // ─── Part sub-resource ─────────────────────────────────────────────────────

  async createPart(productId: string, dto: CreatePartDto): Promise<PartResponseDto> {
    const productBigId = parseBigIntId(productId);
    await this.findOneOrThrow(productId);
    await this.assertPartCodeFree(productBigId, dto.code);

    const part = await this.prisma.part.create({
      data: { mfgProductId: productBigId, code: dto.code, name: dto.name },
    });
    return this.toPartResponseDto(part);
  }

  async listParts(productId: string): Promise<PartResponseDto[]> {
    const productBigId = parseBigIntId(productId);
    await this.findOneOrThrow(productId);

    const parts = await this.prisma.part.findMany({
      where: { mfgProductId: productBigId },
      orderBy: { id: 'asc' },
    });
    return parts.map((p) => this.toPartResponseDto(p));
  }

  async updatePart(productId: string, id: string, dto: UpdatePartDto): Promise<PartResponseDto> {
    const productBigId = parseBigIntId(productId);
    const idBigId = parseBigIntId(id);
    await this.findPartOrThrow(productId, id);

    if (dto.code) {
      await this.assertPartCodeFree(productBigId, dto.code, idBigId);
    }

    const part = await this.prisma.part.update({
      where: { id: idBigId },
      data: { code: dto.code, name: dto.name },
    });
    return this.toPartResponseDto(part);
  }

  async removePart(productId: string, id: string): Promise<void> {
    const idBigId = parseBigIntId(id);
    await this.findPartOrThrow(productId, id);
    await this.prisma.part.delete({ where: { id: idBigId } });
  }

  // ─── Shared lookups ─────────────────────────────────────────────────────────

  private async findOneOrThrow(id: string): Promise<MfgProduct> {
    const bigId = parseBigIntId(id);
    const product = await this.prisma.mfgProduct.findUnique({ where: { id: bigId } });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  private async findVariantOrThrow(productId: string, id: string): Promise<ProductVariant> {
    const productBigId = parseBigIntId(productId);
    const idBigId = parseBigIntId(id);
    const variant = await this.prisma.productVariant.findUnique({ where: { id: idBigId } });
    if (!variant || variant.mfgProductId !== productBigId) {
      throw new NotFoundException(`Variant ${id} not found on product ${productId}`);
    }
    return variant;
  }

  private async findPieceOrThrow(productId: string, id: string): Promise<Piece> {
    const productBigId = parseBigIntId(productId);
    const idBigId = parseBigIntId(id);
    const piece = await this.prisma.piece.findUnique({ where: { id: idBigId } });
    if (!piece || piece.mfgProductId !== productBigId) {
      throw new NotFoundException(`Piece ${id} not found on product ${productId}`);
    }
    return piece;
  }

  private async findPartOrThrow(productId: string, id: string): Promise<Part> {
    const productBigId = parseBigIntId(productId);
    const idBigId = parseBigIntId(id);
    const part = await this.prisma.part.findUnique({ where: { id: idBigId } });
    if (!part || part.mfgProductId !== productBigId) {
      throw new NotFoundException(`Part ${id} not found on product ${productId}`);
    }
    return part;
  }

  private async assertPieceCodeFree(
    mfgProductId: bigint,
    code: string,
    excludeId?: bigint,
  ): Promise<void> {
    const existing = await this.prisma.piece.findUnique({
      where: { mfgProductId_code: { mfgProductId, code } },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Piece "${code}" already exists on this product`);
    }
  }

  private async assertPartCodeFree(
    mfgProductId: bigint,
    code: string,
    excludeId?: bigint,
  ): Promise<void> {
    const existing = await this.prisma.part.findUnique({
      where: { mfgProductId_code: { mfgProductId, code } },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Part "${code}" already exists on this product`);
    }
  }

  private toResponseDto(product: MfgProduct): ProductResponseDto {
    return new ProductResponseDto({
      id: product.id.toString(),
      factoryCode: product.factoryCode,
      name: product.name,
      description: product.description,
    });
  }

  private toVariantResponseDto(variant: ProductVariant): ProductVariantResponseDto {
    return new ProductVariantResponseDto({
      id: variant.id.toString(),
      mfgProductId: variant.mfgProductId.toString(),
      customerId: variant.customerId?.toString() ?? null,
      colorCode: variant.colorCode,
      description: variant.description,
      isActive: variant.isActive,
    });
  }

  private toPieceResponseDto(piece: Piece): PieceResponseDto {
    return new PieceResponseDto({
      id: piece.id.toString(),
      mfgProductId: piece.mfgProductId.toString(),
      code: piece.code,
      groupNumber: piece.groupNumber,
      pieceNumber: piece.pieceNumber,
      name: piece.name,
      isWoven: piece.isWoven,
      weavingPrice: piece.weavingPrice?.toNumber() ?? null,
    });
  }

  private toPartResponseDto(part: Part): PartResponseDto {
    return new PartResponseDto({
      id: part.id.toString(),
      mfgProductId: part.mfgProductId.toString(),
      code: part.code,
      name: part.name,
    });
  }
}
