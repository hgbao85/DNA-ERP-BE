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
import { CreateMaterialGroupDto } from './dto/create-material-group.dto';
import { UpdateMaterialGroupDto } from './dto/update-material-group.dto';
import { MaterialGroupsService } from './material-groups.service';

@ApiTags('Material Groups')
@ApiBearerAuth()
@Controller({ path: 'material-groups', version: '1' })
export class MaterialGroupsController {
  constructor(private readonly materialGroupsService: MaterialGroupsService) {}

  @Post()
  @RequirePermissions({
    module: PERMISSION_MODULES.MATERIAL_GROUP,
    action: PermissionAction.CREATE,
  })
  create(@Body() dto: CreateMaterialGroupDto) {
    return this.materialGroupsService.create(dto);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.MATERIAL_GROUP, action: PermissionAction.VIEW })
  findAll(@Query() query: PaginationQueryDto) {
    return this.materialGroupsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.MATERIAL_GROUP, action: PermissionAction.VIEW })
  findOne(@Param('id') id: string) {
    return this.materialGroupsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions({
    module: PERMISSION_MODULES.MATERIAL_GROUP,
    action: PermissionAction.UPDATE,
  })
  update(@Param('id') id: string, @Body() dto: UpdateMaterialGroupDto) {
    return this.materialGroupsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({
    module: PERMISSION_MODULES.MATERIAL_GROUP,
    action: PermissionAction.DELETE,
  })
  remove(@Param('id') id: string) {
    return this.materialGroupsService.remove(id);
  }
}
