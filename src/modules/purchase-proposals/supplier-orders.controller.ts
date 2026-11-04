import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { BossApprovePurchaseProposalDto } from './dto/boss-approve-purchase-proposal.dto';
import {
  CancelSupplierOrderDto,
  CreateSupplierOrderDto,
  ListSupplierOrdersQueryDto,
  ReviseSupplierOrderDto,
  SetSupplierOrderCounterDto,
} from './dto/supplier-order.dto';
import { SupplierOrdersService } from './supplier-orders.service';
import { vnYear } from './supplier-order-code.util';

const VIEW = { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, action: PermissionAction.VIEW };
// Cùng quyền với sửa số mua / "Sếp đã duyệt" cũ - nhân viên mua hàng (xem PurchaseProposalsController).
const UPDATE = { module: PERMISSION_MODULES.PURCHASE_PROPOSAL, action: PermissionAction.UPDATE };

/** Đơn đặt hàng NCC + số đơn theo NCC/năm (2026-11-04, bản v8 mục 4.10, 4.13). */
@ApiTags('Supplier Orders')
@ApiBearerAuth()
@Controller({ path: 'supplier-orders', version: '1' })
export class SupplierOrdersController {
  constructor(private readonly supplierOrdersService: SupplierOrdersService) {}

  @Get()
  @RequirePermissions(VIEW)
  findAll(
    @Query() query: ListSupplierOrdersQueryDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.supplierOrdersService.findAll(query, userId, roles);
  }

  /** Số đơn cuối cùng của từng NCC trong năm (mặc định năm nay, giờ VN) - Admin nạp trước khi dùng. */
  @Get('counters')
  @RequireRole(DEFAULT_ROLES.ADMIN)
  listCounters(@Query('year') year?: string) {
    return this.supplierOrdersService.listCounters(year ? Number(year) : vnYear());
  }

  @Put('counters/:supplierId')
  @RequireRole(DEFAULT_ROLES.ADMIN)
  setCounter(@Param('supplierId') supplierId: string, @Body() dto: SetSupplierOrderCounterDto) {
    return this.supplierOrdersService.setCounter(supplierId, dto.year, dto.lastSeq);
  }

  @Get(':id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.supplierOrdersService.findOne(id);
  }

  @Post()
  @RequirePermissions(UPDATE)
  create(
    @Body() dto: CreateSupplierOrderDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.supplierOrdersService.create(dto, userId, roles);
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions(UPDATE)
  removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.supplierOrdersService.removeItem(id, itemId, userId, roles);
  }

  @Post(':id/cancel')
  @RequirePermissions(UPDATE)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelSupplierOrderDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.supplierOrdersService.cancel(id, dto.reason, userId, roles);
  }

  /** File phiếu đề xuất .xlsx theo mẫu (base64 trong envelope JSON). */
  @Get(':id/print')
  @RequirePermissions(VIEW)
  print(@Param('id') id: string) {
    return this.supplierOrdersService.print(id);
  }

  /** "THAY PHIẾU" - đơn đã ký về chờ duyệt để gỡ dòng / sửa số mua, in phiếu mới cùng số. */
  @Post(':id/revise')
  @RequirePermissions(UPDATE)
  revise(
    @Param('id') id: string,
    @Body() dto: ReviseSupplierOrderDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.supplierOrdersService.revise(id, dto.reason, userId, roles);
  }

  /** "Sếp đã duyệt" theo đơn - tải phiếu Giám đốc đã ký cho đúng đơn này. */
  @Post(':id/boss-approve')
  @RequirePermissions(UPDATE)
  approve(
    @Param('id') id: string,
    @Body() dto: BossApprovePurchaseProposalDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.supplierOrdersService.approve(id, dto.approvalFileUrl, userId, roles);
  }
}
