import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { CreateProductionInvoiceDto } from './dto/create-production-invoice.dto';
import { CreateProductionInvoiceItemDto } from './dto/create-production-invoice-item.dto';
import { MergeProductionInvoiceDto } from './dto/merge-production-invoice.dto';
import { RecordPackagingDto } from './dto/record-packaging.dto';
import { RecordTransferCheckDto } from './dto/record-transfer-check.dto';
import { RejectItemDto } from './dto/reject-item.dto';
import { SendBatchDto, SendBatchToBossDto } from './dto/send-batch.dto';
import { SendToBossDto } from './dto/send-to-boss.dto';
import { UpdateProductionInvoiceDto } from './dto/update-production-invoice.dto';
import { UpdateProductionInvoiceItemDto } from './dto/update-production-invoice-item.dto';
import { PieceMaterialYieldPurchaseService } from './piece-material-yield-purchase.service';
import { ProductionInvoicesService } from './production-invoices.service';

const VIEW = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.CREATE };
const UPDATE = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.UPDATE };
const APPROVE = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.APPROVE };
const PURCHASE_PROPOSAL_CREATE = {
  module: PERMISSION_MODULES.PURCHASE_PROPOSAL,
  action: PermissionAction.CREATE,
};

@ApiTags('Production Invoices')
@ApiBearerAuth()
@Controller({ path: 'production-invoices', version: '1' })
export class ProductionInvoicesController {
  constructor(
    private readonly productionInvoicesService: ProductionInvoicesService,
    private readonly pieceMaterialYieldPurchaseService: PieceMaterialYieldPurchaseService,
  ) {}

  @Post()
  @RequirePermissions(CREATE)
  create(@Body() dto: CreateProductionInvoiceDto) {
    return this.productionInvoicesService.create(dto);
  }

  /**
   * KHSX gộp nhiều SKU thành 1 lệnh sản xuất để cắt chung (màn "Tối ưu cắt sắt").
   * Khai báo TRƯỚC mọi route ':id' để 'merge' không bị nuốt thành tham số id.
   */
  @Post('merge')
  @RequirePermissions(CREATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER)
  merge(@Body() dto: MergeProductionInvoiceDto, @CurrentUser('id') userId: string) {
    return this.productionInvoicesService.mergeItems(dto, userId);
  }

  /**
   * KHSX chọn ĐÚNG 1 SKU và "Tiến hành cắt riêng" (màn "Tối ưu cắt sắt") - tạo cho nó 1 PI thường
   * của riêng nó (item vừa tạo từ PO chưa được gom vào PI nào, xem
   * ProductionInvoicesService.claimSolo()). Route không lồng dưới ':id' (khác addItem) vì item
   * lúc này CHƯA thuộc PI nào để lồng vào - khai báo trước mọi route ':id' cùng lý do 'merge' ở
   * trên.
   */
  @Post('items/:itemId/claim-solo')
  @RequirePermissions(CREATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER)
  claimSolo(@Param('itemId') itemId: string) {
    return this.productionInvoicesService.claimSolo(itemId);
  }

  @Get()
  @RequirePermissions(VIEW)
  findAll(@Query() query: PaginationQueryDto) {
    return this.productionInvoicesService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.productionInvoicesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateProductionInvoiceDto) {
    return this.productionInvoicesService.update(id, dto);
  }

  /**
   * Tính (hoặc tính lại) nhu cầu mua nguyên liệu cho "vật tư thành phẩm" (needsHan=false, vd
   * chân nhôm) của PI này theo PieceMaterialYield - kiểm tồn trước, tự tạo/refresh
   * PurchaseProposal. Gọi lại được nhiều lần để refresh trước khi Mua hàng submit (idempotent
   * trong khi còn NEW - xem PieceMaterialYieldPurchaseService).
   */
  @Post(':id/piece-material-yield-purchase-proposals')
  @RequirePermissions(PURCHASE_PROPOSAL_CREATE)
  computePieceMaterialYieldPurchaseProposals(@Param('id') id: string) {
    return this.pieceMaterialYieldPurchaseService.computeAndUpsertProposals(id);
  }

  @Post(':id/items')
  @RequirePermissions(CREATE)
  addItem(@Param('id') id: string, @Body() dto: CreateProductionInvoiceItemDto) {
    return this.productionInvoicesService.addItem(id, dto);
  }

  @Patch(':id/items/:itemId')
  @RequirePermissions(UPDATE)
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateProductionInvoiceItemDto,
  ) {
    return this.productionInvoicesService.updateItem(id, itemId, dto);
  }

  // ─── KHSX (role PRODUCTION_PLANNER - đến từ User.isProductPlanner, KHÔNG phải mfgRole,
  // xem MFG_ROLE_TO_BUSINESS_ROLE) - cố ý siết hơn mock (mock không guard chỗ này) ──

  @Post(':id/items/:itemId/send-to-qlsx')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER)
  sendItemToQlsx(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionInvoicesService.sendItemToQlsx(id, itemId, userId);
  }

  /** Gửi CẢ phiếu (mọi SKU chưa gửi / bị QLSX trả lại) trong 1 lần - cùng quyền với route lẻ ở
   *  trên. Xem ProductionInvoicesService.sendBatchToQlsx() cho lý do tồn tại và vì sao KHÔNG giới
   *  hạn ở đợt gộp như approve-batch. */
  @Post(':id/send-to-qlsx-batch')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER)
  sendBatchToQlsx(
    @Param('id') id: string,
    @Body() dto: SendBatchDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionInvoicesService.sendBatchToQlsx(id, userId, dto.itemIds);
  }

  // ─── QLSX (mfgRole = PRODUCTION_MANAGER) ────────────────────────────────────

  @Post(':id/items/:itemId/send-to-boss')
  @RequirePermissions(APPROVE)
  @RequireMfgRole(MfgRole.PRODUCTION_MANAGER)
  sendItemToBoss(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: SendToBossDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionInvoicesService.sendItemToBoss(
      id,
      itemId,
      dto.warehouseCode,
      dto.warehouseName,
      userId,
    );
  }

  /** Gửi CẢ phiếu lên Sếp - mọi SKU đang chờ QLSX, dùng CHUNG 1 kho thành phẩm (ca hiếm cần kho
   *  khác nhau vẫn dùng route lẻ ở trên). Xem ProductionInvoicesService.sendBatchToBoss(). */
  @Post(':id/send-to-boss-batch')
  @RequirePermissions(APPROVE)
  @RequireMfgRole(MfgRole.PRODUCTION_MANAGER)
  sendBatchToBoss(
    @Param('id') id: string,
    @Body() dto: SendBatchToBossDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionInvoicesService.sendBatchToBoss(
      id,
      dto.warehouseCode,
      dto.warehouseName,
      userId,
      dto.itemIds,
    );
  }

  @Post(':id/items/:itemId/reject-by-qlsx')
  @RequirePermissions(APPROVE)
  @RequireMfgRole(MfgRole.PRODUCTION_MANAGER)
  rejectItemByQlsx(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: RejectItemDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionInvoicesService.rejectItemByQlsx(id, itemId, dto.reason, userId);
  }

  /** Từ chối CẢ phiếu ở bước QLSX - mọi SKU đang chờ QLSX xử lý. Xem ProductionInvoicesService.
   *  rejectBatchByQlsx() - "duyệt theo PI, không theo từng SKU" (2026-08-24). */
  @Post(':id/reject-qlsx-batch')
  @RequirePermissions(APPROVE)
  @RequireMfgRole(MfgRole.PRODUCTION_MANAGER)
  rejectBatchByQlsx(
    @Param('id') id: string,
    @Body() dto: RejectItemDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionInvoicesService.rejectBatchByQlsx(id, dto.reason, userId);
  }

  // ─── Sếp (role BOSS) - duyệt cuối, mirror assertBossRole() trong mock ───────

  @Post(':id/items/:itemId/approve')
  @RequirePermissions(APPROVE)
  @RequireRole(BUSINESS_ROLES.BOSS)
  approveItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionInvoicesService.approveItem(id, itemId, userId);
  }

  @Post(':id/items/:itemId/reject')
  @RequirePermissions(APPROVE)
  @RequireRole(BUSINESS_ROLES.BOSS)
  rejectItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: RejectItemDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionInvoicesService.rejectItem(id, itemId, dto.reason, userId);
  }

  // ─── Sếp duyệt/từ chối CẢ đợt gộp (PI.isMerged) ────────────────────────────
  // Tách khỏi 2 route :itemId/approve|reject có chủ đích: nhóm gộp cắt chung một cây sắt nên
  // không duyệt lẻ được, và từ chối là XOÁ cả đợt chứ không chỉ đổi trạng thái 1 SKU.

  @Post(':id/approve-batch')
  @RequirePermissions(APPROVE)
  @RequireRole(BUSINESS_ROLES.BOSS)
  approveBatch(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.productionInvoicesService.approveBatch(id, userId);
  }

  @Post(':id/reject-batch')
  @RequirePermissions(APPROVE)
  @RequireRole(BUSINESS_ROLES.BOSS)
  rejectBatch(
    @Param('id') id: string,
    @Body() dto: RejectItemDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionInvoicesService.rejectBatch(id, dto.reason, userId);
  }

  // ─── Chuyền kiểm (TRANSFER_CHECK) - thủ kho thành phẩm, mirror KhoChuyenKiemPage ─────

  @Get(':id/items/:itemId/transfer-check')
  @RequirePermissions(VIEW)
  listTransferCheckPieces(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.productionInvoicesService.listTransferCheckPieces(id, itemId);
  }

  @Post(':id/items/:itemId/transfer-check')
  @RequirePermissions(UPDATE)
  recordTransferCheck(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: RecordTransferCheckDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionInvoicesService.recordTransferCheck(id, itemId, dto, userId);
  }

  // ─── Đóng gói (PACKAGING) - thủ kho thành phẩm, mirror KhoDongGoiPage ───────────────

  @Get(':id/items/:itemId/packaging')
  @RequirePermissions(VIEW)
  getPackaging(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.productionInvoicesService.getPackaging(id, itemId);
  }

  @Post(':id/items/:itemId/packaging')
  @RequirePermissions(UPDATE)
  recordPackaging(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: RecordPackagingDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionInvoicesService.recordPackaging(id, itemId, dto, userId);
  }
}
