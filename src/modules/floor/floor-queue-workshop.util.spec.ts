import { MfgStage } from '../../generated/prisma/client';
import {
  loadDefaultWorkshopId,
  queueLockKey,
  queueWorkshopIdOfPi,
  queueWorkshopIdsOfPis,
  resolveQueueWorkshopId,
  workstationQueueWorkshopId,
} from './floor-queue-workshop.util';

const PHU_AN = 1n;
const PHUOC_AN = 2n;

function makeDb(opts: {
  rootWorkshopId?: bigint | null;
  firstActive?: bigint | null;
  items?: Array<{ productionInvoiceId: bigint; workshopId: bigint | null }>;
}) {
  return {
    warehouse: {
      findUnique: jest.fn().mockResolvedValue({
        workshopId: opts.rootWorkshopId === undefined ? PHU_AN : opts.rootWorkshopId,
      }),
    },
    workshop: {
      findFirst: jest.fn().mockResolvedValue(opts.firstActive ? { id: opts.firstActive } : null),
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: { in: bigint[] } } }) =>
          Promise.resolve(
            where.id.in.map((id) => ({ id, paintWorkshopId: id === PHUOC_AN ? PHU_AN : null })),
          ),
        ),
    },
    productionInvoiceItem: { findMany: jest.fn().mockResolvedValue(opts.items ?? []) },
  } as never;
}

describe('floor-queue-workshop.util', () => {
  it('resolveQueueWorkshopId: Sơn của Phước An đi theo xưởng sơn nhờ, Phôi/Hàn giữ xưởng của PI', () => {
    const paint = new Map<string, bigint | null>([
      ['2', PHU_AN],
      ['1', null],
    ]);
    expect(resolveQueueWorkshopId(MfgStage.SON, PHUOC_AN, paint)).toBe(PHU_AN);
    expect(resolveQueueWorkshopId(MfgStage.PHOI, PHUOC_AN, paint)).toBe(PHUOC_AN);
    expect(resolveQueueWorkshopId(MfgStage.HAN, PHUOC_AN, paint)).toBe(PHUOC_AN);
    expect(resolveQueueWorkshopId(MfgStage.SON, PHU_AN, paint)).toBe(PHU_AN);
    expect(resolveQueueWorkshopId(MfgStage.SON, null, paint)).toBeNull();
  });

  it('xưởng mặc định: xưởng của kho phoi-son-han, rồi xưởng đang dùng đầu tiên, rồi null', async () => {
    expect(await loadDefaultWorkshopId(makeDb({}))).toBe(PHU_AN);
    expect(await loadDefaultWorkshopId(makeDb({ rootWorkshopId: null, firstActive: 7n }))).toBe(7n);
    expect(await loadDefaultWorkshopId(makeDb({ rootWorkshopId: null }))).toBeNull();
  });

  it('máy chưa gắn xưởng lấy xưởng mặc định, máy đã gắn giữ nguyên (không đổi theo xưởng sơn)', async () => {
    expect(await workstationQueueWorkshopId(makeDb({}), null)).toBe(PHU_AN);
    expect(await workstationQueueWorkshopId(makeDb({}), PHUOC_AN)).toBe(PHUOC_AN);
  });

  it('queueWorkshopIdsOfPis: PI có xưởng / chưa có xưởng, theo tổ', async () => {
    const db = makeDb({ items: [{ productionInvoiceId: 10n, workshopId: PHUOC_AN }] });
    const phoi = await queueWorkshopIdsOfPis(db, MfgStage.PHOI, [10n, 11n]);
    expect(phoi.get('10')).toBe(PHUOC_AN);
    expect(phoi.get('11')).toBe(PHU_AN); // chưa có xưởng -> mặc định
    const son = await queueWorkshopIdsOfPis(db, MfgStage.SON, [10n, 11n]);
    expect(son.get('10')).toBe(PHU_AN); // Phước An sơn ở Phú An
    expect(son.get('11')).toBe(PHU_AN);
  });

  it('queueWorkshopIdOfPi + khoá advisory', async () => {
    const db = makeDb({ items: [{ productionInvoiceId: 10n, workshopId: PHUOC_AN }] });
    expect(await queueWorkshopIdOfPi(db, MfgStage.SON, 10n)).toBe(PHU_AN);
    expect(queueLockKey('SON', PHU_AN)).toBe('floor-queue:SON:1');
    expect(queueLockKey('SON', null)).toBe('floor-queue:SON:none');
  });
});
