import { AllocationLine, autoAllocate } from './purchase-receipt-allocation.util';

const d = (s: string) => new Date(`${s}T00:00:00+07:00`);
const line = (o: Partial<AllocationLine> & { itemId: string }): AllocationLine => ({
  buyQty: 0,
  orderQty: 0,
  receivedQty: 0,
  deadline: null,
  approvedAt: null,
  ...o,
});

describe('autoAllocate (YC8 - nhập 1 lần tự chia)', () => {
  it('ví dụ bản v8: 150 cây -> lệnh cần sớm nhất đủ 120, lệnh kế 30, lệnh sau chờ', () => {
    const res = autoAllocate(
      [
        line({ itemId: '3', buyQty: 100, orderQty: 100, deadline: d('2026-11-08') }),
        line({ itemId: '1', buyQty: 120, orderQty: 120, deadline: d('2026-11-03') }),
        line({ itemId: '2', buyQty: 80, orderQty: 80, deadline: d('2026-11-05') }),
      ],
      150,
    );
    expect(res).toEqual([
      { itemId: '1', qty: 120 },
      { itemId: '2', qty: 30 },
      { itemId: '3', qty: 0 },
    ]);
  });

  it('trùng ngày cần thì lệnh duyệt trước được chia trước; chưa có ngày xếp cuối', () => {
    const res = autoAllocate(
      [
        line({ itemId: '1', buyQty: 10, orderQty: 10 }),
        line({
          itemId: '2',
          buyQty: 10,
          orderQty: 10,
          deadline: d('2026-11-05'),
          approvedAt: d('2026-11-02'),
        }),
        line({
          itemId: '3',
          buyQty: 10,
          orderQty: 10,
          deadline: d('2026-11-05'),
          approvedAt: d('2026-11-01'),
        }),
      ],
      15,
    );
    expect(res).toEqual([
      { itemId: '3', qty: 10 },
      { itemId: '2', qty: 5 },
      { itemId: '1', qty: 0 },
    ]);
  });

  it('trừ phần đã nhận đợt trước; lấp phần cần mua của mọi lệnh trước rồi mới tới phần mua dư', () => {
    const res = autoAllocate(
      [
        line({
          itemId: '1',
          buyQty: 100,
          orderQty: 120,
          receivedQty: 40,
          deadline: d('2026-11-03'),
        }),
        line({ itemId: '2', buyQty: 50, orderQty: 50, deadline: d('2026-11-05') }),
      ],
      80,
    );
    // Lượt 1: lệnh 1 còn thiếu 60, lệnh 2 còn 50 -> 60 + 20. Không chừa gì cho mua dư.
    expect(res).toEqual([
      { itemId: '1', qty: 60 },
      { itemId: '2', qty: 20 },
    ]);
  });

  it('dư sau khi lấp đủ cần mua + mua dư thì ghi vào lệnh xếp cuối (nhận vượt)', () => {
    const res = autoAllocate(
      [
        line({ itemId: '1', buyQty: 10, orderQty: 12, deadline: d('2026-11-03') }),
        line({ itemId: '2', buyQty: 5, orderQty: 5, deadline: d('2026-11-05') }),
      ],
      20,
    );
    expect(res).toEqual([
      { itemId: '1', qty: 12 },
      { itemId: '2', qty: 8 },
    ]);
  });

  it('số lẻ không dính sai số dấu phẩy động', () => {
    const res = autoAllocate(
      [
        line({ itemId: '1', buyQty: 0.3, orderQty: 0.3 }),
        line({ itemId: '2', buyQty: 1, orderQty: 1 }),
      ],
      0.7,
    );
    expect(res).toEqual([
      { itemId: '1', qty: 0.3 },
      { itemId: '2', qty: 0.4 },
    ]);
  });
});
