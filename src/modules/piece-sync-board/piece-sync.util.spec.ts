import type { ProcessStepValue } from '../../common/constants/process-steps.constant';
import {
  computePieceSync,
  type PieceSyncLineInput,
  type PieceSyncPieceInput,
} from './piece-sync.util';

const piece = (
  pieceId: string,
  qtyPerUnit = 1,
  selfCalcPieceQty: number | null = null,
): PieceSyncPieceInput => ({
  pieceId,
  qtyPerUnit,
  selfCalcPieceQty,
});
const line = (
  lineKey: string,
  pieceId: string,
  segmentSpecId: string,
  qtyPerPiece: number,
  processSteps: ProcessStepValue[] = [],
): PieceSyncLineInput => ({ lineKey, pieceId, segmentSpecId, qtyPerPiece, processSteps });
const good = (o: Record<string, number>) => new Map(Object.entries(o));

describe('computePieceSync', () => {
  it('1 mảnh 4 loại sắt: mảnh đồng bộ theo loại sắt thiếu nhất, dòng A kẹt ở Cắt', () => {
    const res = computePieceSync({
      orderQuantity: 100,
      pieces: [piece('P')],
      lines: [
        line('A', 'P', 'a', 4),
        line('B', 'P', 'b', 2),
        line('C', 'P', 'c', 2),
        line('D', 'P', 'd', 1),
      ],
      goodBySpecStep: good({ 'a:CAT': 360, 'b:CAT': 190, 'c:CAT': 184, 'd:CAT': 92 }),
    });
    expect(res[0].requiredQty).toBe(100);
    expect(res[0].phoiSyncedQty).toBe(90);
    expect(res[0].lines[0]).toMatchObject({
      lineKey: 'A',
      usableQty: 360,
      makeablePieces: 90,
      limitingStep: 'CAT',
    });
  });

  it('cỡ đoạn dùng chung 2 mảnh: chia đều, phần dư vào mảnh đứng trước', () => {
    const base = {
      orderQuantity: 1000,
      pieces: [piece('TT'), piece('TP')],
      lines: [line('L1', 'TT', '436', 1), line('L2', 'TP', '436', 1)],
    };
    const even = computePieceSync({ ...base, goodBySpecStep: good({ '436:CAT': 1500 }) });
    expect(even.map((r) => r.phoiSyncedQty)).toEqual([750, 750]);
    const odd = computePieceSync({ ...base, goodBySpecStep: good({ '436:CAT': 1501 }) });
    expect(odd.map((r) => r.phoiSyncedQty)).toEqual([751, 750]);
  });

  it('cùng cỡ đoạn, 2 dòng khác công đoạn trong 1 mảnh: mỗi dòng kẹt ở công đoạn riêng', () => {
    const res = computePieceSync({
      orderQuantity: 1000,
      pieces: [piece('V16')],
      lines: [
        line('L1', 'V16', '595', 1, ['TAN', 'NHAN']),
        line('L2', 'V16', '595', 1, ['TAN', 'UON']),
      ],
      goodBySpecStep: good({ '595:CAT': 2000, '595:TAN': 1200, '595:NHAN': 1000, '595:UON': 300 }),
    });
    expect(res[0].lines[0]).toMatchObject({ usableQty: 600, limitingStep: 'TAN' });
    expect(res[0].lines[1]).toMatchObject({ usableQty: 300, limitingStep: 'UON' });
    expect(res[0].phoiSyncedQty).toBe(300);
  });

  it('qtyPerPiece 2 có phần lẻ: chỉ cấp theo bội số đủ 1 mảnh', () => {
    const res = computePieceSync({
      orderQuantity: 10,
      pieces: [piece('P')],
      lines: [line('L', 'P', 's', 2)],
      goodBySpecStep: good({ 's:CAT': 15 }),
    });
    expect(res[0].lines[0]).toMatchObject({ usableQty: 14, makeablePieces: 7 });
    expect(res[0].phoiSyncedQty).toBe(7);
  });

  it('good dư rất nhiều: chặn trần requiredQty, limitingStep null', () => {
    const res = computePieceSync({
      orderQuantity: 10,
      pieces: [piece('P')],
      lines: [line('L', 'P', 's', 2, ['UON'])],
      goodBySpecStep: good({ 's:CAT': 9999, 's:UON': 9999 }),
    });
    expect(res[0].lines[0]).toMatchObject({
      usableQty: 20,
      makeablePieces: 10,
      limitingStep: null,
    });
    expect(res[0].phoiSyncedQty).toBe(10);
  });

  it('thiếu khoá công đoạn phụ: 0, limitingStep là công đoạn đó', () => {
    const res = computePieceSync({
      orderQuantity: 10,
      pieces: [piece('P')],
      lines: [line('L', 'P', 's', 1, ['UON'])],
      goodBySpecStep: good({ 's:CAT': 10 }),
    });
    expect(res[0].lines[0]).toMatchObject({ usableQty: 0, makeablePieces: 0, limitingStep: 'UON' });
    expect(res[0].phoiSyncedQty).toBe(0);
  });

  it('mảnh chỉ có Sắt tự tính: min(self, required); self null thì phoiSyncedQty null', () => {
    const res = computePieceSync({
      orderQuantity: 10,
      pieces: [piece('PAT', 1, 25), piece('X', 1, 4), piece('Y', 1, null)],
      lines: [],
      goodBySpecStep: good({}),
    });
    expect(res.map((r) => r.phoiSyncedQty)).toEqual([10, 4, null]);
    expect(res[0].lines).toEqual([]);
  });

  it('mảnh có dòng và self nhỏ hơn: lấy self', () => {
    const res = computePieceSync({
      orderQuantity: 10,
      pieces: [piece('P', 1, 3)],
      lines: [line('L', 'P', 's', 1)],
      goodBySpecStep: good({ 's:CAT': 10 }),
    });
    expect(res[0].phoiSyncedQty).toBe(3);
  });

  it('qtyPerUnit 2 (chân bàn x2): required = 2 x order, chia đúng', () => {
    const res = computePieceSync({
      orderQuantity: 50,
      pieces: [piece('CHAN', 2)],
      lines: [line('L', 'CHAN', 's', 1)],
      goodBySpecStep: good({ 's:CAT': 70 }),
    });
    expect(res[0].requiredQty).toBe(100);
    expect(res[0].lines[0]).toMatchObject({
      usableQty: 70,
      makeablePieces: 70,
      limitingStep: 'CAT',
    });
    expect(res[0].phoiSyncedQty).toBe(70);
  });

  it('processSteps lộn xộn / có sẵn CAT / trùng: steps đúng thứ tự, không trùng', () => {
    const res = computePieceSync({
      orderQuantity: 1,
      pieces: [piece('P')],
      lines: [line('L', 'P', 's', 1, ['NHAN', 'TAN', 'CAT', 'UON', 'TAN'])],
      goodBySpecStep: good({}),
    });
    expect(res[0].lines[0].steps).toEqual(['CAT', 'UON', 'TAN', 'NHAN']);
  });

  it('2 mảnh dùng chung cỡ ở cả Cắt lẫn Tán: phần dư rơi vào cùng dòng đầu, không mất mảnh', () => {
    const res = computePieceSync({
      orderQuantity: 1000,
      pieces: [piece('TT'), piece('TP')],
      lines: [line('L1', 'TT', '436', 1, ['TAN']), line('L2', 'TP', '436', 1, ['TAN'])],
      goodBySpecStep: good({ '436:CAT': 1501, '436:TAN': 1501 }),
    });
    expect(res.map((r) => r.phoiSyncedQty)).toEqual([751, 750]);
  });
});
