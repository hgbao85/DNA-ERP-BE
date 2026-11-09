import { BadRequestException, Body, Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PackagingIssuesService } from './packaging-issues.service';

const VIEW = { module: PERMISSION_MODULES.PACKAGING_ISSUE, action: PermissionAction.VIEW };

@ApiTags('Packaging Issues')
@ApiBearerAuth()
@Controller({ version: '1' })
export class PackagingIssuesController {
  constructor(private readonly packagingIssuesService: PackagingIssuesService) {}

  // ─── Thủ kho vật tư-TP - xuất vật tư đóng gói cho kho thành phẩm ────────────

  // POST xuất thẳng (trừ tồn ngay, không phiếu) ĐÃ GỠ 09/11/2026 - xuất đi phiếu XK có ảnh ký (IssueSlipsService, dòng PACKAGING).

  /** Gộp nhiều PO 1 lần - WarehouseXuatPage liệt kê mọi PO đang hoạt động cùng lúc, cùng mẫu
   *  GET /warehouse-transfers/piece-transfer-plan. */
  @Get('packaging-issues/plan')
  @RequirePermissions(VIEW)
  getBulkPlan(@Query('productionOrderIds') productionOrderIds?: string) {
    if (!productionOrderIds) {
      throw new BadRequestException(
        'Query productionOrderIds là bắt buộc (phân tách bởi dấu phẩy)',
      );
    }
    const ids = productionOrderIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    return this.packagingIssuesService.getBulkPlan(ids);
  }
}
