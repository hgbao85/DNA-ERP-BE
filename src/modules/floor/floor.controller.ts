import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import {
  REVERSE_REMOVED_MESSAGE,
  SEND_KCS_REMOVED_MESSAGE,
} from '../../common/constants/legacy-floor-report.constant';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import {
  AddCutAllocationDto,
  AutoCutAllocationDto,
  CutAllocationLogQueryDto,
  CutAllocationQueryDto,
  ReorderCutAllocationDto,
  SplitCutAllocationDto,
  UpdateCutAllocationDto,
} from './dto/cut-allocation.dto';
import { StageProgressQueryDto } from './dto/floor-stage-progress.dto';
import { CutMachineStatsQueryDto } from './dto/cut-machine-stats.dto';
import { FloorStatsQueryDto, MyStatsQueryDto } from './dto/floor-stats.dto';
import { FloorReviewQueryDto, ScanContextQueryDto } from './dto/floor-review.dto';
import {
  KcsCloseMaterialYieldGroupDto,
  KcsClosePieceStepGroupDto,
  KcsCloseStepGroupDto,
} from './dto/kcs-close.dto';
import { MyOutputQueryDto, ScanReceiveSteelDto, ScanReportDto } from './dto/floor-scan.dto';
import { PaintPalletDto } from '../pallets/dto/pallet.dto';
import {
  CreateFloorWorkerDto,
  FLOOR_WORKER_STAGES,
  FloorWorkerStage,
  UpdateFloorWorkerDto,
} from './dto/floor-worker.dto';
import { CreateWorkstationDto, UpdateWorkstationDto } from './dto/workstation.dto';
import { CutAllocationFollowUpService } from './cut-allocation-follow-up.service';
import { CutAllocationService } from './cut-allocation.service';
import { CutMachineStatsService } from './cut-machine-stats.service';
import { FloorAdminService } from './floor-admin.service';
import { FloorReviewService } from './floor-review.service';
import { FloorRealtimeInterceptor } from './floor-realtime.interceptor';
import { FloorScanService } from './floor-scan.service';
import { FloorStageService } from './floor-stage.service';
import { FloorStatsService } from './floor-stats.service';

const perm = (action: PermissionAction) => ({ module: PERMISSION_MODULES.FLOOR_REPORT, action });
const QLSX = BUSINESS_ROLES.PRODUCTION_MANAGER;
const KCS = BUSINESS_ROLES.KCS_STAFF;
/** Route KCS chốt để chấm (P1): quyền QC_REVIEW:CREATE (cùng quyền chấm), không qua perm() vì perm() cố định FLOOR_REPORT. */
const kcsClose = { module: PERMISSION_MODULES.QC_REVIEW, action: PermissionAction.CREATE };

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
 * - `floor/review`: QLSX xem đợt đang mở + KCS (KCS_STAFF) xem để chấm (P1, 18/11/2026: KCS tự chốt). Câu 10 (25/11/2026): KCS
 *   gắn xưởng chỉ thấy đợt xưởng mình; chưa gắn xưởng thấy hết.
 * - `floor/kcs/.../close`: KCS chốt đợt công nhân vừa báo để chấm - QC_REVIEW:CREATE + @RequireRole(KCS_STAFF).
 * - còn lại: QLSX - thêm @RequireRole(PRODUCTION_MANAGER) như floor-start, để BOSS (VIEW+APPROVE mọi module)
 *   không tự thao tác được. 3 route `send-kcs` cũ của QLSX giữ nguyên decorator, trả 403 (KCS tự chấm).
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
    private readonly cutAllocation: CutAllocationService,
    private readonly cutFollowUp: CutAllocationFollowUpService,
    private readonly cutMachineStats: CutMachineStatsService,
    private readonly stageService: FloorStageService,
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

  /** Pallet Sơn (24/11/2026): công nhân Sơn quét tem pallet (`/floor?pallet=<token>`) - xem pallet, lệnh, mảnh, số. */
  @Get('pallets/:palletToken')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireMfgRole(MfgRole.SON)
  palletView(@Param('palletToken') palletToken: string, @CurrentUser() user: AuthenticatedUser) {
    return this.scan.palletView(palletToken, user);
  }

  /** "Sơn xong pallet này" / "Báo thiếu" - báo qua điểm sơn `:token` (máy quét gần nhất). Idempotency-Key bắt buộc. */
  @Post('scan/:token/pallets/:palletToken/paint')
  @RequirePermissions(perm(PermissionAction.CREATE))
  @RequireMfgRole(MfgRole.SON)
  paintPallet(
    @Param('token') token: string,
    @Param('palletToken') palletToken: string,
    @Body() dto: PaintPalletDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.scan.paintPallet(token, palletToken, user, dto, idempotencyKey);
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
  stats(@Query() query: FloorStatsQueryDto, @CurrentUser('id') userId: string) {
    return this.statsService.getStats(query, userId);
  }

  /**
   * Đo năng suất máy cắt (đợt C4a, 14/11/2026): số đo từ giờ công nhân báo qua QR ở máy cắt, để IT
   * gửi Sếp chốt luật nửa ca. Chỉ ĐỌC;
   * cùng quyền với `stats`, xưởng theo tài khoản (người không gắn xưởng phải truyền workshopId).
   */
  @Get('stats/cut-machines')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX, BUSINESS_ROLES.BOSS, DEFAULT_ROLES.ADMIN)
  cutMachineStatsReport(
    @Query() query: CutMachineStatsQueryDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.cutMachineStats.getStats(userId, query);
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
  summary(@CurrentUser('id') userId: string) {
    return this.admin.summary(userId);
  }

  // ─── QLSX: xem địa chỉ ERP dùng cho tem (Admin đặt ở Cấu hình hệ thống) ───────

  @Get('settings')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX, DEFAULT_ROLES.ADMIN)
  getSettings() {
    return this.admin.getSettings();
  }

  // ─── QLSX: điểm làm việc + mã QR ────────────────────────────────────────────

  @Get('workstations')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX, DEFAULT_ROLES.ADMIN)
  listWorkstations(@CurrentUser('id') userId: string) {
    return this.admin.listWorkstations(userId);
  }

  @Post('workstations')
  @RequirePermissions(perm(PermissionAction.CREATE))
  @RequireRole(QLSX, DEFAULT_ROLES.ADMIN)
  createWorkstation(@Body() dto: CreateWorkstationDto, @CurrentUser('id') userId: string) {
    return this.admin.createWorkstation(dto, userId);
  }

  @Patch('workstations/:id')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX, DEFAULT_ROLES.ADMIN)
  updateWorkstation(
    @Param('id') id: string,
    @Body() dto: UpdateWorkstationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.admin.updateWorkstation(id, dto, userId);
  }

  @Post('workstations/:id/regenerate-token')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX, DEFAULT_ROLES.ADMIN)
  regenerateToken(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.admin.regenerateWorkstationToken(id, userId);
  }

  // ─── QLSX: tài khoản công nhân ──────────────────────────────────────────────

  @Get('workers')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX)
  listWorkers(@CurrentUser('id') userId: string) {
    return this.admin.listWorkers(userId);
  }

  @Post('workers')
  @RequirePermissions(perm(PermissionAction.CREATE))
  @RequireRole(QLSX)
  createWorker(@Body() dto: CreateFloorWorkerDto, @CurrentUser('id') userId: string) {
    return this.admin.createWorker(dto, userId);
  }

  @Patch('workers/:id')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  updateWorker(
    @Param('id') id: string,
    @Body() dto: UpdateFloorWorkerDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.admin.updateWorker(id, dto, userId);
  }

  @Post('workers/:id/reset-pin')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  resetWorkerPin(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.admin.resetWorkerPin(id, userId);
  }

  @Post('workers/:id/unlock')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  unlockWorker(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.admin.unlockWorker(id, userId);
  }

  // ─── Sản lượng theo lệnh của tổ (23/11/2026, thay hàng đợi xưởng) ───────────────
  // Quyền: FLOOR_REPORT VIEW; vai (QLSX / BOSS / ADMIN, hoặc tài khoản tổ chỉ xem tổ mình) kiểm trong FloorStageService vì
  // @RequireRole và @RequireMfgRole cộng dồn (AND), không diễn đạt được "hoặc".

  @Get('stage-progress')
  @RequirePermissions(perm(PermissionAction.VIEW))
  stageProgress(@Query() query: StageProgressQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.stageService.listProgress(
      user,
      query.stage,
      query.workshopId,
      undefined,
      query.productionInvoiceIds,
    );
  }

  /** Ngăn "còn thiếu gì" của 1 lệnh: thân y hệt GET /floor/queue/:stage/detail/:pi cũ (FloorAdminService.stageDetail). */
  @Get('stage-progress/:stage/:productionInvoiceId')
  @RequirePermissions(perm(PermissionAction.VIEW))
  stageProgressDetail(
    @Param('stage') stage: string,
    @Param('productionInvoiceId') productionInvoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stageService.detail(user, parseStage(stage), productionInvoiceId);
  }

  // ─── QLSX: chia máy cắt (đợt B1, 13/11/2026) ────────────────────────────────
  // Chỉ là bảng kế hoạch - không đổi luồng quét QR / hàng đợi tổ. Xưởng lấy theo tài khoản
  // (WorkshopScopeService).

  @Get('cut-allocation')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX)
  cutAllocationBoard(@Query() query: CutAllocationQueryDto, @CurrentUser('id') userId: string) {
    return this.cutAllocation.getBoard(userId, query.workshopId);
  }

  /**
   * Nhật ký điều chuyển (Sếp chốt 14/11, câu 6 + 10): cùng quyền và phạm vi xưởng với bảng; mặc
   * định 30 ngày gần nhất.
   */
  @Get('cut-allocation/log')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX)
  cutAllocationLog(@Query() query: CutAllocationLogQueryDto, @CurrentUser('id') userId: string) {
    return this.cutAllocation.getLog(userId, query);
  }

  @Post('cut-allocation/auto')
  @RequirePermissions(perm(PermissionAction.CREATE))
  @RequireRole(QLSX)
  async cutAllocationAuto(@Body() dto: AutoCutAllocationDto, @CurrentUser('id') userId: string) {
    const { board, allocated } = await this.cutAllocation.auto(userId, dto);
    await this.cutFollowUp.afterAllocated({
      workshopId: board.workshop.id,
      orders: allocated,
      source: 'MANUAL',
    });
    return board;
  }

  @Post('cut-allocation/add')
  @RequirePermissions(perm(PermissionAction.CREATE))
  @RequireRole(QLSX)
  async cutAllocationAdd(@Body() dto: AddCutAllocationDto, @CurrentUser('id') userId: string) {
    const { board, allocated } = await this.cutAllocation.add(userId, dto);
    await this.cutFollowUp.afterAllocated({
      workshopId: board.workshop.id,
      orders: allocated,
      source: 'MANUAL',
    });
    return board;
  }

  @Post('cut-allocation/reorder')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  cutAllocationReorder(@Body() dto: ReorderCutAllocationDto, @CurrentUser('id') userId: string) {
    return this.cutAllocation.reorder(userId, dto);
  }

  @Patch('cut-allocation/:id')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  cutAllocationUpdate(
    @Param('id') id: string,
    @Body() dto: UpdateCutAllocationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.cutAllocation.update(userId, id, dto);
  }

  @Post('cut-allocation/:id/split')
  @RequirePermissions(perm(PermissionAction.CREATE))
  @RequireRole(QLSX)
  cutAllocationSplit(
    @Param('id') id: string,
    @Body() dto: SplitCutAllocationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.cutAllocation.split(userId, id, dto);
  }

  @Delete('cut-allocation/:id')
  @RequirePermissions(perm(PermissionAction.DELETE))
  @RequireRole(QLSX)
  cutAllocationRemove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.cutAllocation.remove(userId, id);
  }

  // ─── QLSX + KCS: xem đợt đang mở; KCS chốt để chấm; QLSX xem ───────────

  /**
   * Lọc theo xưởng của tài khoản: QLSX như cũ; câu 10 (chốt 25/11/2026) KCS Hàn / Sơn mỗi xưởng 1 người, chỉ thấy đợt xưởng mình
   * (Admin gắn xưởng cho tài khoản KCS). Tài khoản chưa gắn xưởng thấy hết như trước.
   */
  @Get('review')
  @RequirePermissions(perm(PermissionAction.VIEW))
  @RequireRole(QLSX, KCS)
  listOpen(@Query() query: FloorReviewQueryDto, @CurrentUser('id') userId: string) {
    return this.review.listOpen(query.stage, query.productionInvoiceId, userId, true);
  }

  /** 3 route gửi KCS cũ: KCS tự chấm nên không còn bước gửi - giữ route để bản FE cũ nhận câu rõ ràng thay vì 404. */
  @Post('review/cut-bundles/:id/send-kcs')
  @RequirePermissions(perm(PermissionAction.APPROVE))
  @RequireRole(QLSX)
  sendCutBundle(): never {
    throw new ForbiddenException(SEND_KCS_REMOVED_MESSAGE);
  }

  @Post('review/production-batches/:id/send-kcs')
  @RequirePermissions(perm(PermissionAction.APPROVE))
  @RequireRole(QLSX)
  sendProductionBatch(): never {
    throw new ForbiddenException(SEND_KCS_REMOVED_MESSAGE);
  }

  @Post('review/step-groups/send-kcs')
  @RequirePermissions(perm(PermissionAction.APPROVE))
  @RequireRole(QLSX)
  sendStepGroup(): never {
    throw new ForbiddenException(SEND_KCS_REMOVED_MESSAGE);
  }

  @Post('kcs/cut-bundles/:id/close')
  @RequirePermissions(kcsClose)
  @RequireRole(KCS)
  closeCutBundle(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.review.closeCutBundle(id, userId);
  }

  @Post('kcs/step-groups/close')
  @RequirePermissions(kcsClose)
  @RequireRole(KCS)
  closeStepGroup(@Body() dto: KcsCloseStepGroupDto, @CurrentUser('id') userId: string) {
    return this.review.closeStepGroup(dto, userId);
  }

  @Post('kcs/production-batches/:id/close')
  @RequirePermissions(kcsClose)
  @RequireRole(KCS)
  closeProductionBatch(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.review.closeProductionBatch(id, userId);
  }

  @Post('kcs/piece-step-groups/close')
  @RequirePermissions(kcsClose)
  @RequireRole(KCS)
  closePieceStepGroup(@Body() dto: KcsClosePieceStepGroupDto, @CurrentUser('id') userId: string) {
    return this.review.closePieceStepGroup(dto, userId);
  }

  @Post('kcs/material-yield-groups/close')
  @RequirePermissions(kcsClose)
  @RequireRole(KCS)
  closeMaterialYieldGroup(
    @Body() dto: KcsCloseMaterialYieldGroupDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.review.closeMaterialYieldGroup(dto, userId);
  }

  /** QLSX không còn hủy lần báo (23/11/2026): sai số thì KCS sửa bằng "Thực có" lúc chấm. Giữ route (theo mẫu send-kcs) để FE cũ nhận câu rõ thay vì 404. */
  @Post('reports/:id/reverse')
  @RequirePermissions(perm(PermissionAction.UPDATE))
  @RequireRole(QLSX)
  reverse(): never {
    throw new ForbiddenException(REVERSE_REMOVED_MESSAGE);
  }
}
