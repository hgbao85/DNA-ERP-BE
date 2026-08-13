import { bestFill, bestWasteAcrossStockLengths, minWasteForStockLength } from './best-fill.util';

/**
 * Mọi con số kỳ vọng dưới đây tính TAY từ công thức của solver (cat_sat/de_xuat_logic.py) trên
 * BOM thật trong DB, KHÔNG lấy từ output của chính hàm đang test - nên chúng là mốc hồi quy thật:
 * lệch nghĩa là công thức đã trôi khỏi solver, và con số hiện cho KHSX sẽ khác con số solver trả
 * về sau đó.
 *
 * Cấu hình chuẩn hiện tại: cây 6000mm (NCC chỉ bán cỡ này), tề đầu 10mm, lưỡi cắt 1mm
 * -> dùng được 5990mm.
 */
const STOCK = 6000;
const TRIM = 10;
const KERF = 1;

describe('bestFill', () => {
  it('trả 0 khi không có cỡ đoạn nào', () => {
    expect(bestFill([], 5990, KERF)).toBe(0);
  });

  it('trả 0 khi mọi cỡ đoạn đều dài hơn phần dùng được của cây', () => {
    expect(bestFill([7000, 6500], 5990, KERF)).toBe(0);
  });

  it('trả 0 khi cây không còn phần dùng được', () => {
    expect(bestFill([840], 0, KERF)).toBe(0);
    expect(bestFill([840], -50, KERF)).toBe(0);
  });

  it('bỏ qua cỡ đoạn rác (<= 0, NaN) thay vì lặp vô hạn hoặc trả số sai', () => {
    // 660 + 1 = 661; 9 x 661 = 5949 (đoạn thứ 10 cần 6610 > 5990).
    expect(bestFill([660, 0, -5, NaN], 5990, KERF)).toBe(5949);
  });

  it('tính đúng khi cỡ nhỏ nhất KHÔNG phải phần tử đầu của mảng (bẫy khởi tạo vòng lặp)', () => {
    // Nếu vòng lặp bắt đầu từ phần tử đầu (841) thay vì từ 1 thì các mức c < 841 không được
    // điền, cỡ 200 bị bỏ sót và kết quả nhỏ hơn thực tế.
    const used = bestFill([840, 200], 5990, KERF);
    // Trọng số 841 và 201. Quét theo số đoạn 840 (a), lấy tối đa đoạn 200 cho phần còn lại:
    //   a=7 -> 5887, còn 103  -> b=0  -> 5887
    //   a=6 -> 5046, còn 944  -> b=4  -> 5850
    //   a=5 -> 4205, còn 1785 -> b=8  -> 5813
    //   a=4 -> 3364, còn 2626 -> b=13 -> 5977  <- tốt nhất
    //   a=3 -> 2523, còn 3467 -> b=17 -> 5940
    //   a=0 ->    0, còn 5990 -> b=29 -> 5829
    expect(used).toBe(5977);
  });
});

describe('minWasteForStockLength - đối chiếu số đo tay từ BOM thật', () => {
  const waste = (sizes: number[]) => minWasteForStockLength(sizes, STOCK, TRIM, KERF);

  it('bàn J55, sắt vuông 20x20 chỉ có 1 cỡ 840mm -> 1,88% (KHÔNG đạt ngưỡng 1%)', () => {
    // 7 x (840+1) = 5887 <= 5990; đoạn thứ 8 cần thêm 841 nhưng chỉ còn 103.
    const r = waste([840]);
    expect(r.bestUsedMm).toBe(5887);
    expect(r.minWastePerBarMm).toBe(113);
    expect(r.minWastePct).toBeCloseTo(1.883, 3);
  });

  it('gộp thêm đoạn 460mm của Ghế tình yêu (cùng 20x20) -> 0,53%, đạt ngưỡng', () => {
    // 840x6 + 460x2 = 5960 sắt + 8 lưỡi = 5968 <= 5990.
    const r = waste([840, 460]);
    expect(r.bestUsedMm).toBe(5968);
    expect(r.minWastePerBarMm).toBe(32);
    expect(r.minWastePct).toBeCloseTo(0.533, 3);
  });

  it('nếu 840mm và 930mm cùng tiết diện (chuẩn hoá tiết diện) -> 0,38%', () => {
    // 840x6 + 930x1 = 5970 sắt + 7 lưỡi = 5977 <= 5990.
    const r = waste([840, 930]);
    expect(r.bestUsedMm).toBe(5977);
    expect(r.minWastePerBarMm).toBe(23);
    expect(r.minWastePct).toBeCloseTo(0.383, 3);
  });

  it('bàn J55, sắt vuông 50x50 chỉ có 1 cỡ 660mm -> 0,85%, tự nó đã đạt ngưỡng', () => {
    // 9 x 661 = 5949 <= 5990.
    const r = waste([660]);
    expect(r.minWastePerBarMm).toBe(51);
    expect(r.minWastePct).toBeCloseTo(0.85, 3);
  });

  it('nới 840 -> 854mm giảm hao hụt 7,5 lần mà vẫn 7 đoạn/cây', () => {
    // 7 x 855 = 5985 <= 5990.
    const r = waste([854]);
    expect(r.minWastePerBarMm).toBe(15);
    expect(r.minWastePct).toBeCloseTo(0.25, 3);
  });

  it('VÁCH ĐỨNG: 855mm tràn 2mm -> rớt xuống 6 đoạn/cây, hao hụt vọt lên 14,4%', () => {
    // 7 x 856 = 5992 > 5990 -> chỉ còn 6 x 856 = 5136.
    const r = waste([855]);
    expect(r.bestUsedMm).toBe(5136);
    expect(r.minWastePerBarMm).toBe(864);
    expect(r.minWastePct).toBeCloseTo(14.4, 3);
  });

  it('gộp KHÔNG BAO GIỜ làm hao hụt xấu đi (tính đơn điệu - nền tảng của cả tính năng)', () => {
    const alone = waste([840]).minWastePct;
    const pair = waste([840, 460]).minWastePct;
    const triple = waste([840, 460, 930]).minWastePct;
    expect(pair).toBeLessThanOrEqual(alone);
    expect(triple).toBeLessThanOrEqual(pair);
  });
});

describe('bestWasteAcrossStockLengths', () => {
  it('trả null khi không chiều dài cây nào cắt nổi cỡ đoạn đang có', () => {
    expect(bestWasteAcrossStockLengths([7000], [6000], TRIM, KERF)).toBeNull();
  });

  it('chọn chiều dài cây cho hao hụt thấp nhất khi có nhiều cỡ mua được', () => {
    // Cấu hình hiện tại chỉ có [6000], nhưng hàm phải sẵn sàng cho ngày NCC bán thêm cỡ.
    const r = bestWasteAcrossStockLengths([660], [6000, 5850], TRIM, KERF);
    // 5850: usable 5840 -> 8 x 661 = 5288, thừa 562 (9,61%). 6000 tốt hơn nhiều.
    expect(r?.stockLengthMm).toBe(6000);
    expect(r?.minWastePerBarMm).toBe(51);
  });

  it('cấu hình 1 chiều dài duy nhất (thực tế hiện nay) vẫn chạy đúng', () => {
    const r = bestWasteAcrossStockLengths([840], [6000], TRIM, KERF);
    expect(r?.minWastePct).toBeCloseTo(1.883, 3);
  });
});
