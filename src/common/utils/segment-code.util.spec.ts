import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SEGMENT_SUB_STEPS,
  compareSegmentCodes,
  isNormalizedSegmentSteps,
  normalizeSegmentSteps,
  parseSegmentSteps,
  segmentBucketLockKey,
  segmentCodeKey,
  segmentCodeLabel,
  segmentProductionLockKey,
  segmentStepsLabel,
} from './segment-code.util';

describe('segment-code.util', () => {
  describe('normalizeSegmentSteps', () => {
    it('bỏ CAT, sắp theo thứ tự nghiệp vụ, bỏ trùng', () => {
      expect(normalizeSegmentSteps(['CAT', 'TAN', 'NHAN'])).toBe('TAN,NHAN');
      expect(normalizeSegmentSteps(['CAT', 'NHAN', 'TAN'])).toBe('TAN,NHAN');
      expect(normalizeSegmentSteps(['TAN', 'UON', 'DAP', 'UON'])).toBe('UON,DAP,TAN');
      expect(normalizeSegmentSteps([' DAP '])).toBe('DAP');
    });

    it('chỉ cắt / rỗng / null là trơn', () => {
      expect(normalizeSegmentSteps(['CAT'])).toBe('');
      expect(normalizeSegmentSteps([])).toBe('');
      expect(normalizeSegmentSteps(null)).toBe('');
      expect(normalizeSegmentSteps(undefined)).toBe('');
    });

    it('công đoạn lạ thì báo lỗi, không lặng lẽ bỏ', () => {
      expect(() => normalizeSegmentSteps(['CAT', 'HAN'])).toThrow(/HAN/);
    });
  });

  describe('isNormalizedSegmentSteps / parseSegmentSteps', () => {
    it('nhận đúng dạng lưu', () => {
      expect(isNormalizedSegmentSteps('')).toBe(true);
      expect(isNormalizedSegmentSteps('DAP')).toBe(true);
      expect(isNormalizedSegmentSteps('UON,DAP,TAN')).toBe(true);
      expect(parseSegmentSteps('UON,DAP')).toEqual(['UON', 'DAP']);
      expect(parseSegmentSteps('')).toEqual([]);
    });

    it('từ chối sai thứ tự / trùng / có CAT / khoảng trắng / chữ thường', () => {
      for (const bad of [
        'DAP,UON',
        'DAP,DAP',
        'CAT',
        'CAT,DAP',
        'DAP, TAN',
        'dap',
        ',DAP',
        'DAP,',
      ]) {
        expect(isNormalizedSegmentSteps(bad)).toBe(false);
        expect(() => parseSegmentSteps(bad)).toThrow();
      }
    });
  });

  it('nhãn tiếng Việt', () => {
    expect(segmentStepsLabel('')).toBe('Trơn');
    expect(segmentStepsLabel('UON,DAP')).toBe('Uốn + Dập');
    expect(segmentStepsLabel('DUC_LO,TOP_DAU')).toBe('Đục lỗ + Tóp đầu');
    expect(segmentCodeLabel('SAT-005', 460, 'DAP')).toBe('SAT-005 @ 460mm · Dập');
    expect(segmentCodeLabel('SAT-005', 452.7, '')).toBe('SAT-005 @ 452.7mm · Trơn');
  });

  it('khoá và thứ tự mã đoạn', () => {
    expect(segmentCodeKey(18n, 'DAP')).toBe('18|DAP');
    expect(segmentCodeKey('18', '')).toBe('18|');
    expect(segmentBucketLockKey(6n, 18n, 'UON,DAP')).toBe('segment-stock:6:18:UON,DAP');
    expect(segmentProductionLockKey(900n)).toBe('segment-production:900');
    const codes = [
      { segmentSpecId: 20n, segmentSteps: '' },
      { segmentSpecId: 3n, segmentSteps: 'DAP' },
      { segmentSpecId: 3n, segmentSteps: '' },
      { segmentSpecId: 100n, segmentSteps: 'UON' },
    ];
    expect([...codes].sort(compareSegmentCodes)).toEqual([
      { segmentSpecId: 3n, segmentSteps: '' },
      { segmentSpecId: 3n, segmentSteps: 'DAP' },
      { segmentSpecId: 20n, segmentSteps: '' },
      { segmentSpecId: 100n, segmentSteps: 'UON' },
    ]);
  });

  it('danh sách công đoạn trùng với CHECK của migration tồn đoạn', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20261113180000_segment_stock_by_order/migration.sql',
      ),
      'utf8',
    );
    const lists = [...sql.matchAll(/\^\(([A-Z_|]+)\)\(,\(([A-Z_|]+)\)\)\*\$/g)];
    // 4 CHECK: stock_ledger, stock_quant, segment_reservations, segment_productions.
    expect(lists).toHaveLength(4);
    for (const m of lists) {
      expect(m[1].split('|')).toEqual([...SEGMENT_SUB_STEPS]);
      expect(m[2].split('|')).toEqual([...SEGMENT_SUB_STEPS]);
    }
  });
});
