import { WorkshopCapacityMode } from '../../generated/prisma/client';
import type { PrismaServiceType } from '../../prisma/prisma.service';
import { WorkshopsService } from './workshops.service';

describe('WorkshopsService', () => {
  let prisma: { workshop: { findMany: jest.Mock } };
  let service: WorkshopsService;

  beforeEach(() => {
    prisma = { workshop: { findMany: jest.fn() } };
    service = new WorkshopsService(prisma as unknown as PrismaServiceType);
  });

  it('chỉ lấy xưởng đang hoạt động, xếp sortOrder rồi id', async () => {
    prisma.workshop.findMany.mockResolvedValue([]);
    await service.findActive();
    expect(prisma.workshop.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
  });

  it('đổi bigint thành chuỗi, giữ thứ tự DB trả và chỉ lộ đúng các trường khai báo', async () => {
    prisma.workshop.findMany.mockResolvedValue([
      {
        id: 1n,
        code: 'PHU_AN',
        name: 'Xưởng Phú An',
        capacityMode: WorkshopCapacityMode.CONT_PER_DAY,
        paintWorkshopId: null,
        sortOrder: 1,
        isActive: true,
        createdAt: new Date(),
      },
      {
        id: 2n,
        code: 'PHUOC_AN',
        name: 'Xưởng Phước An',
        capacityMode: WorkshopCapacityMode.DAYS_PER_CONT,
        paintWorkshopId: 1n,
        sortOrder: 2,
        isActive: true,
        updatedAt: new Date(),
      },
    ]);

    const r = await service.findActive();

    expect(r.map((w) => w.id)).toEqual(['1', '2']);
    expect(r[0].paintWorkshopId).toBeNull();
    expect(r[1].paintWorkshopId).toBe('1');
    expect(r[1].capacityMode).toBe(WorkshopCapacityMode.DAYS_PER_CONT);
    expect(Object.keys(r[0]).sort()).toEqual(
      ['capacityMode', 'code', 'id', 'name', 'paintWorkshopId', 'sortOrder'].sort(),
    );
  });
});
