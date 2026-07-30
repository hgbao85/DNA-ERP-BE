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
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { WarehousesService } from './warehouses.service';

@ApiTags('Warehouses')
@ApiBearerAuth()
@Controller({ path: 'warehouses', version: '1' })
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.WAREHOUSE, action: PermissionAction.CREATE })
  create(@Body() dto: CreateWarehouseDto) {
    return this.warehousesService.create(dto);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.WAREHOUSE, action: PermissionAction.VIEW })
  findAll(@Query() query: PaginationQueryDto) {
    return this.warehousesService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.WAREHOUSE, action: PermissionAction.VIEW })
  findOne(@Param('id') id: string) {
    return this.warehousesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.WAREHOUSE, action: PermissionAction.UPDATE })
  update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
    return this.warehousesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.WAREHOUSE, action: PermissionAction.DELETE })
  remove(@Param('id') id: string) {
    return this.warehousesService.remove(id);
  }
}
