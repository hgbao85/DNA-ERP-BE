import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { CreateMaterialInspectionRequestDto } from './dto/create-material-inspection-request.dto';
import { SubmitInspectionKhoDto } from './dto/submit-inspection-kho.dto';
import { MaterialInspectionService } from './material-inspection.service';

const VIEW = { module: PERMISSION_MODULES.MATERIAL_INSPECTION, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.MATERIAL_INSPECTION, action: PermissionAction.CREATE };
const UPDATE = { module: PERMISSION_MODULES.MATERIAL_INSPECTION, action: PermissionAction.UPDATE };

@ApiTags('Material Inspection')
@ApiBearerAuth()
@Controller({ path: 'material-inspection-requests', version: '1' })
export class MaterialInspectionController {
  constructor(private readonly materialInspectionService: MaterialInspectionService) {}

  // ─── KHSX (role PRODUCTION_PLANNER) ─────────────────────────────────────────

  @Post()
  @RequirePermissions(CREATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER)
  create(@Body() dto: CreateMaterialInspectionRequestDto, @CurrentUser('id') userId: string) {
    return this.materialInspectionService.create(dto, userId);
  }

  @Get()
  @RequirePermissions(VIEW)
  findAll(@Query() query: PaginationQueryDto) {
    return this.materialInspectionService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.materialInspectionService.findOne(id);
  }

  @Post(':id/start-production')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER)
  startProduction(@Param('id') id: string) {
    return this.materialInspectionService.startProduction(id);
  }

  // ─── Kho staff (role WAREHOUSE_STAFF, scope theo warehouseScope) ────────────

  @Post(':id/kho/:warehouseCode/submit')
  @RequirePermissions(UPDATE)
  submitKho(
    @Param('id') id: string,
    @Param('warehouseCode') warehouseCode: string,
    @Body() dto: SubmitInspectionKhoDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.materialInspectionService.submitKho(id, warehouseCode, dto, userId, warehouseScope);
  }
}
