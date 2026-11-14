import { BadRequestException } from '@nestjs/common';
import { CutAllocationChangeReason, CutAllocationLogAction } from '../../generated/prisma/client';
import { vnDayStart } from '../../common/utils/floor-stats.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PrismaTx } from '../../prisma/prisma.service';
import { materialLabel } from './cut-allocation-snapshot';
import type { CutAllocationLogEntry, CutAllocationLogResult } from './cut-allocation-types';
import type { CutAllocationLogQueryDto } from './dto/cut-allocation.dto';

// Nhật ký sửa tay bảng chia máy: tính khoảng ngày, nạp dòng nhật ký, thống kê "lệnh có điều
// chuyển".

const LOG_DEFAULT_DAYS = 30;
const LOG_MAX_ROWS = 500;
const DAY_MS = 24 * 3600 * 1000;

/** Khoảng [from, to) của nhật ký: mặc định 30 ngày gần nhất; `to` là ngày cuối (gồm cả ngày đó). */
export function resolveLogRange(query: CutAllocationLogQueryDto): { from: Date; to: Date } {
  const toStart = query.to ? vnDayStart(query.to) : null;
  if (query.to && !toStart) throw new BadRequestException('Đến ngày không hợp lệ');
  const to = toStart ? new Date(toStart.getTime() + DAY_MS) : new Date(Date.now() + 1);
  let from: Date;
  if (query.from) {
    const f = vnDayStart(query.from);
    if (!f) throw new BadRequestException('Từ ngày không hợp lệ');
    from = f;
  } else {
    from = new Date(to.getTime() - LOG_DEFAULT_DAYS * DAY_MS);
  }
  if (from.getTime() >= to.getTime()) {
    throw new BadRequestException('Từ ngày phải trước đến ngày');
  }
  return { from, to };
}

/** Nhật ký của xưởng trong khoảng, mới nhất trước, tối đa LOG_MAX_ROWS dòng. */
export async function loadLogEntries(
  db: PrismaTx,
  workshopId: bigint,
  range: { from: Date; to: Date },
  productionInvoiceId: string | undefined,
): Promise<CutAllocationLogEntry[]> {
  const rows = await db.cutAllocationLog.findMany({
    where: {
      workshopId,
      createdAt: { gte: range.from, lt: range.to },
      ...(productionInvoiceId ? { productionInvoiceId: parseBigIntId(productionInvoiceId) } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: LOG_MAX_ROWS,
    include: {
      productionInvoice: { select: { code: true } },
      fromWorkstation: { select: { id: true, name: true } },
      toWorkstation: { select: { id: true, name: true } },
      createdBy: { select: { firstName: true, lastName: true, username: true } },
    },
  });

  // Loại sắt của dòng chia: lấy từ kiểu cắt (pattern -> dòng phương án -> vật tư).
  const patternIds = [...new Set(rows.flatMap((r) => (r.patternId != null ? [r.patternId] : [])))];
  const patternRows =
    patternIds.length > 0
      ? await db.cuttingProposalPattern.findMany({
          where: { id: { in: patternIds } },
          select: {
            id: true,
            line: { select: { material: { select: { name: true, spec: true } } } },
          },
        })
      : [];
  const labelByPattern = new Map(
    patternRows.map((p) => [p.id.toString(), materialLabel(p.line.material)]),
  );

  return rows.map((r) => ({
    id: r.id.toString(),
    createdAt: r.createdAt,
    action: r.action,
    reason: r.reason,
    note: r.note,
    isBundle: r.isBundle,
    barCount: r.barCount,
    previousBarCount: r.previousBarCount,
    productionInvoiceId: r.productionInvoiceId.toString(),
    piCode: r.productionInvoice.code,
    materialLabel:
      r.patternId != null ? (labelByPattern.get(r.patternId.toString()) ?? null) : null,
    fromMachine: r.fromWorkstation
      ? { id: r.fromWorkstation.id.toString(), name: r.fromWorkstation.name }
      : null,
    toMachine: r.toWorkstation
      ? { id: r.toWorkstation.id.toString(), name: r.toWorkstation.name }
      : null,
    createdByName: r.createdBy
      ? `${r.createdBy.lastName} ${r.createdBy.firstName}`.trim() || r.createdBy.username
      : null,
  }));
}

/** "Lệnh có điều chuyển": lệnh có đổi máy hoặc tách, số lần giảm dần. */
export function summarizeByOrder(
  entries: CutAllocationLogEntry[],
): CutAllocationLogResult['byOrder'] {
  const byOrderMap = new Map<string, CutAllocationLogResult['byOrder'][number]>();
  for (const e of entries) {
    if (e.action !== CutAllocationLogAction.MOVE && e.action !== CutAllocationLogAction.SPLIT) {
      continue;
    }
    const cur = byOrderMap.get(e.productionInvoiceId) ?? {
      productionInvoiceId: e.productionInvoiceId,
      piCode: e.piCode,
      moves: 0,
      splits: 0,
      machineBrokenMoves: 0,
    };
    if (e.action === CutAllocationLogAction.MOVE) {
      cur.moves += 1;
      if (e.reason === CutAllocationChangeReason.MACHINE_BROKEN) cur.machineBrokenMoves += 1;
    } else {
      cur.splits += 1;
    }
    byOrderMap.set(e.productionInvoiceId, cur);
  }
  return [...byOrderMap.values()].sort(
    (a, b) => b.moves + b.splits - (a.moves + a.splits) || a.piCode.localeCompare(b.piCode),
  );
}
