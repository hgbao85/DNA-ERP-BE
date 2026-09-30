import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
      previous: null,
      updatedAt: config.updatedAt,
    });
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
      solverMaxWastePercentage: config.solverMaxWastePercentage.toNumber(),
      purchaseOverReceiptTolerancePercent: config.purchaseOverReceiptTolerancePercent.toNumber(),
    });
  }

  async update(dto: UpdateSystemConfigDto): Promise<SystemConfigResponseDto> {
    const existing = await this.prisma.systemConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (!existing) {
      throw new NotFoundException('System config has not been seeded');
    }

    const updated = await this.prisma.systemConfig.update({
      where: { id: SINGLETON_ID },
      data: dto,
    });

    return new SystemConfigResponseDto({
      ...updated,
      solverStockLengths: updated.solverStockLengths as number[],
      solverBladeWidthMm: updated.solverBladeWidthMm.toNumber(),
      solverMaxWastePercentage: updated.solverMaxWastePercentage.toNumber(),
      purchaseOverReceiptTolerancePercent: updated.purchaseOverReceiptTolerancePercent.toNumber(),
    });
  }
}
