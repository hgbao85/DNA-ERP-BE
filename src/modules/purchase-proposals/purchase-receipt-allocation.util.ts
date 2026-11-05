/**
 * Tự chia 1 lần hàng về cho các lệnh trong đơn gộp (Đợt 5d, bản v8 YC8 + 8.1):
 *  - Thứ tự: lệnh có ngày cần vật tư sớm nhất trước; trùng ngày thì lệnh Giám đốc duyệt trước; chưa có ngày xếp cuối.
 *  - Lượt 1 lấp phần CẦN MUA (buyQty) còn thiếu của từng lệnh theo thứ tự đó - hàng thật sự thiếu được ưu tiên.
 *  - Lượt 2 lấp phần MUA DƯ người mua đã chốt (orderQty > buyQty) - phần này vốn về tồn chưa giữ.
 *  - Còn thừa nữa (NCC giao vượt đơn) ghi vào lệnh xếp CUỐI - cũng về tồn chưa giữ (receiptQtyForPool chỉ cộng giữ
 *    chỗ tới buyQty), chỉ để biết lần nhận vượt thuộc dòng nào.
 */
export interface AllocationLine {
  itemId: string;
  buyQty: number;
  /** Số mua thật (effectiveOrderQty) - luôn >= buyQty. */
  orderQty: number;
  receivedQty: number;
  deadline: Date | null;
  /** Lúc Giám đốc duyệt lệnh (sớm nhất trong các SKU đã duyệt của lệnh). */
  approvedAt: Date | null;
}

export interface AllocationResult {
  itemId: string;
  qty: number;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

const timeOrInf = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);

export function sortByPriority<T extends AllocationLine>(lines: T[]): T[] {
  return [...lines].sort(
    (a, b) =>
      timeOrInf(a.deadline) - timeOrInf(b.deadline) ||
      timeOrInf(a.approvedAt) - timeOrInf(b.approvedAt) ||
      (BigInt(a.itemId) < BigInt(b.itemId) ? -1 : BigInt(a.itemId) > BigInt(b.itemId) ? 1 : 0),
  );
}

export function autoAllocate(lines: AllocationLine[], total: number): AllocationResult[] {
  const ordered = sortByPriority(lines);
  const given = new Map<string, number>(ordered.map((l) => [l.itemId, 0]));
  let left = round4(total);

  const fill = (capOf: (l: AllocationLine) => number) => {
    for (const l of ordered) {
      if (left <= 0) return;
      const room = round4(capOf(l) - l.receivedQty - given.get(l.itemId)!);
      if (room <= 0) continue;
      const take = Math.min(room, left);
      given.set(l.itemId, round4(given.get(l.itemId)! + take));
      left = round4(left - take);
    }
  };
  fill((l) => l.buyQty);
  fill((l) => l.orderQty);
  if (left > 0 && ordered.length > 0) {
    const last = ordered[ordered.length - 1].itemId;
    given.set(last, round4(given.get(last)! + left));
  }
  return ordered.map((l) => ({ itemId: l.itemId, qty: given.get(l.itemId)! }));
}
