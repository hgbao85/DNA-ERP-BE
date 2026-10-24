import { BomOptionKind } from '../../generated/prisma/client';
import type { PrismaServiceType } from '../../prisma/prisma.service';

/**
 * Loại dây (mã SHT) / loại nệm mà 1 bản định mức cho Sales chọn được (bảng bom_option) và cách
 * mỗi lệnh sản xuất loại bỏ các lựa chọn KHÔNG được chọn khỏi định mức khi tính vật tư.
 *
 * Quy ước: 1 dòng định mức (PieceMaterialItem / BomAccessoryItem) là "dòng chọn một" khi vật tư
 * của nó nằm trong bom_option của chính revision đó. Dòng đó chỉ tính nếu lệnh chọn đúng vật tư
 * ấy; mọi vật tư KHÔNG nằm trong bom_option (đinh, nút nhựa, sắt, sơn...) luôn được tính - nên
 * SKU không khai tick nào chạy y như trước khi có tính năng này.
 */
export interface BomChoice {
  bomRevisionId: bigint;
  wireMaterialId: bigint | null;
  cushionMaterialId: bigint | null;
}

export interface BomOptionRow {
  bomRevisionId: bigint;
  kind: BomOptionKind;
  materialId: bigint;
}

type BomOptionClient = { bomOption: PrismaServiceType['bomOption'] };

/**
 * Tập id vật tư phải LOẠI khỏi định mức của 1 lệnh: các loại dây/nệm đã tick nhưng lệnh không
 * chọn. Lệnh chưa chọn gì cho 1 loại (null - đơn cũ / SKU không có tick loại đó) thì KHÔNG lọc gì
 * cho loại đó, giữ hành vi cũ thay vì tự ý bỏ hết dòng (mất hẳn vật tư không ai biết).
 */
export function excludedMaterialIds(options: BomOptionRow[], choice: BomChoice): Set<string> {
  const excluded = new Set<string>();
  for (const opt of options) {
    if (opt.bomRevisionId !== choice.bomRevisionId) continue;
    const chosen =
      opt.kind === BomOptionKind.WIRE ? choice.wireMaterialId : choice.cushionMaterialId;
    if (chosen == null) continue;
    if (opt.materialId !== chosen) excluded.add(opt.materialId.toString());
  }
  return excluded;
}

/**
 * Nạp tick của mọi revision liên quan bằng 1 query rồi tính tập loại trừ cho từng lệnh. Khoá kết
 * quả = id lệnh (string). Lệnh không có tick nào trả về Set rỗng (luôn có key để gọi .get() an
 * toàn).
 */
export async function loadBomOptionExclusions(
  db: BomOptionClient,
  orders: (BomChoice & { id: bigint })[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (orders.length === 0) return result;
  const revisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
  const options = await db.bomOption.findMany({
    where: { bomRevisionId: { in: revisionIds } },
    select: { bomRevisionId: true, kind: true, materialId: true },
  });
  for (const order of orders) {
    result.set(order.id.toString(), excludedMaterialIds(options, order));
  }
  return result;
}
