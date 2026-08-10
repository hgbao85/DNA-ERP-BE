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
import { CreateMaterialDto } from './dto/create-material.dto';
import { CreateMaterialSupplierDto } from './dto/create-material-supplier.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { UpdateMaterialSupplierDto } from './dto/update-material-supplier.dto';
import { MaterialsService } from './materials.service';

@ApiTags('Materials')
@ApiBearerAuth()
@Controller({ path: 'materials', version: '1' })
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.MATERIAL, action: PermissionAction.CREATE })
  create(@Body() dto: CreateMaterialDto) {
    return this.materialsService.create(dto);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.MATERIAL, action: PermissionAction.VIEW })
  findAll(@Query() query: PaginationQueryDto) {
    return this.materialsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.MATERIAL, action: PermissionAction.VIEW })
  findOne(@Param('id') id: string) {
    return this.materialsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.MATERIAL, action: PermissionAction.UPDATE })
  update(@Param('id') id: string, @Body() dto: UpdateMaterialDto) {
    return this.materialsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.MATERIAL, action: PermissionAction.DELETE })
  remove(@Param('id') id: string) {
    return this.materialsService.remove(id);
  }

  // ─── Nested: which suppliers offer this material, at what price ──────────
  // Dữ liệu ở đây là bảng nối MaterialSupplier (giá/lead-time theo NCC), không phải entity
  // Material - gắn permission theo module SUPPLIER (không phải MATERIAL) để tách đúng "sửa
  // thông tin vật tư gốc" khỏi "quản lý NCC của vật tư" (2 việc khác nhau, xem review rủi ro #2:
  // trước đây gộp chung MATERIAL:UPDATE khiến PURCHASER vô tình có luôn quyền PATCH /materials/:id).

  @Post(':materialId/suppliers')
  @RequirePermissions({ module: PERMISSION_MODULES.SUPPLIER, action: PermissionAction.CREATE })
  addSupplier(@Param('materialId') materialId: string, @Body() dto: CreateMaterialSupplierDto) {
    return this.materialsService.addSupplier(materialId, dto);
  }

  @Get(':materialId/suppliers')
  @RequirePermissions({ module: PERMISSION_MODULES.SUPPLIER, action: PermissionAction.VIEW })
  listSuppliers(@Param('materialId') materialId: string) {
    return this.materialsService.listSuppliers(materialId);
  }

  @Patch(':materialId/suppliers/:id')
  @RequirePermissions({ module: PERMISSION_MODULES.SUPPLIER, action: PermissionAction.UPDATE })
  updateSupplier(
    @Param('materialId') materialId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMaterialSupplierDto,
  ) {
    return this.materialsService.updateSupplier(materialId, id, dto);
  }

  @Delete(':materialId/suppliers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.SUPPLIER, action: PermissionAction.DELETE })
  removeSupplier(@Param('materialId') materialId: string, @Param('id') id: string) {
    return this.materialsService.removeSupplier(materialId, id);
  }
}
