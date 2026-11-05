/**
 * Phần A – Đợt 3 (YC10 10.12): hàm THUẦN gom cont các khoảng ngày công đoạn thành bảng năng lực theo (nhóm × công đoạn × ngày) và
 * sinh cảnh báo. Không đụng DB. CONT_PER_DAY: cảnh báo khi tổng cont trong ngày > trần; DAYS_PER_CONT (Phước An, Phôi + Hàn):
 * cảnh báo khi từ 2 lệnh khác nhau cùng chiếm 1 ngày (lệnh sau bắt đầu khi lệnh trước cắt xong).
 */
import { addDays, diffDays, type TimelineParams } from '../../common/utils/timeline-suggest.util';
import type { StageRange } from './production-capacity.ranges';
import {
  CAPACITY_STAGES,
  type CapacityDayCell,
  type CapacityOrderLoad,
  type CapacityRow,
  type CapacityWarning,
} from './production-capacity.types';

const EPS = 1e-9;

/** Thứ tự ưu tiên hiển thị các xưởng; xưởng khác xếp sau theo mã. */
const WORKSHOP_ORDER = ['PHU_AN', 'PHUOC_AN'];

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Số kiểu VN: dấu phẩy, tối đa 2 số lẻ, bỏ số 0 thừa (1,8 · 1,3 · 2). */
export function formatVnNumber(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r).replace('.', ',');
}

/** 'YYYY-MM-DD' -> 'DD/MM'. */
function dayLabel(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function stageOrder(stage: string): number {
  return CAPACITY_STAGES.findIndex((s) => s.stage === stage);
}

function compareGroups(a: CapacityRow, b: CapacityRow): number {
  if (a.groupKind !== b.groupKind) return a.groupKind === 'WORKSHOP' ? -1 : 1;
  if (a.groupCode !== b.groupCode) {
    if (a.groupKind === 'WORKSHOP') {
      const ia = WORKSHOP_ORDER.indexOf(a.groupCode);
      const ib = WORKSHOP_ORDER.indexOf(b.groupCode);
      if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    }
    return a.groupCode < b.groupCode ? -1 : 1;
  }
  return stageOrder(a.stage) - stageOrder(b.stage);
}

export function aggregateCapacity(
  ranges: StageRange[],
  from: string,
  to: string,
  params: TimelineParams,
): { rows: CapacityRow[]; warnings: CapacityWarning[] } {
  const span = diffDays(from, to) + 1;
  if (span < 1) return { rows: [], warnings: [] };
  const allDays: string[] = [];
  for (let i = 0; i < span; i++) allDays.push(addDays(from, i));

  // Gom khoảng theo (kind, code, stage) - chỉ khoảng giao với [from, to].
  const groups = new Map<string, StageRange[]>();
  for (const r of ranges) {
    if (diffDays(r.to, from) > 0 || diffDays(to, r.from) > 0) continue;
    const key = `${r.groupKind}|${r.groupCode}|${r.stage}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const rows: CapacityRow[] = [];
  for (const list of groups.values()) {
    const head = list[0];
    const isCont = head.mode === 'CONT_PER_DAY';
    const capacity = isCont ? params.capacityContPerDay : null;
    const days: CapacityDayCell[] = [];
    for (const day of allDays) {
      const orders: CapacityOrderLoad[] = [];
      let total = 0;
      for (const r of list) {
        if (diffDays(r.from, day) < 0 || diffDays(day, r.to) < 0) continue;
        total += r.contPerDay;
        orders.push({
          itemId: r.itemId,
          piId: r.piId,
          displayCode: r.displayCode,
          skuCode: r.skuCode,
          cont: round3(r.contPerDay),
          from: r.from,
          to: r.to,
        });
      }
      // DAYS_PER_CONT: đếm theo LỆNH SX (piId) - lệnh gộp 2 SKU cắt chung là 1 lệnh, không tự "chồng" với chính nó.
      const over = isCont
        ? total > (capacity as number) + EPS
        : new Set(orders.map((o) => o.piId)).size >= 2;
      days.push({ day, cont: round3(total), orders, over });
    }
    const row: CapacityRow = {
      groupKind: head.groupKind,
      groupCode: head.groupCode,
      groupName: head.groupName,
      stage: head.stage,
      stageLabel: head.stageLabel,
      mode: head.mode,
      capacity,
      days,
    };
    rows.push(row);
  }
  rows.sort(compareGroups);

  const warnings: CapacityWarning[] = [];
  for (const row of rows) {
    warnings.push(...warningsOfRow(row));
  }
  return { rows, warnings };
}

/** Gộp các ô over LIÊN TIẾP cùng tập lệnh của 1 dòng bảng thành 1 cảnh báo. */
function warningsOfRow(row: CapacityRow): CapacityWarning[] {
  const out: CapacityWarning[] = [];
  const idsOf = (cell: CapacityDayCell) => [...new Set(cell.orders.map((o) => o.itemId))].sort();
  let i = 0;
  while (i < row.days.length) {
    const cell = row.days[i];
    if (!cell.over) {
      i++;
      continue;
    }
    const ids = idsOf(cell);
    const key = ids.join(',');
    let j = i;
    let maxCont = cell.cont;
    while (
      j + 1 < row.days.length &&
      row.days[j + 1].over &&
      idsOf(row.days[j + 1]).join(',') === key
    ) {
      j++;
      maxCont = Math.max(maxCont, row.days[j].cont);
    }
    const codes: string[] = [];
    for (let k = i; k <= j; k++) {
      for (const o of row.days[k].orders) {
        const code = o.displayCode || o.skuCode;
        if (!codes.includes(code)) codes.push(code);
      }
    }
    const dayText =
      j > i ? `${dayLabel(cell.day)}–${dayLabel(row.days[j].day)}` : dayLabel(cell.day);
    const piCount = new Set(cell.orders.map((o) => o.piId)).size;
    const detail =
      row.capacity === null
        ? `${piCount} lệnh cùng chiếm ngày`
        : `${formatVnNumber(maxCont)} cont > ${formatVnNumber(row.capacity)}`;
    out.push({
      groupKind: row.groupKind,
      groupCode: row.groupCode,
      groupName: row.groupName,
      stage: row.stage,
      stageLabel: row.stageLabel,
      day: cell.day,
      cont: maxCont,
      capacity: row.capacity,
      itemIds: ids,
      message: `${row.stageLabel} · ${row.groupName} ${dayText}: ${detail} (${codes.join(', ')})`,
    });
    i = j + 1;
  }
  return out;
}
