import { MfgStage } from '../../generated/prisma/client';
import { queueWorkshopIdsOfPis } from './floor-queue-workshop.util';

/** Tổ có đợt báo chờ gửi KCS (nhắc chờ lâu tách theo tổ x xưởng). */
export type StaleStage = 'PHOI' | 'HAN' | 'SON';

/** 1 đợt chờ quá hạn: tổ + lệnh (null = không biết lệnh). */
export interface StaleItem {
  stage: StaleStage;
  productionInvoiceId: bigint | null;
}

/** Số đợt chờ quá hạn của 1 (tổ, xưởng hàng đợi); workshopId null = không suy ra được xưởng. */
export interface StaleBucket {
  stage: StaleStage;
  workshopId: bigint | null;
  count: number;
}

type QueueDb = Parameters<typeof queueWorkshopIdsOfPis>[0];

/** Khoá nhóm / entityId của tin: '<tổ>:<id xưởng | none>'. */
export function staleBucketKey(stage: StaleStage, workshopId: bigint | null): string {
  return `${stage}:${workshopId ?? 'none'}`;
}

/**
 * Gom các đợt chờ quá hạn theo (tổ, xưởng hàng đợi) - cùng quy tắc lọc xưởng của màn Sản lượng xưởng
 * (queueWorkshopIdsOfPis): tổ Sơn lấy xưởng nơi sơn, Phôi / Hàn lấy xưởng của lệnh. Dòng không có
 * lệnh hoặc lệnh không suy ra được xưởng rơi vào nhóm xưởng null. Dùng lại cho nhắc KCS chờ lâu.
 */
export async function groupStaleByQueueWorkshop(
  db: QueueDb,
  items: StaleItem[],
): Promise<StaleBucket[]> {
  const stageEnum: Record<StaleStage, MfgStage> = {
    PHOI: MfgStage.PHOI,
    HAN: MfgStage.HAN,
    SON: MfgStage.SON,
  };
  const counts = new Map<string, StaleBucket>();
  for (const stage of ['PHOI', 'HAN', 'SON'] as StaleStage[]) {
    const ofStage = items.filter((i) => i.stage === stage);
    if (ofStage.length === 0) continue;
    const piIds = new Map<string, bigint>();
    for (const i of ofStage) {
      if (i.productionInvoiceId != null) {
        piIds.set(i.productionInvoiceId.toString(), i.productionInvoiceId);
      }
    }
    const wsOf =
      piIds.size > 0
        ? await queueWorkshopIdsOfPis(db, stageEnum[stage], [...piIds.values()])
        : new Map<string, bigint | null>();
    for (const i of ofStage) {
      const workshopId =
        i.productionInvoiceId != null ? (wsOf.get(i.productionInvoiceId.toString()) ?? null) : null;
      const key = staleBucketKey(stage, workshopId);
      const b = counts.get(key);
      if (b) b.count += 1;
      else counts.set(key, { stage, workshopId, count: 1 });
    }
  }
  return [...counts.values()];
}
