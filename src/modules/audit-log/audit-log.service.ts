import { Inject, Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

@Injectable()
export class AuditLogService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async findAll(query: QueryAuditLogDto): Promise<Paginated<AuditLog>> {
    const where: Prisma.AuditLogWhereInput = {
      tableName: query.tableName,
      recordId: query.recordId,
      userId: query.userId,
    };

    return paginate(
      this.prisma.auditLog,
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { createdAt: query.sortOrder },
    );
  }
}
