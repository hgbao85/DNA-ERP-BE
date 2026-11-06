import { BadRequestException, Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreatePurchaseReceiptDto,
  OverReceiptStatsQueryDto,
  PreviewPurchaseReceiptDto,
  RejectPurchaseReceiptDto,
} from './dto/purchase-receipt.dto';
import { PurchaseReceiptsService } from './purchase-receipts.service';

// Cùng quyền với route nhận hàng cũ - TÁCH khỏi PURCHASE_PROPOSAL:UPDATE (thủ kho không được chạm luồng mua).
const RECEIVE = { module: PERMISSION_MODULES.PURCHASE_RECEIPT, action: PermissionAction.UPDATE };
const VIEW = { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, action: PermissionAction.VIEW };

function requireKey(key: string | undefined): string {
  if (!key) throw new BadRequestException('Header Idempotency-Key là bắt buộc');
  return key;
}

/** Nhận hàng mua theo phiếu (Đợt 5d) - xem PurchaseReceiptsService. */
@ApiTags('Purchase Receipts')
@ApiBearerAuth()
@Controller({ path: 'purchase-receipts', version: '1' })
export class PurchaseReceiptsController {
  constructor(private readonly receipts: PurchaseReceiptsService) {}

  @Get()
  @RequirePermissions(VIEW)
  list(
    @Query('supplierOrderId') supplierOrderId?: string,
    @Query('materialId') materialId?: string,
  ) {
    return this.receipts.list({ supplierOrderId, materialId });
  }

  /** Thống kê nhận vượt (4.12) - theo NCC, vật tư, thủ kho. Cùng quyền xem với Mua hàng. */
  @Get('over-stats')
  @RequirePermissions(VIEW)
  overStats(@Query() query: OverReceiptStatsQueryDto) {
    return this.receipts.overStats(query);
  }

  /** "In phiếu nhập" (Đợt 6): giữ 1 số NK-yymmdd-NNN để in trước khi xác nhận nhập. `reuse` = số đã giữ trước đó (in lại). */
  @Post('slip-code')
  @RequirePermissions(RECEIVE)
  reserveSlipCode(@CurrentUser('id') userId: string, @Body() body: { reuse?: string }) {
    return this.receipts.reserveSlipCode(
      userId,
      typeof body?.reuse === 'string' ? body.reuse : undefined,
    );
  }

  @Post('preview')
  @RequirePermissions(RECEIVE)
  preview(
    @Body() dto: PreviewPurchaseReceiptDto,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.receipts.preview(dto, warehouseScope);
  }

  @Post()
  @RequirePermissions(RECEIVE)
  receive(
    @Body() dto: CreatePurchaseReceiptDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.receipts.receive(dto, userId, requireKey(idempotencyKey), warehouseScope);
  }

  @Post('reject')
  @RequirePermissions(RECEIVE)
  reject(
    @Body() dto: RejectPurchaseReceiptDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') warehouseScope: string | null,
  ) {
    return this.receipts.reject(dto, userId, requireKey(idempotencyKey), warehouseScope);
  }
}
