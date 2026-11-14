/**
 * Phân loại máy cho từng kiểu cắt (13/11/2026, "Quy tắc chia sắt cho máy cắt" 07/11/2026 mục 2; Sếp
 * chốt lại 13/11/2026 câu 7).
 *
 * Bộ giải gộp đoạn theo (loại sắt, chiều dài) nên 1 kiểu cắt không biết đoạn 425 mm nào trên cây là
 * đoạn phải DẬP (lỗ ô van). Mặc định của IT: GOM đoạn dập vào ÍT CÂY NHẤT - để ít cây phải cắt
 * laze, các cây còn
 * lại của kiểu cắt (không mang đoạn dập) là cây máy tự động.
 *
 * Hàm thuần, không đụng DB - chạy cho MỘT loại sắt (patterns + nhu cầu dập của chính loại sắt đó).
 *
 * Chỉ còn 2 lớp (xét từng cây):
 * - 0 đoạn dập        -> TU_DONG (có khoan/tán cũng vẫn máy tự động)
 * - >= 1 đoạn dập     -> LASER (máy tự động không cắt cây có lỗ ô van)
 * Số lỗ ô van không còn ảnh hưởng gì (đã gỡ khỏi định mức mảnh).
 */

export type PatternMachineClass = 'TU_DONG' | 'LASER';

export interface PatternMachinePunchedSegment {
  cutLengthMm: number;
  countPerBar: number;
}

export interface PatternMachineGroup {
  /** Số cây của kiểu cắt thuộc nhóm này (tổng các nhóm của 1 kiểu = barCount). */
  bars: number;
  machineClass: PatternMachineClass;
  punchedSegments: PatternMachinePunchedSegment[];
}

export interface ClassifyPatternInput {
  key: string;
  barCount: number;
  segments: Array<{ cutLengthMm: number; countPerBar: number }>;
}

export interface ClassifyPunchedDemand {
  cutLengthMm: number;
  count: number;
}

const CLASS_ORDER: Record<PatternMachineClass, number> = {
  LASER: 0,
  TU_DONG: 1,
};

export function classifyPatternMachines(input: {
  patterns: ClassifyPatternInput[];
  punchedDemand: ClassifyPunchedDemand[];
}): Map<string, PatternMachineGroup[]> {
  const { patterns, punchedDemand } = input;

  // Tổng số đoạn mỗi chiều dài mà các kiểu cắt ra - chặn cầu dập vượt quá số đoạn thật.
  const totalCut = new Map<number, number>();
  for (const p of patterns) {
    for (const s of p.segments) {
      totalCut.set(s.cutLengthMm, (totalCut.get(s.cutLengthMm) ?? 0) + p.barCount * s.countPerBar);
    }
  }

  // Kho đoạn dập còn phải xếp, theo chiều dài (số đoạn còn lại).
  const pool = new Map<number, number>();
  for (const d of punchedDemand) {
    if (d.count <= 0) continue;
    pool.set(d.cutLengthMm, (pool.get(d.cutLengthMm) ?? 0) + d.count);
  }
  // Vượt tổng đoạn cắt ra: bỏ bớt phần vượt.
  for (const [length, count] of [...pool]) {
    const cap = totalCut.get(length) ?? 0;
    const capped = Math.min(count, cap);
    if (capped > 0) pool.set(length, capped);
    else pool.delete(length);
  }

  const barsLeft = patterns.map((p) => Math.max(0, p.barCount));
  // groups[patternIdx]: chữ ký -> nhóm
  const groups: Map<string, PatternMachineGroup>[] = patterns.map(
    () => new Map<string, PatternMachineGroup>(),
  );

  for (;;) {
    // Chọn kiểu cắt còn cây mà 1 cây "hút" được nhiều đoạn dập nhất.
    let bestIdx = -1;
    let bestGain = 0;
    for (let i = 0; i < patterns.length; i++) {
      if (barsLeft[i] <= 0) continue;
      let gain = 0;
      for (const s of patterns[i].segments) {
        gain += Math.min(s.countPerBar, pool.get(s.cutLengthMm) ?? 0);
      }
      if (gain > bestGain) {
        bestGain = gain;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;

    // Số đoạn dập sẽ lên cây này theo từng chiều dài.
    const punchedSegments: PatternMachinePunchedSegment[] = [];
    for (const s of patterns[bestIdx].segments) {
      const left = pool.get(s.cutLengthMm) ?? 0;
      const k = Math.min(s.countPerBar, left);
      if (k <= 0) continue;
      punchedSegments.push({ cutLengthMm: s.cutLengthMm, countPerBar: k });
      if (left - k > 0) pool.set(s.cutLengthMm, left - k);
      else pool.delete(s.cutLengthMm);
    }
    // Chiều dài giảm dần cho dễ đọc.
    punchedSegments.sort((a, b) => b.cutLengthMm - a.cutLengthMm);

    const signature = punchedSegments.map((x) => `${x.cutLengthMm}:${x.countPerBar}`).join(',');
    const map = groups[bestIdx];
    const existing = map.get(signature);
    if (existing) existing.bars += 1;
    else map.set(signature, { bars: 1, machineClass: 'LASER', punchedSegments });
    barsLeft[bestIdx] -= 1;
  }

  const result = new Map<string, PatternMachineGroup[]>();
  patterns.forEach((p, i) => {
    const list = [...groups[i].values()];
    if (barsLeft[i] > 0) {
      list.push({ bars: barsLeft[i], machineClass: 'TU_DONG', punchedSegments: [] });
    }
    // Sắp ổn định: LASER trước, TU_DONG sau (Array.sort ổn định - giữ thứ tự xuất hiện trong lớp).
    list.sort((a, b) => CLASS_ORDER[a.machineClass] - CLASS_ORDER[b.machineClass]);
    result.set(
      p.key,
      list.length > 0 ? list : [{ bars: 0, machineClass: 'TU_DONG', punchedSegments: [] }],
    );
  });
  return result;
}
