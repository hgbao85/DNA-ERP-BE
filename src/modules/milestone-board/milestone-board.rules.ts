/**
 * Luật thuần của "Bảng mốc" (2026-10-29, changelog 2026-09-25 mục 32.24): từ tiến độ + hạn đã lưu của 1 mốc ra trạng thái
 * Xong / Không cần / Chưa biết / Chưa đặt hạn / Đúng hạn / Sắp tới hạn / Trễ. Không đọc DB - service gom số rồi gọi vào đây.
 */

export type MilestoneKey =
  | 'MUA_VT_KHUNG'
  | 'PHOI'
  | 'HAN'
  | 'SON'
  | 'KHUNG'
  | 'DAN'
  | 'MUA_VT_CON_LAI'
  | 'DONG_GOI'
  | 'HAN_GIAO';

/** Thứ tự cột = thứ tự cột mốc đã chốt trên màn KHSX ("Mua VT còn lại" đứng giữa Đan và Đóng gói - changelog 32.7). */
export const MILESTONES: { key: MilestoneKey; label: string }[] = [
  { key: 'MUA_VT_KHUNG', label: 'Mua VT khung & đan' },
  { key: 'PHOI', label: 'Phôi' },
  { key: 'HAN', label: 'Hàn' },
  { key: 'SON', label: 'Sơn' },
  { key: 'KHUNG', label: 'Khung CK' },
  { key: 'DAN', label: 'Đan' },
  { key: 'MUA_VT_CON_LAI', label: 'Mua VT còn lại' },
  { key: 'DONG_GOI', label: 'Đóng gói' },
  { key: 'HAN_GIAO', label: 'Hạn giao' },
];

export type MilestoneStatus =
  'DONE' | 'NA' | 'UNKNOWN' | 'NO_DEADLINE' | 'ON_TRACK' | 'DUE_SOON' | 'LATE';

/** "Sắp tới hạn" = còn từ 0 tới số ngày này (mặc định người dùng duyệt ở 32.24). */
export const DUE_SOON_DAYS = 2;

/** Mức độ để xếp dòng / chọn trạng thái xấu nhất - số lớn = cần chú ý hơn. */
export const STATUS_RANK: Record<MilestoneStatus, number> = {
  NA: 0,
  DONE: 1,
  UNKNOWN: 2,
  NO_DEADLINE: 3,
  ON_TRACK: 4,
  DUE_SOON: 5,
  LATE: 6,
};

/**
 * Tiến độ 1 mốc. `known=false`: nguồn số tải lỗi -> không kết luận (KHÔNG coi là xong hay chưa xong). `need <= 0`: mốc không
 * có việc (vd SKU không đan) -> "Không cần". `done` đã chặn trần theo từng dòng ở phía gom số.
 */
export interface MilestoneProgress {
  known: boolean;
  need: number;
  done: number;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Số ngày từ `fromDay` tới `toDay` (cả 2 dạng 'YYYY-MM-DD'); âm = `toDay` đã qua. */
export function daysBetween(fromDay: string, toDay: string): number {
  const a = DAY_RE.exec(fromDay);
  const b = DAY_RE.exec(toDay);
  if (!a || !b) throw new Error(`Ngày không hợp lệ: ${fromDay} / ${toDay}`);
  const ms = (m: RegExpExecArray) => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** % nguyên làm tròn XUỐNG (chỉ ra 100 khi đủ thật), đã làm thì tối thiểu 1 - cùng cách `pctOf` ở FE ThongKePagePlan. */
export function percentOf(p: MilestoneProgress): number {
  if (p.need <= 0) return 0;
  const done = Math.min(p.done, p.need);
  return Math.min(100, Math.max(done > 0 ? 1 : 0, Math.floor((done / p.need) * 100)));
}

/** % của mốc gộp = trung bình % các phần có việc, làm tròn xuống, đã làm thì tối thiểu 1 - cùng `getStagePercent` ở FE
 *  ThongKePagePlan (Khung CK = trung bình 3 tổ; người dùng chốt Q1, 32.27). Không phần nào có việc -> 0. */
export function averagePercent(parts: MilestoneProgress[]): number {
  const active = parts.filter((p) => p.need > 0);
  if (active.length === 0) return 0;
  const sum = active.reduce((a, p) => a + percentOf(p), 0);
  return Math.max(sum > 0 ? 1 : 0, Math.floor(sum / active.length));
}

export function isDone(p: MilestoneProgress): boolean {
  return p.known && p.need > 0 && p.done >= p.need;
}

/**
 * Trạng thái 1 mốc. `deadlineDay` = hạn đã lưu (ngày VN 'YYYY-MM-DD') - null = chưa đặt hạn thì KHÔNG báo trễ (không lấy ngày
 * đề xuất kiểu Phú An, quyết định 32.24).
 */
export function milestoneStatus(
  p: MilestoneProgress,
  deadlineDay: string | null,
  todayDay: string,
): { status: MilestoneStatus; daysLeft: number | null } {
  const daysLeft = deadlineDay ? daysBetween(todayDay, deadlineDay) : null;
  if (!p.known) return { status: 'UNKNOWN', daysLeft };
  if (p.need <= 0) return { status: 'NA', daysLeft };
  if (p.done >= p.need) return { status: 'DONE', daysLeft };
  if (daysLeft === null) return { status: 'NO_DEADLINE', daysLeft };
  if (daysLeft < 0) return { status: 'LATE', daysLeft };
  if (daysLeft <= DUE_SOON_DAYS) return { status: 'DUE_SOON', daysLeft };
  return { status: 'ON_TRACK', daysLeft };
}

export function worstStatus(statuses: MilestoneStatus[]): MilestoneStatus {
  return statuses.reduce<MilestoneStatus>(
    (w, s) => (STATUS_RANK[s] > STATUS_RANK[w] ? s : w),
    'NA',
  );
}

/** Gộp nhiều mốc con thành 1 mốc (Khung CK = Phôi + Hàn + Sơn): chưa biết nếu 1 phần chưa biết, không cần nếu mọi phần
 *  không cần, còn lại cộng dồn need/done của các phần có việc. */
export function combineProgress(parts: MilestoneProgress[]): MilestoneProgress {
  if (parts.some((p) => !p.known)) return { known: false, need: 0, done: 0 };
  const active = parts.filter((p) => p.need > 0);
  return {
    known: true,
    need: active.reduce((a, p) => a + p.need, 0),
    done: active.reduce((a, p) => a + Math.min(p.done, p.need), 0),
  };
}

/** Phần đã làm của 1 dòng có lỗi KCS: (đã làm − lỗi), chặn trần theo cần - cùng `bucketLine().reported` ở FE progressModel. */
export function goodCapped(required: number, done: number, failed: number): number {
  return Math.min(Math.max(0, done - failed), Math.max(0, required));
}
