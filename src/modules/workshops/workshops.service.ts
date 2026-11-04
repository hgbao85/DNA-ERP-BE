import { Inject, Injectable } from '@nestjs/common';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { WorkshopResponseDto } from './dto/workshop-response.dto';

/** Phần A – Đợt 2: danh sách xưởng cơ khí đang hoạt động (chọn xưởng ở dòng lệnh SX). */
@Injectable()
export class WorkshopsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async findActive(): Promise<WorkshopResponseDto[]> {
    const rows = await this.prisma.workshop.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map(
      (w) =>
        new WorkshopResponseDto({
          id: w.id.toString(),
          code: w.code,
          name: w.name,
          capacityMode: w.capacityMode,
          paintWorkshopId: w.paintWorkshopId === null ? null : w.paintWorkshopId.toString(),
          sortOrder: w.sortOrder,
        }),
    );
  }
}
