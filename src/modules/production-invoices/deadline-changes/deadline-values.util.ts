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
