import type { MaterialChoiceRefDto } from '../../common/utils/material-choice-ref.util';
import type { ProductionBatchesService } from '../production-batches/production-batches.service';
import type { SteelIssuesService } from '../steel-issues/steel-issues.service';
import {
  addBuckets,
  bucketLine,
  emptyBuckets,
  isShort,
  percentOf,
  type ProgressBuckets,
  type ProgressLineInput,
} from './floor-progress.util';

/** 1 công đoạn của tổ trên PI: `CAT`/công đoạn phụ (Phôi, đơn vị đoạn) hoặc `PIECE` (mảnh/vật tư thành phẩm). */
export interface FloorProgressStep extends ProgressBuckets {
  step: string;
  percent: number;
}

/**
 * Tiến độ của tổ trên 1 PI theo định nghĩa số chung (`floor-progress.util.ts`, changelog 10-08 mục 45.2): mọi số đã
 * chặn trần theo từng dòng; `reported` = `passed` + `awaiting` + `open` (Đã báo − Lỗi, chặn trần).
 */
export interface FloorProgress extends ProgressBuckets {
  percent: number;
  complete: boolean;
  /** Theo công đoạn - chỉ công đoạn PI có (Phôi: CAT + công đoạn phụ + PIECE nếu có mảnh). */
  breakdown: FloorProgressStep[];
  missing: {
    /** Số dòng (cỡ đoạn × công đoạn / mảnh) còn thiếu. */
    lines: number;
    /** Phôi: số loại sắt còn thiếu ít nhất 1 dòng; trong đó `materialsNotReceived` loại Phôi chưa nhận đợt sắt nào. */
    materials: number;
    materialsNotReceived: number;
    /** Số mảnh / vật tư thành phẩm còn thiếu. */
    pieces: number;
  };
}

export type PhoiItems = Awaited<ReturnType<SteelIssuesService['getPhoiProgressBatch']>>[string];
export type BatchPlans = Awaited<ReturnType<ProductionBatchesService['getBatchPlanBatch']>>;
export interface StageData {
  phoi: PhoiItems | null;
  plans: BatchPlans;
  orders: {
    productionOrderId: string;
    poNumber: string;
    productName: string;
    /** Loại dây/nệm Sales đã chọn - phân biệt các lệnh cùng SKU khác dây/nệm (null = không có lựa chọn). */
    wireMaterial: MaterialChoiceRefDto | null;
    cushionMaterial: MaterialChoiceRefDto | null;
  }[];
}

/**
 * Tiến độ của tổ trên 1 PI theo định nghĩa số chung (`floor-progress.util.ts`): MỖI dòng chặn trần ở số cần (dòng
 * báo vượt không che dòng còn thiếu), số được tính = Đã báo − Lỗi KCS. Cùng phạm vi với tab Phôi/Hàn/Sơn của
 * "Tổng hợp lệnh SX" để 2 màn ra cùng %:
 * - Phôi: Cắt + MỌI công đoạn phụ (Uốn/Dập/…) theo cỡ đoạn + mảnh Phôi tự báo + vật tư thành phẩm (chân nhôm) -
 *   người dùng chốt 2026-10-19 (mục 45.9-1): tổ Phôi chỉ "đủ số" khi xong cả công đoạn phụ.
 * - Hàn/Sơn: mảnh theo định mức (đạt + chờ KCS + chưa gửi; số đạt đã trừ lỗi vì KCS ghi đè `reportedQty`).
 * P1 (18/11/2026): `done` của phoi-progress = thô − thiếu (vẫn gồm lỗi) nên số được tính = done − lỗi = thô − lỗi − thiếu; mảnh:
 * `passedQty` đã trừ cả lỗi lẫn thiếu. Số cần của Phôi đã gồm phần cắt lại (extraNeed). Công thức giữ nguyên, chỉ đổi nghĩa đầu vào.
 * Chỉ là gợi ý nhắc QLSX, KHÔNG tự chuyển PI và không chặn gì.
 */
export function progressFrom({ phoi, plans }: StageData): FloorProgress {
  const steps = new Map<string, ProgressBuckets>();
  const missing = { lines: 0, materials: 0, materialsNotReceived: 0, pieces: 0 };
  const add = (step: string, line: ProgressLineInput): boolean => {
    const acc = steps.get(step) ?? emptyBuckets();
    addBuckets(acc, bucketLine(line));
    steps.set(step, acc);
    const short = isShort(line);
    if (short) missing.lines++;
    return short;
  };

  for (const m of phoi ?? []) {
    let materialShort = false;
    for (const g of [{ step: 'CAT', segments: m.segments }, ...m.steps]) {
      for (const sg of g.segments) {
        const short = add(g.step, {
          required: sg.required,
          done: sg.done,
          failed: sg.failed,
          open: sg.openQty,
          awaiting: sg.awaitingQcQty,
        });
        materialShort ||= short;
      }
    }
    if (materialShort) {
      missing.materials++;
      if (m.steelBalance === null) missing.materialsNotReceived++;
    }
  }

  for (const plan of Object.values(plans)) {
    for (const it of plan.items) {
      // Mảnh: `passedQty` đã là số ĐẠT sau KCS (lỗi đã bị trừ); `failedQty` = lỗi KCS cộng dồn (18/11/2026). Đã báo gồm cả lỗi,
      // được tính = đã báo − lỗi nên tiến độ / còn thiếu không đổi; chỉ thêm số Lỗi cho khớp FE progressModel.pieceLine.
      const failed = it.failedQty ?? 0;
      const short = add('PIECE', {
        required: it.plannedQty,
        done: it.passedQty + failed + it.awaitingQcQty + it.openQty,
        failed,
        open: it.openQty,
        awaiting: it.awaitingQcQty,
      });
      if (short) missing.pieces++;
    }
    for (const it of plan.materialYieldItems ?? []) {
      const short = add('PIECE', {
        required: it.plannedQty,
        done: it.passedQty + it.awaitingQcQty,
        failed: 0,
        open: 0,
        awaiting: it.awaitingQcQty,
      });
      if (short) missing.pieces++;
    }
  }

  const total = emptyBuckets();
  const breakdown: FloorProgressStep[] = [];
  for (const [step, b] of steps) {
    if (b.required <= 0) continue;
    addBuckets(total, b);
    breakdown.push({ step, ...b, percent: percentOf(b.reported, b.required) });
  }
  return {
    ...total,
    percent: percentOf(total.reported, total.required),
    complete: total.required > 0 && total.reported >= total.required,
    breakdown,
    missing,
  };
}
