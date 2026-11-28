/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return -- gọi hàm private qua prototype, tx mock */
import { BadRequestException } from '@nestjs/common';
import { SteelReturnStatus } from '../../generated/prisma/client';
import { SteelIssuesService } from './steel-issues.service';

jest.mock('./steel-usage.util', () => {
  const actual = jest.requireActual('./steel-usage.util');
  return {
    ...actual,
    // 2 cây 6000 đã nhận, tề đầu 0 -> dùng được 12000 mm; đã báo 0; mạch cưa 0.
    loadSteelUsage: jest.fn().mockResolvedValue({
      receivedBarCount: 2,
      usableMm: 12000,
      reportedMm: 0,
      trimMm: 0,
      kerfMm: 0,
    }),
  };
});

/**
 * Chặn báo cắt vượt 102% sắt (giao nhận giữa tổ) - 28/11: phải trừ cây tổ cắt đã nhập trả (SKU huỷ ngưng cắt). Trước đây giới hạn
 * vẫn tính cả cây đã trả nên báo vượt lọt.
 */
describe('assertCutWithinSteelInTx - trừ cây đã nhập trả', () => {
  const call = (returns: any[], qty: number) => {
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      stageHandoverOverride: { aggregate: jest.fn().mockResolvedValue({ _sum: { qty: null } }) },
      steelReturn: { findMany: jest.fn().mockResolvedValue(returns) },
      material: { findUnique: jest.fn().mockResolvedValue({ code: 'SAT-001' }) },
    };
    const self: any = { logger: { warn: jest.fn() } };
    return (SteelIssuesService.prototype as any).assertCutWithinSteelInTx.call(self, tx, {
      piId: 1n,
      materialId: 2n,
      lines: [{ qty, cutLengthMm: 1000 }],
    });
  };
  const ret = (over: Record<string, unknown> = {}) => ({
    id: 5n,
    status: SteelReturnStatus.CONFIRMED,
    bars: 1,
    confirmedBars: 1,
    makeupForId: null,
    shortLostAt: null,
    lengthMm: 6000,
    ...over,
  });

  it('không trả cây: báo 12 đoạn 1000 mm trong 12000 mm -> cho', async () => {
    await expect(call([], 12)).resolves.toBeUndefined();
  });

  it('đã trả 1 cây 6000: còn 6000 (+2%) -> 7 đoạn bị chặn, 6 đoạn cho', async () => {
    await expect(call([ret()], 7)).rejects.toBeInstanceOf(BadRequestException);
    await expect(call([ret()], 6)).resolves.toBeUndefined();
  });

  it('thủ kho đếm thiếu (0/1, phương án a): cây vẫn ở tổ -> không trừ', async () => {
    await expect(call([ret({ confirmedBars: 0 })], 12)).resolves.toBeUndefined();
  });
});
