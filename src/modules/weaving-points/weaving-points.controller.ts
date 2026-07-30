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
import { CreateWeavingPointDto } from './dto/create-weaving-point.dto';
import { UpdateWeavingPointDto } from './dto/update-weaving-point.dto';
import { WeavingPointsService } from './weaving-points.service';

@ApiTags('Weaving Points')
@ApiBearerAuth()
@Controller({ path: 'weaving-points', version: '1' })
export class WeavingPointsController {
  constructor(private readonly weavingPointsService: WeavingPointsService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.WEAVING_POINT, action: PermissionAction.CREATE })
  create(@Body() dto: CreateWeavingPointDto) {
    return this.weavingPointsService.create(dto);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.WEAVING_POINT, action: PermissionAction.VIEW })
  findAll(@Query() query: PaginationQueryDto) {
    return this.weavingPointsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.WEAVING_POINT, action: PermissionAction.VIEW })
  findOne(@Param('id') id: string) {
    return this.weavingPointsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.WEAVING_POINT, action: PermissionAction.UPDATE })
  update(@Param('id') id: string, @Body() dto: UpdateWeavingPointDto) {
    return this.weavingPointsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.WEAVING_POINT, action: PermissionAction.DELETE })
  remove(@Param('id') id: string) {
    return this.weavingPointsService.remove(id);
  }
}
