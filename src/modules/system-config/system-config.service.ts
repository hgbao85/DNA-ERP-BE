import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { SystemConfigResponseDto } from './dto/system-config-response.dto';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';

/** Singleton row id, pinned by a DB CHECK constraint - see prisma/migrations. */
const SINGLETON_ID = 1;

@Injectable()
export class SystemConfigService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async findOne(): Promise<SystemConfigResponseDto> {
    const config = await this.prisma.systemConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (!config) {
      throw new NotFoundException('System config has not been seeded');
    }
    return new SystemConfigResponseDto(config);
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

    return new SystemConfigResponseDto(updated);
  }
}
