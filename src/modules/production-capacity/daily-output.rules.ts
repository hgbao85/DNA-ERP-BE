/**
 * Phần A – Đợt 3 (YC10 10.4, 10.15; V4-12, V4-13): LUẬT THUẦN chấm "công đoạn làm chưa đủ 1 cont trong ngày". Không đọc DB -
 * `DailyOutputService` gom số cont đã làm theo ngày của từng (dòng × công đoạn) rồi gọi vào đây.
 *
 *  - CONT_PER_DAY (Phú An, kho đóng gói): gom theo (nhóm, công đoạn) mọi dòng có khoảng PHỦ ngày D.
 *    Còn lại đầu ngày = Σ max(0, cont − cont đã làm TRƯỚC ngày D); ngưỡng = min(1, còn lại). Còn lại ≈ 0 (xong rồi) -> không báo;
 *    làm trong ngày D < ngưỡng -> báo.
 *  - DAYS_PER_CONT (Phước An, Phôi + Hàn): theo từng dòng, khối b ngày tính từ ngày bắt đầu; chỉ kiểm vào NGÀY CUỐI mỗi khối:
 *    luỹ kế từ đầu tới hết ngày D < min(số khối, cont của dòng) -> báo.
 */
import { diffDays } from '../../common/utils/timeline-suggest.util';
import type { TimelineParams } from '../../common/utils/timeline-suggest.util';
import { rangeCovers, type StageRange } from './production-capacity.ranges';
import type { CapacityStage, DailyOutputAlert } from './production-capacity.types';

/** Chênh lệch số thực bỏ qua khi so cont. */
const EPS = 1e-6;
/** Mức chuẩn mỗi ngày (cont) - v8 10.4 "1 cont/ngày". */
export const DAILY_TARGET_CONT = 1;

/** 1 dòng × 1 công đoạn: khoảng ngày + số cont ĐÃ LÀM theo từng ngày VN (tới hết ngày được chấm). */
export interface OutputLine {
  range: StageRange;
  /** 'YYYY-MM-DD' -> cont làm trong ngày đó. */
  doneByDay: Record<string, number>;
  /** Phôi: ước tính theo tỷ lệ đoạn cắt (chưa đồng bộ theo mảnh). */
  estimated: boolean;
}

/** Số kiểu VN, tối đa 2 số lẻ: 0,6 · 1 · 1,25. */
export const fmtCont = (n: number): string => Number(n.toFixed(2)).toLocaleString('vi-VN');

const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

const sumDone = (l: OutputLine, pred: (d: string) => boolean): number =>
  Object.entries(l.doneByDay).reduce((a, [d, v]) => (pred(d) ? a + v : a), 0);

const doneOn = (l: OutputLine, day: string): number => l.doneByDay[day] ?? 0;
const doneBefore = (l: OutputLine, day: string): number => sumDone(l, (d) => d < day);

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

const SUFFIX_ESTIMATED = ' (ước tính theo đoạn cắt)';

function codesOf(lines: OutputLine[]): string[] {
  return unique(lines.map((l) => l.range.displayCode).filter((c) => c));
}

/** Đơn vị -> cont: cont làm được của 1 dòng = (số đơn vị làm ÷ tổng cần) × cont của dòng. Tổng cần ≤ 0 (hoặc nguồn lỗi) -> 0. */
export function unitsToCont(units: number, totalUnits: number, lineCont: number): number {
  if (!(totalUnits > 0) || !(units > 0)) return 0;
  return (units / totalUnits) * lineCont;
}

export function evaluateDailyOutput(
  day: string,
  lines: OutputLine[],
  params: TimelineParams,
): DailyOutputAlert[] {
  const covering = lines.filter((l) => rangeCovers(l.range, day));
  const alerts: DailyOutputAlert[] = [];

  // ── CONT_PER_DAY: gom theo (loại nhóm, mã nhóm, công đoạn) ──
  const groups = new Map<string, OutputLine[]>();
  for (const l of covering) {
    if (l.range.mode !== 'CONT_PER_DAY') continue;
    const key = `${l.range.groupKind}|${l.range.groupCode}|${l.range.stage}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  for (const group of groups.values()) {
    const remaining = group.map((l) => ({
      l,
      rem: Math.max(0, l.range.cont - doneBefore(l, day)),
    }));
    const remainingTotal = remaining.reduce((a, x) => a + x.rem, 0);
    if (remainingTotal <= EPS) continue; // đã xong hết trước ngày D
    const threshold = Math.min(DAILY_TARGET_CONT, remainingTotal);
    const done = group.reduce((a, l) => a + doneOn(l, day), 0);
    if (done >= threshold - EPS) continue;
    const open = remaining.filter((x) => x.rem > EPS).map((x) => x.l);
    const r = open[0].range;
    const estimated = open.some((l) => l.estimated);
    alerts.push({
      groupKind: r.groupKind,
      groupCode: r.groupCode,
      groupName: r.groupName,
      stage: r.stage,
      stageLabel: r.stageLabel,
      day,
      mode: 'CONT_PER_DAY',
      doneCont: done,
      thresholdCont: threshold,
      estimated,
      itemIds: unique(open.map((l) => l.range.itemId)),
      displayCodes: codesOf(open),
      message:
        `${r.stageLabel} · ${r.groupName} ${ddmm(day)}: làm ${fmtCont(done)}/${fmtCont(threshold)} cont` +
        `${estimated ? SUFFIX_ESTIMATED : ''} - ${codesOf(open).join(', ')}`,
    });
  }

  // ── DAYS_PER_CONT (Phước An, Phôi + Hàn): kiểm cuối mỗi khối b ngày, theo từng dòng ──
  const b = Math.max(1, Math.round(params.daysPerContPhuocAn));
  for (const l of covering) {
    const r = l.range;
    if (r.mode !== 'DAYS_PER_CONT') continue;
    if (r.stage !== 'PHOI' && r.stage !== 'HAN') continue;
    const n = diffDays(r.from, day) + 1;
    if (n % b !== 0) continue;
    const k = n / b;
    const threshold = Math.min(k * DAILY_TARGET_CONT, r.cont);
    const cum = sumDone(l, (d) => d >= r.from && d <= day);
    if (cum >= threshold - EPS) continue;
    alerts.push({
      groupKind: r.groupKind,
      groupCode: r.groupCode,
      groupName: r.groupName,
      stage: r.stage,
      stageLabel: r.stageLabel,
      day,
      mode: 'DAYS_PER_CONT',
      doneCont: cum,
      thresholdCont: threshold,
      estimated: l.estimated,
      itemIds: [r.itemId],
      displayCodes: codesOf([l]),
      message:
        `${r.stageLabel} · ${r.groupName} tới ${ddmm(day)}: luỹ kế ${fmtCont(cum)}/${fmtCont(threshold)} cont sau ${n} ngày` +
        `${l.estimated ? SUFFIX_ESTIMATED : ''} - ${codesOf([l]).join(', ')}`,
    });
  }

  const stageOrder: CapacityStage[] = ['PHOI', 'HAN', 'SON', 'NHAP_DAN', 'CHUYEN_KIEM', 'DONG_GOI'];
  return alerts.sort(
    (a, b2) =>
      stageOrder.indexOf(a.stage) - stageOrder.indexOf(b2.stage) ||
      a.groupCode.localeCompare(b2.groupCode),
  );
}
