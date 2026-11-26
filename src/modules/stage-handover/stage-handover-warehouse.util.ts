import { BadRequestException } from '@nestjs/common';
import { MfgStage, WarehouseKind } from '../../generated/prisma/client';
import type { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { WarehouseLike, WorkshopWarehouseResolver } from '../stock/workshop-warehouse.util';

type Db = PrismaTx | PrismaServiceType;

/**
 * Kho của tổ nhận hàng giao (giao nhận giữa tổ, 24/11/2026):
 *  - Hàn: kho Hàn của xưởng làm lệnh;
 *  - Sơn: kho Sơn của NƠI SƠN = Workshop.paintWorkshopId ?? xưởng của lệnh (cùng quy tắc tổ Sơn ở floor-stage.service), không có
 *    kho Sơn gắn xưởng đó thì kho Sơn dùng chung (WorkshopWarehouseResolver.kindWarehouseOf).
 * Dùng chung cho phiếu giao (kho đích) và phía trừ đoạn lúc KCS chấm (kho nguồn khi bật công tắc) - 2 nơi phải ra cùng 1 kho.
 */
export async function stageWarehouseOfPi(
  db: Db,
  productionInvoiceId: bigint | null,
  stage: MfgStage,
): Promise<WarehouseLike | null> {
  const resolver = new WorkshopWarehouseResolver(db);
  const workshopId = await resolver.workshopIdOfPi(productionInvoiceId);
  if (stage === MfgStage.HAN) return resolver.kindWarehouseOf(WarehouseKind.HAN, workshopId);
  if (stage === MfgStage.PHOI) return resolver.phoiWarehouseOfPi(productionInvoiceId);
  let paintWs = workshopId;
  if (workshopId != null) {
    const ws = await db.workshop.findUnique({
      where: { id: workshopId },
      select: { paintWorkshopId: true },
    });
    paintWs = ws?.paintWorkshopId ?? workshopId;
  }
  if (paintWs != null) {
    const own = await db.warehouse.findFirst({
      where: { kind: WarehouseKind.SON, workshopId: paintWs, deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true, code: true, kind: true, workshopId: true },
    });
    if (own) return own;
  }
  return resolver.kindWarehouseOf(WarehouseKind.SON, null);
}

/** Như stageWarehouseOfPi nhưng thiếu kho thì 400 (cấu hình thiếu). */
export async function requireStageWarehouseOfPi(
  db: Db,
  productionInvoiceId: bigint,
  stage: MfgStage,
): Promise<WarehouseLike> {
  const w = await stageWarehouseOfPi(db, productionInvoiceId, stage);
  if (!w) {
    const label = stage === MfgStage.HAN ? 'Hàn' : stage === MfgStage.SON ? 'Sơn' : 'Phôi';
    throw new BadRequestException(
      `Chưa có kho ${label} cho xưởng của lệnh - báo Admin tạo kho trước`,
    );
  }
  return w;
}
