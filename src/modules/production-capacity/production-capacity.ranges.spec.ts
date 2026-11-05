import { DEFAULT_TIMELINE_PARAMS } from '../../common/utils/timeline-suggest.util';
import { stageRangesOf, type CapacityItemInput } from './production-capacity.ranges';

const PHU_AN = { code: 'PHU_AN', name: 'Xưởng Phú An', capacityMode: 'CONT_PER_DAY' as const };
const PHUOC_AN = {
  code: 'PHUOC_AN',
  name: 'Xưởng Phước An',
  capacityMode: 'DAYS_PER_CONT' as const,
};

const item = (extra: Partial<CapacityItemInput> = {}): CapacityItemInput => ({
  itemId: '1',
  piId: '10',
  displayCode: 'MY-313',
  skuCode: 'SKU-1',
  quantity: 240,
  loadCont: 80,
  workshop: { ...PHU_AN, paint: null },
  warehouse: { code: 'KHO_A', name: 'Kho A' },
  stages: {},
  ...extra,
});

const find = (rs: ReturnType<typeof stageRangesOf>, stage: string) =>
  rs.find((r) => r.stage === stage);
const span = (r?: { from: string; to: string }) => (r ? [r.from, r.to] : null);

describe('stageRangesOf', () => {
  it('chưa có load cont -> không có khoảng nào', () => {
    expect(
      stageRangesOf(
        item({ loadCont: null, stages: { FRAME_PHOI: '2026-11-11' } }),
        DEFAULT_TIMELINE_PARAMS,
      ),
    ).toEqual([]);
  });

  it('Phú An đủ mốc: Phôi [09,11], Hàn [10,12], Sơn [11,13], mỗi ngày 1 cont', () => {
    const rs = stageRangesOf(
      item({
        stages: {
          PHOI_START: '2026-11-09',
          FRAME_PHOI: '2026-11-11',
          FRAME_HAN: '2026-11-12',
          FRAME_SON: '2026-11-13',
        },
      }),
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(span(find(rs, 'PHOI'))).toEqual(['2026-11-09', '2026-11-11']);
    expect(span(find(rs, 'HAN'))).toEqual(['2026-11-10', '2026-11-12']);
    expect(span(find(rs, 'SON'))).toEqual(['2026-11-11', '2026-11-13']);
    for (const stage of ['PHOI', 'HAN', 'SON']) {
      expect(find(rs, stage)!.days).toBe(3);
      expect(find(rs, stage)!.contPerDay).toBeCloseTo(1, 9);
    }
  });

  it('thiếu PHOI_START: suy từ ngày xong - X + 1', () => {
    const rs = stageRangesOf(
      item({
        stages: { FRAME_PHOI: '2026-11-11', FRAME_HAN: '2026-11-12', FRAME_SON: '2026-11-13' },
      }),
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(span(find(rs, 'PHOI'))).toEqual(['2026-11-09', '2026-11-11']);
    expect(span(find(rs, 'HAN'))).toEqual(['2026-11-10', '2026-11-12']);
    expect(span(find(rs, 'SON'))).toEqual(['2026-11-11', '2026-11-13']);
  });

  it('ngày bắt đầu sau ngày xong -> 1 ngày = ngày xong', () => {
    const rs = stageRangesOf(
      item({ stages: { PHOI_START: '2026-11-15', FRAME_PHOI: '2026-11-11' } }),
      DEFAULT_TIMELINE_PARAMS,
    );
    const phoi = find(rs, 'PHOI')!;
    expect(span(phoi)).toEqual(['2026-11-11', '2026-11-11']);
    expect(phoi.days).toBe(1);
    expect(phoi.contPerDay).toBeCloseTo(3, 9);
  });

  it('thiếu ngày xong -> công đoạn đó bị bỏ', () => {
    const rs = stageRangesOf(
      item({ stages: { PHOI_START: '2026-11-09' } }),
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(rs).toEqual([]);
  });

  it('Phước An 120 bộ load 80: X = 6, Phôi [N, N+5], Hàn [N+1, N+6] không theo FRAME_PHOI đã lưu; Sơn nhóm Phú An', () => {
    const rs = stageRangesOf(
      item({
        quantity: 120,
        workshop: { ...PHUOC_AN, paint: { ...PHU_AN } },
        stages: {
          PHOI_START: '2026-11-09',
          FRAME_PHOI: '2026-11-11',
          FRAME_HAN: '2026-11-12',
          FRAME_SON: '2026-11-16',
        },
      }),
      DEFAULT_TIMELINE_PARAMS,
    );
    const phoi = find(rs, 'PHOI')!;
    expect(span(phoi)).toEqual(['2026-11-09', '2026-11-14']);
    expect(phoi.groupCode).toBe('PHUOC_AN');
    expect(phoi.mode).toBe('DAYS_PER_CONT');
    expect(span(find(rs, 'HAN'))).toEqual(['2026-11-10', '2026-11-15']);
    const son = find(rs, 'SON')!;
    expect(son.groupCode).toBe('PHU_AN');
    expect(son.mode).toBe('CONT_PER_DAY');
    expect(span(son)).toEqual(['2026-11-11', '2026-11-16']);
  });

  it('Phước An thiếu PHOI_START: N = FRAME_PHOI - (X - 1)', () => {
    const rs = stageRangesOf(
      item({
        quantity: 120,
        workshop: { ...PHUOC_AN, paint: { ...PHU_AN } },
        stages: { FRAME_PHOI: '2026-11-14' },
      }),
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(span(find(rs, 'PHOI'))).toEqual(['2026-11-09', '2026-11-14']);
  });

  it('Nhập đan / Chuyền kiểm trải Xđg ngày, kết thúc ở ngày mốc; Đóng gói [PACKAGING_START, PACKAGING]', () => {
    const rs = stageRangesOf(
      item({
        stages: {
          WEAVING: '2026-11-20',
          TRANSFER_CHECK: '2026-11-21',
          PACKAGING_START: '2026-11-22',
          PACKAGING: '2026-11-24',
        },
      }),
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(span(find(rs, 'NHAP_DAN'))).toEqual(['2026-11-18', '2026-11-20']);
    expect(span(find(rs, 'CHUYEN_KIEM'))).toEqual(['2026-11-19', '2026-11-21']);
    expect(span(find(rs, 'DONG_GOI'))).toEqual(['2026-11-22', '2026-11-24']);
    expect(find(rs, 'DONG_GOI')!.groupKind).toBe('WAREHOUSE');
    expect(find(rs, 'DONG_GOI')!.groupCode).toBe('KHO_A');
  });

  it('Đóng gói thiếu PACKAGING_START: PACKAGING - (Xđg - 1)', () => {
    const rs = stageRangesOf(
      item({ stages: { PACKAGING: '2026-11-24' } }),
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(span(find(rs, 'DONG_GOI'))).toEqual(['2026-11-22', '2026-11-24']);
  });

  it('chưa xưởng -> không có Phôi/Hàn/Sơn', () => {
    const rs = stageRangesOf(
      item({
        workshop: null,
        stages: {
          FRAME_PHOI: '2026-11-11',
          FRAME_HAN: '2026-11-12',
          FRAME_SON: '2026-11-13',
          PACKAGING: '2026-11-24',
        },
      }),
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(rs.map((r) => r.stage)).toEqual(['DONG_GOI']);
  });

  it('chưa kho -> không có Nhập đan / Chuyền kiểm / Đóng gói', () => {
    const rs = stageRangesOf(
      item({
        warehouse: null,
        stages: {
          FRAME_PHOI: '2026-11-11',
          WEAVING: '2026-11-20',
          TRANSFER_CHECK: '2026-11-21',
          PACKAGING: '2026-11-24',
        },
      }),
      DEFAULT_TIMELINE_PARAMS,
    );
    expect(rs.map((r) => r.stage)).toEqual(['PHOI']);
  });
});
