import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { RecomputeSegmentStockResponseDto } from './dto/recompute-segment-stock-response.dto';
import { RecomputeSegmentStockDto } from './dto/recompute-segment-stock.dto';
import { SegmentProductionService } from './segment-production.service';

const UPDATE = { module: PERMISSION_MODULES.STOCK, action: PermissionAction.UPDATE };

/** Phía cộng tồn đoạn theo lệnh: endpoint tính lại (sửa lệch / backfill). Các route GET nằm ở SegmentStockController. */
@ApiTags('Segment Stock')
@ApiBearerAuth()
@Controller({ path: 'segment-stock', version: '1' })
export class SegmentProductionController {
  constructor(private readonly segmentProductionService: SegmentProductionService) {}

  @Post('recompute')
  @RequirePermissions(UPDATE)
  @ApiOperation({
    summary: 'Tính lại tồn đoạn phía cộng của 1 lệnh (dryRun = xem thử, không ghi)',
  })
  @ApiCreatedResponse({ type: RecomputeSegmentStockResponseDto })
  async recompute(
    @Body() dto: RecomputeSegmentStockDto,
    @CurrentUser('id') userId: string,
  ): Promise<RecomputeSegmentStockResponseDto> {
    const result = await this.segmentProductionService.recomputeForPi(
      parseBigIntId(dto.productionInvoiceId),
      { actorId: userId, reason: 'ADMIN_RECOMPUTE', dryRun: dto.dryRun === true },
    );
    return RecomputeSegmentStockResponseDto.from(result);
  }
}
