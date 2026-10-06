import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateMaterialYieldStepBatchDto } from './dto/create-material-yield-step-batch.dto';
import { ListMaterialYieldStepBundlesQueryDto } from './dto/list-material-yield-step-bundles-query.dto';
import { SubmitMaterialYieldStepDto } from './dto/submit-material-yield-step.dto';
import { MaterialYieldRecipeProductionService } from './material-yield-recipe-production.service';

// Tái dùng ĐÚNG permission module PRODUCTION_BATCH (không tạo module quyền riêng) - cùng tiền lệ
// piece-step-batches/piece-step-bundles (ProductionBatchesController): "báo tiến độ công đoạn vật
// tư thành phẩm" là 1 hình thức khác của "Phôi báo tiến độ", PHOI_STAFF đã có CREATE+VIEW sẵn.
const CREATE = { module: PERMISSION_MODULES.PRODUCTION_BATCH, action: PermissionAction.CREATE };
const VIEW = { module: PERMISSION_MODULES.PRODUCTION_BATCH, action: PermissionAction.VIEW };

@ApiTags('Material Yield Recipe Production')
@ApiBearerAuth()
@Controller({ version: '1' })
export class MaterialYieldRecipeProductionController {
  constructor(private readonly service: MaterialYieldRecipeProductionService) {}

  @Post('production-invoices/:id/material-yield-step-batches')
  @RequirePermissions(CREATE)
  @RequireMfgRole(MfgRole.PHOI)
  recordStepBatch(
    @Param('id') id: string,
    @Body() dto: CreateMaterialYieldStepBatchDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('mfgRole') mfgRole: string | null,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    return this.service.recordStepBatch(id, dto, userId, mfgRole, idempotencyKey);
  }

  @Post('production-invoices/:id/material-yield-step-bundles')
  @RequirePermissions(CREATE)
  @RequireMfgRole(MfgRole.PHOI)
  submitStep(
    @Param('id') id: string,
    @Body() dto: SubmitMaterialYieldStepDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('mfgRole') mfgRole: string | null,
  ) {
    return this.service.submitStep(id, dto, userId, mfgRole);
  }

  /** Phôi xem lại bundle theo PI (lịch sử + đang chờ KCS) - dùng cho StepPanel bên FE. */
  @Get('production-invoices/:id/material-yield-step-bundles')
  @RequirePermissions(VIEW)
  findBundlesForInvoice(@Param('id') id: string) {
    return this.service.findBundlesForInvoice(id);
  }

  /** Flat, không cần productionInvoiceId - dùng cho màn KCS lọc theo trạng thái. */
  @Get('material-yield-step-bundles')
  @RequirePermissions(VIEW)
  findAllBundles(@Query() query: ListMaterialYieldStepBundlesQueryDto) {
    return this.service.findAllBundles(query);
  }
}
