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
import { CreateSegmentSpecDto } from './dto/create-segment-spec.dto';
import { UpdateSegmentSpecDto } from './dto/update-segment-spec.dto';
import { SegmentSpecsService } from './segment-specs.service';

@ApiTags('Segment Specs')
@ApiBearerAuth()
@Controller({ path: 'segment-specs', version: '1' })
export class SegmentSpecsController {
  constructor(private readonly segmentSpecsService: SegmentSpecsService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.SEGMENT_SPEC, action: PermissionAction.CREATE })
  create(@Body() dto: CreateSegmentSpecDto) {
    return this.segmentSpecsService.create(dto);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.SEGMENT_SPEC, action: PermissionAction.VIEW })
  findAll(@Query() query: PaginationQueryDto) {
    return this.segmentSpecsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.SEGMENT_SPEC, action: PermissionAction.VIEW })
  findOne(@Param('id') id: string) {
    return this.segmentSpecsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.SEGMENT_SPEC, action: PermissionAction.UPDATE })
  update(@Param('id') id: string, @Body() dto: UpdateSegmentSpecDto) {
    return this.segmentSpecsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.SEGMENT_SPEC, action: PermissionAction.DELETE })
  remove(@Param('id') id: string) {
    return this.segmentSpecsService.remove(id);
  }
}
