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
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ApprovePurchaseProposalDto } from './dto/approve-purchase-proposal.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { ReceivePurchaseProposalItemDto } from './dto/receive-purchase-proposal-item.dto';
import { RejectPurchaseProposalDto } from './dto/reject-purchase-proposal.dto';
import { PurchaseProposalsService } from './purchase-proposals.service';

const VIEW = { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, action: PermissionAction.VIEW };
const UPDATE = { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, action: PermissionAction.UPDATE };
const APPROVE = { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, action: PermissionAction.APPROVE };
// Riêng nhận hàng (receiveItem) - TÁCH khỏi UPDATE ở trên (2026-08-15, D.c4-warehouse-can-quote).
// Trước đó WAREHOUSE_STAFF được PURCHASE_PROPOSAL:UPDATE chỉ để gọi route này, nhưng CÙNG action
// đó cũng mở khoá acknowledge/quotes/submit/requote bên dưới - thủ kho gọi thẳng API là tự báo
// giá + tự gửi Sếp duyệt được, dù UI không có nút. Đúng loại lỗ mà PURCHASER đã được vá (cố ý bỏ
// APPROVE, xem comment ở role-permissions.constant.ts) nhưng để hở ở chiều ngược lại.
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
  findAll(@Query() query: PaginationQueryDto) {
    return this.purchaseProposalsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.purchaseProposalsService.findOne(id);
  }

  @Post(':id/acknowledge')
  @RequirePermissions(UPDATE)
  acknowledge(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.purchaseProposalsService.acknowledge(id, userId, roles);
  }

  @Post(':id/items/:itemId/quotes')
  @RequirePermissions(UPDATE)
  addQuote(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: CreateQuoteDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.purchaseProposalsService.addQuote(id, itemId, dto, userId, roles);
  }

  @Post(':id/submit')
  @RequirePermissions(UPDATE)
  submit(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.purchaseProposalsService.submit(id, userId, roles);
  }

  @Post(':id/approve')
  @RequirePermissions(APPROVE)
  approve(
    @Param('id') id: string,
    @Body() dto: ApprovePurchaseProposalDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.purchaseProposalsService.approve(id, userId, dto);
  }

  @Post(':id/reject')
  @RequirePermissions(APPROVE)
  reject(@Param('id') id: string, @Body() dto: RejectPurchaseProposalDto) {
    return this.purchaseProposalsService.reject(id, dto);
  }

  @Post(':id/requote')
  @RequirePermissions(UPDATE)
  requote(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.purchaseProposalsService.requote(id, userId, roles);
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
