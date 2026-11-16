import { ConflictException } from '@nestjs/common';
import type { PrismaTx } from '../../prisma/prisma.service';
import { assertWorkshopUnchanged, lockPisForIssue, workshopsOfPis } from './pi-workshop-lock.util';

describe('pi-workshop-lock.util (rà soát 14/11 CK6 - khoá chung đổi xưởng / xuất kho)', () => {
  const makeTx = () => ({
    $queryRaw: jest.fn(),
    productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([]) },
  });

  it('workshopsOfPis: lệnh chưa có SKU nào chọn xưởng -> null', async () => {
    const tx = makeTx();
    tx.productionInvoiceItem.findMany.mockResolvedValue([
      { productionInvoiceId: 7n, workshopId: 2n },
    ]);

    const result = await workshopsOfPis(tx as unknown as PrismaTx, [7n, 8n]);

    expect(result.get('7')).toBe(2n);
    expect(result.get('8')).toBeNull();
  });

  it('lockPisForIssue: khoá FOR UPDATE theo id TĂNG (bỏ trùng), đọc xưởng + cờ SAU khoá', async () => {
    const tx = makeTx();
    tx.$queryRaw.mockResolvedValue([
      { id: 3n, cuttingRecheckRequired: false },
      { id: 9n, cuttingRecheckRequired: true },
    ]);
    tx.productionInvoiceItem.findMany.mockResolvedValue([
      { productionInvoiceId: 3n, workshopId: 1n },
    ]);

    const result = await lockPisForIssue(tx as unknown as PrismaTx, [9n, 3n, 9n]);

    const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toContain('FOR UPDATE');
    expect(
      JSON.stringify(values, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
    ).toContain('"3","9"');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.productionInvoiceItem.findMany.mock.invocationCallOrder[0],
    );
    expect(result.get('3')).toEqual({ workshopId: 1n, cuttingRecheckRequired: false });
    expect(result.get('9')).toEqual({ workshopId: null, cuttingRecheckRequired: true });
  });

  it('lockPisForIssue: không có lệnh nào -> không khoá gì', async () => {
    const tx = makeTx();
    expect((await lockPisForIssue(tx as unknown as PrismaTx, [])).size).toBe(0);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('assertWorkshopUnchanged: xưởng sau khoá khác lúc tra kho -> 409; trùng -> qua', () => {
    expect(() =>
      assertWorkshopUnchanged({ workshopId: 2n, cuttingRecheckRequired: false }, 1n),
    ).toThrow(ConflictException);
    expect(() =>
      assertWorkshopUnchanged({ workshopId: 1n, cuttingRecheckRequired: false }, 1n),
    ).not.toThrow();
    expect(() => assertWorkshopUnchanged(undefined, null)).not.toThrow();
  });
});
