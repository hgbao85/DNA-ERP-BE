/**
 * Phần A – Đợt 3 (YC10; kế hoạch phần A mục 3 "Năng lực" + V4-5, V4-16): KHOẢNG NGÀY mỗi công đoạn của 1 dòng SKU, lấy từ mốc ĐÃ
 * LƯU (hoặc đang thử ở /check). Hàm thuần dùng chung cho bảng năng lực (cộng cont theo ngày) và cảnh báo sản lượng ngày.
 *
 *   Phôi   [PHOI_START, FRAME_PHOI]         nhóm = xưởng của dòng
 *   Hàn    [PHOI_START + 1, FRAME_HAN]      nhóm = xưởng của dòng
 *   Sơn    [PHOI_START + 2, FRAME_SON]      nhóm = xưởng SƠN (Phước An -> Phú An), cộng cont như lệnh Phú An (10.12)
 *   Nhập đan    [WEAVING − Xđg + 1, WEAVING]                 nhóm = kho đóng gói (1 ngày mốc - SINGLE_DATE_STAGE_SPREAD_X_DAYS)
 *   Chuyền kiểm [TRANSFER_CHECK − Xđg + 1, TRANSFER_CHECK]   nhóm = kho đóng gói
 *   Đóng gói    [PACKAGING_START, PACKAGING]                 nhóm = kho đóng gói
 * Thiếu ngày bắt đầu -> suy từ ngày xong − X + 1 (X theo chế độ của nhóm). Bắt đầu sau ngày xong (KHSX đặt ngược) -> 1 ngày = ngày
 * xong. Thiếu ngày xong -> công đoạn đó chưa có kế hoạch, bỏ. Xưởng DAYS_PER_CONT (Phước An): Phôi/Hàn dùng X TÍNH LẠI theo xưởng
 * (V4-5) - [N, N+X−1] và [N+1, N+X], không dùng ngày xong đã lưu (KHSX có thể đã đặt theo Phú An). Chưa có load cont -> không có
 * khoảng nào (không cộng được cont) - service liệt kê vào `missingLoadCont`.
 */
import {
  addDays,
  diffDays,
  frameDaysOf,
  packagingDaysOf,
  type TimelineParams,
} from '../../common/utils/timeline-suggest.util';
import {
  CAPACITY_STAGES,
  SINGLE_DATE_STAGE_SPREAD_X_DAYS,
  type CapacityGroupKind,
  type CapacityMode,
  type CapacityStage,
} from './production-capacity.types';

export type CapacityStageKey =
  | 'PHOI_START'
  | 'FRAME_PHOI'
  | 'FRAME_HAN'
  | 'FRAME_SON'
  | 'WEAVING'
  | 'TRANSFER_CHECK'
  | 'PACKAGING_START'
  | 'PACKAGING';

export interface CapacityWorkshopRef {
  code: string;
  name: string;
  capacityMode: CapacityMode;
}

/** 1 dòng SKU đưa vào tính năng lực (service tự dựng từ DB / từ body /check). */
export interface CapacityItemInput {
  itemId: string;
  piId: string;
  displayCode: string;
  skuCode: string;
  quantity: number;
  loadCont: number | null;
  /** Xưởng cơ khí của dòng (null = chưa chọn -> không xét Phôi/Hàn/Sơn, v8 10.10). */
  workshop: (CapacityWorkshopRef & { paint: CapacityWorkshopRef | null }) | null;
  /** Kho đóng gói (warehouseCode/Name) - null = chưa chọn -> không xét Nhập đan/Chuyền kiểm/Đóng gói. */
  warehouse: { code: string; name: string } | null;
  /** Mốc 'YYYY-MM-DD' (ngày VN). */
  stages: Partial<Record<CapacityStageKey, string>>;
}

export interface StageRange {
  itemId: string;
  piId: string;
  displayCode: string;
  skuCode: string;
  stage: CapacityStage;
  stageLabel: string;
  groupKind: CapacityGroupKind;
  groupCode: string;
  groupName: string;
  mode: CapacityMode;
  from: string;
  to: string;
  /** Số ngày của khoảng (≥ 1). */
  days: number;
  /** Cont của cả dòng ở công đoạn này. */
  cont: number;
  /** cont ÷ days. */
  contPerDay: number;
}

const labelOf = (stage: CapacityStage) => CAPACITY_STAGES.find((s) => s.stage === stage)!.label;

export function stageRangesOf(item: CapacityItemInput, params: TimelineParams): StageRange[] {
  if (!(typeof item.loadCont === 'number' && item.loadCont > 0) || !(item.quantity > 0)) return [];
  const cont = item.quantity / item.loadCont;
  const s = item.stages;
  const out: StageRange[] = [];

  const push = (
    stage: CapacityStage,
    group: { kind: CapacityGroupKind; code: string; name: string; mode: CapacityMode },
    fromRaw: string | null,
    to: string,
  ) => {
    const from = fromRaw && diffDays(fromRaw, to) >= 0 ? fromRaw : to;
    const days = diffDays(from, to) + 1;
    out.push({
      itemId: item.itemId,
      piId: item.piId,
      displayCode: item.displayCode,
      skuCode: item.skuCode,
      stage,
      stageLabel: labelOf(stage),
      groupKind: group.kind,
      groupCode: group.code,
      groupName: group.name,
      mode: group.mode,
      from,
      to,
      days,
      cont,
      contPerDay: cont / days,
    });
  };

  if (item.workshop) {
    const ws = item.workshop;
    const wsGroup = {
      kind: 'WORKSHOP' as const,
      code: ws.code,
      name: ws.name,
      mode: ws.capacityMode,
    };
    const x = frameDaysOf(item.quantity, item.loadCont, ws.capacityMode, params);
    if (ws.capacityMode === 'DAYS_PER_CONT') {
      // V4-5: X tính lại theo xưởng, N = PHOI_START ?? Phôi xong − (X − 1).
      const n = s.PHOI_START ?? (s.FRAME_PHOI ? addDays(s.FRAME_PHOI, -(x - 1)) : null);
      if (n) {
        push('PHOI', wsGroup, n, addDays(n, x - 1));
        push('HAN', wsGroup, addDays(n, 1), addDays(n, x));
      }
    } else {
      if (s.FRAME_PHOI)
        push('PHOI', wsGroup, s.PHOI_START ?? addDays(s.FRAME_PHOI, -(x - 1)), s.FRAME_PHOI);
      if (s.FRAME_HAN)
        push(
          'HAN',
          wsGroup,
          s.PHOI_START ? addDays(s.PHOI_START, 1) : addDays(s.FRAME_HAN, -(x - 1)),
          s.FRAME_HAN,
        );
    }
    const paint = ws.paint ?? ws;
    const xPaint = frameDaysOf(item.quantity, item.loadCont, paint.capacityMode, params);
    if (s.FRAME_SON) {
      push(
        'SON',
        { kind: 'WORKSHOP', code: paint.code, name: paint.name, mode: paint.capacityMode },
        s.PHOI_START ? addDays(s.PHOI_START, 2) : addDays(s.FRAME_SON, -(xPaint - 1)),
        s.FRAME_SON,
      );
    }
  }

  if (item.warehouse) {
    const wh = {
      kind: 'WAREHOUSE' as const,
      code: item.warehouse.code,
      name: item.warehouse.name,
      mode: 'CONT_PER_DAY' as const,
    };
    const xPack = packagingDaysOf(item.quantity, item.loadCont, params);
    const spread = (end: string) =>
      SINGLE_DATE_STAGE_SPREAD_X_DAYS ? addDays(end, -(xPack - 1)) : end;
    if (s.WEAVING) push('NHAP_DAN', wh, spread(s.WEAVING), s.WEAVING);
    if (s.TRANSFER_CHECK) push('CHUYEN_KIEM', wh, spread(s.TRANSFER_CHECK), s.TRANSFER_CHECK);
    if (s.PACKAGING)
      push('DONG_GOI', wh, s.PACKAGING_START ?? addDays(s.PACKAGING, -(xPack - 1)), s.PACKAGING);
  }
  return out;
}

/** Khoảng có chứa ngày `day` không. */
export function rangeCovers(r: Pick<StageRange, 'from' | 'to'>, day: string): boolean {
  return diffDays(r.from, day) >= 0 && diffDays(day, r.to) >= 0;
}
