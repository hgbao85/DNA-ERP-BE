import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NetworkAccessService } from '../../common/network/network-access.service';
import { isPrivateOrLoopbackIp, normalizeAllowedIps } from '../../common/utils/ip-allowlist.util';
import { normalizePublicUrl } from '../../common/utils/public-url.util';
import { type SystemConfig } from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigResponseDto } from './dto/system-config-response.dto';
import { CuttingDefaultsResponseDto, UpdateMaxWasteDto } from './dto/update-max-waste.dto';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';

/** Singleton row id, pinned by a DB CHECK constraint - see prisma/migrations. */
const SINGLETON_ID = 1;

@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly notifications: NotificationsService,
    private readonly network: NetworkAccessService,
  ) {}

  /** Ngưỡng hao hụt mặc định hiện tại - KHSX đọc ở màn "Tối ưu cắt sắt" (quyền CUTTING_PROPOSAL:VIEW,
   *  không cần SYSTEM_CONFIG:VIEW vốn chỉ Admin có). */
  async getCuttingDefaults(): Promise<CuttingDefaultsResponseDto> {
    const config = await this.prisma.systemConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (!config) {
      throw new NotFoundException('System config has not been seeded');
    }
    return new CuttingDefaultsResponseDto({
      solverMaxWastePercentage: config.solverMaxWastePercentage.toNumber(),
      solverMachine: config.solverMachine,
      ...this.cuttingParams(config),
      previous: null,
      updatedAt: config.updatedAt,
    });
  }

  /** Thông số máy cắt KHSX được XEM (chỉ đọc) - Decimal đổi ra number, Json ra mảng số. */
  private cuttingParams(config: SystemConfig) {
    return {
      solverStockLengths: config.solverStockLengths as number[],
      solverMaxSurplus: config.solverMaxSurplus,
      solverTrimStartMm: config.solverTrimStartMm,
      solverBladeWidthMm: config.solverBladeWidthMm.toNumber(),
      solverMctdTrimStartMm: config.solverMctdTrimStartMm,
      solverMctdBladeWidthMm: config.solverMctdBladeWidthMm.toNumber(),
      solverBundleFactors: config.solverBundleFactors as number[],
      solverMaxManualCuts: config.solverMaxManualCuts,
      solverMaxSizesPerPattern: config.solverMaxSizesPerPattern,
      solverMergeWindowDays: config.solverMergeWindowDays,
      solverMergeMaxSkus: config.solverMergeMaxSkus,
    };
  }

  /**
   * KHSX đổi ngưỡng hao hụt mặc định cho cắt sắt. CHỈ động tới đúng 1 cột này (không cho sửa tham
   * số solver khác). Không cần Sếp duyệt - thay vào đó: (1) AuditLog ghi ai đổi, từ bao nhiêu sang
   * bao nhiêu (SystemConfig nằm trong AUDITED_MODELS); (2) báo Sếp + QLSX ngay để họ biết và can
   * thiệp nếu không đồng ý. Giá trị không đổi thì không ghi/báo gì (tránh nhiễu).
   */
  async updateMaxWastePercentage(
    dto: UpdateMaxWasteDto,
    actorUserId: string,
  ): Promise<CuttingDefaultsResponseDto> {
    const existing = await this.prisma.systemConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (!existing) {
      throw new NotFoundException('System config has not been seeded');
    }
    const previous = existing.solverMaxWastePercentage.toNumber();
    if (previous === dto.solverMaxWastePercentage) {
      return new CuttingDefaultsResponseDto({
        solverMaxWastePercentage: previous,
        solverMachine: existing.solverMachine,
        ...this.cuttingParams(existing),
        previous,
        updatedAt: existing.updatedAt,
      });
    }

    const updated = await this.prisma.systemConfig.update({
      where: { id: SINGLETON_ID },
      data: { solverMaxWastePercentage: dto.solverMaxWastePercentage },
    });

    // Best-effort: lỗi thông báo không được làm hỏng việc đổi đã ghi (đã có AuditLog làm căn cứ).
    try {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: { firstName: true, lastName: true, username: true },
      });
      const actorName = actor
        ? `${actor.lastName} ${actor.firstName}`.trim() || actor.username
        : 'KHSX';
      await this.notifications.emit('CUTTING_WASTE_DEFAULT_CHANGED', {
        entityId: 'system-config',
        actorId: actorUserId,
        params: {
          actorName,
          previous,
          next: dto.solverMaxWastePercentage,
          reason: dto.reason,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to notify waste-default change: ${(error as Error).message}`);
    }

    return new CuttingDefaultsResponseDto({
      solverMaxWastePercentage: updated.solverMaxWastePercentage.toNumber(),
      solverMachine: updated.solverMachine,
      ...this.cuttingParams(updated),
      previous,
      updatedAt: updated.updatedAt,
    });
  }

  async findOne(): Promise<SystemConfigResponseDto> {
    const config = await this.prisma.systemConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (!config) {
      throw new NotFoundException('System config has not been seeded');
    }
    return new SystemConfigResponseDto({
      ...config,
      solverStockLengths: config.solverStockLengths as number[],
      solverBladeWidthMm: config.solverBladeWidthMm.toNumber(),
      solverMctdBladeWidthMm: config.solverMctdBladeWidthMm.toNumber(),
      solverBundleFactors: config.solverBundleFactors as number[],
      solverMaxWastePercentage: config.solverMaxWastePercentage.toNumber(),
      purchaseOverReceiptTolerancePercent: config.purchaseOverReceiptTolerancePercent.toNumber(),
    });
  }

  async update(dto: UpdateSystemConfigDto): Promise<SystemConfigResponseDto> {
    const existing = await this.prisma.systemConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (!existing) {
      throw new NotFoundException('System config has not been seeded');
    }

    // floorPublicUrl chuẩn hoá về scheme://host[:port] (dán cả /login cũng được; rỗng = xoá). Không gửi field = giữ nguyên.
    // floorAllowedIps: chuẩn hoá từng dòng (IP/CIDR hợp lệ, bỏ trùng); rỗng = tắt giới hạn. Không gửi field = giữ nguyên.
    const data: typeof dto = { ...dto };
    if (dto.floorPublicUrl !== undefined)
      data.floorPublicUrl = normalizePublicUrl(dto.floorPublicUrl);
    if (dto.floorAllowedIps !== undefined)
      data.floorAllowedIps = normalizeAllowedIps(dto.floorAllowedIps);
    const updated = await this.prisma.systemConfig.update({
      where: { id: SINGLETON_ID },
      data,
    });
    // Có hiệu lực ngay trên instance này (instance khác chậm nhất 30 giây - xem NetworkAccessService).
    if (dto.floorAllowedIps !== undefined) this.network.invalidate();

    return new SystemConfigResponseDto({
      ...updated,
      solverStockLengths: updated.solverStockLengths as number[],
      solverBladeWidthMm: updated.solverBladeWidthMm.toNumber(),
      solverMctdBladeWidthMm: updated.solverMctdBladeWidthMm.toNumber(),
      solverBundleFactors: updated.solverBundleFactors as number[],
      solverMaxWastePercentage: updated.solverMaxWastePercentage.toNumber(),
      purchaseOverReceiptTolerancePercent: updated.purchaseOverReceiptTolerancePercent.toNumber(),
    });
  }

  /**
   * IP mà BE đang thấy của NGƯỜI GỌI + trạng thái giới hạn - Admin mở màn Cấu hình từ mạng công ty bấm "thêm IP hiện tại" để điền danh sách
   * đúng, và biết ngay BE có đọc đúng IP thật không (thấy IP nội bộ = chưa khai TRUST_PROXY_HOPS sau proxy).
   */
  async getNetworkInfo(clientIp: string | undefined) {
    return {
      ip: clientIp ?? null,
      isPrivate: clientIp ? isPrivateOrLoopbackIp(clientIp) : false,
      enforced: await this.network.isEnforced(),
      allowed: await this.network.isAllowed(clientIp),
    };
  }
}
