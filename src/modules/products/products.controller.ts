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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreatePartDto } from './dto/create-part.dto';
import { CreatePieceDto } from './dto/create-piece.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdatePartDto } from './dto/update-part.dto';
import { UpdatePieceDto } from './dto/update-piece.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';
import { ProductsService } from './products.service';

@ApiTags('Products')
@ApiBearerAuth()
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.CREATE })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.VIEW })
  findAll(@Query() query: PaginationQueryDto) {
    return this.productsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.VIEW })
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.UPDATE })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.DELETE })
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  // ─── Nested: ProductVariant ────────────────────────────────────────────────

  @Post(':productId/variants')
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.CREATE })
  createVariant(@Param('productId') productId: string, @Body() dto: CreateProductVariantDto) {
    return this.productsService.createVariant(productId, dto);
  }

  @Get(':productId/variants')
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.VIEW })
  listVariants(@Param('productId') productId: string) {
    return this.productsService.listVariants(productId);
  }

  @Patch(':productId/variants/:id')
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.UPDATE })
  updateVariant(
    @Param('productId') productId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductVariantDto,
  ) {
    return this.productsService.updateVariant(productId, id, dto);
  }

  @Delete(':productId/variants/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.DELETE })
  removeVariant(@Param('productId') productId: string, @Param('id') id: string) {
    return this.productsService.removeVariant(productId, id);
  }

  // ─── Nested: Piece ──────────────────────────────────────────────────────────

  @Post(':productId/pieces')
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.CREATE })
  createPiece(@Param('productId') productId: string, @Body() dto: CreatePieceDto) {
    return this.productsService.createPiece(productId, dto);
  }

  @Get(':productId/pieces')
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.VIEW })
  listPieces(@Param('productId') productId: string) {
    return this.productsService.listPieces(productId);
  }

  @Patch(':productId/pieces/:id')
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.UPDATE })
  updatePiece(
    @Param('productId') productId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePieceDto,
  ) {
    return this.productsService.updatePiece(productId, id, dto);
  }

  @Delete(':productId/pieces/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.DELETE })
  removePiece(@Param('productId') productId: string, @Param('id') id: string) {
    return this.productsService.removePiece(productId, id);
  }

  // ─── Nested: Part ───────────────────────────────────────────────────────────

  @Post(':productId/parts')
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.CREATE })
  createPart(@Param('productId') productId: string, @Body() dto: CreatePartDto) {
    return this.productsService.createPart(productId, dto);
  }

  @Get(':productId/parts')
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.VIEW })
  listParts(@Param('productId') productId: string) {
    return this.productsService.listParts(productId);
  }

  @Patch(':productId/parts/:id')
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.UPDATE })
  updatePart(
    @Param('productId') productId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePartDto,
  ) {
    return this.productsService.updatePart(productId, id, dto);
  }

  @Delete(':productId/parts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.PRODUCT, action: PermissionAction.DELETE })
  removePart(@Param('productId') productId: string, @Param('id') id: string) {
    return this.productsService.removePart(productId, id);
  }
}
