import {
  addBuckets,
  bucketLine,
  emptyBuckets,
  goodQty,
  isShort,
  percentOf,
} from './floor-progress.util';

describe('floor-progress.util', () => {
  it('chia 1 dòng theo thứ tự đạt → chờ KCS → chưa gửi; lỗi chỉ trừ vào phần KCS đã chấm', () => {
    // Đã báo 100 = chưa gửi 20 + chờ KCS 30 + đã chấm 50 (trong đó lỗi 5).
    expect(bucketLine({ required: 200, done: 100, failed: 5, open: 20, awaiting: 30 })).toEqual({
      required: 200,
      reported: 95,
      passed: 45,
      awaiting: 30,
      open: 20,
      failed: 5,
    });
  });

  it('báo vượt: chặn trần ở số cần, cắt phần chưa gửi trước', () => {
    expect(bucketLine({ required: 60, done: 78, failed: 0, open: 10, awaiting: 18 })).toMatchObject(
      {
        reported: 60,
        passed: 50,
        awaiting: 10,
        open: 0,
      },
    );
  });

  it('dữ liệu lệch (lỗi lớn hơn phần đã chấm): tổng 3 ngăn vẫn = Đã báo − Lỗi', () => {
    expect(bucketLine({ required: 50, done: 10, failed: 8, open: 5, awaiting: 0 })).toMatchObject({
      reported: 2,
      passed: 0,
      open: 2,
    });
  });

  it('số được tính và còn thiếu', () => {
    expect(goodQty({ done: 3, failed: 5 })).toBe(0);
    expect(isShort({ required: 10, done: 10, failed: 1, open: 0, awaiting: 0 })).toBe(true);
    expect(isShort({ required: 0, done: 0, failed: 0, open: 0, awaiting: 0 })).toBe(false);
    expect(isShort({ required: 10, done: 12, failed: 2, open: 0, awaiting: 0 })).toBe(false);
  });

  it('cộng dồn nhiều dòng', () => {
    const acc = emptyBuckets();
    addBuckets(acc, bucketLine({ required: 10, done: 10, failed: 0, open: 10, awaiting: 0 }));
    addBuckets(acc, bucketLine({ required: 5, done: 1, failed: 0, open: 0, awaiting: 1 }));
    expect(acc).toEqual({
      required: 15,
      reported: 11,
      passed: 0,
      awaiting: 1,
      open: 10,
      failed: 0,
    });
  });

  it('% làm tròn xuống như pctOf của FE: chưa đủ không hiện 100, có làm thì ≥ 1, không có số cần = 0', () => {
    expect(percentOf(2819, 2820)).toBe(99);
    expect(percentOf(2820, 2820)).toBe(100);
    expect(percentOf(3000, 2820)).toBe(100);
    expect(percentOf(840, 2820)).toBe(29);
    expect(percentOf(1, 2820)).toBe(1);
    expect(percentOf(0, 2820)).toBe(0);
    expect(percentOf(0, 0)).toBe(0);
  });
});
