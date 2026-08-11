import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessoryItemKind,
  BomRevision,
  BomRevisionStatus,
  MaterialDetailKind,
  Prisma,
} from '../../generated/prisma/client';
import {
  MATERIAL_GROUP_SYSTEM_KEYS,
  MaterialGroupSystemKey,
} from '../../common/constants/material-group-system-keys.constant';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { BomAccessoryItemResponseDto } from './dto/bom-accessory-item-response.dto';
import { BomPartResponseDto } from './dto/bom-part-response.dto';
import { BomPieceResponseDto } from './dto/bom-piece-response.dto';
import { BomRevisionResponseDto } from './dto/bom-revision-response.dto';
import { ConsumableBomResponseDto } from './dto/consumable-bom-response.dto';
import { CreateBomAccessoryItemDto } from './dto/create-bom-accessory-item.dto';
import { CreateBomPartDto } from './dto/create-bom-part.dto';
import { CreateBomPieceDto } from './dto/create-bom-piece.dto';
import { CreateConsumableBomDto } from './dto/create-consumable-bom.dto';
import { CreatePartBomDto } from './dto/create-part-bom.dto';
import { CreatePieceBomDto } from './dto/create-piece-bom.dto';
import { PartBomResponseDto } from './dto/part-bom-response.dto';
import { PieceBomResponseDto } from './dto/piece-bom-response.dto';
import { UpdateBomAccessoryItemDto } from './dto/update-bom-accessory-item.dto';
import { UpdateBomPartDto } from './dto/update-bom-part.dto';
import { UpdateBomPieceDto } from './dto/update-bom-piece.dto';
import { UpdateConsumableBomDto } from './dto/update-consumable-bom.dto';
import { UpdatePartBomDto } from './dto/update-part-bom.dto';
import { UpdatePieceBomDto } from './dto/update-piece-bom.dto';

type BomPieceWithPiece = Prisma.BomPieceGetPayload<{ include: { piece: true } }>;
type BomPartWithPart = Prisma.BomPartGetPayload<{ include: { part: true } }>;
type PieceBomWithRefs = Prisma.PieceBomGetPayload<{
  include: { piece: true; segmentSpec: { include: { material: true } } };
}>;
type PartBomWithRefs = Prisma.PartBomGetPayload<{
  include: { part: true; segmentSpec: { include: { material: true } } };
}>;
type ConsumableBomWithMaterial = Prisma.ConsumableBomGetPayload<{ include: { material: true } }>;
type BomAccessoryItemWithMaterial = Prisma.BomAccessoryItemGetPayload<{
  include: { material: true };
}>;

/** PrismaServiceType (client mở rộng qua $extends) có shape tx callback khác Prisma.TransactionClient
 *  gốc - suy ra đúng type từ chính $transaction của nó, đúng idiom SkusService dùng khi gọi
 *  activateInTransaction() chung 1 transaction với PlanForm.update() (xem SkusService.approve()). */
type PrismaTx = Parameters<Parameters<PrismaServiceType['$transaction']>[0]>[0];

/**
 * BomRevision + its 5 line-item collections (bom_piece/bom_part/piece_bom/part_bom/
 * consumable_bom) - docs/dna-erp-db-schema.html mục 1.2, the last and most complex piece
 * of Phase 2. Core rule enforced everywhere below: a revision's line items are only
 * mutable while status=DRAFT (assertDraft) - ACTIVE/RETIRED are permanent history that
 * production_order (P7) pins a bomRevisionId to.
 *
 * bom_piece/bom_part have no mfgProductId column at all, and piece_bom/part_bom's
 * composite FK to bom_revision(id, mfgProductId) only proves the *row* points at a real
 * revision - neither guarantees the referenced piece/part actually belongs to that
 * revision's product. That cross-check is done here (assertSameProduct) before every
 * insert, exactly the "ràng buộc chéo cha" the schema doc calls out for piece_bom.
 */
@Injectable()
export class BomRevisionsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  // ─── BomRevision ────────────────────────────────────────────────────────────

  async create(productId: string, sourcePlanFormId?: string): Promise<BomRevisionResponseDto> {
    const productBigId = parseBigIntId(productId);
    const product = await this.prisma.mfgProduct.findUnique({ where: { id: productBigId } });
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }

    const last = await this.prisma.bomRevision.findFirst({
      where: { mfgProductId: productBigId },
      orderBy: { revNo: 'desc' },
    });

    const revision = await this.prisma.bomRevision.create({
      data: {
        mfgProductId: productBigId,
        revNo: (last?.revNo ?? 0) + 1,
        sourcePlanFormId: sourcePlanFormId ? parseBigIntId(sourcePlanFormId) : undefined,
      },
    });
    return this.toResponseDto(revision);
  }

  async findAllForProduct(productId: string): Promise<BomRevisionResponseDto[]> {
    const productBigId = parseBigIntId(productId);
    const revisions = await this.prisma.bomRevision.findMany({
      where: { mfgProductId: productBigId },
      orderBy: { revNo: 'desc' },
    });
    return revisions.map((r) => this.toResponseDto(r));
  }

  async findOne(id: string): Promise<BomRevisionResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  /**
   * Retire whatever is currently ACTIVE for this product, then activate this one, in a
   * single transaction. The actual concurrency guard is the partial unique index
   * `bom_revision_one_active_per_product` (see prisma/migrations/20260730000000_.../
   * migration.sql) - if two activate() calls for the same product race, the DB rejects
   * whichever commits second with a unique-violation (surfaced as 409 by the global
   * Prisma exception filter), not a lock held here.
   */
  async activate(id: string): Promise<BomRevisionResponseDto> {
    const activated = await this.prisma.$transaction((tx) => this.activateInTransaction(tx, id));
    return this.toResponseDto(activated);
  }

  /**
   * Lõi của activate() tách riêng theo `tx` truyền vào, để SkusService.approve() chạy được
   * chung 1 transaction với việc cập nhật PlanForm.status - boss-approve phải atomic toàn phần
   * (activate BomRevision + PlanForm -> APPROVED cùng thành công hoặc cùng rollback), không
   * phải 2 write rời nhau như trước (crash giữa chừng để lại BomRevision đã ACTIVE nhưng
   * PlanForm vẫn kẹt ở WAITING_BOSS_APPROVAL).
   */
  async activateInTransaction(tx: PrismaTx, id: string): Promise<BomRevision> {
    const bigId = parseBigIntId(id);
    const revision = await tx.bomRevision.findUnique({ where: { id: bigId } });
    if (!revision) {
      throw new NotFoundException(`Bom revision ${id} not found`);
    }
    if (revision.status !== BomRevisionStatus.DRAFT) {
      throw new ConflictException(
        `Only a DRAFT revision can be activated (bom_revision ${id} is ${revision.status})`,
      );
    }

    await tx.bomRevision.updateMany({
      where: { mfgProductId: revision.mfgProductId, status: BomRevisionStatus.ACTIVE },
      data: { status: BomRevisionStatus.RETIRED },
    });
    return tx.bomRevision.update({
      where: { id: revision.id },
      data: { status: BomRevisionStatus.ACTIVE },
    });
  }

  /** Only a DRAFT revision can be deleted - ACTIVE/RETIRED are permanent history. */
  async remove(id: string): Promise<void> {
    const revision = await this.findOneOrThrow(id);
    if (revision.status !== BomRevisionStatus.DRAFT) {
      throw new ConflictException(
        `Only a DRAFT revision can be deleted (bom_revision ${id} is ${revision.status})`,
      );
    }
    await this.prisma.bomRevision.delete({ where: { id: revision.id } });
  }

  // ─── BomPiece (SL mảnh/SKU) ─────────────────────────────────────────────────

  async createBomPiece(
    bomRevisionId: string,
    dto: CreateBomPieceDto,
  ): Promise<BomPieceResponseDto> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);

    const pieceBigId = parseBigIntId(dto.pieceId);
    const piece = await this.prisma.piece.findUnique({ where: { id: pieceBigId } });
    if (!piece) {
      throw new NotFoundException(`Piece ${dto.pieceId} not found`);
    }
    this.assertSameProduct(piece.mfgProductId, revision.mfgProductId, 'Piece', dto.pieceId);

    const existing = await this.prisma.bomPiece.findUnique({
      where: { bomRevisionId_pieceId: { bomRevisionId: revision.id, pieceId: pieceBigId } },
    });
    if (existing) {
      throw new ConflictException(
        `Piece ${dto.pieceId} already has a bom_piece row on this revision`,
      );
    }

    const row = await this.prisma.bomPiece.create({
      data: { bomRevisionId: revision.id, pieceId: pieceBigId, qtyPerUnit: dto.qtyPerUnit },
      include: { piece: true },
    });
    return this.toBomPieceResponseDto(row);
  }

  async listBomPieces(bomRevisionId: string): Promise<BomPieceResponseDto[]> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    const rows = await this.prisma.bomPiece.findMany({
      where: { bomRevisionId: revision.id },
      include: { piece: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => this.toBomPieceResponseDto(r));
  }

  async updateBomPiece(
    bomRevisionId: string,
    id: string,
    dto: UpdateBomPieceDto,
  ): Promise<BomPieceResponseDto> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);
    const row = await this.findBomPieceOrThrow(revision.id, id);

    const updated = await this.prisma.bomPiece.update({
      where: { id: row.id },
      data: { qtyPerUnit: dto.qtyPerUnit },
      include: { piece: true },
    });
    return this.toBomPieceResponseDto(updated);
  }

  async removeBomPiece(bomRevisionId: string, id: string): Promise<void> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);
    const row = await this.findBomPieceOrThrow(revision.id, id);
    await this.prisma.bomPiece.delete({ where: { id: row.id } });
  }

  // ─── BomPart (SL chi tiết/SKU) ──────────────────────────────────────────────

  async createBomPart(bomRevisionId: string, dto: CreateBomPartDto): Promise<BomPartResponseDto> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);

    const partBigId = parseBigIntId(dto.partId);
    const part = await this.prisma.part.findUnique({ where: { id: partBigId } });
    if (!part) {
      throw new NotFoundException(`Part ${dto.partId} not found`);
    }
    this.assertSameProduct(part.mfgProductId, revision.mfgProductId, 'Part', dto.partId);

    const existing = await this.prisma.bomPart.findUnique({
      where: { bomRevisionId_partId: { bomRevisionId: revision.id, partId: partBigId } },
    });
    if (existing) {
      throw new ConflictException(`Part ${dto.partId} already has a bom_part row on this revision`);
    }

    const row = await this.prisma.bomPart.create({
      data: { bomRevisionId: revision.id, partId: partBigId, qtyPerUnit: dto.qtyPerUnit },
      include: { part: true },
    });
    return this.toBomPartResponseDto(row);
  }

  async listBomParts(bomRevisionId: string): Promise<BomPartResponseDto[]> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    const rows = await this.prisma.bomPart.findMany({
      where: { bomRevisionId: revision.id },
      include: { part: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => this.toBomPartResponseDto(r));
  }

  async updateBomPart(
    bomRevisionId: string,
    id: string,
    dto: UpdateBomPartDto,
  ): Promise<BomPartResponseDto> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);
    const row = await this.findBomPartOrThrow(revision.id, id);

    const updated = await this.prisma.bomPart.update({
      where: { id: row.id },
      data: { qtyPerUnit: dto.qtyPerUnit },
      include: { part: true },
    });
    return this.toBomPartResponseDto(updated);
  }

  async removeBomPart(bomRevisionId: string, id: string): Promise<void> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);
    const row = await this.findBomPartOrThrow(revision.id, id);
    await this.prisma.bomPart.delete({ where: { id: row.id } });
  }

  // ─── PieceBom (đoạn cấu thành 1 mảnh) ───────────────────────────────────────

  async createPieceBom(
    bomRevisionId: string,
    dto: CreatePieceBomDto,
  ): Promise<PieceBomResponseDto> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);

    const pieceBigId = parseBigIntId(dto.pieceId);
    const piece = await this.prisma.piece.findUnique({ where: { id: pieceBigId } });
    if (!piece) {
      throw new NotFoundException(`Piece ${dto.pieceId} not found`);
    }
    this.assertSameProduct(piece.mfgProductId, revision.mfgProductId, 'Piece', dto.pieceId);

    const segmentSpecBigId = parseBigIntId(dto.segmentSpecId);
    const segmentSpec = await this.prisma.segmentSpec.findUnique({
      where: { id: segmentSpecBigId },
    });
    if (!segmentSpec) {
      throw new NotFoundException(`Segment spec ${dto.segmentSpecId} not found`);
    }

    const existing = await this.prisma.pieceBom.findUnique({
      where: {
        bomRevisionId_pieceId_segmentSpecId: {
          bomRevisionId: revision.id,
          pieceId: pieceBigId,
          segmentSpecId: segmentSpecBigId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `piece_bom row for piece ${dto.pieceId} + segment spec ${dto.segmentSpecId} already exists on this revision`,
      );
    }

    // mfgProductId is always derived from the revision, never taken from the client - it
    // only exists on this row to satisfy the composite FK back to bom_revision(id, mfgProductId).
    const row = await this.prisma.pieceBom.create({
      data: {
        bomRevisionId: revision.id,
        mfgProductId: revision.mfgProductId,
        pieceId: pieceBigId,
        segmentSpecId: segmentSpecBigId,
        qtyPerPiece: dto.qtyPerPiece,
        needsHan: dto.needsHan,
        needsSon: dto.needsSon,
        note: dto.note,
      },
      include: { piece: true, segmentSpec: { include: { material: true } } },
    });
    return this.toPieceBomResponseDto(row);
  }

  async listPieceBoms(bomRevisionId: string): Promise<PieceBomResponseDto[]> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    const rows = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId: revision.id },
      include: { piece: true, segmentSpec: { include: { material: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => this.toPieceBomResponseDto(r));
  }

  async updatePieceBom(
    bomRevisionId: string,
    id: string,
    dto: UpdatePieceBomDto,
  ): Promise<PieceBomResponseDto> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);
    const row = await this.findPieceBomOrThrow(revision.id, id);

    const updated = await this.prisma.pieceBom.update({
      where: { id: row.id },
      data: {
        qtyPerPiece: dto.qtyPerPiece,
        needsHan: dto.needsHan,
        needsSon: dto.needsSon,
        note: dto.note,
      },
      include: { piece: true, segmentSpec: { include: { material: true } } },
    });
    return this.toPieceBomResponseDto(updated);
  }

  async removePieceBom(bomRevisionId: string, id: string): Promise<void> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);
    const row = await this.findPieceBomOrThrow(revision.id, id);
    await this.prisma.pieceBom.delete({ where: { id: row.id } });
  }

  // ─── PartBom (đoạn cấu thành 1 chi tiết hàn) ────────────────────────────────

  async createPartBom(bomRevisionId: string, dto: CreatePartBomDto): Promise<PartBomResponseDto> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);

    const partBigId = parseBigIntId(dto.partId);
    const part = await this.prisma.part.findUnique({ where: { id: partBigId } });
    if (!part) {
      throw new NotFoundException(`Part ${dto.partId} not found`);
    }
    this.assertSameProduct(part.mfgProductId, revision.mfgProductId, 'Part', dto.partId);

    const segmentSpecBigId = parseBigIntId(dto.segmentSpecId);
    const segmentSpec = await this.prisma.segmentSpec.findUnique({
      where: { id: segmentSpecBigId },
    });
    if (!segmentSpec) {
      throw new NotFoundException(`Segment spec ${dto.segmentSpecId} not found`);
    }

    const existing = await this.prisma.partBom.findUnique({
      where: {
        bomRevisionId_partId_segmentSpecId: {
          bomRevisionId: revision.id,
          partId: partBigId,
          segmentSpecId: segmentSpecBigId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `part_bom row for part ${dto.partId} + segment spec ${dto.segmentSpecId} already exists on this revision`,
      );
    }

    const row = await this.prisma.partBom.create({
      data: {
        bomRevisionId: revision.id,
        mfgProductId: revision.mfgProductId,
        partId: partBigId,
        segmentSpecId: segmentSpecBigId,
        qtyPerPart: dto.qtyPerPart,
      },
      include: { part: true, segmentSpec: { include: { material: true } } },
    });
    return this.toPartBomResponseDto(row);
  }

  async listPartBoms(bomRevisionId: string): Promise<PartBomResponseDto[]> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    const rows = await this.prisma.partBom.findMany({
      where: { bomRevisionId: revision.id },
      include: { part: true, segmentSpec: { include: { material: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => this.toPartBomResponseDto(r));
  }

  async updatePartBom(
    bomRevisionId: string,
    id: string,
    dto: UpdatePartBomDto,
  ): Promise<PartBomResponseDto> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);
    const row = await this.findPartBomOrThrow(revision.id, id);

    const updated = await this.prisma.partBom.update({
      where: { id: row.id },
      data: { qtyPerPart: dto.qtyPerPart },
      include: { part: true, segmentSpec: { include: { material: true } } },
    });
    return this.toPartBomResponseDto(updated);
  }

  async removePartBom(bomRevisionId: string, id: string): Promise<void> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);
    const row = await this.findPartBomOrThrow(revision.id, id);
    await this.prisma.partBom.delete({ where: { id: row.id } });
  }

  // ─── ConsumableBom (định mức vật tư tiêu hao Hàn/Sơn) ───────────────────────

  async createConsumableBom(
    bomRevisionId: string,
    dto: CreateConsumableBomDto,
  ): Promise<ConsumableBomResponseDto> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);

    const materialBigId = parseBigIntId(dto.materialId);
    const material = await this.assertMaterialInSystemGroups(
      materialBigId,
      [
        MATERIAL_GROUP_SYSTEM_KEYS.WIRE,
        MATERIAL_GROUP_SYSTEM_KEYS.NAIL,
        MATERIAL_GROUP_SYSTEM_KEYS.OTHER,
      ],
      'consumable_bom',
    );
    // consumable_bom qua nhóm OTHER chỉ dùng cho Sơn (Dây/Đinh đi qua nhóm riêng của chúng,
    // không cần kiểm detailKind).
    if (material.systemKey === MATERIAL_GROUP_SYSTEM_KEYS.OTHER) {
      this.assertMaterialDetailKind(material, MaterialDetailKind.PAINT, 'consumable_bom (Sơn)');
    }

    const existing = await this.prisma.consumableBom.findUnique({
      where: {
        bomRevisionId_stage_materialId: {
          bomRevisionId: revision.id,
          stage: dto.stage,
          materialId: materialBigId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `consumable_bom row for stage ${dto.stage} + material ${dto.materialId} already exists on this revision`,
      );
    }

    const row = await this.prisma.consumableBom.create({
      data: {
        bomRevisionId: revision.id,
        stage: dto.stage,
        materialId: materialBigId,
        qtyPerUnit: dto.qtyPerUnit,
      },
      include: { material: true },
    });
    return this.toConsumableBomResponseDto(row);
  }

  async listConsumableBoms(bomRevisionId: string): Promise<ConsumableBomResponseDto[]> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    const rows = await this.prisma.consumableBom.findMany({
      where: { bomRevisionId: revision.id },
      include: { material: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => this.toConsumableBomResponseDto(r));
  }

  async updateConsumableBom(
    bomRevisionId: string,
    id: string,
    dto: UpdateConsumableBomDto,
  ): Promise<ConsumableBomResponseDto> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);
    const row = await this.findConsumableBomOrThrow(revision.id, id);

    const updated = await this.prisma.consumableBom.update({
      where: { id: row.id },
      data: { qtyPerUnit: dto.qtyPerUnit },
      include: { material: true },
    });
    return this.toConsumableBomResponseDto(updated);
  }

  async removeConsumableBom(bomRevisionId: string, id: string): Promise<void> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);
    const row = await this.findConsumableBomOrThrow(revision.id, id);
    await this.prisma.consumableBom.delete({ where: { id: row.id } });
  }

  // ─── BomAccessoryItem (Phụ kiện/Bao bì tiêu hao, không gắn công đoạn) ───────

  async createBomAccessoryItem(
    bomRevisionId: string,
    dto: CreateBomAccessoryItemDto,
  ): Promise<BomAccessoryItemResponseDto> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);

    const materialBigId = parseBigIntId(dto.materialId);
    const material = await this.assertMaterialInSystemGroups(
      materialBigId,
      [MATERIAL_GROUP_SYSTEM_KEYS.OTHER],
      'bom_accessory_items',
    );
    const expectedDetailKind =
      dto.kind === AccessoryItemKind.ACCESSORY
        ? MaterialDetailKind.ACCESSORY
        : MaterialDetailKind.PACKAGING;
    this.assertMaterialDetailKind(
      material,
      expectedDetailKind,
      `bom_accessory_items (${dto.kind})`,
    );

    const existing = await this.prisma.bomAccessoryItem.findUnique({
      where: {
        bomRevisionId_materialId: { bomRevisionId: revision.id, materialId: materialBigId },
      },
    });
    if (existing) {
      throw new ConflictException(
        `bom_accessory_items row for material ${dto.materialId} already exists on this revision`,
      );
    }

    const row = await this.prisma.bomAccessoryItem.create({
      data: {
        bomRevisionId: revision.id,
        materialId: materialBigId,
        kind: dto.kind,
        qtyPerUnit: dto.qtyPerUnit,
      },
      include: { material: true },
    });
    return this.toBomAccessoryItemResponseDto(row);
  }

  async listBomAccessoryItems(bomRevisionId: string): Promise<BomAccessoryItemResponseDto[]> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    const rows = await this.prisma.bomAccessoryItem.findMany({
      where: { bomRevisionId: revision.id },
      include: { material: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => this.toBomAccessoryItemResponseDto(r));
  }

  async updateBomAccessoryItem(
    bomRevisionId: string,
    id: string,
    dto: UpdateBomAccessoryItemDto,
  ): Promise<BomAccessoryItemResponseDto> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);
    const row = await this.findBomAccessoryItemOrThrow(revision.id, id);

    const updated = await this.prisma.bomAccessoryItem.update({
      where: { id: row.id },
      data: { qtyPerUnit: dto.qtyPerUnit },
      include: { material: true },
    });
    return this.toBomAccessoryItemResponseDto(updated);
  }

  async removeBomAccessoryItem(bomRevisionId: string, id: string): Promise<void> {
    const revision = await this.findOneOrThrow(bomRevisionId);
    this.assertDraft(revision);
    const row = await this.findBomAccessoryItemOrThrow(revision.id, id);
    await this.prisma.bomAccessoryItem.delete({ where: { id: row.id } });
  }

  // ─── Shared lookups / guards ──────────────────────────────────────────────

  private async findOneOrThrow(id: string): Promise<BomRevision> {
    const bigId = parseBigIntId(id);
    const revision = await this.prisma.bomRevision.findUnique({ where: { id: bigId } });
    if (!revision) {
      throw new NotFoundException(`Bom revision ${id} not found`);
    }
    return revision;
  }

  private assertDraft(revision: BomRevision): void {
    if (revision.status !== BomRevisionStatus.DRAFT) {
      throw new ConflictException(
        `Cannot modify line items on bom_revision ${revision.id} - status is ${revision.status}, only DRAFT is editable`,
      );
    }
  }

  /** Vật tư phải thuộc 1 trong các nhóm hệ thống cho phép (vd Dây/Đinh/Vật tư khác cho
   *  consumable_bom, Vật tư khác cho bom_accessory_items - Phụ kiện vs Bao bì tách qua
   *  `kind` chứ không phải nhóm vật tư). Reject cứng, không tự gán nhóm - đây là API CRUD
   *  cấp thấp, side-effect ngầm ở đây sẽ bất ngờ với người gọi. Trả về material (kèm
   *  detailKind + systemKey đã resolve) để caller tự kiểm thêm phân loại Sơn/Phụ kiện/Bao bì
   *  khi nhóm là OTHER, không phải query lại. */
  private async assertMaterialInSystemGroups(
    materialId: bigint,
    allowed: MaterialGroupSystemKey[],
    label: string,
  ): Promise<{ code: string; detailKind: MaterialDetailKind | null; systemKey: string }> {
    const material = await this.prisma.material.findUnique({
      where: { id: materialId },
      include: { materialGroup: true },
    });
    if (!material) {
      throw new NotFoundException(`Material ${materialId} not found`);
    }
    const systemKey = material.materialGroup?.systemKey;
    if (!systemKey || !allowed.includes(systemKey as MaterialGroupSystemKey)) {
      throw new BadRequestException(
        `Material "${material.code}" phải thuộc nhóm vật tư hệ thống [${allowed.join(', ')}] cho ${label} (đang thuộc nhóm systemKey=${systemKey ?? 'null'})`,
      );
    }
    return { code: material.code, detailKind: material.detailKind, systemKey };
  }

  /** Sơn/Phụ kiện/Bao bì dùng chung nhóm vật tư OTHER nên phải kiểm thêm material.detailKind
   *  mới biết đúng vật tư đó dành cho mục đích nào (xem assertMaterialInSystemGroups). */
  private assertMaterialDetailKind(
    material: { code: string; detailKind: MaterialDetailKind | null },
    expected: MaterialDetailKind,
    label: string,
  ): void {
    if (material.detailKind !== expected) {
      throw new BadRequestException(
        `Material "${material.code}" chưa được phân loại đúng cho ${label} - vào Admin > Vật tư gán Phân loại = ${expected} cho vật tư này trước`,
      );
    }
  }

  private assertSameProduct(
    entityMfgProductId: bigint,
    revisionMfgProductId: bigint,
    entityLabel: string,
    entityId: string,
  ): void {
    if (entityMfgProductId !== revisionMfgProductId) {
      throw new BadRequestException(
        `${entityLabel} ${entityId} belongs to a different product than this bom_revision`,
      );
    }
  }

  private async findBomPieceOrThrow(revisionId: bigint, id: string): Promise<BomPieceWithPiece> {
    const idBigId = parseBigIntId(id);
    const row = await this.prisma.bomPiece.findUnique({
      where: { id: idBigId },
      include: { piece: true },
    });
    if (!row || row.bomRevisionId !== revisionId) {
      throw new NotFoundException(`bom_piece ${id} not found on this revision`);
    }
    return row;
  }

  private async findBomPartOrThrow(revisionId: bigint, id: string): Promise<BomPartWithPart> {
    const idBigId = parseBigIntId(id);
    const row = await this.prisma.bomPart.findUnique({
      where: { id: idBigId },
      include: { part: true },
    });
    if (!row || row.bomRevisionId !== revisionId) {
      throw new NotFoundException(`bom_part ${id} not found on this revision`);
    }
    return row;
  }

  private async findPieceBomOrThrow(revisionId: bigint, id: string): Promise<PieceBomWithRefs> {
    const idBigId = parseBigIntId(id);
    const row = await this.prisma.pieceBom.findUnique({
      where: { id: idBigId },
      include: { piece: true, segmentSpec: { include: { material: true } } },
    });
    if (!row || row.bomRevisionId !== revisionId) {
      throw new NotFoundException(`piece_bom ${id} not found on this revision`);
    }
    return row;
  }

  private async findPartBomOrThrow(revisionId: bigint, id: string): Promise<PartBomWithRefs> {
    const idBigId = parseBigIntId(id);
    const row = await this.prisma.partBom.findUnique({
      where: { id: idBigId },
      include: { part: true, segmentSpec: { include: { material: true } } },
    });
    if (!row || row.bomRevisionId !== revisionId) {
      throw new NotFoundException(`part_bom ${id} not found on this revision`);
    }
    return row;
  }

  private async findConsumableBomOrThrow(
    revisionId: bigint,
    id: string,
  ): Promise<ConsumableBomWithMaterial> {
    const idBigId = parseBigIntId(id);
    const row = await this.prisma.consumableBom.findUnique({
      where: { id: idBigId },
      include: { material: true },
    });
    if (!row || row.bomRevisionId !== revisionId) {
      throw new NotFoundException(`consumable_bom ${id} not found on this revision`);
    }
    return row;
  }

  private async findBomAccessoryItemOrThrow(
    revisionId: bigint,
    id: string,
  ): Promise<BomAccessoryItemWithMaterial> {
    const idBigId = parseBigIntId(id);
    const row = await this.prisma.bomAccessoryItem.findUnique({
      where: { id: idBigId },
      include: { material: true },
    });
    if (!row || row.bomRevisionId !== revisionId) {
      throw new NotFoundException(`bom_accessory_items ${id} not found on this revision`);
    }
    return row;
  }

  // ─── Mappers ────────────────────────────────────────────────────────────────

  private toResponseDto(revision: BomRevision): BomRevisionResponseDto {
    return new BomRevisionResponseDto({
      id: revision.id.toString(),
      mfgProductId: revision.mfgProductId.toString(),
      revNo: revision.revNo,
      status: revision.status,
      sourcePlanFormId: revision.sourcePlanFormId?.toString() ?? null,
      createdAt: revision.createdAt,
    });
  }

  private toBomPieceResponseDto(row: BomPieceWithPiece): BomPieceResponseDto {
    return new BomPieceResponseDto({
      id: row.id.toString(),
      bomRevisionId: row.bomRevisionId.toString(),
      pieceId: row.pieceId.toString(),
      pieceCode: row.piece.code,
      qtyPerUnit: row.qtyPerUnit,
    });
  }

  private toBomPartResponseDto(row: BomPartWithPart): BomPartResponseDto {
    return new BomPartResponseDto({
      id: row.id.toString(),
      bomRevisionId: row.bomRevisionId.toString(),
      partId: row.partId.toString(),
      partCode: row.part.code,
      qtyPerUnit: row.qtyPerUnit,
    });
  }

  private toPieceBomResponseDto(row: PieceBomWithRefs): PieceBomResponseDto {
    return new PieceBomResponseDto({
      id: row.id.toString(),
      bomRevisionId: row.bomRevisionId.toString(),
      pieceId: row.pieceId.toString(),
      pieceCode: row.piece.code,
      segmentSpecId: row.segmentSpecId.toString(),
      segmentSpecLabel: `${row.segmentSpec.material.code} @ ${row.segmentSpec.cutLengthMm}mm`,
      qtyPerPiece: row.qtyPerPiece,
      needsHan: row.needsHan,
      needsSon: row.needsSon,
      note: row.note,
    });
  }

  private toPartBomResponseDto(row: PartBomWithRefs): PartBomResponseDto {
    return new PartBomResponseDto({
      id: row.id.toString(),
      bomRevisionId: row.bomRevisionId.toString(),
      partId: row.partId.toString(),
      partCode: row.part.code,
      segmentSpecId: row.segmentSpecId.toString(),
      segmentSpecLabel: `${row.segmentSpec.material.code} @ ${row.segmentSpec.cutLengthMm}mm`,
      qtyPerPart: row.qtyPerPart,
    });
  }

  private toConsumableBomResponseDto(row: ConsumableBomWithMaterial): ConsumableBomResponseDto {
    return new ConsumableBomResponseDto({
      id: row.id.toString(),
      bomRevisionId: row.bomRevisionId.toString(),
      stage: row.stage,
      materialId: row.materialId.toString(),
      materialCode: row.material.code,
      qtyPerUnit: row.qtyPerUnit.toNumber(),
    });
  }

  private toBomAccessoryItemResponseDto(
    row: BomAccessoryItemWithMaterial,
  ): BomAccessoryItemResponseDto {
    return new BomAccessoryItemResponseDto({
      id: row.id.toString(),
      bomRevisionId: row.bomRevisionId.toString(),
      materialId: row.materialId.toString(),
      materialCode: row.material.code,
      kind: row.kind,
      qtyPerUnit: row.qtyPerUnit.toNumber(),
    });
  }
}
