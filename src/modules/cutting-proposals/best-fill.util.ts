/**
 * Giới hạn dưới của hao hụt cắt cho MỘT loại sắt trên MỘT chiều dài cây - trả lời "gộp nhu cầu
 * của các lệnh này lại thì khá nhất có thể xuống bao nhiêu %", KHÔNG gọi solver.
 *
 * Vì sao cần: quét xem có đáng gộp đợt cắt hay không phải chấm hàng chục tổ hợp; gọi solver
 * (CP-SAT, vài giây mỗi lần) là không khả thi. Nhưng câu hỏi "các cỡ đoạn này lấp đầy được cây
 * tới đâu" chỉ là bài toán ba lô 1 chiều - quy hoạch động O(sức_chứa × số_cỡ), vài phần nghìn
 * giây. Nhanh hơn solver cỡ nghìn lần và cho ĐÚNG cận dưới.
 *
 * ⚠ Đây là GIỚI HẠN DƯỚI ("khá nhất có thể"), KHÔNG phải hao hụt sẽ đạt được. Thực tế cao hơn khi:
 *   - số lượng nhu cầu không đủ để MỌI cây đều dùng được kiểu cắt tốt nhất (cận này giả định
 *     nguồn đoạn vô hạn, cây nào cũng cắt theo pattern tối ưu);
 *   - cây cuối luôn cắt dở và được giữ nguyên thành mẫu nguyên (xem
 *     de_xuat_logic.py::_giu_lai_mau_nguyen) - tính riêng, không nằm trong con số này.
 * Dùng để LOẠI SỚM tổ hợp chắc chắn không đạt (cận dưới đã vượt ngưỡng thì thực tế càng vượt),
 * và để xếp hạng ứng viên. Tuyệt đối không trình bày như kết quả cam kết.
 *
 * Công thức bám ĐÚNG solver (cat_sat/de_xuat_logic.py):
 *   usable     = stock − trim                       (dòng ~226)
 *   total_used = Σ (len_i + kerf) · x_i  ≤ usable    (dòng 240-242)
 *   waste      = stock − total_used                  (dòng 274-278: kerf tính là "sắt đã dùng")
 * Lệch công thức ở đây là con số hiện cho KHSX lệch khỏi con số solver trả về sau đó.
 */

/** Kết quả tính cận dưới cho 1 chiều dài cây. */
export interface BestFillResult {
  /** Chiều dài cây nguyên đã chấm (mm). */
  stockLengthMm: number;
  /** Tổng "sắt đã dùng" (đoạn + lưỡi cắt) lớn nhất nhét được vào 1 cây, mm. */
  bestUsedMm: number;
  /** stockLengthMm − bestUsedMm: phần thừa mỗi cây ở phương án lấp đầy nhất, mm. */
  minWastePerBarMm: number;
  /** minWastePerBarMm / stockLengthMm × 100, làm tròn 3 chữ số thập phân. */
  minWastePct: number;
}

/**
 * Tổng (đoạn + lưỡi cắt) lớn nhất nhét vừa `usableMm`, dùng KHÔNG giới hạn số lượng mỗi cỡ.
 * Không giới hạn số lượng là CỐ Ý: đây là cận dưới, ràng buộc theo nhu cầu thật chỉ làm con số
 * xấu đi chứ không tốt lên, nên bỏ ra vẫn giữ đúng tính chất "cận dưới" mà rẻ hơn nhiều.
 */
export function bestFill(sizesMm: number[], usableMm: number, kerfMm: number): number {
  if (usableMm <= 0) return 0;

  // Mỗi đoạn tốn thêm đúng 1 lưỡi cắt -> quy về 1 trọng số duy nhất, bài toán thành ba lô thuần.
  // Lọc cỡ <= 0 (dữ liệu rác) và cỡ không thể nhét vừa dù chỉ 1 đoạn.
  const weights = [
    ...new Set(
      sizesMm
        .filter((s) => Number.isFinite(s) && s > 0)
        .map((s) => Math.round(s + kerfMm))
        .filter((w) => w > 0 && w <= usableMm),
    ),
  ];
  if (weights.length === 0) return 0;

  const cap = Math.floor(usableMm);
  // dp[c] = tổng lớn nhất đạt được khi sức chứa là c. Chạy từ 1 (KHÔNG từ weights[0] - thứ tự
  // phần tử của Set là thứ tự chèn, không phải nhỏ nhất, bỏ qua đoạn đầu sẽ bỏ sót cỡ nhỏ hơn).
  const dp = new Int32Array(cap + 1);
  for (let c = 1; c <= cap; c++) {
    let best = dp[c - 1]; // không thêm gì ở mức c này -> thừa hưởng mức thấp hơn
    for (const w of weights) {
      if (w > c) continue;
      const cand = dp[c - w] + w;
      if (cand > best) best = cand;
    }
    dp[c] = best;
  }
  return dp[cap];
}

/**
 * Hao hụt thấp nhất có thể (%) của 1 loại sắt trên 1 chiều dài cây, cho trước tập cỡ đoạn.
 * `sizesMm` là các chiều dài đoạn KHÁC NHAU cần cắt (số lượng không ảnh hưởng - xem bestFill).
 */
export function minWasteForStockLength(
  sizesMm: number[],
  stockLengthMm: number,
  trimMm: number,
  kerfMm: number,
): BestFillResult {
  const usable = stockLengthMm - trimMm;
  const bestUsedMm = bestFill(sizesMm, usable, kerfMm);
  const minWastePerBarMm = stockLengthMm - bestUsedMm;
  return {
    stockLengthMm,
    bestUsedMm,
    minWastePerBarMm,
    minWastePct:
      stockLengthMm > 0 ? Math.round((minWastePerBarMm / stockLengthMm) * 100 * 1000) / 1000 : 0,
  };
}

/**
 * Chấm mọi chiều dài cây được phép mua và trả cái tốt nhất - mirror bước 1 của
 * optimize_one_material() ("chấm từng chiều dài chuẩn, chọn cái ít hao hụt nhất"). Hiện hệ thống
 * chỉ cấu hình 1 chiều dài (6000mm, NCC không bán cỡ khác - xem SystemConfig.solverStockLengths)
 * nhưng vẫn viết theo mảng để thêm cỡ mới không phải sửa chỗ này.
 */
export function bestWasteAcrossStockLengths(
  sizesMm: number[],
  stockLengthsMm: number[],
  trimMm: number,
  kerfMm: number,
): BestFillResult | null {
  let best: BestFillResult | null = null;
  for (const stockLengthMm of stockLengthsMm) {
    const result = minWasteForStockLength(sizesMm, stockLengthMm, trimMm, kerfMm);
    // bestUsedMm = 0 nghĩa là không cỡ đoạn nào nhét vừa cây này -> không phải ứng viên.
    if (result.bestUsedMm === 0) continue;
    if (best === null || result.minWastePct < best.minWastePct) {
      best = result;
    }
  }
  return best;
}
