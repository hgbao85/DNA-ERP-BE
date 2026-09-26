import { Inject, Injectable } from '@nestjs/common';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { RecipientCriteria } from './notification-types';

/**
 * Dịch `RecipientCriteria` (khai báo ở NOTIFICATION_TYPES) sang danh sách userId cụ thể - luôn
 * lọc `isActive && !deletedAt` (không báo cho tài khoản đã khoá/xoá), luôn gộp OR giữa các nhóm
 * tiêu chí, luôn khử trùng lặp (1 user khớp nhiều tiêu chí chỉ nhận 1 dòng).
 */
@Injectable()
export class RecipientResolverService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  /**
   * @param excludeUserIds Loại khỏi kết quả sau khi đã gộp - dùng để không báo cho chính người
   *   vừa thao tác (`actorId`), trừ khi type khai `notifyActor: true`.
   */
  async resolve(
    criteria: RecipientCriteria,
    excludeUserIds: string[] = [],
    tx?: PrismaTx,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const ids = new Set<string>();

    if (criteria.allActiveUsers) {
      const users = await client.user.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    if (criteria.roles?.length) {
      const users = await client.user.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          roles: { some: { role: { name: { in: criteria.roles } } } },
        },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    if (criteria.mfgRoles?.length) {
      const users = await client.user.findMany({
        where: { isActive: true, deletedAt: null, mfgRole: { in: criteria.mfgRoles } },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    if (criteria.warehouseIds?.length) {
      const users = await client.user.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          warehouseScope: { in: criteria.warehouseIds },
        },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    if (criteria.userIds?.length) {
      const users = await client.user.findMany({
        where: { id: { in: criteria.userIds }, isActive: true, deletedAt: null },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    excludeUserIds.forEach((id) => ids.delete(id));
    return [...ids];
  }
}
