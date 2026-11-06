import type { PrismaTx } from '../../prisma/prisma.service';
import { allocateSlipCode, formatSlipCode, vnDayStamp } from './slip-code.util';

describe('slip-code.util (bản v8 4.8)', () => {
  it('ngày theo giờ VN: 17:30 UTC ngày 05/11 đã là 06/11 ở VN', () => {
    expect(vnDayStamp(new Date('2026-11-05T17:30:00Z'))).toBe('261106');
    expect(vnDayStamp(new Date('2026-11-05T16:59:59Z'))).toBe('261105');
    expect(vnDayStamp(new Date('2026-12-31T17:00:00Z'))).toBe('270101');
  });

  it('số 3 chữ số, quá 999 thì dài thêm', () => {
    expect(formatSlipCode('NK', '261106', 1)).toBe('NK-261106-001');
    expect(formatSlipCode('XK', '261106', 42)).toBe('XK-261106-042');
    expect(formatSlipCode('XK', '261106', 1000)).toBe('XK-261106-1000');
  });

  it('cấp số tiếp theo của (loại, ngày VN) qua INSERT ... ON CONFLICT', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ lastSeq: 7 }]) };
    const code = await allocateSlipCode(
      tx as unknown as PrismaTx,
      'XK',
      new Date('2026-11-06T02:00:00Z'),
    );
    expect(code).toBe('XK-261106-007');
    const [strings, kind, day] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string,
      string,
    ];
    expect(strings.join('?')).toContain('ON CONFLICT');
    expect([kind, day]).toEqual(['XK', '261106']);
  });
});
