import { SortOrder } from '../../common/dto/pagination-query.dto';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: { auditLog: { findMany: jest.Mock; count: jest.Mock } };

  beforeEach(() => {
    prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    service = new AuditLogService(prisma as unknown as PrismaServiceType);
  });

  describe('findAll - filters', () => {
    it('passes tableName/recordId/userId straight through as an AND filter', async () => {
      await service.findAll({
        page: 1,
        limit: 20,
        sortOrder: SortOrder.DESC,
        tableName: 'sku',
        recordId: 'sku-1',
        userId: 'user-1',
      } as any);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tableName: 'sku', recordId: 'sku-1', userId: 'user-1' },
        }),
      );
      expect(prisma.auditLog.count).toHaveBeenCalledWith({
        where: { tableName: 'sku', recordId: 'sku-1', userId: 'user-1' },
      });
    });

    it('leaves unset filters as undefined instead of narrowing to null-only rows', async () => {
      await service.findAll({ page: 1, limit: 20, sortOrder: SortOrder.DESC } as any);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tableName: undefined, recordId: undefined, userId: undefined },
        }),
      );
    });
  });

  describe('findAll - sorting and pagination', () => {
    it('defaults to sorting by createdAt in the requested order when sortBy is omitted', async () => {
      await service.findAll({ page: 2, limit: 10, skip: 10, sortOrder: SortOrder.ASC });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: SortOrder.ASC }, skip: 10, take: 10 }),
      );
    });

    it('sorts by the caller-provided field instead when sortBy is set', async () => {
      await service.findAll({
        page: 1,
        limit: 20,
        sortBy: 'tableName',
        sortOrder: SortOrder.ASC,
      } as any);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { tableName: SortOrder.ASC } }),
      );
    });

    it('computes pagination meta (totalPages) from the real total returned by count', async () => {
      prisma.auditLog.count.mockResolvedValue(45);

      const result = await service.findAll({
        page: 2,
        limit: 20,
        sortOrder: SortOrder.DESC,
      } as any);

      expect(result.meta).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 });
    });
  });
});
