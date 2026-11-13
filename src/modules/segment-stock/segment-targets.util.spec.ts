import { SEGMENT_SUB_STEPS, SegmentSubStep } from '../../common/utils/segment-code.util';
import { computeSegmentTargets, SegmentTargetsResult } from './segment-targets.util';

/** Gọn: [segmentSteps, held, surplus] của từng dòng output. */
function rows(r: SegmentTargetsResult): [string, number, number][] {
  return r.variants.map((v) => [v.segmentSteps, v.heldQty, v.surplusQty]);
}

describe('computeSegmentTargets', () => {
  it('E1: trơn 100 + DAP 50, cắt 120, DAP 20 -> DAP giữ 20, trơn 70, chờ 30', () => {
    const r = computeSegmentTargets({
      cutPassedQty: 120,
      stepPassedQty: { DAP: 20 },
      variants: [
        { segmentSteps: '', needQty: 100 },
        { segmentSteps: 'DAP', needQty: 50 },
      ],
    });
    expect(rows(r)).toEqual([
      ['DAP', 20, 0],
      ['', 70, 0],
    ]);
    expect(r.wipQty).toBe(30);
    expect(r.leftoverStepQty).toEqual({});
  });

  it('E2: DAP 50, cắt 60, DAP 55 -> DAP 50 / dư 5, trơn dư 5', () => {
    const r = computeSegmentTargets({
      cutPassedQty: 60,
      stepPassedQty: { DAP: 55 },
      variants: [{ segmentSteps: 'DAP', needQty: 50 }],
    });
    expect(rows(r)).toEqual([
      ['DAP', 50, 5],
      ['', 0, 5],
    ]);
    expect(r.wipQty).toBe(0);
  });

  it('E3: UON,DAP 50, cắt 60, UON 40, DAP 30 -> 30 / 0, trơn dư 10, chờ 20, lệch UON 10', () => {
    const r = computeSegmentTargets({
      cutPassedQty: 60,
      stepPassedQty: { UON: 40, DAP: 30 },
      variants: [{ segmentSteps: 'UON,DAP', needQty: 50 }],
    });
    expect(rows(r)).toEqual([
      ['UON,DAP', 30, 0],
      ['', 0, 10],
    ]);
    expect(r.wipQty).toBe(20);
    expect(r.leftoverStepQty).toEqual({ UON: 10 });
  });

  it('E4: DAP 50 + trơn 50, cắt 100, DAP 60 -> DAP 50 / 10, trơn 40 / 0', () => {
    const r = computeSegmentTargets({
      cutPassedQty: 100,
      stepPassedQty: { DAP: 60 },
      variants: [
        { segmentSteps: 'DAP', needQty: 50 },
        { segmentSteps: '', needQty: 50 },
      ],
    });
    expect(rows(r)).toEqual([
      ['DAP', 50, 10],
      ['', 40, 0],
    ]);
  });

  it('E5: DAP,TAN 50 + DAP 50, cắt 100, DAP 100, TAN 80 -> 50 / 0 và 50 / 0, lệch TAN 30', () => {
    const r = computeSegmentTargets({
      cutPassedQty: 100,
      stepPassedQty: { DAP: 100, TAN: 80 },
      variants: [
        { segmentSteps: 'DAP,TAN', needQty: 50 },
        { segmentSteps: 'DAP', needQty: 50 },
      ],
    });
    expect(rows(r)).toEqual([
      ['DAP,TAN', 50, 0],
      ['DAP', 50, 0],
    ]);
    expect(r.leftoverStepQty).toEqual({ TAN: 30 });
  });

  it('E6: DAP,TAN 10 + DAP 60 + TAN 60, cắt 130, DAP 70, TAN 70 -> 10, 60, 60 đều không dư', () => {
    const r = computeSegmentTargets({
      cutPassedQty: 130,
      stepPassedQty: { DAP: 70, TAN: 70 },
      variants: [
        { segmentSteps: 'DAP,TAN', needQty: 10 },
        { segmentSteps: 'DAP', needQty: 60 },
        { segmentSteps: 'TAN', needQty: 60 },
      ],
    });
    expect(rows(r)).toEqual([
      ['DAP,TAN', 10, 0],
      ['DAP', 60, 0],
      ['TAN', 60, 0],
    ]);
    expect(r.wipQty).toBe(0);
    expect(r.leftoverStepQty).toEqual({});
  });

  it('E7: chưa cắt đoạn nào -> mọi số 0', () => {
    const r = computeSegmentTargets({
      cutPassedQty: 0,
      stepPassedQty: {},
      variants: [
        { segmentSteps: '', needQty: 30 },
        { segmentSteps: 'DAP', needQty: 50 },
      ],
    });
    expect(rows(r)).toEqual([
      ['DAP', 0, 0],
      ['', 0, 0],
    ]);
    expect(r.wipQty).toBe(0);
    expect(r.leftoverStepQty).toEqual({});
  });

  it('E8: UON 50, cắt 50, chưa công đoạn nào -> 0 / 0, không có dòng trơn, chờ 50', () => {
    const r = computeSegmentTargets({
      cutPassedQty: 50,
      stepPassedQty: {},
      variants: [{ segmentSteps: 'UON', needQty: 50 }],
    });
    expect(rows(r)).toEqual([['UON', 0, 0]]);
    expect(r.wipQty).toBe(50);
  });

  it('E9: trơn 100, cắt 110 -> giữ 100, dư 10', () => {
    const r = computeSegmentTargets({
      cutPassedQty: 110,
      stepPassedQty: {},
      variants: [{ segmentSteps: '', needQty: 100 }],
    });
    expect(rows(r)).toEqual([['', 100, 10]]);
  });

  it('E10: DAP 50, cắt 30, DAP 40 -> DAP 30 / 0, lệch DAP 10', () => {
    const r = computeSegmentTargets({
      cutPassedQty: 30,
      stepPassedQty: { DAP: 40 },
      variants: [{ segmentSteps: 'DAP', needQty: 50 }],
    });
    expect(rows(r)).toEqual([['DAP', 30, 0]]);
    expect(r.leftoverStepQty).toEqual({ DAP: 10 });
  });

  it('E11: cỡ cắt ngoài định mức (không có variants), cắt 20, DAP 5 -> trơn dư 15, lệch DAP 5', () => {
    const r = computeSegmentTargets({
      cutPassedQty: 20,
      stepPassedQty: { DAP: 5 },
      variants: [],
    });
    expect(rows(r)).toEqual([['', 0, 15]]);
    expect(r.leftoverStepQty).toEqual({ DAP: 5 });
  });

  it('gộp mã trùng, bỏ số cần <= 0, kẹp số âm về 0', () => {
    const r = computeSegmentTargets({
      cutPassedQty: -5,
      stepPassedQty: { DAP: -3 },
      variants: [
        { segmentSteps: 'DAP', needQty: 20 },
        { segmentSteps: 'DAP', needQty: 30 },
        { segmentSteps: 'UON', needQty: 0 },
        { segmentSteps: '', needQty: -4 },
      ],
    });
    expect(r.variants).toEqual([{ segmentSteps: 'DAP', needQty: 50, heldQty: 0, surplusQty: 0 }]);
  });

  it('segmentSteps sai dạng -> ném lỗi', () => {
    expect(() =>
      computeSegmentTargets({
        cutPassedQty: 1,
        stepPassedQty: {},
        variants: [{ segmentSteps: 'DAP,UON', needQty: 1 }],
      }),
    ).toThrow(/không đúng dạng mã đoạn/);
  });

  it('bất biến trên 200 bộ số ngẫu nhiên (seed cố định)', () => {
    // PRNG mulberry32 nhỏ, seed cố định để test lặp lại được.
    let a = 123456789;
    const rnd = (): number => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (max: number): number => Math.floor(rnd() * (max + 1));
    const pool = ['', 'UON', 'DAP', 'TAN', 'UON,DAP', 'DAP,TAN', 'UON,DAP,TAN', 'DUC_LO,TAN'];

    for (let i = 0; i < 200; i++) {
      const cut = int(200);
      const P: Partial<Record<SegmentSubStep, number>> = {};
      for (const t of SEGMENT_SUB_STEPS) if (rnd() < 0.5) P[t] = int(220);
      const variants = pool
        .filter(() => rnd() < 0.5)
        .map((s) => ({
          segmentSteps: s,
          needQty: int(120),
        }));
      const r = computeSegmentTargets({ cutPassedQty: cut, stepPassedQty: P, variants });

      let total = 0;
      const usedByStep: Record<string, number> = {};
      for (const v of r.variants) {
        expect(v.heldQty).toBeGreaterThanOrEqual(0);
        expect(v.surplusQty).toBeGreaterThanOrEqual(0);
        expect(v.heldQty).toBeLessThanOrEqual(v.needQty);
        total += v.heldQty + v.surplusQty;
        if (v.segmentSteps !== '') {
          for (const t of v.segmentSteps.split(',')) {
            usedByStep[t] = (usedByStep[t] ?? 0) + v.heldQty + v.surplusQty;
          }
        }
      }
      expect(r.wipQty).toBeGreaterThanOrEqual(0);
      expect(total + r.wipQty).toBeLessThanOrEqual(cut);
      for (const [t, used] of Object.entries(usedByStep)) {
        expect(used).toBeLessThanOrEqual(P[t as SegmentSubStep] ?? 0);
      }
    }
  });
});
