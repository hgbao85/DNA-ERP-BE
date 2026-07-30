import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BomRevisionsService } from './bom-revisions.service';
import { CreateBomPartDto } from './dto/create-bom-part.dto';
import { CreateBomPieceDto } from './dto/create-bom-piece.dto';
import { CreateConsumableBomDto } from './dto/create-consumable-bom.dto';
import { CreatePartBomDto } from './dto/create-part-bom.dto';
import { CreatePieceBomDto } from './dto/create-piece-bom.dto';
import { UpdateBomPartDto } from './dto/update-bom-part.dto';
import { UpdateBomPieceDto } from './dto/update-bom-piece.dto';
import { UpdateConsumableBomDto } from './dto/update-consumable-bom.dto';
import { UpdatePartBomDto } from './dto/update-part-bom.dto';
import { UpdatePieceBomDto } from './dto/update-piece-bom.dto';

const VIEW = { module: PERMISSION_MODULES.BOM_REVISION, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.BOM_REVISION, action: PermissionAction.CREATE };
const UPDATE = { module: PERMISSION_MODULES.BOM_REVISION, action: PermissionAction.UPDATE };
const DELETE = { module: PERMISSION_MODULES.BOM_REVISION, action: PermissionAction.DELETE };
const APPROVE = { module: PERMISSION_MODULES.BOM_REVISION, action: PermissionAction.APPROVE };

/**
 * Addresses a BomRevision by its own id (globally unique), plus everything nested under
 * it. Creation/listing-by-product live on ProductBomRevisionsController below instead,
 * since a revision is always created in the context of one product.
 */
@ApiTags('Bom Revisions')
@ApiBearerAuth()
@Controller({ path: 'bom-revisions', version: '1' })
export class BomRevisionsController {
  constructor(private readonly bomRevisionsService: BomRevisionsService) {}

  @Get(':id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.bomRevisionsService.findOne(id);
  }

  // activate() is a state transition (DRAFT -> ACTIVE), not a field edit - modeled as
  // APPROVE rather than UPDATE, same spirit as production_order approvals elsewhere.
  @Post(':id/activate')
  @RequirePermissions(APPROVE)
  activate(@Param('id') id: string) {
    return this.bomRevisionsService.activate(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(DELETE)
  remove(@Param('id') id: string) {
    return this.bomRevisionsService.remove(id);
  }

  // ─── Nested: BomPiece ───────────────────────────────────────────────────────

  @Post(':bomRevisionId/bom-pieces')
  @RequirePermissions(CREATE)
  createBomPiece(@Param('bomRevisionId') bomRevisionId: string, @Body() dto: CreateBomPieceDto) {
    return this.bomRevisionsService.createBomPiece(bomRevisionId, dto);
  }

  @Get(':bomRevisionId/bom-pieces')
  @RequirePermissions(VIEW)
  listBomPieces(@Param('bomRevisionId') bomRevisionId: string) {
    return this.bomRevisionsService.listBomPieces(bomRevisionId);
  }

  @Patch(':bomRevisionId/bom-pieces/:id')
  @RequirePermissions(UPDATE)
  updateBomPiece(
    @Param('bomRevisionId') bomRevisionId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBomPieceDto,
  ) {
    return this.bomRevisionsService.updateBomPiece(bomRevisionId, id, dto);
  }

  @Delete(':bomRevisionId/bom-pieces/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(DELETE)
  removeBomPiece(@Param('bomRevisionId') bomRevisionId: string, @Param('id') id: string) {
    return this.bomRevisionsService.removeBomPiece(bomRevisionId, id);
  }

  // ─── Nested: BomPart ────────────────────────────────────────────────────────

  @Post(':bomRevisionId/bom-parts')
  @RequirePermissions(CREATE)
  createBomPart(@Param('bomRevisionId') bomRevisionId: string, @Body() dto: CreateBomPartDto) {
    return this.bomRevisionsService.createBomPart(bomRevisionId, dto);
  }

  @Get(':bomRevisionId/bom-parts')
  @RequirePermissions(VIEW)
  listBomParts(@Param('bomRevisionId') bomRevisionId: string) {
    return this.bomRevisionsService.listBomParts(bomRevisionId);
  }

  @Patch(':bomRevisionId/bom-parts/:id')
  @RequirePermissions(UPDATE)
  updateBomPart(
    @Param('bomRevisionId') bomRevisionId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBomPartDto,
  ) {
    return this.bomRevisionsService.updateBomPart(bomRevisionId, id, dto);
  }

  @Delete(':bomRevisionId/bom-parts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(DELETE)
  removeBomPart(@Param('bomRevisionId') bomRevisionId: string, @Param('id') id: string) {
    return this.bomRevisionsService.removeBomPart(bomRevisionId, id);
  }

  // ─── Nested: PieceBom ───────────────────────────────────────────────────────

  @Post(':bomRevisionId/piece-boms')
  @RequirePermissions(CREATE)
  createPieceBom(@Param('bomRevisionId') bomRevisionId: string, @Body() dto: CreatePieceBomDto) {
    return this.bomRevisionsService.createPieceBom(bomRevisionId, dto);
  }

  @Get(':bomRevisionId/piece-boms')
  @RequirePermissions(VIEW)
  listPieceBoms(@Param('bomRevisionId') bomRevisionId: string) {
    return this.bomRevisionsService.listPieceBoms(bomRevisionId);
  }

  @Patch(':bomRevisionId/piece-boms/:id')
  @RequirePermissions(UPDATE)
  updatePieceBom(
    @Param('bomRevisionId') bomRevisionId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePieceBomDto,
  ) {
    return this.bomRevisionsService.updatePieceBom(bomRevisionId, id, dto);
  }

  @Delete(':bomRevisionId/piece-boms/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(DELETE)
  removePieceBom(@Param('bomRevisionId') bomRevisionId: string, @Param('id') id: string) {
    return this.bomRevisionsService.removePieceBom(bomRevisionId, id);
  }

  // ─── Nested: PartBom ────────────────────────────────────────────────────────

  @Post(':bomRevisionId/part-boms')
  @RequirePermissions(CREATE)
  createPartBom(@Param('bomRevisionId') bomRevisionId: string, @Body() dto: CreatePartBomDto) {
    return this.bomRevisionsService.createPartBom(bomRevisionId, dto);
  }

  @Get(':bomRevisionId/part-boms')
  @RequirePermissions(VIEW)
  listPartBoms(@Param('bomRevisionId') bomRevisionId: string) {
    return this.bomRevisionsService.listPartBoms(bomRevisionId);
  }

  @Patch(':bomRevisionId/part-boms/:id')
  @RequirePermissions(UPDATE)
  updatePartBom(
    @Param('bomRevisionId') bomRevisionId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePartBomDto,
  ) {
    return this.bomRevisionsService.updatePartBom(bomRevisionId, id, dto);
  }

  @Delete(':bomRevisionId/part-boms/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(DELETE)
  removePartBom(@Param('bomRevisionId') bomRevisionId: string, @Param('id') id: string) {
    return this.bomRevisionsService.removePartBom(bomRevisionId, id);
  }

  // ─── Nested: ConsumableBom ──────────────────────────────────────────────────

  @Post(':bomRevisionId/consumable-boms')
  @RequirePermissions(CREATE)
  createConsumableBom(
    @Param('bomRevisionId') bomRevisionId: string,
    @Body() dto: CreateConsumableBomDto,
  ) {
    return this.bomRevisionsService.createConsumableBom(bomRevisionId, dto);
  }

  @Get(':bomRevisionId/consumable-boms')
  @RequirePermissions(VIEW)
  listConsumableBoms(@Param('bomRevisionId') bomRevisionId: string) {
    return this.bomRevisionsService.listConsumableBoms(bomRevisionId);
  }

  @Patch(':bomRevisionId/consumable-boms/:id')
  @RequirePermissions(UPDATE)
  updateConsumableBom(
    @Param('bomRevisionId') bomRevisionId: string,
    @Param('id') id: string,
    @Body() dto: UpdateConsumableBomDto,
  ) {
    return this.bomRevisionsService.updateConsumableBom(bomRevisionId, id, dto);
  }

  @Delete(':bomRevisionId/consumable-boms/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(DELETE)
  removeConsumableBom(@Param('bomRevisionId') bomRevisionId: string, @Param('id') id: string) {
    return this.bomRevisionsService.removeConsumableBom(bomRevisionId, id);
  }
}

/** Creation/listing scoped to a product - a revision always belongs to exactly one. */
@ApiTags('Bom Revisions')
@ApiBearerAuth()
@Controller({ path: 'products/:productId/bom-revisions', version: '1' })
export class ProductBomRevisionsController {
  constructor(private readonly bomRevisionsService: BomRevisionsService) {}

  @Post()
  @RequirePermissions(CREATE)
  create(@Param('productId') productId: string) {
    return this.bomRevisionsService.create(productId);
  }

  @Get()
  @RequirePermissions(VIEW)
  findAll(@Param('productId') productId: string) {
    return this.bomRevisionsService.findAllForProduct(productId);
  }
}
