import { FloorQueueStatus, MfgStage } from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { moveOpenQueueEntriesToPiWorkshop } from './floor-queue-move.util';

jest.mock('../../common/utils/advisory-lock.util', () => ({
  lockBusinessKey: jest.fn().mockResolvedValue(undefined),
}));

const PHU_AN = 1n;
const PHUOC_AN = 2n;
const XUONG_3 = 3n;
const PI = 7n;

interface Row {
  id: bigint;
  stage: MfgStage;
  productionInvoiceId: bigint;
  workshopId: bigint | null;
  position: number;
  status: FloorQueueStatus;
  startedAt: Date | null;
  startedById: string | null;
}

/** tx giả trong bộ nhớ: bảng hàng đợi + xưởng của PI (đã đổi sang xưởng mới) + bảng xưởng sơn nhờ (Phước An sơn ở Phú An). */
function makeTx(rows: Row[], piWorkshopId: bigint | null) {
  const matches = (r: Row, where: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(where)) {
      const val = (r as unknown as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && 'in' in v) {
        if (!(v as { in: unknown[] }).in.includes(val)) return false;
      } else if (val !== v) return false;
    }
    return true;
  };
  const tx = {
    floorQueueEntry: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(rows.filter((r) => matches(r, where)).map((r) => ({ ...r }))),
      ),
      aggregate: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const pos = rows.filter((r) => matches(r, where)).map((r) => r.position);
        return Promise.resolve({ _max: { position: pos.length ? Math.max(...pos) : null } });
      }),
      update: jest.fn(({ where, data }: { where: { id: bigint }; data: Partial<Row> }) => {
        const r = rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return Promise.resolve(r);
      }),
    },
    productionInvoiceItem: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          piWorkshopId == null ? [] : [{ productionInvoiceId: PI, workshopId: piWorkshopId }],
        ),
    },
    warehouse: { findUnique: jest.fn().mockResolvedValue({ workshopId: PHU_AN }) },
    workshop: {
      findFirst: jest.fn().mockResolvedValue({ id: PHU_AN }),
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: { in: bigint[] } } }) =>
          Promise.resolve(
            where.id.in.map((id) => ({ id, paintWorkshopId: id === PHUOC_AN ? PHU_AN : null })),
          ),
        ),
    },
  };
  return tx;
}

const row = (p: Partial<Row> & Pick<Row, 'id' | 'stage'>): Row => ({
  productionInvoiceId: PI,
  workshopId: PHU_AN,
  position: 1,
  status: FloorQueueStatus.QUEUED,
  startedAt: null,
  startedById: null,
  ...p,
});

const lockMock = lockBusinessKey as jest.Mock;

describe('moveOpenQueueEntriesToPiWorkshop', () => {
  beforeEach(() => lockMock.mockClear());

  it('không có dòng hàng đợi mở nào -> [] và không khoá', async () => {
    const tx = makeTx(
      [row({ id: 1n, stage: MfgStage.PHOI, status: FloorQueueStatus.DONE })],
      XUONG_3,
    );
    await expect(moveOpenQueueEntriesToPiWorkshop(tx as never, PI)).resolves.toEqual([]);
    expect(lockMock).not.toHaveBeenCalled();
  });

  it('QUEUED dời xuống CUỐI hàng của xưởng mới, giữ trạng thái chờ', async () => {
    const rows = [
      row({ id: 1n, stage: MfgStage.PHOI, workshopId: PHU_AN, position: 2 }),
      // PI khác đã đứng trong hàng đợi Phôi của xưởng mới
      row({
        id: 2n,
        stage: MfgStage.PHOI,
        workshopId: XUONG_3,
        position: 5,
        productionInvoiceId: 99n,
      }),
    ];
    const tx = makeTx(rows, XUONG_3);
    const moves = await moveOpenQueueEntriesToPiWorkshop(tx as never, PI);
    expect(moves).toEqual([
      { stage: MfgStage.PHOI, fromWorkshopId: PHU_AN, toWorkshopId: XUONG_3, wasRunning: false },
    ]);
    expect(rows[0]).toMatchObject({
      workshopId: XUONG_3,
      position: 6,
      status: FloorQueueStatus.QUEUED,
    });
  });

  it('RUNNING thành QUEUED ở cuối hàng, xoá startedAt / startedById', async () => {
    const rows = [
      row({
        id: 1n,
        stage: MfgStage.HAN,
        status: FloorQueueStatus.RUNNING,
        startedAt: new Date('2026-11-16T01:00:00Z'),
        startedById: 'u1',
      }),
    ];
    const tx = makeTx(rows, XUONG_3);
    const moves = await moveOpenQueueEntriesToPiWorkshop(tx as never, PI);
    expect(moves).toEqual([
      { stage: MfgStage.HAN, fromWorkshopId: PHU_AN, toWorkshopId: XUONG_3, wasRunning: true },
    ]);
    expect(rows[0]).toMatchObject({
      workshopId: XUONG_3,
      position: 1,
      status: FloorQueueStatus.QUEUED,
      startedAt: null,
      startedById: null,
    });
  });

  it('DONE giữ nguyên ở xưởng cũ, dòng mở vẫn dời', async () => {
    const rows = [
      row({ id: 1n, stage: MfgStage.PHOI, status: FloorQueueStatus.DONE }),
      row({ id: 2n, stage: MfgStage.HAN }),
    ];
    const tx = makeTx(rows, XUONG_3);
    const moves = await moveOpenQueueEntriesToPiWorkshop(tx as never, PI);
    expect(moves.map((m) => m.stage)).toEqual([MfgStage.HAN]);
    expect(rows[0]).toMatchObject({ workshopId: PHU_AN, status: FloorQueueStatus.DONE });
    expect(rows[1].workshopId).toBe(XUONG_3);
  });

  it('Sơn: xưởng mới sơn nhờ ở xưởng đang giữ dòng thì giữ; khác nơi sơn thì dời sang nơi sơn', async () => {
    // Xưởng mới = Phước An (sơn nhờ ở Phú An): Phôi dời sang Phước An, Sơn đang ở Phú An nên giữ.
    const rows = [
      row({ id: 1n, stage: MfgStage.PHOI, workshopId: XUONG_3 }),
      row({ id: 2n, stage: MfgStage.SON, workshopId: PHU_AN }),
    ];
    const tx = makeTx(rows, PHUOC_AN);
    const moves = await moveOpenQueueEntriesToPiWorkshop(tx as never, PI);
    expect(moves).toHaveLength(1);
    expect(rows[0].workshopId).toBe(PHUOC_AN);
    expect(rows[1].workshopId).toBe(PHU_AN);

    // Dòng Sơn đang ở xưởng 3 mà nơi sơn mới là Phú An -> dời.
    const rows2 = [row({ id: 3n, stage: MfgStage.SON, workshopId: XUONG_3 })];
    const moves2 = await moveOpenQueueEntriesToPiWorkshop(makeTx(rows2, PHUOC_AN) as never, PI);
    expect(moves2).toEqual([
      { stage: MfgStage.SON, fromWorkshopId: XUONG_3, toWorkshopId: PHU_AN, wasRunning: false },
    ]);
    expect(rows2[0].workshopId).toBe(PHU_AN);
  });

  it('khoá hàng đợi cũ + mới của mọi dòng, không trùng, theo thứ tự tăng dần', async () => {
    const rows = [
      row({ id: 1n, stage: MfgStage.PHOI, workshopId: PHU_AN }),
      row({ id: 2n, stage: MfgStage.HAN, workshopId: PHU_AN }),
      row({ id: 3n, stage: MfgStage.SON, workshopId: PHU_AN }),
    ];
    const tx = makeTx(rows, XUONG_3);
    await moveOpenQueueEntriesToPiWorkshop(tx as never, PI);
    const keys = (lockMock.mock.calls as [unknown, string][]).map((c) => c[1]);
    expect(keys).toEqual([...new Set(keys)].sort());
    expect(keys).toEqual([
      'floor-queue:HAN:1',
      'floor-queue:HAN:3',
      'floor-queue:PHOI:1',
      'floor-queue:PHOI:3',
      'floor-queue:SON:1',
      'floor-queue:SON:3',
    ]);
  });

  it('dòng thành DONE sau khi khoá thì bỏ qua (không dời)', async () => {
    const rows = [row({ id: 1n, stage: MfgStage.PHOI }), row({ id: 2n, stage: MfgStage.HAN })];
    const tx = makeTx(rows, XUONG_3);
    // Trong lúc chờ khoá, tổ Phôi bấm xong dòng Phôi.
    lockMock.mockImplementationOnce(() => {
      rows[0].status = FloorQueueStatus.DONE;
      return Promise.resolve();
    });
    const moves = await moveOpenQueueEntriesToPiWorkshop(tx as never, PI);
    expect(moves.map((m) => m.stage)).toEqual([MfgStage.HAN]);
    expect(rows[0]).toMatchObject({ workshopId: PHU_AN, status: FloorQueueStatus.DONE });
  });
});
