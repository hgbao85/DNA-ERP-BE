import { FloorQueueStatus, MfgStage } from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import type { PrismaTx } from '../../prisma/prisma.service';
import { queueLockKey, queueWorkshopIdOfPi } from './floor-queue-workshop.util';

/** 1 dòng hàng đợi đã dời sang hàng đợi của xưởng mới. */
export interface FloorQueueMove {
  stage: MfgStage;
  fromWorkshopId: bigint | null;
  toWorkshopId: bigint | null;
  /** Trước khi dời dòng đang chạy (RUNNING). */
  wasRunning: boolean;
}

/**
 * Đổi xưởng của lệnh (16/11/2026): dòng hàng đợi Phôi / Hàn / Sơn CÒN MỞ (QUEUED hoặc RUNNING) của lệnh dời sang hàng đợi cùng tổ
 * của xưởng mới, ở trạng thái chờ, đứng CUỐI hàng. Dòng DONE giữ nguyên ở xưởng cũ.
 *
 * - Gọi trong transaction đổi xưởng, SAU khi đã cập nhật xưởng của SKU (queueWorkshopIdOfPi đọc trong tx nên thấy xưởng mới;
 *   tổ Sơn tự lấy xưởng sơn nhờ).
 * - Dòng có đích trùng hàng đợi hiện tại (vd Sơn cùng nơi sơn) thì bỏ qua.
 * - Khoá advisory hàng đợi (tổ, xưởng) cũ + mới của mọi dòng phải dời, xếp chuỗi khoá tăng dần để không khoá chéo; sau khoá đọc
 *   lại dòng (dòng vừa thành DONE thì bỏ qua).
 * - Thứ tự khoá: đổi xưởng khoá dòng lệnh (lockPisForIssue) TRƯỚC rồi mới khoá hàng đợi ở đây. Chiều ngược có tồn tại:
 *   enqueue / ensurePhoiQueued giữ khoá hàng đợi rồi INSERT dòng hàng đợi, khoá ngoại của INSERT lấy KEY SHARE trên dòng
 *   `production_invoices` - xung đột với FOR UPDATE của đổi xưởng. Vòng chờ chỉ xảy ra khi >= 3 giao dịch chồng nhau; khi đó
 *   Postgres tự huỷ 1 giao dịch (người dùng thấy lỗi, thử lại được), dữ liệu không hỏng.
 * - KHÔNG tự chạy lệnh kế ở hàng đợi cũ: QLSX xưởng cũ tự bấm "Bắt đầu lệnh đầu hàng đợi" trên màn hàng đợi.
 */
export async function moveOpenQueueEntriesToPiWorkshop(
  tx: PrismaTx,
  productionInvoiceId: bigint,
): Promise<FloorQueueMove[]> {
  const open = { in: [FloorQueueStatus.QUEUED, FloorQueueStatus.RUNNING] };
  const candidates = await tx.floorQueueEntry.findMany({
    where: { productionInvoiceId, status: open },
    orderBy: { id: 'asc' },
    select: { id: true, stage: true, workshopId: true },
  });
  if (candidates.length === 0) return [];

  const targetOf = new Map<string, bigint | null>();
  const keys = new Set<string>();
  for (const c of candidates) {
    const to = await queueWorkshopIdOfPi(tx, c.stage, productionInvoiceId);
    if (to === c.workshopId) continue;
    targetOf.set(c.id.toString(), to);
    keys.add(queueLockKey(c.stage, c.workshopId));
    keys.add(queueLockKey(c.stage, to));
  }
  if (keys.size === 0) return [];

  for (const key of [...keys].sort()) await lockBusinessKey(tx, key);

  // Đọc lại sau khoá: dòng đã thành DONE (hoặc bị xoá) trong lúc chờ khoá thì bỏ qua.
  const fresh = await tx.floorQueueEntry.findMany({
    where: { id: { in: [...targetOf.keys()].map((id) => BigInt(id)) }, status: open },
    orderBy: { id: 'asc' },
    select: { id: true, stage: true, workshopId: true, status: true },
  });

  const moves: FloorQueueMove[] = [];
  for (const e of fresh) {
    const to = targetOf.get(e.id.toString()) ?? null;
    if (to === e.workshopId) continue;
    const last = await tx.floorQueueEntry.aggregate({
      where: { stage: e.stage, workshopId: to },
      _max: { position: true },
    });
    await tx.floorQueueEntry.update({
      where: { id: e.id },
      data: {
        workshopId: to,
        status: FloorQueueStatus.QUEUED,
        position: (last._max.position ?? 0) + 1,
        startedAt: null,
        startedById: null,
      },
    });
    moves.push({
      stage: e.stage,
      fromWorkshopId: e.workshopId,
      toWorkshopId: to,
      wasRunning: e.status === FloorQueueStatus.RUNNING,
    });
  }
  return moves;
}
