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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CancelIssueSlipDto,
  ConfirmIssueSlipDto,
  CreateIssueSlipDto,
  ListIssueSlipsQueryDto,
} from './dto/issue-slip.dto';
import { IssueSlipsService } from './issue-slips.service';

// Cùng quyền với route xuất cũ (đã gỡ): thủ kho có MATERIAL_ISSUE CREATE+VIEW (và STEEL_ISSUE CREATE cho dòng sắt - kiểm phạm vi kho
// trong service theo từng dòng).
const VIEW = { module: PERMISSION_MODULES.MATERIAL_ISSUE, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.MATERIAL_ISSUE, action: PermissionAction.CREATE };

/** Phiếu xuất kho XK (Đợt 6, bản v8 YC4) - thay route xuất sắt / xuất tiêu hao từng dòng cũ. */
@ApiTags('Issue Slips')
@ApiBearerAuth()
@Controller({ path: 'issue-slips', version: '1' })
export class IssueSlipsController {
  constructor(private readonly slips: IssueSlipsService) {}

  @Get()
  @RequirePermissions(VIEW)
  findAll(
    @Query() query: ListIssueSlipsQueryDto,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.slips.findAll(query, scope);
  }

  @Get(':id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.slips.findOne(id);
  }

  /** Bước 1: tạo phiếu, cấp số XK-yymmdd-NNN - chưa trừ tồn. */
  @Post()
  @RequirePermissions(CREATE)
  create(
    @Body() dto: CreateIssueSlipDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.slips.create(dto, userId, scope);
  }

  /** Bước 2: ảnh phiếu đã ký -> trừ tồn mọi dòng. Idempotency-Key bắt buộc. */
  @Post(':id/confirm')
  @RequirePermissions(CREATE)
  confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmIssueSlipDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    if (!idempotencyKey) throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    return this.slips.confirm(id, dto.signedSlipUrls, userId, scope, idempotencyKey);
  }

  @Post(':id/cancel')
  @RequirePermissions(CREATE)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelIssueSlipDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    return this.slips.cancel(id, dto.reason, userId, scope);
  }
}
