import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import {
  CreateWeavingFollowUpDto,
  WeavingBoardQueryDto,
  WeavingFollowUpQueryDto,
} from './dto/weaving-coordination.dto';
import { WeavingCoordinationService } from './weaving-coordination.service';

const WEAVING_VIEW = { module: PERMISSION_MODULES.WEAVING_ISSUE, action: PermissionAction.VIEW };

/**
 * Điều phối đan (25/11/2026, docs THIET-KE-DIEU-PHOI-DAN, công tắc DIEU_PHOI_DAN_ENABLED). Route đọc trả `enabled`; route ghi trả 400
 * khi tắt.
 *  - `config`: công tắc cho FE (mọi tài khoản đăng nhập).
 *  - `board`, `follow-ups` (GET): ai có WEAVING_ISSUE:VIEW (Điều phối đan, thủ kho, Giám đốc, Admin) - chỉ xem.
 *  - `follow-ups` (POST): chỉ Điều phối đan và Admin ghi chú / hẹn.
 * Danh sách điểm đan vẫn ở /weaving-points (Đ3 chặn quyền trong WeavingPointsService).
 */
@ApiTags('Điều phối đan')
@ApiBearerAuth()
@Controller({ path: 'weaving-coordination', version: '1' })
export class WeavingCoordinationController {
  constructor(private readonly service: WeavingCoordinationService) {}

  @Get('config')
  config() {
    return this.service.getConfig();
  }

  @Get('board')
  @RequirePermissions(WEAVING_VIEW)
  board(@Query() query: WeavingBoardQueryDto) {
    return this.service.getBoard(query);
  }

  @Get('follow-ups')
  @RequirePermissions(WEAVING_VIEW)
  followUps(@Query() query: WeavingFollowUpQueryDto) {
    return this.service.listFollowUps(query);
  }

  @Post('follow-ups')
  @RequirePermissions(WEAVING_VIEW)
  @RequireRole(DEFAULT_ROLES.ADMIN, BUSINESS_ROLES.WEAVING_COORDINATOR)
  createFollowUp(@Body() dto: CreateWeavingFollowUpDto, @CurrentUser('id') userId: string) {
    return this.service.createFollowUp(dto, userId);
  }
}
