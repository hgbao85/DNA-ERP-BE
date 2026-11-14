/**
 * Hợp đồng JSON vào/ra — GIỐNG `api_de_xuat_propose` trong D:\DNA-DEXUAT\api\views.py
 * để sau này có thể thay thế endpoint Python mà không đổi client (ERP).
 */

export interface BomRowInput {
  part?: string;
  qty_per_set?: number | string;
  material?: string;
  spec?: string;
  cut_length?: number | string;
  qty_per_part?: number | string;
}

export interface ProposeRequest {
  num_sets?: number | string;
  bom: BomRowInput[];
  /** Python nhận chuỗi "5850 6000" hoặc số đơn; bản TS nhận thêm cả mảng số. */
  stock_lengths?: string | number | Array<number | string>;
  trim_start?: number | string;
  blade_width?: number | string;
  max_waste_percentage?: number | string;
  max_waste_percentage_by_material?: Record<string, number | string>;
  stock_lengths_by_material?: Record<string, string | number | Array<number | string>>;
  max_surplus?: number | string;
  auto_scan?: boolean;
  stop_on_first?: boolean;
  min_length?: number | string;
  max_length?: number | string;
  length_step?: number | string;
  time_limit_seconds?: number | string;
  /**
   * Máy cắt (2026-10-23, Sếp yêu cầu): 'laser' (mặc định, cắt từng cây - như trước) hay 'tu_dong'
   * (MC Tự động: cắt theo BÓ, port module `cat_sat` của D:\cat_sat_iea). Các trường dưới chỉ dùng
   * khi 'tu_dong'. Lưỡi cắt/tề đầu của MC Tự động (2,5-3 mm / 0) vẫn gửi qua blade_width/trim_start.
   */
  machine?: string;
  /** hệ số bó (cây/bó), vd "14 16 18 20" hoặc [14,16,18,20]; mặc định như app cũ */
  bundle_factors?: string | number | Array<number | string>;
  /** tổng số cây cắt tay (hệ số 1) tối đa; mặc định 5 như app cũ */
  max_manual_cuts?: number | string;
  /** số cỡ đoạn tối đa trên 1 kiểu cắt (máy MCTĐ chỉ nhập được 5); mặc định 5 */
  max_sizes_per_pattern?: number | string;
  /**
   * Tâm dò chiều dài đặt riêng (mm) - 13/11/2026, Sếp: "dò từ 6.000 ra hai phía (6.000 → 5.950 /
   * 6.050 → 5.900 / 6.100…),
   * lấy chiều dài đạt ngưỡng gần cây chuẩn nhất". Thiếu = chiều dài chuẩn đầu tiên của
   * `stock_lengths`.
   * Cùng khoảng cách thì thử chiều dài NGẮN hơn trước. Cũng dùng để phá hoà ở bước thử các chiều
   * dài cố định
   * (bằng % hao hụt thì lấy chiều dài gần tâm nhất, tức ưu tiên cây chuẩn).
   */
  scan_center_length?: number | string;
  /**
   * Luật xưởng "tối đa N cỡ đoạn/cây" (13/11/2026, Sếp: Phước An = 2; "không đạt ≤1% thì thêm cỡ,
   * ghi lý do").
   * THỨ TỰ (sửa 13/11/2026 theo quy tắc chia sắt 07/11: "tính sơ đồ theo cây 6.000; mỗi cây cố gắng
   * tối đa 2 cỡ đoạn; 2 cỡ không
   * đạt hao hụt dưới 1% thì được nhiều hơn, phải ghi chú"): ƯU TIÊN GIỮ CHIỀU DÀI CỐ ĐỊNH (cây
   * chuẩn + chiều dài đang có tồn).
   * Giai đoạn 1 - chỉ các chiều dài cố định, KHÔNG dò: thử trần N cỡ/cây, không đạt ngưỡng thì N+1,
   * N+2… tới giới hạn của máy
   * (laser: 4 rồi bỏ giới hạn; tu_dong: `max_sizes_per_pattern`). Mức đầu tiên đạt ngưỡng thì dừng.
   * Giai đoạn 2 - chỉ khi giai đoạn 1 không mức nào đạt và `auto_scan` bật: dò chiều dài đặt riêng,
   * lại theo thang N, N+1…
   * Thiếu / null / ≥ giới hạn máy = hành vi cũ. Áp cho cả 2 máy.
   */
  max_sizes_per_bar_start?: number | string | null;
  /**
   * Hệ số bó RIÊNG từng loại sắt cho MC Tự động (13/11/2026, quy tắc chia sắt 07/11 mục 4: số
   * cây/bó theo quy cách). Khoá = khoá
   * loại sắt như `stock_lengths_by_material`. Giá trị là danh sách hệ số (mảng số hoặc chuỗi) ->
   * loại sắt đó dùng các hệ số này thay
   * `bundle_factors`; giá trị `null` -> quy cách ngoài bảng, KHÔNG cắt MC Tự động: loại sắt đó giải
   * theo cắt TỪNG CÂY (như 'laser')
   * với `fallback_trim_start` / `fallback_blade_width`, và dòng kết quả mang `machine: 'laser'`.
   * Loại sắt không có khoá = dùng
   * `bundle_factors` chung như cũ. Chỉ có tác dụng khi `machine = 'tu_dong'`.
   */
  bundle_factors_by_material?: Record<string, string | number | Array<number | string> | null>;
  /**
   * Tề đầu / lưỡi cắt (mm) cho loại sắt phải cắt từng cây khi `bundle_factors_by_material[khoá] =
   * null`. Thiếu = 10 / 1,0.
   */
  fallback_trim_start?: number | string;
  fallback_blade_width?: number | string;
  /**
   * MC Laser: nhát cắt cuối phải ra 1 đoạn DÀI HƠN số này (mm), tính cả phần cùi (13/11/2026, Sếp
   * chốt câu 11). Kiểu cắt giải
   * theo cắt từng cây (laser, hoặc loại sắt `bundle_factors_by_material = null`) chỉ hợp lệ khi
   * `đoạn dài nhất trên cây + cùi >
   * laser_min_tail_mm` (đoạn đó để cuối, công nhân cắt tay). Thiếu / 0 = không áp. Không áp cho cắt
   * theo bó (MC Tự động).
   */
  laser_min_tail_mm?: number | string;
}

export type MachineKind = 'laser' | 'tu_dong';

/** Tổng kết cắt theo bó (chỉ khi machine = 'tu_dong'). */
export interface BundleSummary {
  factors: number[];
  /** số bó (mỗi bó = 1 lần cắt máy, factor cây) */
  total_bundles: number;
  /** số cây cắt tay (hệ số 1) */
  manual_bars: number;
  /** số lần cắt = số bó + số cây cắt tay */
  total_cuts: number;
  /** ≤ 5 cỡ/kiểu cắt đã áp */
  max_sizes_per_pattern: number;
}

export interface PieceRow {
  size: number;
  demand: number;
  produced: number;
  surplus: number;
}

export interface CuttingPattern {
  pattern_id: number;
  stock_length: number;
  counts: number[];
  bars: number;
  waste_per_bar: number;
  pieces_breakdown: Array<{ size: number; count: number }>;
  /** chỉ khi machine = 'tu_dong': { "<hệ số>": số bó, "1": số cây cắt tay }; bars = Σ hệ số × số bó */
  bundles?: Record<string, number>;
}

export interface LengthEval {
  length: number;
  bars: number;
  waste_pct: number;
}

export interface PurchasePlanItemFeasible {
  material: string;
  feasible: true;
  best_stock_length: number;
  length_source: 'fixed' | 'scan';
  total_bars: number;
  total_purchased_mm: number;
  total_waste_mm: number;
  waste_percentage: number;
  total_surplus_pieces: number;
  over_threshold: boolean;
  max_waste_pct_threshold: number;
  timeout_count: number;
  timeout_lengths: number[];
  solve_seconds: number;
  pieces: PieceRow[];
  cutting_patterns: CuttingPattern[];
  length_comparison: LengthEval[];
  optimal_custom_length: number | null;
  machine: MachineKind;
  /** chỉ khi machine = 'tu_dong' */
  bundle_summary?: BundleSummary;
  /**
   * Chỉ có khi request gửi `max_sizes_per_bar_start` còn hiệu lực (13/11/2026):
   * `sizes_per_bar_start` = mức của xưởng,
   * `sizes_per_bar_limit` = mức ĐÃ DÙNG để ra kết quả này (null = đã bỏ giới hạn). limit ≠ start
   * nghĩa là đã phải nới.
   */
  sizes_per_bar_start?: number | null;
  sizes_per_bar_limit?: number | null;
}

export interface PurchasePlanItemInfeasible {
  material: string;
  feasible: false;
  timed_out: boolean;
  best_achievable: LengthEval | null | undefined;
  reason: string;
  max_waste_pct_threshold: number | undefined;
  solve_seconds: number;
}

export type PurchasePlanItem = PurchasePlanItemFeasible | PurchasePlanItemInfeasible;

export interface ProposeSuccess {
  status: 'success';
  summary: {
    num_sets: number;
    num_material_groups: number;
    total_solve_seconds: number;
    total_bars_all: number;
    total_purchased_mm: number;
    total_waste_mm: number;
    total_surplus_pieces: number;
    waste_percentage: number;
    any_over_threshold: boolean;
  };
  purchase_plan: PurchasePlanItem[];
  input_echo: {
    num_sets: number;
    stock_lengths: number[];
    trim_start: number;
    blade_width: number;
    max_waste_percentage: number;
    max_waste_percentage_by_material: Record<string, number>;
    resolved_max_waste_pct_by_group: Record<string, number>;
    stock_lengths_by_material: Record<string, number[]>;
    resolved_stock_lengths_by_group: Record<string, number[]>;
    max_surplus: number;
    min_length: number;
    max_length: number;
    length_step: number;
    auto_scan: boolean;
    stop_on_first: boolean;
    machine: MachineKind;
    bundle_factors: number[];
    max_manual_cuts: number;
    max_sizes_per_pattern: number;
  };
}

export interface ProposeError {
  status: 'error';
  code: 'INVALID_JSON' | 'INVALID_INPUT' | 'SOLVER_ERROR';
  message: string;
  http_status: 400 | 500;
}

export type ProposeResponse = ProposeSuccess | ProposeError;

// ---------- Kiểu nội bộ (tương ứng dict Python trong de_xuat_logic.py) ----------

export interface PlanRow {
  stock_length: number;
  counts: number[];
  bars: number;
  waste_per_bar: number;
  /** chỉ khi cắt theo bó: { "<hệ số>": số bó, "1": số cây cắt tay } */
  bundles?: Record<string, number>;
}

export interface MaterialResultOk {
  feasible: true;
  cut_lengths: number[];
  demands: number[];
  produced: number[];
  bars_by_length: Record<string, number>;
  total_bars: number;
  total_purchased_mm: number;
  total_used_mm: number;
  total_waste_mm: number;
  total_surplus_pieces: number;
  waste_pct: number;
  plan: PlanRow[];
  patterns_truncated: boolean;
  limited_sizes_per_bar: number | null;
  machine: MachineKind;
  /** chỉ khi machine = 'tu_dong' */
  bundle_summary?: BundleSummary;
  /** Thêm so với Python: số đo để bench. */
  stats: SolveStats;
}

export interface MaterialResultFail {
  feasible: false;
  timed_out?: boolean;
  patterns_truncated?: boolean;
  reason: string;
  stats?: SolveStats;
}

export type MaterialResult = MaterialResultOk | MaterialResultFail;

export interface SolveStats {
  strategy: 'direct' | 'byN';
  /** đã nạp nghiệm tham lam làm điểm xuất phát tầng 1 */
  warm_start: boolean;
  /** số pattern TRƯỚC khi cắt bớt (null = không cắt) - xem maxIpPatterns */
  patterns_before_cap: number | null;
  pattern_count: number;
  /** ngưỡng hao hụt/cây của tập kiểu cắt ĐẦY ĐỦ đã gộp vào khi liệt kê ở ngưỡng người dùng chạm trần 100.000 (xem ENUM_RATIO_LADDER) */
  enum_ratio_used?: number;
  enum_seconds: number;
  stage1_status: string;
  stage1_seconds: number;
  stage2_status: string;
  stage2_seconds: number;
  /** Tầng 2 không ra nghiệm (hết giờ) → giữ nghiệm tầng 1. */
  stage2_fell_back: boolean;
  rss_peak_mb: number;
  /** cận dưới HiGHS chứng minh được ở mỗi tầng + mốc thời gian các nghiệm cải thiện */
  stage1_dual_bound: number | null;
  stage2_dual_bound: number | null;
  stage1_trace: Array<{ t: number; obj: number }>;
  stage2_trace: Array<{ t: number; obj: number }>;
  /** chiến lược 'byN': từng N đã giải, cận dưới, trạng thái */
  stage1_by_n?: Array<{
    N: number;
    bound: number;
    status: string;
    objective: number | null;
    seconds: number;
  }>;
  stage2_by_n?: Array<{
    N: number;
    bound: number;
    status: string;
    objective: number | null;
    seconds: number;
  }>;
  /**
   * MC Tự động đi đường "thu hẹp" (highs-solver.ts solveBundled): bài không-bó lấy tập pattern, bài bó thu
   * hẹp, bài bó đầy đủ - số pattern, trạng thái từng bài và nghiệm cuối lấy từ bài nào.
   */
  bundle_narrow?: {
    relaxSeconds: number;
    relaxPatterns: number;
    relaxStatus: string;
    narrowPatterns1: number;
    narrowPatterns2: number;
    narrowStatus1: string | null;
    narrowStatus2: string | null;
    fullStatus1: string | null;
    fullStatus2: string | null;
    stage1From: 'narrow' | 'full' | null;
    stage2From: 'narrow' | 'full' | 'stage1' | null;
  };
}

export interface OneMaterialOk {
  feasible: true;
  cut_lengths: number[];
  demands: number[];
  produced: number[];
  best_length: number;
  source: 'fixed' | 'scan';
  total_bars: number;
  waste_pct: number;
  plan: PlanRow[];
  total_waste_mm: number;
  total_purchased_mm: number;
  total_surplus_pieces: number;
  over_waste: boolean;
  max_waste_pct: number;
  timeout_count: number;
  timeout_lengths: number[];
  auto_scan: boolean;
  scan_stopped_early: boolean;
  patterns_truncated: boolean;
  fixed_evals: LengthEval[];
  scan_optimal: LengthEval | null;
  machine: MachineKind;
  bundle_summary?: BundleSummary;
  /** số cỡ/cây đã áp ở lần giải được chọn (null = không giới hạn) */
  limited_sizes_per_bar?: number | null;
  /**
   * luật xưởng số cỡ/cây (13/11/2026): chỉ có khi có luật còn hiệu lực - xem
   * PurchasePlanItemFeasible
   */
  sizes_per_bar_start?: number | null;
  sizes_per_bar_limit?: number | null;
  stats: SolveStats;
}

export interface OneMaterialFail {
  feasible: false;
  timed_out?: boolean;
  timeout_lengths?: number[];
  best_achievable?: LengthEval;
  reason: string;
}

export type OneMaterialResult = OneMaterialOk | OneMaterialFail;
