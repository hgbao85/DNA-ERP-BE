import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import {
  ListSegmentOveragesQueryDto,
  ResolveSegmentOverageDto,
  SegmentOverageResponseDto,
} from './dto/segment-overage.dto';
import { SegmentOveragesService } from './segment-overages.service';

/** Sổ báo vượt tồn đoạn (13/11/2026): QLSX / KHSX xem; QLSX đóng từng dòng, bắt buộc lý do. */
@ApiTags('Segment Overages')
@ApiBearerAuth()
@Controller({ path: 'segment-overages', version: '1' })
export class SegmentOveragesController {
  constructor(private readonly service: SegmentOveragesService) {}

  @Get()
  @RequirePermissions({
    module: PERMISSION_MODULES.PRODUCTION_BATCH,
    action: PermissionAction.VIEW,
  })
  findAll(
    @Query() query: ListSegmentOveragesQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<SegmentOverageResponseDto[]> {
    return this.service.findAll(query, userId);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions({
    module: PERMISSION_MODULES.PRODUCTION_BATCH,
    action: PermissionAction.VIEW,
  })
  @RequireRole(BUSINESS_ROLES.PRODUCTION_MANAGER, DEFAULT_ROLES.ADMIN)
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveSegmentOverageDto,
    @CurrentUser('id') userId: string,
  ): Promise<SegmentOverageResponseDto> {
    return this.service.resolve(id, dto.reason, userId);
  }
}
