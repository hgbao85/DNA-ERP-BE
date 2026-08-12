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
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ApprovePurchaseProposalDto } from './dto/approve-purchase-proposal.dto';
import { CreateManualPurchaseProposalDto } from './dto/create-manual-purchase-proposal.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { ReceivePurchaseProposalItemDto } from './dto/receive-purchase-proposal-item.dto';
import { RejectPurchaseProposalDto } from './dto/reject-purchase-proposal.dto';
import { PurchaseProposalsService } from './purchase-proposals.service';

const VIEW = { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, action: PermissionAction.CREATE };
const UPDATE = { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, action: PermissionAction.UPDATE };
const APPROVE = { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, action: PermissionAction.APPROVE };

/**
 * PurchaseProposal tự sinh khi CuttingProposal được duyệt (xem CuttingProposalsService.approve(),
 * sourceType=CUTTING_PROPOSAL), HOẶC tạo thủ công qua POST / dưới đây từ 1 InspectionKhoResult đã
 * SUBMITTED (sourceType=MATERIAL_INSPECTION - Phase 10, 2026-08-12, mirror markProposalCreated
 * trong mock InspectionContext).
 */
@ApiTags('Purchase Proposals')
@ApiBearerAuth()
@Controller({ path: 'purchase-proposals', version: '1' })
export class PurchaseProposalsController {
  constructor(private readonly purchaseProposalsService: PurchaseProposalsService) {}

  @Post()
  @RequirePermissions(CREATE)
  create(
    @Body() dto: CreateManualPurchaseProposalDto,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ) {
    return this.purchaseProposalsService.createFromInspection(dto, idempotencyKey);
  }

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
  acknowledge(@Param('id') id: string) {
    return this.purchaseProposalsService.acknowledge(id);
  }

  @Post(':id/items/:itemId/quotes')
  @RequirePermissions(UPDATE)
  addQuote(@Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: CreateQuoteDto) {
    return this.purchaseProposalsService.addQuote(id, itemId, dto);
  }

  @Post(':id/submit')
  @RequirePermissions(UPDATE)
  submit(@Param('id') id: string) {
    return this.purchaseProposalsService.submit(id);
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
  requote(@Param('id') id: string) {
    return this.purchaseProposalsService.requote(id);
  }

  @Post(':id/items/:itemId/receive')
  @RequirePermissions(UPDATE)
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
