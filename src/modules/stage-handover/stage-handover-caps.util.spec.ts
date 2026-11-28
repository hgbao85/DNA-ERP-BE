import {
  effectiveMaxNow,
  framePieceCap,
  outstandingAdvance,
  segmentPieceCaps,
  segmentPool,
  SegmentPieceInput,
} from './stage-handover-caps.util';

const piece = (
  key: string,
  codes: Record<string, number>,
  o: Partial<SegmentPieceInput> = {},
): SegmentPieceInput => ({
  key,
  usedQty: 0,
  overrideQty: 0,
  qtyPerPieceByCode: new Map(Object.entries(codes)),
  ...o,
});

describe('stage-handover-caps.util - trần theo hàng đã nhận (giao nhận giữa tổ 24/11/2026)', () => {
  it('mảnh 2 mã đoạn: còn = min theo mã ⌊còn / định mức⌋', () => {
    const caps = segmentPieceCaps(
      [piece('1:7', { A: 1, B: 2 })],
      new Map([
        ['A', 10],
        ['B', 9],
      ]),
    );
    expect(caps.get('1:7')).toEqual({
      receivedQty: 4,
      usedQty: 0,
      receivedLeft: 4,
      overrideQty: 0,
    });
  });

  it('chưa nhận mã nào -> còn 0 (bị chặn), mảnh không định mức đoạn -> không có cổng', () => {
    const caps = segmentPieceCaps([piece('1:7', { A: 1 }), piece('1:8', {})], new Map());
    expect(caps.get('1:7')?.receivedLeft).toBe(0);
    expect(caps.has('1:8')).toBe(false);
  });

  it('2 mảnh / 2 SKU dùng chung 1 mã: phần đã làm của mảnh này trừ vào phần còn của mảnh kia', () => {
    const pieces = [piece('1:7', { A: 1 }, { usedQty: 4 }), piece('2:7', { A: 2 }, { usedQty: 1 })];
    const caps = segmentPieceCaps(pieces, new Map([['A', 10]]));
    // còn A = 10 - 4×1 - 1×2 = 4
    expect(caps.get('1:7')).toEqual({
      receivedQty: 8,
      usedQty: 4,
      receivedLeft: 4,
      overrideQty: 0,
    });
    expect(caps.get('2:7')?.receivedLeft).toBe(2);
    expect(segmentPool(pieces, new Map([['A', 10]])).get('A')).toEqual({
      receivedQty: 10,
      overrideQty: 0,
      usedQty: 6,
      leftQty: 4,
    });
  });

  it('mở chặn N mảnh quy ra N × định mức đoạn', () => {
    const caps = segmentPieceCaps(
      [piece('1:7', { A: 2, B: 1 }, { usedQty: 3, overrideQty: 2 })],
      new Map([
        ['A', 6],
        ['B', 3],
      ]),
    );
    // A: 6 + 4 - 6 = 4 -> 2 mảnh; B: 3 + 2 - 3 = 2 -> 2 mảnh
    expect(caps.get('1:7')?.receivedLeft).toBe(2);
    expect(caps.get('1:7')?.overrideQty).toBe(2);
  });

  it('làm vượt (dữ liệu trước khi bật) -> còn 0, không âm', () => {
    const caps = segmentPieceCaps([piece('1:7', { A: 1 }, { usedQty: 12 })], new Map([['A', 10]]));
    expect(caps.get('1:7')?.receivedLeft).toBe(0);
  });

  it('mảnh đã hàn giao Sơn: còn = nhận + mở chặn - đã báo', () => {
    expect(framePieceCap({ receivedQty: 5, overrideQty: 2, usedQty: 4 })).toEqual({
      receivedQty: 7,
      usedQty: 4,
      receivedLeft: 3,
      overrideQty: 2,
    });
    expect(framePieceCap({ receivedQty: 1, overrideQty: 0, usedQty: 4 }).receivedLeft).toBe(0);
  });

  it('effectiveMaxNow = min(kế hoạch, hàng đã nhận); không có cổng nhận thì giữ kế hoạch', () => {
    expect(effectiveMaxNow(5, 3)).toBe(3);
    expect(effectiveMaxNow(2, 9)).toBe(2);
    expect(effectiveMaxNow(5, null)).toBe(5);
    expect(effectiveMaxNow(5, undefined)).toBe(5);
  });
});

describe('outstandingAdvance - mở chặn là ứng trước (lượt 1, chốt 28/11/2026)', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 10, 28, h));
  it('phiếu sau lần mở chặn trả dần; phiếu trước không trả', () => {
    expect(
      outstandingAdvance([
        { at: t(1), receipt: 10 },
        { at: t(2), advance: 5 },
      ]),
    ).toBe(5);
    expect(
      outstandingAdvance([
        { at: t(2), advance: 5 },
        { at: t(3), receipt: 3 },
      ]),
    ).toBe(2);
    expect(
      outstandingAdvance([
        { at: t(2), advance: 5 },
        { at: t(3), receipt: 8 },
      ]),
    ).toBe(0);
  });
  it('phiếu trả dư không để dành cho lần mở chặn sau', () => {
    expect(
      outstandingAdvance([
        { at: t(1), advance: 2 },
        { at: t(2), receipt: 10 },
        { at: t(3), advance: 4 },
      ]),
    ).toBe(4);
  });
  it('cùng thời điểm: ứng trước tính trước; không thứ tự đầu vào', () => {
    expect(
      outstandingAdvance([
        { at: t(2), receipt: 3 },
        { at: t(2), advance: 5 },
      ]),
    ).toBe(2);
    expect(outstandingAdvance([])).toBe(0);
  });
  it('segmentPieceCaps dùng phần ứng còn lại thay cho tổng mở chặn', () => {
    const piece: SegmentPieceInput = {
      key: '70:7',
      usedQty: 6,
      overrideQty: 2,
      qtyPerPieceByCode: new Map([['1:', 1]]),
    };
    // Nhận 6 (gồm 2 phiếu bù), ứng còn 0 -> còn 0 (trước: 6 + 2 - 6 = 2).
    expect(
      segmentPieceCaps([piece], new Map([['1:', 6]]), new Map([['1:', 0]])).get('70:7')
        ?.receivedLeft,
    ).toBe(0);
    expect(segmentPieceCaps([piece], new Map([['1:', 6]])).get('70:7')?.receivedLeft).toBe(2);
  });
});
