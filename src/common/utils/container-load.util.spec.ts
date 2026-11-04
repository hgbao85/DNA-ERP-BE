import { computeContainerLoad, contEquivalent } from './container-load.util';

const box = (
  l: number | null,
  w: number | null,
  h: number | null,
  boxesPerSet = 1,
  manual: number | null = null,
) => ({
  boxLengthCm: l,
  boxWidthCm: w,
  boxHeightCm: h,
  boxesPerSet,
  loadContManual: manual,
});

describe('computeContainerLoad', () => {
  // Bộ ví dụ dùng chung với FE src/utils/containerLoad.test.ts - đổi ở đây thì đổi cả bên đó.
  it.each([
    // [dài, rộng, cao, thùng/bộ, cont m³, thể tích thùng, load cont]
    [90, 75, 125, 1, 68, 0.8438, 80], // ví dụ J55 của v8: 68 ÷ 0,844 = 80,6 → 80
    [85, 80, 100, 1, 68, 0.68, 100], // số thực ra 99,999… → 99; số nguyên đúng 100
    [50, 40, 85, 1, 68, 0.17, 400], // số thực ra 399
    [90, 75, 125, 2, 68, 0.8438, 40], // bộ 2 thùng
    [60.5, 40.2, 30.1, 1, 68, 0.0732, 928],
    [200, 200, 200, 1, 68, 8, 8],
    [500, 500, 500, 1, 68, 125, 0], // thùng to hơn cont
  ])('%s×%s×%s cm, %s thùng/bộ, cont %s m³ → %s m³, load %s', (l, w, h, n, cont, vol, load) => {
    const r = computeContainerLoad(box(l, w, h, n), cont);
    expect(r.boxVolumeM3).toBe(vol);
    expect(r.loadContFormula).toBe(load);
    expect(r.loadCont).toBe(load);
    expect(r.source).toBe('FORMULA');
  });

  it('số nhập tay thắng công thức', () => {
    const r = computeContainerLoad(box(90, 75, 125, 1, 75), 68);
    expect(r).toEqual({ boxVolumeM3: 0.8438, loadContFormula: 80, loadCont: 75, source: 'MANUAL' });
  });

  it('thiếu kích thước: chỉ dùng số nhập tay, không có thì null', () => {
    expect(computeContainerLoad(box(90, null, 125), 68)).toEqual({
      boxVolumeM3: null,
      loadContFormula: null,
      loadCont: null,
      source: null,
    });
    expect(computeContainerLoad(box(null, null, null, 1, 120), 68)).toEqual({
      boxVolumeM3: null,
      loadContFormula: null,
      loadCont: 120,
      source: 'MANUAL',
    });
  });

  it('0 / âm / NaN coi như chưa nhập; số thùng/bộ không hợp lệ coi như 1', () => {
    expect(computeContainerLoad(box(0, 75, 125), 68).loadCont).toBeNull();
    expect(computeContainerLoad(box(-90, 75, 125), 68).loadCont).toBeNull();
    expect(computeContainerLoad(box(90, 75, 125, 1, 0), 68).source).toBe('FORMULA');
    expect(computeContainerLoad(box(90, 75, 125, 0), 68).loadContFormula).toBe(80);
    expect(computeContainerLoad(box(90, 75, Number.NaN), 68).loadCont).toBeNull();
  });

  it('thể tích cont theo cấu hình (vd 67,5 m³)', () => {
    expect(computeContainerLoad(box(90, 75, 125), 67.5).loadContFormula).toBe(80);
    expect(computeContainerLoad(box(85, 80, 100), 67.5).loadContFormula).toBe(99);
  });
});

describe('contEquivalent', () => {
  it('số bộ ÷ load cont; chưa có load cont → null', () => {
    expect(contEquivalent(200, 80)).toBe(2.5);
    expect(contEquivalent(200, null)).toBeNull();
    expect(contEquivalent(200, 0)).toBeNull();
  });
});
