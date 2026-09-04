import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreatePieceStepBatchDto } from './dto/create-piece-step-batch.dto';
import { CreateProductionBatchDto } from './dto/create-production-batch.dto';
import { ListProductionBatchesQueryDto } from './dto/list-production-batches-query.dto';
import { ProductionBatchPlanBatchQueryDto } from './dto/production-batch-plan-batch-query.dto';
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
    @CurrentUser('warehouseScope') warehouseScope: string | null,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    return this.productionBatchesService.create(
      id,
      dto,
      userId,
      mfgRole,
      warehouseScope,
      idempotencyKey,
    );
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

  /**
   * Gộp nhiều ProductionOrder 1 lần, cùng stage - "Bảng thống kê" (ThongKePagePlan.tsx).
   *
   * Path 1 segment 'production-batch-plan-batch' ĐÃ TỪNG đụng 'production-orders/:id'
   * (ProductionOrdersController.findOne) - Nest khớp theo thứ tự đăng ký module, không ưu tiên
   * route tĩnh, :id nuốt mất chuỗi làm id → 400 (phát hiện qua browser thật 2026-08-31). Đổi sang
   * 2 segment 'production-batch-plan/batch' - segment 2 'batch' không trùng literal segment-2 nào
   * sau ':id/' đã có (vd 'production-batch-plan' của getBatchPlan) nên hết khớp nhầm.
   *
   * Dùng DTO riêng (ProductionBatchPlanBatchQueryDto, có khai `ids`) thay vì
   * @Query('ids') rời + @Query() ProductionBatchPlanQueryDto (chỉ khai `stage`) - global
   * ValidationPipe forbidNonWhitelisted:true (main.ts) chặn 400 field `ids` "lạ" dù có
   * @Query('ids') riêng đọc đúng, vì cả 2 decorator cùng validate chung 1 req.query (phát hiện
   * qua browser thật 2026-08-31, endpoint duy nhất trong 5 batch mới trộn kiểu này nên chỉ nó lỗi).
   */
  @Get('production-orders/production-batch-plan/batch')
  @RequirePermissions(VIEW)
  getBatchPlanBatch(@Query() query: ProductionBatchPlanBatchQueryDto) {
    const ids = query.ids
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    return this.productionBatchesService.getBatchPlanBatch(ids, query.stage);
  }

  /**
   * Phôi báo "vừa {step} xong N mảnh" cho vật tư thành phẩm (PieceMaterialYield.processSteps) -
   * trước khi chốt lô thật qua POST .../production-batches. Dùng chung permission
   * PRODUCTION_BATCH:CREATE (PHOI_STAFF đã có, xem role-permissions.constant.ts) - đây là 1 hình
   * thức khác của "Phôi báo tiến độ", không phải quyền mới. Idempotency-Key bắt buộc, cùng tiền lệ
   * SteelIssuesController.create() (vấn đề #11 audit 26/08).
   *
   * Đặt route TRÊN @Get('production-batches/:id') - controller này đã 2 lần dính bẫy Nest khớp
   * nhầm route tĩnh vào :id (xem comment getBatchPlanBatch() ở trên); path 2 segment cố định
   * 'production-orders/:id/piece-step-batches' không trùng bất kỳ segment-2 nào khác nên an toàn,
   * nhưng để tuân thủ tiền lệ vẫn khai trước route có :id.
   */
  @Post('production-orders/:id/piece-step-batches')
  @RequirePermissions(CREATE)
  @RequireMfgRole(MfgRole.PHOI)
  recordPieceStepBatch(
    @Param('id') id: string,
    @Body() dto: CreatePieceStepBatchDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('mfgRole') mfgRole: string | null,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    }
    return this.productionBatchesService.recordPieceStepBatch(
      id,
      dto,
      userId,
      mfgRole,
      idempotencyKey,
    );
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
