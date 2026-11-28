import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CkDgQrService } from './ck-dg-qr.service';
import {
  AddKcsDefectReasonDto,
  CancelPackingReportDto,
  CkDgScanQueryDto,
  GradeTransferCheckBatchDto,
  ListPackingReportsQueryDto,
  ListTransferCheckBatchesQueryDto,
  ReportPackingDto,
  ReportTransferCheckBatchDto,
} from './dto/ck-dg-qr.dto';

const floor = (action: PermissionAction) => ({ module: PERMISSION_MODULES.FLOOR_REPORT, action });
// Kho Thành phẩm: cùng quyền màn Chuyền kiểm / Đóng gói đang dùng (PRODUCTION_INVOICE VIEW để xem, UPDATE để ghi).
const PI_VIEW = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.VIEW };
const PI_UPDATE = {
  module: PERMISSION_MODULES.PRODUCTION_INVOICE,
  action: PermissionAction.UPDATE,
};

/**
 * Chuyền kiểm + Đóng gói bằng quét QR (24/11/2026, docs THIET-KE-CHUYEN-KIEM-DONG-GOI-QR, công tắc CK_DG_QR_ENABLED).
 * - `ck-dg/scan/*`: công nhân tổ CHUYEN_KIEM / DONG_GOI (tài khoản PIN, FLOOR_REPORT) quét tem điểm ở màn /floor.
 * - `ck-dg/kcs/*`: KCS chuyền kiểm (mfgRole KCS_CHUYEN_KIEM, tài khoản PIN QLSX tạo ở "Máy & tem QR") chấm đợt.
 * - `ck-dg/transfer-check/batches`, `ck-dg/packing/*`: kho Thành phẩm theo dõi / đối chiếu, huỷ lần báo đóng gói sai.
 */
@ApiTags('Chuyền kiểm / Đóng gói (QR)')
@ApiBearerAuth()
@Controller({ path: 'ck-dg', version: '1' })
export class CkDgQrController {
  constructor(private readonly service: CkDgQrService) {}

  /** Công tắc cho FE (mọi tài khoản đăng nhập). */
  @Get('config')
  config() {
    return this.service.getConfig();
  }

  // ─── Công nhân ───────────────────────────────────────────────────────────────────────────

  @Get('scan/:token')
  @RequirePermissions(floor(PermissionAction.VIEW))
  @RequireMfgRole(MfgRole.CHUYEN_KIEM, MfgRole.DONG_GOI)
  scan(
    @Param('token') token: string,
    @Query() query: CkDgScanQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.scanContext(token, user, query.itemId);
  }

  @Post('scan/:token/transfer-check')
  @RequirePermissions(floor(PermissionAction.CREATE))
  @RequireMfgRole(MfgRole.CHUYEN_KIEM)
  reportTransferCheck(
    @Param('token') token: string,
    @Body() dto: ReportTransferCheckBatchDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.service.reportTransferCheck(token, user, dto, idempotencyKey);
  }

  @Post('scan/:token/packing')
  @RequirePermissions(floor(PermissionAction.CREATE))
  @RequireMfgRole(MfgRole.DONG_GOI)
  reportPacking(
    @Param('token') token: string,
    @Body() dto: ReportPackingDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.service.reportPacking(token, user, dto, idempotencyKey);
  }

  // ─── KCS chuyền kiểm ─────────────────────────────────────────────────────────────────────

  @Get('kcs/batches')
  @RequirePermissions(floor(PermissionAction.VIEW))
  @RequireMfgRole(MfgRole.KCS_CHUYEN_KIEM)
  async kcsBatches(@Query() query: ListTransferCheckBatchesQueryDto) {
    const list = await this.service.listBatches({
      ...query,
      status: query.status ?? 'AWAITING_KCS',
    });
    // Tài khoản PIN không có quyền DEFECT_REASON - gửi kèm danh mục nguyên nhân để KCS chọn khi chấm lỗi thêm.
    return { ...list, defectReasons: list.enabled ? await this.service.listDefectReasons() : [] };
  }

  @Post('kcs/batches/:id/grade')
  @RequirePermissions(floor(PermissionAction.CREATE))
  @RequireMfgRole(MfgRole.KCS_CHUYEN_KIEM)
  grade(
    @Param('id') id: string,
    @Body() dto: GradeTransferCheckBatchDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.gradeBatch(id, dto, userId);
  }

  /** Câu 10 (25/11/2026): KCS chuyền kiểm tự thêm nguyên nhân lỗi khi chấm. */
  @Post('kcs/defect-reasons')
  @RequirePermissions(floor(PermissionAction.CREATE))
  @RequireMfgRole(MfgRole.KCS_CHUYEN_KIEM)
  addDefectReason(@Body() dto: AddKcsDefectReasonDto) {
    return this.service.addDefectReason(dto.label);
  }

  // ─── Kho Thành phẩm ──────────────────────────────────────────────────────────────────────

  @Get('transfer-check/batches')
  @RequirePermissions(PI_VIEW)
  transferCheckBatches(@Query() query: ListTransferCheckBatchesQueryDto) {
    return this.service.listBatches(query);
  }

  @Get('packing/reports')
  @RequirePermissions(PI_VIEW)
  packingReports(@Query() query: ListPackingReportsQueryDto) {
    return this.service.listPackingReports(query);
  }

  @Post('packing/reports/:id/cancel')
  @RequirePermissions(PI_UPDATE)
  cancelPacking(
    @Param('id') id: string,
    @Body() dto: CancelPackingReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.cancelPackingReport(id, dto, {
      id: user.id,
      warehouseScope: user.warehouseScope,
    });
  }
}
