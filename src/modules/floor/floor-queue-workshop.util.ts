import { MfgStage } from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';

/**
 * Xưởng của hàng đợi tổ (đợt C1, 14/11/2026): mỗi xưởng một hàng đợi cho mỗi tổ (Phôi/Hàn/Sơn).
 *
 * - Xưởng hàng đợi của 1 PI ở 1 tổ = xưởng của PI (ProductionInvoiceItem.workshopId; mọi SKU 1 PI
 *   cùng xưởng); PI chưa có xưởng
 *   thì dùng xưởng mặc định.
 * - Riêng tổ SƠN: xưởng đó nhờ xưởng khác sơn (Workshop.paintWorkshopId, vd Phước An sơn ở Phú An)
 *   thì lấy xưởng sơn.
 * - Xưởng mặc định = xưởng của kho 'phoi-son-han'; kho đó không có xưởng thì xưởng đang dùng có
 *   sortOrder nhỏ nhất, rồi id nhỏ nhất;
 *   không có xưởng nào thì null.
 * - Xưởng của máy khi quét = Workstation.workshopId, máy chưa gắn xưởng thì xưởng mặc định. KHÔNG
 *   đổi theo xưởng sơn: máy đặt ở
 *   đâu là xưởng đó.
 *
 * Quy tắc này cũng là quy tắc backfill trong migration 20261114090000_floor_queue_by_workshop.
 */
type Db = Pick<PrismaTx, 'warehouse' | 'workshop' | 'productionInvoiceItem'>;

/**
 * Hàm thuần của quy tắc: xưởng hàng đợi từ xưởng của PI (đã thay bằng xưởng mặc định nếu PI chưa
 * có), tổ và bảng xưởng sơn nhờ.
 */
export function resolveQueueWorkshopId(
  stage: MfgStage,
  baseWorkshopId: bigint | null,
  paintWorkshopOf: ReadonlyMap<string, bigint | null>,
): bigint | null {
  if (baseWorkshopId == null) return null;
  if (stage !== MfgStage.SON) return baseWorkshopId;
  return paintWorkshopOf.get(baseWorkshopId.toString()) ?? baseWorkshopId;
}

/** Xưởng mặc định (xem đầu file). */
export async function loadDefaultWorkshopId(
  db: Pick<Db, 'warehouse' | 'workshop'>,
): Promise<bigint | null> {
  const root = await db.warehouse.findUnique({
    where: { code: 'phoi-son-han' },
    select: { workshopId: true },
  });
  if (root?.workshopId != null) return root.workshopId;
  const first = await db.workshop.findFirst({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return first?.id ?? null;
}

/** Xưởng của máy khi quét: máy chưa gắn xưởng thì xưởng mặc định. */
export async function workstationQueueWorkshopId(
  db: Pick<Db, 'warehouse' | 'workshop'>,
  workstationWorkshopId: bigint | null,
): Promise<bigint | null> {
  return workstationWorkshopId ?? (await loadDefaultWorkshopId(db));
}

/** Xưởng hàng đợi của nhiều PI ở 1 tổ (khoá = id PI dạng chuỗi) - vài truy vấn cho cả lô. */
export async function queueWorkshopIdsOfPis(
  db: Db,
  stage: MfgStage,
  productionInvoiceIds: bigint[],
): Promise<Map<string, bigint | null>> {
  const out = new Map<string, bigint | null>();
  if (productionInvoiceIds.length === 0) return out;
  const items = await db.productionInvoiceItem.findMany({
    where: { productionInvoiceId: { in: productionInvoiceIds }, workshopId: { not: null } },
    select: { productionInvoiceId: true, workshopId: true },
    orderBy: { id: 'asc' },
  });
  const own = new Map<string, bigint>();
  for (const it of items) {
    const key = String(it.productionInvoiceId);
    if (!own.has(key) && it.workshopId != null) own.set(key, it.workshopId);
  }
  const needDefault = productionInvoiceIds.some((id) => !own.has(id.toString()));
  const defaultId = needDefault ? await loadDefaultWorkshopId(db) : null;
  const paintOf = new Map<string, bigint | null>();
  if (stage === MfgStage.SON) {
    const baseIds = [...new Set([...own.values(), ...(defaultId != null ? [defaultId] : [])])];
    if (baseIds.length > 0) {
      const rows = await db.workshop.findMany({
        where: { id: { in: baseIds } },
        select: { id: true, paintWorkshopId: true },
      });
      for (const w of rows) paintOf.set(w.id.toString(), w.paintWorkshopId);
    }
  }
  for (const id of productionInvoiceIds) {
    const key = id.toString();
    out.set(key, resolveQueueWorkshopId(stage, own.get(key) ?? defaultId, paintOf));
  }
  return out;
}

export async function queueWorkshopIdOfPi(
  db: Db,
  stage: MfgStage,
  productionInvoiceId: bigint,
): Promise<bigint | null> {
  const map = await queueWorkshopIdsOfPis(db, stage, [productionInvoiceId]);
  return map.get(productionInvoiceId.toString()) ?? null;
}

/**
 * X4 (danh sách lỗi 16/11): QLSX gắn xưởng chỉ thấy các đợt chờ gửi KCS của PI có xưởng hàng đợi (ở tổ đó) = xưởng
 * mình - cùng quy tắc hàng đợi tổ, nên tổ Sơn thấy cả lệnh của xưởng nhờ sơn. `workshopId` null (người không
 * gắn xưởng) = không lọc; PI không suy ra được xưởng nào (chưa có xưởng nào) thì ai cũng thấy.
 */
export async function filterByQueueWorkshop<T>(
  db: Db,
  workshopId: bigint | null,
  stage: MfgStage,
  rows: T[],
  /** PI của dòng; null (dòng không gắn PI) = không lọc dòng đó. */
  piIdOf: (row: T) => bigint | null | undefined,
): Promise<T[]> {
  if (workshopId == null || rows.length === 0) return rows;
  const piIds = new Map<string, bigint>();
  for (const r of rows) {
    const id = piIdOf(r);
    if (id != null) piIds.set(id.toString(), id);
  }
  const wsOf = await queueWorkshopIdsOfPis(db, stage, [...piIds.values()]);
  return rows.filter((r) => {
    const id = piIdOf(r);
    const ws = id != null ? wsOf.get(id.toString()) : null;
    return ws == null || ws === workshopId;
  });
}
