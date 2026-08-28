import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BossApprovePurchaseProposalDto } from './dto/boss-approve-purchase-proposal.dto';
import { ListPurchaseProposalsQueryDto } from './dto/list-purchase-proposals-query.dto';
import { ReceivePurchaseProposalItemDto } from './dto/receive-purchase-proposal-item.dto';
import { PurchaseProposalsService } from './purchase-proposals.service';

const VIEW = { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, action: PermissionAction.VIEW };
const UPDATE = { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, action: PermissionAction.UPDATE };
// Riêng nhận hàng (receiveItem) - TÁCH khỏi UPDATE ở trên (2026-08-15, D.c4-warehouse-can-quote).
// Trước đó WAREHOUSE_STAFF được PURCHASE_PROPOSAL:UPDATE chỉ để gọi route này, nhưng CÙNG action
// đó cũng mở khoá các route ghi khác - thủ kho gọi thẳng API là tự đẩy đề xuất đi tiếp được, dù
// UI không có nút. Vẫn giữ tách sau 2026-08-27: giờ UPDATE mở khoá boss-approve, còn nguy hiểm
// hơn trước (đẩy thẳng sang PURCHASING), thủ kho tuyệt đối không được chạm tới.
const RECEIVE = { module: PERMISSION_MODULES.PURCHASE_RECEIPT, action: PermissionAction.UPDATE };

/**
 * PurchaseProposal tự sinh khi CuttingProposal được duyệt (xem CuttingProposalsService.approve(),
 * sourceType=CUTTING_PROPOSAL) - không có endpoint tạo tay.
 */
@ApiTags('Purchase Proposals')
@ApiBearerAuth()
@Controller({ path: 'purchase-proposals', version: '1' })
export class PurchaseProposalsController {
  constructor(private readonly purchaseProposalsService: PurchaseProposalsService) {}

  @Get()
  @RequirePermissions(VIEW)
  findAll(@Query() query: ListPurchaseProposalsQueryDto) {
    return this.purchaseProposalsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.purchaseProposalsService.findOne(id);
  }

  /**
   * Mua hàng xác nhận "Sếp đã duyệt" kèm file phiếu đã ký (2026-08-27). Quyền UPDATE, KHÔNG phải
   * APPROVE - xem giải thích ở PurchaseProposalsService.bossApprove().
   */
  @Post(':id/boss-approve')
  @RequirePermissions(UPDATE)
  bossApprove(
    @Param('id') id: string,
    @Body() dto: BossApprovePurchaseProposalDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.purchaseProposalsService.bossApprove(id, userId, roles, dto);
  }

  @Post(':id/items/:itemId/receive')
  @RequirePermissions(RECEIVE)
  receiveItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ReceivePurchaseProposalItemDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    }
    return this.purchaseProposalsService.receiveItem(id, itemId, dto, userId, idempotencyKey);
  }
}
