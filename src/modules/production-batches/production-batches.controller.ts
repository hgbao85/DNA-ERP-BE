import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateProductionBatchDto } from './dto/create-production-batch.dto';
import { ListProductionBatchesQueryDto } from './dto/list-production-batches-query.dto';
import { ProductionBatchPlanQueryDto } from './dto/production-batch-plan-query.dto';
import { ProductionBatchesService } from './production-batches.service';

const VIEW = { module: PERMISSION_MODULES.PRODUCTION_BATCH, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.PRODUCTION_BATCH, action: PermissionAction.CREATE };

@ApiTags('Production Batches')
@ApiBearerAuth()
@Controller({ version: '1' })
export class ProductionBatchesController {
  constructor(private readonly productionBatchesService: ProductionBatchesService) {}

  // ─── Tổ Phôi/Hàn/Sơn (mfgRole = PHOI|HAN|SON) - báo sản lượng ────────────────
  // PHOI ở đây là "Phôi tự báo cắt xong vật tư thành phẩm" (needsHan=false, vd chân nhôm) - khác
  // hẳn STEEL_ISSUE (báo cắt sắt cho mảnh needsHan=true qua SteelIssuesService.completeCutting()).

  @Post('production-orders/:id/production-batches')
  @RequirePermissions(CREATE)
  @RequireMfgRole(MfgRole.PHOI, MfgRole.HAN, MfgRole.SON)
  create(
    @Param('id') id: string,
    @Body() dto: CreateProductionBatchDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('mfgRole') mfgRole: string | null,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    return this.productionBatchesService.create(id, dto, userId, mfgRole, idempotencyKey);
  }

  @Get('production-orders/:id/production-batches')
  @RequirePermissions(VIEW)
  findAllForOrder(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.productionBatchesService.findAllForOrder(id, query);
  }

  /** Tổ Phôi/Hàn/Sơn tự tra pieceId thật để báo sản lượng - xem ProductionBatchesService.getBatchPlan(). */
  @Get('production-orders/:id/production-batch-plan')
  @RequirePermissions(VIEW)
  getBatchPlan(@Param('id') id: string, @Query() query: ProductionBatchPlanQueryDto) {
    return this.productionBatchesService.getBatchPlan(id, query.stage);
  }

  @Get('production-batches/:id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.productionBatchesService.findOne(id);
  }

  // ─── KCS (mfgRole = KCS) - xem lô chờ duyệt không cần biết trước PO ──────────

  /** Flat, không cần productionOrderId - xem ListProductionBatchesQueryDto. */
  @Get('production-batches')
  @RequirePermissions(VIEW)
  findAll(@Query() query: ListProductionBatchesQueryDto) {
    return this.productionBatchesService.findAll(query);
  }
}
