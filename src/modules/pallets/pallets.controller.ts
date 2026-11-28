import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAssignedWarehouse } from '../../common/decorators/require-assigned-warehouse.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  ClearPaintedPalletDto,
  CreatePalletsDto,
  ListPalletsQueryDto,
  LoadPalletDto,
  PalletLoadOptionsQueryDto,
  PalletLookupQueryDto,
  SetPieceCapacityDto,
} from './dto/pallet.dto';
import { PalletsService } from './pallets.service';

// Thủ kho Sơn: cùng quyền phiếu xuất XK (MATERIAL_ISSUE) như các màn Phân phối nội bộ. Route ghi cần đang phụ trách 1 kho.
const VIEW = { module: PERMISSION_MODULES.MATERIAL_ISSUE, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.MATERIAL_ISSUE, action: PermissionAction.CREATE };

/** Pallet Sơn (24/11/2026) - màn kho Sơn (tab "Pallet"). Màn công nhân Sơn ở FloorController (`floor/pallets/...`). */
@ApiTags('Pallets (kho Sơn)')
@ApiBearerAuth()
@Controller({ path: 'pallets', version: '1' })
export class PalletsController {
  constructor(private readonly service: PalletsService) {}

  /** Danh sách pallet của kho + số theo trạng thái. Luôn có `enabled` (công tắc PALLET_SON_ENABLED). */
  @Get()
  @RequirePermissions(VIEW)
  list(@Query() query: ListPalletsQueryDto, @CurrentUser('warehouseScope') scope: string | null) {
    return this.service.list(query, scope);
  }

  /** Lệnh / (SKU, mảnh) xếp được + số Kế hoạch / Sơn đã nhận / Đã xếp / Còn xếp được. Đặt TRƯỚC ':id'. */
  @Get('load-options')
  @RequirePermissions(VIEW)
  loadOptions(
    @Query() query: PalletLoadOptionsQueryDto,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.loadOptions(query, scope);
  }

  /** Tra pallet theo tem quét (token / link) hoặc mã PL-NNN. Đặt TRƯỚC ':id'. */
  @Get('lookup')
  @RequirePermissions(VIEW)
  lookup(
    @Query() query: PalletLookupQueryDto,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.lookup(query.q, scope);
  }

  @Get(':id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string, @CurrentUser('warehouseScope') scope: string | null) {
    return this.service.findOne(id, scope);
  }

  /** Tạo `count` pallet mới (mã PL-NNN kế tiếp) - in tem ở FE. */
  @Post()
  @HttpCode(201)
  @RequireAssignedWarehouse()
  @RequirePermissions(CREATE)
  create(
    @Body() dto: CreatePalletsDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.create(dto, scope, userId);
  }

  /** Xếp pallet trống: 1 SKU + 1 mảnh + số. Trả `warning` khi vượt sức chứa của mảnh (không chặn). */
  @Post(':id/load')
  @RequireAssignedWarehouse()
  @RequirePermissions(CREATE)
  load(
    @Param('id') id: string,
    @Body() dto: LoadPalletDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.load(id, dto, scope, userId);
  }

  /** Gỡ lượt xếp chưa sơn (xếp nhầm) - pallet về Trống. */
  @Post(':id/unload')
  @RequireAssignedWarehouse()
  @RequirePermissions(CREATE)
  unload(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.unload(id, scope, userId);
  }

  /** Câu 7a (25/11/2026): thủ kho Sơn gỡ pallet đã sơn (lý do bắt buộc) - pallet về Trống. */
  @Post(':id/clear-painted')
  @RequireAssignedWarehouse()
  @RequirePermissions(CREATE)
  clearPainted(
    @Param('id') id: string,
    @Body() dto: ClearPaintedPalletDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.service.clearPainted(id, dto.reason, scope, userId);
  }

  /** Sức chứa pallet của 1 mảnh (chỉ để cảnh báo). */
  @Patch('piece-capacity')
  @RequireAssignedWarehouse()
  @RequirePermissions(CREATE)
  setPieceCapacity(@Body() dto: SetPieceCapacityDto) {
    return this.service.setPieceCapacity(dto);
  }
}
