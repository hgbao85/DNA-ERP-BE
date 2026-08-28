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
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreatePackagingIssueDto } from './dto/create-packaging-issue.dto';
import { PackagingIssuesService } from './packaging-issues.service';

const VIEW = { module: PERMISSION_MODULES.PACKAGING_ISSUE, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.PACKAGING_ISSUE, action: PermissionAction.CREATE };

@ApiTags('Packaging Issues')
@ApiBearerAuth()
@Controller({ version: '1' })
export class PackagingIssuesController {
  constructor(private readonly packagingIssuesService: PackagingIssuesService) {}

  // ─── Thủ kho vật tư-TP - xuất vật tư đóng gói cho kho thành phẩm ────────────

  @Post('production-orders/:id/packaging-issues')
  @RequirePermissions(CREATE)
  create(
    @Param('id') id: string,
    @Body() dto: CreatePackagingIssueDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    // Vấn đề #11 audit 26/08 - trước đây header này chỉ tuỳ chọn dù service đã hỗ trợ dedupe theo
    // key, nên 1 request gửi lặp (mất mạng rồi gửi lại...) mà thiếu header vẫn tạo 2 bản ghi riêng
    // biệt. FE đã gửi kèm ở mọi lần gọi thật (xem withIdempotencyKey() trong packaging-issues-api.ts).
    if (!idempotencyKey) {
      throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    }
    return this.packagingIssuesService.create(id, dto, userId, warehouseScope, idempotencyKey);
  }

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
