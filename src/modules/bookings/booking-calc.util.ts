import { vnDayKey } from '../../common/utils/floor-stats.util';

/**
 * Phần A – Đợt 10a (YC5): hàm thuần tính số liệu booking (ngày hạn, chia hàng sẵn, thể tích). Tính thể tích bằng SỐ NGUYÊN
 * (đơn vị 1e-4 m³) rồi mới chia để khỏi sai số số thực.
 */

const M3_UNIT = 10_000;

/** Ngày hạn của booking = ngày SỚM HƠN giữa ngày lấy cont và ngày (giờ VN) của CUT OFF; không có cả 2 -> null. */
export function bookingDueDay(b: {
  pickupDate: Date | null;
  cutOffAt: Date | null;
}): string | null {
  return bookingDue(b)?.day ?? null;
}

/** Như `bookingDueDay` nhưng cho biết ngày hạn đến từ cột nào (để thông báo ghi "lấy cont" hay "CUT OFF"). */
export function bookingDue(b: {
  pickupDate: Date | null;
  cutOffAt: Date | null;
}): { day: string; kind: 'lấy cont' | 'CUT OFF' } | null {
  const pickup = b.pickupDate ? b.pickupDate.toISOString().slice(0, 10) : null;
  const cutOff = b.cutOffAt ? vnDayKey(b.cutOffAt) : null;
  if (pickup && cutOff) {
    // Bằng nhau thì coi là ngày lấy cont (mốc đến trước trên thực tế).
    return cutOff < pickup ? { day: cutOff, kind: 'CUT OFF' } : { day: pickup, kind: 'lấy cont' };
  }
  if (pickup) return { day: pickup, kind: 'lấy cont' };
  if (cutOff) return { day: cutOff, kind: 'CUT OFF' };
  return null;
}

export interface BookingClaim {
  bookingId: string;
  dueDay: string | null;
  /** max(0, qty − shippedQty) của dòng booking trên dòng đơn đang chia. */
  outstanding: number;
}

/**
 * Chia hàng sẵn (readyQty) cho các booking cùng giữ 1 dòng đơn: booking có ngày hạn sớm được chia trước (không có ngày xếp
 * cuối; cùng ngày thì id nhỏ trước). Trả về số THIẾU của từng booking = outstanding − phần được chia.
 */
export function allocateShortage(readyQty: number, claims: BookingClaim[]): Map<string, number> {
  const sorted = [...claims].sort((a, b) => {
    if (a.dueDay !== b.dueDay) {
      if (a.dueDay === null) return 1;
      if (b.dueDay === null) return -1;
      return a.dueDay < b.dueDay ? -1 : 1;
    }
    const ai = BigInt(a.bookingId);
    const bi = BigInt(b.bookingId);
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
  let left = Math.max(0, readyQty);
  const result = new Map<string, number>();
  for (const c of sorted) {
    const outstanding = Math.max(0, c.outstanding);
    const got = Math.min(outstanding, left);
    left -= got;
    result.set(c.bookingId, (result.get(c.bookingId) ?? 0) + (outstanding - got));
  }
  return result;
}

/** Thể tích 1 thùng tính theo đơn vị 1e-4 m³ (số nguyên). */
function boxUnits(boxVolumeM3: number): number {
  return Math.round(boxVolumeM3 * M3_UNIT);
}

/** Thể tích 1 bộ (m³, 4 số lẻ) = thể tích thùng × số thùng/bộ; null khi thiếu kích thước. */
export function setVolumeM3(boxVolumeM3: number | null, boxesPerSet: number): number | null {
  if (boxVolumeM3 === null) return null;
  return (boxUnits(boxVolumeM3) * boxesPerSet) / M3_UNIT;
}

/** Thể tích của `qty` bộ (m³, 3 số lẻ); null khi thiếu kích thước. */
export function lineM3(
  qty: number,
  boxVolumeM3: number | null,
  boxesPerSet: number,
): number | null {
  if (boxVolumeM3 === null) return null;
  return round(roundUnitsToM3(boxUnits(boxVolumeM3) * boxesPerSet * qty), 3);
}

function roundUnitsToM3(units: number): number {
  return units / M3_UNIT;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export interface BookingTotalsLine {
  factoryCode: string;
  qty: number;
  boxVolumeM3: number | null;
  boxesPerSet: number;
  shortQty: number;
}

export interface BookingTotals {
  qty: number;
  totalM3: number;
  capacityM3: number;
  fillPct: number | null;
  missingVolumeSkus: string[];
  shortQty: number;
  shortLines: number;
}

export function bookingTotals(
  lines: BookingTotalsLine[],
  containerVolumeM3: number,
  containerQty: number,
): BookingTotals {
  let qty = 0;
  let units = 0;
  let shortQty = 0;
  let shortLines = 0;
  const missing: string[] = [];
  for (const l of lines) {
    qty += l.qty;
    if (l.shortQty > 0) {
      shortQty += l.shortQty;
      shortLines += 1;
    }
    if (l.boxVolumeM3 === null) {
      if (l.qty > 0 && !missing.includes(l.factoryCode)) missing.push(l.factoryCode);
    } else {
      units += boxUnits(l.boxVolumeM3) * l.boxesPerSet * l.qty;
    }
  }
  const totalM3 = round(units / M3_UNIT, 3);
  const capacityM3 = round(containerVolumeM3 * containerQty, 2);
  const fillPct = capacityM3 > 0 ? round((totalM3 / capacityM3) * 100, 1) : null;
  return { qty, totalM3, capacityM3, fillPct, missingVolumeSkus: missing, shortQty, shortLines };
}
