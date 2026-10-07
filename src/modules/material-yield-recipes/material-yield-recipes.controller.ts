import { Body, Controller, Delete, Get, Param, Patch, Post, UseInterceptors } from '@nestjs/common';
import {
  RealtimeEntityOn,
  RealtimeMutationInterceptor,
} from '../../realtime/realtime-mutation.interceptor';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateMaterialYieldRecipeDto } from './dto/create-material-yield-recipe.dto';
import { UpdateMaterialYieldRecipeDto } from './dto/update-material-yield-recipe.dto';
import { MaterialYieldRecipesService } from './material-yield-recipes.service';

const VIEW = { module: PERMISSION_MODULES.MATERIAL_YIELD_RECIPE, action: PermissionAction.VIEW };
const CREATE = {
  module: PERMISSION_MODULES.MATERIAL_YIELD_RECIPE,
  action: PermissionAction.CREATE,
};
const UPDATE = {
  module: PERMISSION_MODULES.MATERIAL_YIELD_RECIPE,
  action: PermissionAction.UPDATE,
};
const DELETE = {
  module: PERMISSION_MODULES.MATERIAL_YIELD_RECIPE,
  action: PermissionAction.DELETE,
};

/** Admin quản lý định mức "vật tư thành phẩm không gắn piece" (vd chân nhôm <- thanh nhôm) - xem
 *  doc comment MaterialYieldRecipesService. */
@ApiTags('Material Yield Recipes')
@ApiBearerAuth()
@Controller({ version: '1' })
@RealtimeEntityOn('MATERIAL_YIELD_RECIPE')
@UseInterceptors(RealtimeMutationInterceptor)
export class MaterialYieldRecipesController {
  constructor(private readonly service: MaterialYieldRecipesService) {}

  @Post('material-yield-recipes')
  @RequirePermissions(CREATE)
  create(@Body() dto: CreateMaterialYieldRecipeDto) {
    return this.service.create(dto);
  }

  @Get('material-yield-recipes')
  @RequirePermissions(VIEW)
  findAll() {
    return this.service.findAll();
  }

  @Get('material-yield-recipes/:id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch('material-yield-recipes/:id')
  @RequirePermissions(UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateMaterialYieldRecipeDto) {
    return this.service.update(id, dto);
  }

  @Delete('material-yield-recipes/:id')
  @RequirePermissions(DELETE)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Get('production-invoices/:id/material-yield-recipe-demand')
  @RequirePermissions(VIEW)
  getProductionDemand(@Param('id') id: string) {
    return this.service.getProductionDemand(id);
  }
}
