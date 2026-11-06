/**
 * Phần A – Đợt 9 (YC2): hàm THUẦN dùng chung cho lõi đổi mốc (DeadlineChangesService) và Excel (DeadlinePlanExcelService) - đọc mốc
 * hiện tại của 1 dòng SKU thành `DeadlineValues`, so 2 bộ giá trị, nhãn mốc. Không truy cập DB.
 */
import { vnDayKey } from '../../../common/utils/floor-stats.util';
import {
  DEADLINE_FIELDS,
  DeadlineFieldChange,
  DeadlineFieldKey,
  DeadlineValues,
  PendingDeadlineChangeRef,
} from './deadline-changes.types';

export interface ItemDeadlineSource {
  materialDeadline: Date | null;
  finishedMaterialDeadline: Date | null;
  stages: { stageType: string; deadline: Date }[];
}

const STAGE_PREFIX = 'stage.';

export const isStageKey = (k: DeadlineFieldKey): boolean => k.startsWith(STAGE_PREFIX);
/** 'stage.FRAME_PHOI' → 'FRAME_PHOI'. */
export const stageTypeOf = (k: DeadlineFieldKey): string => k.slice(STAGE_PREFIX.length);

export function fieldLabel(k: DeadlineFieldKey): string {
  return DEADLINE_FIELDS.find((f) => f.key === k)?.label ?? k;
}

/** Mốc hiện tại của 1 dòng SKU, ĐỦ mọi khoá của DEADLINE_FIELDS (null = chưa có), ngày VN. */
export function valuesOfItem(item: ItemDeadlineSource): Required<DeadlineValues> {
  const out = {} as Required<DeadlineValues>;
  for (const f of DEADLINE_FIELDS) {
    if (f.key === 'materialDeadline') {
      out[f.key] = item.materialDeadline ? vnDayKey(item.materialDeadline) : null;
    } else if (f.key === 'finishedMaterialDeadline') {
      out[f.key] = item.finishedMaterialDeadline ? vnDayKey(item.finishedMaterialDeadline) : null;
    } else {
      const st = item.stages.find((s) => s.stageType === stageTypeOf(f.key));
      out[f.key] = st ? vnDayKey(st.deadline) : null;
    }
  }
  return out;
}

/**
 * Các mốc ĐỔI giữa `from` và `to`, theo thứ tự DEADLINE_FIELDS. Chỉ xét khoá có trong `to` (khoá vắng = không đổi). `to[k] = null` không
 * xoá mốc (Đợt 9 không cho xoá mốc qua sửa / Excel) - bỏ qua.
 */
export function diffValues(from: DeadlineValues, to: DeadlineValues): DeadlineFieldChange[] {
  const out: DeadlineFieldChange[] = [];
  for (const f of DEADLINE_FIELDS) {
    if (!(f.key in to)) continue;
    const next = to[f.key] ?? null;
    if (next === null) continue;
    const prev = from[f.key] ?? null;
    if (prev !== next) out.push({ key: f.key, label: f.label, from: prev, to: next });
  }
  return out;
}

/** Chỉ giữ khoá đổi thật: dùng khi lưu `newValues` / `oldValues` của 1 yêu cầu. */
export function pickChanged(changes: DeadlineFieldChange[]): {
  oldValues: DeadlineValues;
  newValues: DeadlineValues;
} {
  const oldValues: DeadlineValues = {};
  const newValues: DeadlineValues = {};
  for (const c of changes) {
    oldValues[c.key] = c.from;
    newValues[c.key] = c.to;
  }
  return { oldValues, newValues };
}

// ─── Phần A – Đợt 9 phần 2 (Sếp trả lời 06/11) ───────────────────────────────────────────────────

/**
 * Q9-3: lệnh đã BẮT ĐẦU SẢN XUẤT (cắt phôi) = lệnh SX có `floorStage` khác PENDING (QLSX đã bấm "Bắt đầu" - Phôi chỉ báo cắt được khi lệnh
 * ACTIVE; PAUSED / FINISHED cũng là đã bắt đầu). Chưa có lệnh SX (chưa duyệt) = chưa bắt đầu.
 */
export const isFloorStarted = (floorStage: string | null | undefined): boolean =>
  !!floorStage && floorStage !== 'PENDING';

/** Câu lỗi dùng chung khi dòng đã bắt đầu sản xuất (Q9-3). */
export const FLOOR_STARTED_ERROR = 'Lệnh đã bắt đầu sản xuất (cắt phôi) - không sửa mốc được nữa';

/** Q9-1: các mốc SẢN XUẤT (khoá `stage.*`) theo thứ tự DEADLINE_FIELDS - chỉ những mốc này tự dời. 2 mốc Mua VT và hạn giao không tự dời. */
export const AUTO_SHIFT_KEYS: DeadlineFieldKey[] = DEADLINE_FIELDS.map((f) => f.key).filter(
  isStageKey,
);

const DAY_MS = 86_400_000;
const utcOfDay = (day: string): number =>
  Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

/** Số ngày từ `from` tới `to` ('YYYY-MM-DD'), âm nếu `to` sớm hơn. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcOfDay(to) - utcOfDay(from)) / DAY_MS);
}

/** 'YYYY-MM-DD' + n ngày lịch. */
export function addDays(day: string, n: number): string {
  return new Date(utcOfDay(day) + n * DAY_MS).toISOString().slice(0, 10);
}

export interface AutoShiftResult {
  /** Đủ mọi khoá DEADLINE_FIELDS: ô gõ + mốc tự dời + mốc giữ nguyên. */
  values: Required<DeadlineValues>;
  /** Các mốc TỰ DỜI (không phải ô gõ), theo thứ tự DEADLINE_FIELDS. */
  autoKeys: DeadlineFieldKey[];
}

/**
 * Q9-1 (Sếp chọn B): mốc sản xuất KHSX không gõ mà đã có ngày → dời cùng số ngày với mốc sản xuất GẦN NHẤT PHÍA TRƯỚC nó mà KHSX đã gõ.
 * - `old` = mốc đang lưu (form) / lúc xuất file (Excel). `explicit` = ô KHSX gõ (null / vắng = không gõ).
 * - Gõ lại đúng ngày cũ = dời 0 ngày → các mốc sau đứng yên (cách giữ hạn đóng gói khi dời Phôi: gõ lại ngày Đóng gói cũ).
 * - Mốc chưa có ngày thì không tự sinh; gõ ngày cho mốc chưa có ngày thì không làm dời mốc sau. 2 mốc Mua VT: chỉ ô gõ, không tự dời,
 *   không làm dời mốc khác (số ngày dời đi xuyên qua chúng).
 * Hàm thuần - FE chép y hệt ở `src/modules/pages/ProductionPlan/deadlineRules.ts`.
 */
export function resolveAutoShift(old: DeadlineValues, explicit: DeadlineValues): AutoShiftResult {
  const values = {} as Required<DeadlineValues>;
  const autoKeys: DeadlineFieldKey[] = [];
  let delta = 0;
  for (const f of DEADLINE_FIELDS) {
    const prev = old[f.key] ?? null;
    const typed = explicit[f.key] ?? null;
    if (typed !== null) {
      values[f.key] = typed;
      if (isStageKey(f.key) && prev !== null) delta = daysBetween(prev, typed);
      continue;
    }
    if (isStageKey(f.key) && prev !== null && delta !== 0) {
      values[f.key] = addDays(prev, delta);
      autoKeys.push(f.key);
      continue;
    }
    values[f.key] = prev;
  }
  return { values, autoKeys };
}

/** Dòng `DeadlineChangeRequest` tối thiểu để dựng `PendingDeadlineChangeRef` (oldValues / newValues là JSON đã lưu). */
export interface PendingRequestRow {
  id: bigint;
  batchId: bigint;
  createdAt: Date;
  oldValues: unknown;
  newValues: unknown;
}

/** Yêu cầu đang chờ → tham chiếu gắn vào item trong response PI. */
export function pendingRefOf(req: PendingRequestRow): PendingDeadlineChangeRef {
  return {
    requestId: req.id.toString(),
    batchId: req.batchId.toString(),
    requestedAt: req.createdAt.toISOString(),
    changes: diffValues(req.oldValues as DeadlineValues, req.newValues as DeadlineValues),
  };
}
