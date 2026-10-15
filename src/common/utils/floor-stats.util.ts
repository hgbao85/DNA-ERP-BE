/**
 * Ngày giờ cho "Báo cáo sản lượng đạt KCS" (2026-10-15, changelog-2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md mục 36).
 * DB lưu UTC nhưng xưởng tính ngày theo GIỜ VIỆT NAM (UTC+7, không có giờ mùa hè): lần KCS duyệt lúc 00:30 sáng 15/10
 * giờ VN là 17:30 UTC ngày 14/10 - nhóm theo ngày UTC sẽ đẩy số đó sang hôm trước. Mọi nhóm/lọc theo ngày đi qua đây.
 */

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type StatsGroupBy = 'day' | 'month' | 'year';

/** Khoảng tối đa (số ngày) cho từng cách nhóm - chặn kéo cả chục nghìn dòng chỉ vì chọn nhầm khoảng. */
export const MAX_SPAN_DAYS: Record<StatsGroupBy, number> = { day: 92, month: 1830, year: 3660 };

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' (ngày lịch VN) -> thời điểm 00:00 giờ VN của ngày đó (dạng Date UTC). null nếu sai định dạng / ngày không có thật. */
export function vnDayStart(day: string): Date | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = Date.UTC(y, mo - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d)
    return null;
  return new Date(utc - VN_OFFSET_MS);
}

/** Ngày lịch VN ('YYYY-MM-DD') của một thời điểm. */
export function vnDayKey(date: Date): string {
  const t = new Date(date.getTime() + VN_OFFSET_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Khoá kỳ: ngày 'YYYY-MM-DD' | tháng 'YYYY-MM' | năm 'YYYY' (theo giờ VN). */
export function bucketKey(date: Date, groupBy: StatsGroupBy): string {
  const day = vnDayKey(date);
  return groupBy === 'day' ? day : groupBy === 'month' ? day.slice(0, 7) : day.slice(0, 4);
}

/** Số ngày lịch trong khoảng [from, to] (gồm cả hai đầu). Cả hai phải hợp lệ. */
export function spanDays(from: string, to: string): number {
  const a = vnDayStart(from);
  const b = vnDayStart(to);
  if (!a || !b) return NaN;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS) + 1;
}

/** Mọi khoá kỳ có trong [from, to], theo thứ tự thời gian - để biểu đồ có cả kỳ không có số (= 0) thay vì bị nhảy cóc. */
export function enumerateBuckets(from: string, to: string, groupBy: StatsGroupBy): string[] {
  const start = vnDayStart(from);
  const n = spanDays(from, to);
  if (!start || !(n >= 1)) return [];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const key = bucketKey(new Date(start.getTime() + i * DAY_MS), groupBy);
    if (out[out.length - 1] !== key) out.push(key);
  }
  return out;
}
