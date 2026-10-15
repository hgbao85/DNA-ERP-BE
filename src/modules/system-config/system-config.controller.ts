import { Body, Controller, Get, Headers, Ip, Put } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { SystemConfigService } from './system-config.service';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { UpdateMaxWasteDto } from './dto/update-max-waste.dto';

@ApiTags('System Config')
@ApiBearerAuth()
@Controller({ path: 'system-config', version: '1' })
export class SystemConfigController {
  constructor(
    private readonly systemConfigService: SystemConfigService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  @Get()
  @RequirePermissions({ module: PERMISSION_MODULES.SYSTEM_CONFIG, action: PermissionAction.VIEW })
  findOne() {
    return this.systemConfigService.findOne();
  }

  /**
   * Ngưỡng hao hụt mặc định cho cắt sắt - KHSX đọc/đổi ngay ở "Tối ưu cắt sắt" (2026-09-30). Dùng
   * quyền CUTTING_PROPOSAL (KHSX có sẵn) thay vì SYSTEM_CONFIG (chỉ Admin): cấp SYSTEM_CONFIG:UPDATE
   * cho KHSX sẽ mở luôn PUT / (sửa cả thông tin công ty, chiều dài cây, thời gian solver...).
   */
  @Get('cutting-defaults')
  @RequirePermissions({
    module: PERMISSION_MODULES.CUTTING_PROPOSAL,
    action: PermissionAction.VIEW,
  })
  getCuttingDefaults() {
    return this.systemConfigService.getCuttingDefaults();
  }

  @Put('cutting-defaults/max-waste')
  @RequirePermissions({
    module: PERMISSION_MODULES.CUTTING_PROPOSAL,
    action: PermissionAction.CREATE,
  })
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER, DEFAULT_ROLES.ADMIN)
  updateMaxWaste(@Body() dto: UpdateMaxWasteDto, @CurrentUser('id') userId: string) {
    return this.systemConfigService.updateMaxWastePercentage(dto, userId);
  }

  /** IP mà BE thấy của người gọi (để Admin điền danh sách mạng công ty) - xem SystemConfigService.getNetworkInfo. */
  @Get('my-ip')
  @RequirePermissions({ module: PERMISSION_MODULES.SYSTEM_CONFIG, action: PermissionAction.VIEW })
  async myIp(@Ip() ip: string, @Headers('x-forwarded-for') forwardedFor: string | undefined) {
    return {
      ...(await this.systemConfigService.getNetworkInfo(ip)),
      // Chẩn đoán số lớp proxy (TRUST_PROXY_HOPS): chuỗi X-Forwarded-For BE nhận được + số lớp BE đang tin. Đặt đúng khi `ip` ở trên là
      // IP công cộng của chính người đang mở màn này (so với trang "what is my ip"); thấy IP của proxy/Cloudflare thì tăng 1 lớp.
      forwardedFor: forwardedFor ?? null,
      trustProxyHops: this.configService.get('trustProxyHops', { infer: true }),
    };
  }

  @Put()
  @RequirePermissions({
    module: PERMISSION_MODULES.SYSTEM_CONFIG,
    action: PermissionAction.UPDATE,
  })
  update(@Body() dto: UpdateSystemConfigDto) {
    return this.systemConfigService.update(dto);
  }
}
