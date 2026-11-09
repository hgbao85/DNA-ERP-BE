import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PieceSyncBoardService } from './piece-sync-board.service';

/**
 * "Đồng bộ Phôi – Hàn" (2026-11-04) - CỐ Ý dùng quyền PRODUCTION_BATCH:VIEW: KHSX, QLSX, Phôi, Hàn, Sơn, KCS đều đã có (màn
 * Hàn cũng gọi endpoint này) nên không phải chạy lại seed quyền trên production.
 */
@ApiTags('Piece Sync Board')
@Controller({ path: 'piece-sync-board', version: '1' })
export class PieceSyncBoardController {
  constructor(private readonly pieceSyncBoardService: PieceSyncBoardService) {}

  @Get()
  @ApiBearerAuth()
  @ApiQuery({
    name: 'productionInvoiceIds',
    required: false,
    description: 'Id PI, cách nhau dấu phẩy',
  })
  @RequirePermissions({
    module: PERMISSION_MODULES.PRODUCTION_BATCH,
    action: PermissionAction.VIEW,
  })
  getBoard(@Query('productionInvoiceIds') productionInvoiceIds?: string) {
    const ids = productionInvoiceIds
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // parseBigIntId ném 400 khi id không phải số; service nhận lại chuỗi.
    ids?.forEach((id) => parseBigIntId(id));
    return this.pieceSyncBoardService.getBoard(ids);
  }
}
