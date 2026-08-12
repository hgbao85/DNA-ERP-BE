import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateProductionBatchDto } from './dto/create-production-batch.dto';
import { ProductionBatchesService } from './production-batches.service';

const VIEW = { module: PERMISSION_MODULES.PRODUCTION_BATCH, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.PRODUCTION_BATCH, action: PermissionAction.CREATE };

@ApiTags('Production Batches')
@ApiBearerAuth()
@Controller({ version: '1' })
export class ProductionBatchesController {
  constructor(private readonly productionBatchesService: ProductionBatchesService) {}

  // ─── Tổ Hàn/Sơn (mfgRole = HAN|SON) - báo sản lượng ──────────────────────────

  @Post('production-orders/:id/production-batches')
  @RequirePermissions(CREATE)
  @RequireMfgRole(MfgRole.HAN, MfgRole.SON)
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

  @Get('production-batches/:id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.productionBatchesService.findOne(id);
  }
}
