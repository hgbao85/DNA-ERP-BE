import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import {
  CreateOpeningWaitingDto,
  CreateStageHandoverOverrideDto,
  ListStageHandoverOverridesQueryDto,
  StageHandoverBoardQueryDto,
  StageHandoverPlanQueryDto,
} from './dto/stage-handover.dto';
import { StageHandoverService } from './stage-handover.service';

// Thủ kho: cùng quyền phiếu xuất XK (MATERIAL_ISSUE). QLSX: cùng quyền Sổ báo vượt đoạn (PRODUCTION_BATCH VIEW + vai QLSX / Admin).
const SLIP_VIEW = { module: PERMISSION_MODULES.MATERIAL_ISSUE, action: PermissionAction.VIEW };
const SLIP_CREATE = { module: PERMISSION_MODULES.MATERIAL_ISSUE, action: PermissionAction.CREATE };
const BATCH_VIEW = { module: PERMISSION_MODULES.PRODUCTION_BATCH, action: PermissionAction.VIEW };

/** Giao nhận giữa tổ (24/11/2026) - màn kho (giao đoạn / giao mảnh) và màn QLSX (theo dõi, mở chặn). */
@ApiTags('Stage Handover')
@ApiBearerAuth()
@Controller({ path: 'stage-handover', version: '1' })
export class StageHandoverController {
  constructor(private readonly service: StageHandoverService) {}

  /** Kế hoạch giao của kho đang làm (kho Phôi giao đoạn, kho Hàn giao mảnh cho Sơn). */
  @Get('plan')
  @RequirePermissions(SLIP_VIEW)
  plan(
    @Query() query: StageHandoverPlanQueryDto,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.getPlan(query, scope);
  }

  /** Bảng theo dõi của QLSX. */
  @Get('board')
  @RequirePermissions(BATCH_VIEW)
  board(@Query() query: StageHandoverBoardQueryDto) {
    return this.service.getBoard(query.productionInvoiceId);
  }

  @Get('overrides')
  @RequirePermissions(BATCH_VIEW)
  listOverrides(@Query() query: ListStageHandoverOverridesQueryDto) {
    return this.service.listOverrides(query.productionInvoiceId);
  }

  /** QLSX mở chặn có lý do - chỉ nâng trần theo hàng đã nhận, không nâng trần kế hoạch. */
  @Post('overrides')
  @HttpCode(201)
  @RequirePermissions(BATCH_VIEW)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_MANAGER, DEFAULT_ROLES.ADMIN)
  createOverride(@Body() dto: CreateStageHandoverOverrideDto, @CurrentUser('id') userId: string) {
    return this.service.createOverride(dto, userId);
  }

  // ─── Đầu kỳ ngày bật (câu 2, chốt 28/11/2026 cách 1) ───────────────────────────────────────

  /** Đã ghi đầu kỳ chưa (QLSX + thủ kho xem). */
  @Get('opening')
  @RequirePermissions(BATCH_VIEW)
  opening() {
    return this.service.getOpening();
  }

  /** Thủ kho Hàn: các SKU, mảnh của xưởng cần nhập khung chờ Sơn đầu kỳ (kèm gợi ý). */
  @Get('opening/waiting-plan')
  @RequirePermissions(SLIP_VIEW)
  openingWaitingPlan(
    @Query('warehouseCode') warehouseCode: string | undefined,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.getOpeningWaitingPlan(scope, warehouseCode);
  }

  /** QLSX bấm 1 lần ngay sau khi bật: số đã báo Hàn / Sơn trước ngày bật thành "đã nhận đầu kỳ". */
  @Post('opening/done')
  @HttpCode(201)
  @RequirePermissions(BATCH_VIEW)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_MANAGER, DEFAULT_ROLES.ADMIN)
  openingDone(@CurrentUser('id') userId: string) {
    return this.service.createOpeningDone(userId);
  }

  /** Thủ kho Hàn (xưởng có kho Sơn) nhập khung Hàn đạt đang chờ ở tổ Sơn - mỗi SKU, mảnh 1 lần. */
  @Post('opening/waiting')
  @HttpCode(201)
  @RequirePermissions(SLIP_CREATE)
  openingWaiting(@Body() dto: CreateOpeningWaitingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createOpeningWaiting(dto, {
      id: user.id,
      roles: user.roles,
      warehouseScope: user.warehouseScope,
    });
  }
}
