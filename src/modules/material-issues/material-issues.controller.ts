import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ListMaterialIssuesQueryDto } from './dto/list-material-issues-query.dto';
import { ReceiveMaterialIssueDto } from './dto/receive-material-issue.dto';
import { MaterialIssuesService } from './material-issues.service';

const VIEW = { module: PERMISSION_MODULES.MATERIAL_ISSUE, action: PermissionAction.VIEW };
const UPDATE = { module: PERMISSION_MODULES.MATERIAL_ISSUE, action: PermissionAction.UPDATE };

@ApiTags('Material Issues')
@ApiBearerAuth()
@Controller({ version: '1' })
export class MaterialIssuesController {
  constructor(private readonly materialIssuesService: MaterialIssuesService) {}

  // ─── Thủ kho vật tư-TP - xuất vật tư tiêu hao cho Hàn/Sơn ───────────────────

  // Route xuất từng dòng (không ảnh chứng từ) ĐÃ GỠ ở Đợt 6 (2026-11-06, bản v8 YC4, V4-1 khoá cứng): xuất kho chỉ qua phiếu
  // xuất XK nhiều dòng - POST /issue-slips (tạo, cấp số, in) rồi POST /issue-slips/:id/confirm kèm ảnh phiếu đã ký. Lõi
  // ghi vẫn ở service này (prepareIssue / createInTx / afterCreate).

  @Get('production-orders/:id/material-issues')
  @RequirePermissions(VIEW)
  findAllForOrder(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.materialIssuesService.findAllForOrder(id, query);
  }

  @Get('production-orders/:id/material-issue-plan')
  @RequirePermissions(VIEW)
  getIssuePlan(@Param('id') id: string) {
    return this.materialIssuesService.getIssuePlan(id);
  }

  @Get('material-issues/:id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.materialIssuesService.findOne(id);
  }

  // ─── Tổ Hàn/Sơn (mfgRole = HAN|SON) - xem đợt chờ/đã nhận + xác nhận đã nhận ─

  /** Flat, không cần biết productionOrderId - xem ListMaterialIssuesQueryDto. */
  @Get('material-issues')
  @RequirePermissions(VIEW)
  findAll(@Query() query: ListMaterialIssuesQueryDto) {
    return this.materialIssuesService.findAll(query);
  }

  @Post('material-issues/:id/receive')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.HAN, MfgRole.SON)
  receive(
    @Param('id') id: string,
    @Body() dto: ReceiveMaterialIssueDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('mfgRole') mfgRole: string | null,
  ) {
    return this.materialIssuesService.receive(id, dto, userId, mfgRole);
  }
}
