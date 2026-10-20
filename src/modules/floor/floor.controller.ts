import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { EnqueuePiDto, ReorderQueueDto } from './dto/floor-queue.dto';
import { FloorStatsQueryDto, MyStatsQueryDto } from './dto/floor-stats.dto';
import {
  FloorQueueQueryDto,
  FloorReviewQueryDto,
  ScanContextQueryDto,
  SendStepGroupDto,
} from './dto/floor-review.dto';
import {
  MyOutputQueryDto,
  ReverseFloorReportDto,
  ScanReceiveSteelDto,
  ScanReportDto,
} from './dto/floor-scan.dto';
import {
  CreateFloorWorkerDto,
  FLOOR_WORKER_STAGES,
  FloorWorkerStage,
  UpdateFloorWorkerDto,
} from './dto/floor-worker.dto';
import { CreateWorkstationDto, UpdateWorkstationDto } from './dto/workstation.dto';
import { FloorAdminService } from './floor-admin.service';
import { FloorReviewService } from './floor-review.service';
import { FloorRealtimeInterceptor } from './floor-realtime.interceptor';
import { FloorScanService } from './floor-scan.service';
import { FloorStatsService } from './floor-stats.service';

const perm = (action: PermissionAction) => ({ module: PERMISSION_MODULES.FLOOR_REPORT, action });
const QLSX = BUSINESS_ROLES.PRODUCTION_MANAGER;

function parseStage(raw: string): FloorWorkerStage {
  if (!(FLOOR_WORKER_STAGES as readonly string[]).includes(raw)) {
    throw new BadRequestException(`Tổ không hợp lệ: ${raw} (PHOI/HAN/SON)`);
  }
  return raw as FloorWorkerStage;
}

/**
 * QR tại máy (2026-10-13, changelog-2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md mục 22).
 * - `floor/scan/*`, `floor/my-output`: công nhân (FLOOR_WORKER hoặc tài khoản thống kê của tổ) - FLOOR_REPORT
 *   VIEW/CREATE.
 * - còn lại: QLSX - thêm @RequireRole(PRODUCTION_MANAGER) như floor-start, để BOSS (VIEW+APPROVE mọi module)
 *   không tự gửi KCS / xếp hàng đợi được.
 */
@ApiTags('Floor (QR tại máy)')
@ApiBearerAuth()
@Controller({ path: 'floor', version: '1' })
@UseInterceptors(FloorRealtimeInterceptor)
export class FloorController {
  constructor(
    private readonly admin: FloorAdminService,
    private readonly scan: FloorScanService,
    private readonly review: FloorReviewService,
    private readonly statsService: FloorStatsService,
  ) {}

  // ─── Công nhân: quét mã tại máy ──────────────────────────────────────────────

  @Get('scan/:token')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireMfgRole(MfgRole.PHOI, MfgRole.HAN, MfgRole.SON)
  scanContext(
    @Param('token') token: string,
    @Query() query: ScanContextQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scan.getContext(token, user, query.productionInvoiceId);
  }

  @Post('scan/:token/reports')
  @RequirePermissions(perm(PermissionAction.CREATE))
  @RequireMfgRole(MfgRole.PHOI, MfgRole.HAN, MfgRole.SON)
  scanReport(
    @Param('token') token: string,
    @Body() dto: ScanReportDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.scan.report(token, user, dto, idempotencyKey);
  }

  @Post('scan/:token/steel-issues/:id/receive')
  @RequirePermissions(perm(PermissionAction.CREATE))
  @RequireMfgRole(MfgRole.PHOI)
  scanReceiveSteel(
    @Param('token') token: string,
    @Param('id') id: string,
    @Body() dto: ScanReceiveSteelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scan.receiveSteel(token, user, id, dto.receivedBarCount);
  }

  /** "Sản lượng của tôi" - số mình đã báo + trạng thái đợt + lần bị đảo. */
  @Get('my-output')
  @RequirePermissions(perm(PermissionAction.VIEW))
  myOutput(@Query() query: MyOutputQueryDto, @CurrentUser('id') userId: string) {
    return this.scan.myOutput(userId, query.from, query.to);
  }

  /**
   * "Báo cáo sản lượng đạt KCS" (2026-10-15): số đạt/lỗi KCS đã chốt theo ngày/tháng/năm. Chỉ ĐỌC nên ngoài QLSX còn cho
   * Giám đốc (BOSS) và ADMIN xem; công nhân không gọi được (không có RequireRole nào của họ).
   */
  @Get('stats')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX, BUSINESS_ROLES.BOSS, DEFAULT_ROLES.ADMIN)
  stats(@Query() query: FloorStatsQueryDto) {
    return this.statsService.getStats(query);
  }

  /**
   * Số ĐÃ KCS duyệt của CHÍNH người đăng nhập (công nhân xem "Sản lượng của tôi"). Không có tham số công nhân nào - id lấy
   * từ token, nên công nhân A không xem được số của công nhân B; toàn xưởng + từng người là `stats` (QLSX/BOSS/ADMIN).
   */
  @Get('my-stats')
  @RequirePermissions(perm(PermissionAction.VIEW))
  myStats(@Query() query: MyStatsQueryDto, @CurrentUser('id') userId: string) {
    return this.statsService.getMyStats(userId, query);
  }

  /** Số đợt chờ gửi KCS theo tổ - chấm số trên menu QLSX. */
  @Get('summary')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX)
  summary() {
    return this.admin.summary();
  }

  // ─── QLSX: xem địa chỉ ERP dùng cho tem (Admin đặt ở Cấu hình hệ thống) ───────

  @Get('settings')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX)
  getSettings() {
    return this.admin.getSettings();
  }

  // ─── QLSX: điểm làm việc + mã QR ────────────────────────────────────────────

  @Get('workstations')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX)
  listWorkstations() {
    return this.admin.listWorkstations();
  }

  @Post('workstations')
  @RequirePermissions(perm(PermissionAction.CREATE))
  @RequireRole(QLSX)
  createWorkstation(@Body() dto: CreateWorkstationDto) {
    return this.admin.createWorkstation(dto);
  }

  @Patch('workstations/:id')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  updateWorkstation(@Param('id') id: string, @Body() dto: UpdateWorkstationDto) {
    return this.admin.updateWorkstation(id, dto);
  }

  @Post('workstations/:id/regenerate-token')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  regenerateToken(@Param('id') id: string) {
    return this.admin.regenerateWorkstationToken(id);
  }

  // ─── QLSX: tài khoản công nhân ──────────────────────────────────────────────

  @Get('workers')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX)
  listWorkers() {
    return this.admin.listWorkers();
  }

  @Post('workers')
  @RequirePermissions(perm(PermissionAction.CREATE))
  @RequireRole(QLSX)
  createWorker(@Body() dto: CreateFloorWorkerDto) {
    return this.admin.createWorker(dto);
  }

  @Patch('workers/:id')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  updateWorker(@Param('id') id: string, @Body() dto: UpdateFloorWorkerDto) {
    return this.admin.updateWorker(id, dto);
  }

  @Post('workers/:id/reset-pin')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  resetWorkerPin(@Param('id') id: string) {
    return this.admin.resetWorkerPin(id);
  }

  @Post('workers/:id/unlock')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  unlockWorker(@Param('id') id: string) {
    return this.admin.unlockWorker(id);
  }

  // ─── QLSX: hàng đợi PI theo tổ ──────────────────────────────────────────────

  @Get('queue')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX)
  listQueue(@Query() query: FloorQueueQueryDto) {
    return this.admin.listQueue(query.stage);
  }

  @Get('queue/candidates')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX)
  queueCandidates(@Query() query: FloorReviewQueryDto) {
    return this.admin.queueCandidates(query.stage);
  }

  @Post('queue')
  @RequirePermissions(perm(PermissionAction.CREATE))
  @RequireRole(QLSX)
  enqueue(@Body() dto: EnqueuePiDto, @CurrentUser('id') userId: string) {
    return this.admin.enqueue(dto.stage, dto.productionInvoiceId, userId);
  }

  @Post('queue/:stage/reorder')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  reorder(@Param('stage') stage: string, @Body() dto: ReorderQueueDto) {
    return this.admin.reorder(parseStage(stage), dto.entryIds);
  }

  /** "Chuyển PI tiếp" (tổ chưa chạy PI nào thì bắt đầu PI đầu hàng). */
  @Post('queue/:stage/advance')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  advance(@Param('stage') stage: string, @CurrentUser('id') userId: string) {
    return this.admin.advance(parseStage(stage), userId);
  }

  /** Hoàn tác "Chuyển PI tiếp" nhầm - chỉ khi PI đang chạy chưa có lần báo nào (xem FloorAdminService.reopenLast). */
  @Post('queue/:stage/reopen')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  reopen(@Param('stage') stage: string) {
    return this.admin.reopenLast(parseStage(stage));
  }

  /** Ngăn "còn thiếu gì" của thẻ PI (mục 45.4): tiến độ tổ + dữ liệu gốc (phoi-progress / batch-plan theo SKU). */
  @Get('queue/:stage/detail/:productionInvoiceId')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX)
  stageDetail(
    @Param('stage') stage: string,
    @Param('productionInvoiceId') productionInvoiceId: string,
  ) {
    return this.admin.stageDetail(parseStage(stage), productionInvoiceId);
  }

  @Delete('queue/:id')
  @RequirePermissions(perm(PermissionAction.DELETE))
  @RequireRole(QLSX)
  removeEntry(@Param('id') id: string) {
    return this.admin.removeEntry(id);
  }

  // ─── QLSX: kiểm + gửi KCS + đảo lần báo ─────────────────────────────────────

  @Get('review')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX)
  listOpen(@Query() query: FloorReviewQueryDto) {
    return this.review.listOpen(query.stage, query.productionInvoiceId);
  }

  @Post('review/cut-bundles/:id/send-kcs')
  @RequirePermissions(perm(PermissionAction.APPROVE))
  @RequireRole(QLSX)
  sendCutBundle(@Param('id') id: string) {
    return this.review.sendCutBundle(id);
  }

  @Post('review/production-batches/:id/send-kcs')
  @RequirePermissions(perm(PermissionAction.APPROVE))
  @RequireRole(QLSX)
  sendProductionBatch(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.review.sendProductionBatch(id, userId);
  }

  @Post('review/step-groups/send-kcs')
  @RequirePermissions(perm(PermissionAction.APPROVE))
  @RequireRole(QLSX)
  sendStepGroup(@Body() dto: SendStepGroupDto, @CurrentUser('id') userId: string) {
    return this.review.sendStepGroup(dto, userId);
  }

  @Post('reports/:id/reverse')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  reverse(
    @Param('id') id: string,
    @Body() dto: ReverseFloorReportDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.review.reverse(id, dto.reason, userId);
  }
}
