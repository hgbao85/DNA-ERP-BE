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
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('Suppliers')
@ApiBearerAuth()
@Controller({ path: 'suppliers', version: '1' })
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.SUPPLIER, action: PermissionAction.CREATE })
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(dto);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.SUPPLIER, action: PermissionAction.VIEW })
  findAll(@Query() query: PaginationQueryDto) {
    return this.suppliersService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.SUPPLIER, action: PermissionAction.VIEW })
  findOne(@Param('id') id: string) {
    return this.suppliersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.SUPPLIER, action: PermissionAction.UPDATE })
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.SUPPLIER, action: PermissionAction.DELETE })
  remove(@Param('id') id: string) {
    return this.suppliersService.remove(id);
  }
}
