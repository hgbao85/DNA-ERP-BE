import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  RealtimeEntityOn,
  RealtimeMutationInterceptor,
} from '../../realtime/realtime-mutation.interceptor';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MfgRole, PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireMfgRole } from '../../common/decorators/require-mfg-role.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ListMaterialYieldRecipeIssuesQueryDto } from './dto/list-material-yield-recipe-issues-query.dto';
import { ReceiveMaterialYieldRecipeIssueDto } from './dto/receive-material-yield-recipe-issue.dto';
import { MaterialYieldRecipeIssuesService } from './material-yield-recipe-issues.service';

// Tái dùng ĐÚNG permission module MATERIAL_YIELD_ISSUE (không tạo module quyền riêng) - đây là
// cùng nghiệp vụ "xuất kho nguyên liệu Vật tư thành phẩm cho Phôi" đã có sẵn role-grants cho
// WAREHOUSE_STAFF (CREATE+VIEW) và PHOI_STAFF (UPDATE+VIEW), chỉ khác khoá theo recipeId/PI thay
// vì materialId/PO - không cần sửa role-permissions.constant.ts/seed.ts.
const VIEW = { module: PERMISSION_MODULES.MATERIAL_YIELD_ISSUE, action: PermissionAction.VIEW };
const UPDATE = { module: PERMISSION_MODULES.MATERIAL_YIELD_ISSUE, action: PermissionAction.UPDATE };

@ApiTags('Material Yield Recipe Issues')
@ApiBearerAuth()
@Controller({ version: '1' })
@RealtimeEntityOn('MATERIAL_YIELD_ISSUE')
@UseInterceptors(RealtimeMutationInterceptor)
export class MaterialYieldRecipeIssuesController {
  constructor(private readonly service: MaterialYieldRecipeIssuesService) {}

  // POST xuất thẳng (trừ tồn ngay, không phiếu) ĐÃ GỠ 09/11/2026 - xuất đi phiếu XK có ảnh ký (IssueSlipsService, dòng MATERIAL_YIELD_RECIPE).

  @Get('production-invoices/:id/material-yield-recipe-issues')
  @RequirePermissions(VIEW)
  findAllForInvoice(@Param('id') id: string) {
    return this.service.findAllForInvoice(id);
  }

  @Get('material-yield-recipe-issues')
  @RequirePermissions(VIEW)
  findAll(@Query() query: ListMaterialYieldRecipeIssuesQueryDto) {
    return this.service.findAll(query);
  }

  @Get('material-yield-recipe-issues/:id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('material-yield-recipe-issues/:id/receive')
  @RequirePermissions(UPDATE)
  @RequireMfgRole(MfgRole.PHOI)
  receive(
    @Param('id') id: string,
    @Body() dto: ReceiveMaterialYieldRecipeIssueDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('mfgRole') mfgRole: string | null,
  ) {
    return this.service.receive(id, dto, userId, mfgRole);
  }
}
