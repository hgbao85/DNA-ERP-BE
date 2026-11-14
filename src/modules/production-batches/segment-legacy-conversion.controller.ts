import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import {
  LegacyConversionReport,
  SegmentLegacyConversionService,
} from './segment-legacy-conversion.service';

export class SegmentLegacyConversionDto {
  /** Mặc định true: chạy y hệt rồi rollback, chỉ trả báo cáo. */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

/** Chuyển đổi tồn đoạn cũ sang tồn đoạn theo lệnh (chạy 1 lần, chỉ Admin). */
@ApiTags('Segment Stock')
@ApiBearerAuth()
@Controller({ path: 'segment-stock', version: '1' })
export class SegmentLegacyConversionController {
  constructor(private readonly service: SegmentLegacyConversionService) {}

  @Post('legacy-conversion')
  @HttpCode(200)
  @RequirePermissions({ module: PERMISSION_MODULES.STOCK, action: PermissionAction.UPDATE })
  @RequireRole(DEFAULT_ROLES.ADMIN)
  @ApiOperation({
    summary: 'Chuyển đổi tồn đoạn cũ (đưa về 0, tính lại theo lệnh) - dryRun mặc định',
  })
  run(
    @Body() dto: SegmentLegacyConversionDto,
    @CurrentUser('id') userId: string,
  ): Promise<LegacyConversionReport> {
    return this.service.run({ dryRun: dto.dryRun !== false, actorId: userId });
  }
}
