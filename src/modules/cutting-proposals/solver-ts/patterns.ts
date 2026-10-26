/**
 * TẦNG 2a: liệt kê kiểu cắt (pattern) cho 1 chiều dài cây — bản TS thuần (DFS), thay cho
 * CP-SAT `enumerate_all_solutions` trong `generate_patterns()` của de_xuat_logic.py.
 *
 * Giữ ĐÚNG ngữ nghĩa Python:
 *  - mọi phép tính trên số nguyên đã nhân SCALING_FACTOR (= 10);
 *  - usable = stock − trim; mỗi đoạn tốn thêm kerf;
 *  - cận trên mỗi cỡ = min(usable // cl, demand) (bám nhu cầu thật, không chặn 30);
 *  - sum(x) ≥ 1;  total_used = đoạn + lưỡi ≤ usable;  total_used ≥ int(stock·(1 − max_waste));
 *  - tối đa `maxSizesPerBar` cỡ khác nhau trên một cây (khi n > cap);
 *  - dừng ở SOLUTION_LIMIT pattern hoặc hết giờ → complete = false.
 */

export const SCALING_FACTOR = 10;
export const SOLUTION_LIMIT = 100000;
export const MAX_SIZES_PER_BAR = 4;
export const ENUM_TIME_LIMIT = 90;

/** Python `round()` làm tròn half-to-even; bắt chước để `_scale`/`_to_int` cho cùng số nguyên. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** mm thật → đơn vị nội bộ (đã nhân SCALING_FACTOR). Tương ứng `_scale()`. */
export function scale(v: number): number {
  return roundHalfEven(Number(v) * SCALING_FACTOR);
}

export interface PatternRow {
  /** số đoạn mỗi cỡ, theo thứ tự cutLengths */
  counts: number[];
  /** tổng mm đoạn hữu ích (đã scale) */
  used: number;
  /** stock − used − kerf·Σcounts (đã scale) = tề đầu + khúc thừa */
  waste: number;
}

export interface GeneratePatternsOptions {
  maxWasteRatio?: number;
  maxPatterns?: number;
  timeLimitSec?: number;
  maxSizesPerBar?: number | null;
}

export interface GeneratePatternsResult {
  rows: PatternRow[];
  complete: boolean;
}

export function generatePatterns(
  cutLengths: number[],
  demands: number[],
  stockLength: number,
  trim: number,
  kerf: number,
  opts: GeneratePatternsOptions = {},
): GeneratePatternsResult {
  const maxWasteRatio = opts.maxWasteRatio ?? 0.2;
  const maxPatterns = opts.maxPatterns ?? SOLUTION_LIMIT;
  const timeLimitSec = opts.timeLimitSec ?? ENUM_TIME_LIMIT;
  const cap = opts.maxSizesPerBar ?? null;

  const stockS = scale(stockLength);
  const trimS = scale(trim);
  const kerfS = scale(kerf);
  const cutsS = cutLengths.map(scale);
  const usableS = stockS - trimS;
  const n = cutsS.length;
  if (usableS <= 0 || n === 0) return { rows: [], complete: true };

  // Giống Python: int(stock_s * (1 - max_waste_ratio)) — cùng phép toán double nên cùng kết quả.
  const minUsed = Math.trunc(stockS * (1 - maxWasteRatio));

  const ub = new Array<number>(n);
  const cost = new Array<number>(n); // sắt tiêu tốn cho MỘT đoạn = đoạn + lưỡi
  for (let i = 0; i < n; i++) {
    ub[i] = Math.max(
      0,
      Math.min(Math.floor(usableS / Math.max(1, cutsS[i])), Math.trunc(demands[i])),
    );
    cost[i] = cutsS[i] + kerfS;
  }
  // suffixMax[i] = sắt tối đa còn có thể dùng từ cỡ i trở đi (để cắt nhánh sớm)
  const suffixMax = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) suffixMax[i] = suffixMax[i + 1] + ub[i] * cost[i];

  const useCap = cap !== null && n > cap;
  const rows: PatternRow[] = [];
  const counts = new Array<number>(n).fill(0);
  let hitLimit = false;
  let timedOut = false;
  let nodes = 0;
  const deadline = Date.now() + timeLimitSec * 1000;

  const dfs = (i: number, used: number, pieces: number, sizesUsed: number): void => {
    if (hitLimit || timedOut) return;
    if ((++nodes & 0xfff) === 0 && Date.now() > deadline) {
      timedOut = true;
      return;
    }
    if (used + suffixMax[i] < minUsed) return; // không thể đạt ngưỡng sắt dùng tối thiểu
    if (i === n) {
      if (pieces >= 1 && used >= minUsed) {
        if (rows.length >= maxPatterns) {
          hitLimit = true;
          return;
        }
        const usedPieces = used - pieces * kerfS;
        rows.push({ counts: counts.slice(), used: usedPieces, waste: stockS - used });
      }
      return;
    }
    const remaining = usableS - used;
    let xMax = Math.min(ub[i], Math.floor(remaining / cost[i]));
    if (useCap && sizesUsed >= cap) xMax = 0;
    for (let x = xMax; x >= 0; x--) {
      counts[i] = x;
      dfs(i + 1, used + x * cost[i], pieces + x, sizesUsed + (x > 0 ? 1 : 0));
      if (hitLimit || timedOut) break;
    }
    counts[i] = 0;
  };

  dfs(0, 0, 0, 0);
  return { rows, complete: !hitLimit && !timedOut };
}
