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
import { CreateDefectReasonDto } from './dto/create-defect-reason.dto';
import { UpdateDefectReasonDto } from './dto/update-defect-reason.dto';
import { DefectReasonsService } from './defect-reasons.service';

@ApiTags('Defect Reasons')
@ApiBearerAuth()
@Controller({ path: 'defect-reasons', version: '1' })
export class DefectReasonsController {
  constructor(private readonly defectReasonsService: DefectReasonsService) {}

  @Post()
  @RequirePermissions({ module: PERMISSION_MODULES.DEFECT_REASON, action: PermissionAction.CREATE })
  create(@Body() dto: CreateDefectReasonDto) {
    return this.defectReasonsService.create(dto);
  }

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.DEFECT_REASON, action: PermissionAction.VIEW })
  findAll(@Query() query: PaginationQueryDto) {
    return this.defectReasonsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.DEFECT_REASON, action: PermissionAction.VIEW })
  findOne(@Param('id') id: string) {
    return this.defectReasonsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions({ module: PERMISSION_MODULES.DEFECT_REASON, action: PermissionAction.UPDATE })
  update(@Param('id') id: string, @Body() dto: UpdateDefectReasonDto) {
    return this.defectReasonsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ module: PERMISSION_MODULES.DEFECT_REASON, action: PermissionAction.DELETE })
  remove(@Param('id') id: string) {
    return this.defectReasonsService.remove(id);
  }
}
