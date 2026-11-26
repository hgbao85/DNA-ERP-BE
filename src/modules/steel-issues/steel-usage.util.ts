import {
  CuttingProposalStatus,
  SolverMachine,
  SteelIssueStatus,
} from '../../generated/prisma/client';
import type { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';

/**
 * Cân bằng sắt nhận - đoạn đã báo của 1 (lệnh, loại sắt) - CÙNG công thức SteelIssuesService.attachSteelBalance (tách ra 24/11/2026
 * để cổng báo cắt dùng lại trong transaction, giao nhận giữa tổ 3.3b):
 *   dùng được   = Σ đợt ĐÃ NHẬN (số thực nhận, rơi về barCount với đợt nhận trước 2026-10-12) × max(chiều dài cây − tề đầu, 0)
 *   đoạn đã báo = Σ số đoạn (đã báo − KCS ghi thiếu) × (chiều dài đoạn + mạch cắt)
 * Tề đầu / mạch cắt theo máy của phương án cắt (MC Tự động có cặp riêng; không ghi nhận = MC Laser).
 */
export interface SteelUsageInput {
  /** Đợt sắt ĐÃ NHẬN (status khác ISSUED) của loại sắt. */
  bars: readonly { barCount: number; receivedBarCount: number | null; barLengthMm: number }[];
  /** Đoạn đã báo theo cỡ: chiều dài cắt + số đoạn (đã trừ KCS ghi thiếu). */
  segments: readonly { cutLengthMm: number; doneQty: number }[];
  trimMm: number;
  kerfMm: number;
}

export interface SteelUsage {
  receivedBarCount: number;
  /** Chưa làm tròn. */
  usableMm: number;
  reportedMm: number;
}

export function steelUsage(input: SteelUsageInput): SteelUsage {
  let receivedBarCount = 0;
  let usableMm = 0;
  for (const i of input.bars) {
    const bars = i.receivedBarCount ?? i.barCount;
    receivedBarCount += bars;
    usableMm += bars * Math.max(i.barLengthMm - input.trimMm, 0);
  }
  const reportedMm = input.segments.reduce(
    (t, s) => t + s.doneQty * (s.cutLengthMm + input.kerfMm),
    0,
  );
  return { receivedBarCount, usableMm, reportedMm };
}

/** Giới hạn mm đoạn được báo: (1 + dung sai) × dùng được + phần QLSX mở chặn (mm). */
export function steelReportLimitMm(
  usableMm: number,
  tolerance: number,
  overrideMm: number,
): number {
  return usableMm * (1 + tolerance) + overrideMm;
}

type Db = PrismaTx | PrismaServiceType;

/** Tề đầu / mạch cắt theo máy của loại sắt trong lệnh (đọc systemConfig + phương án cắt đã duyệt). */
export async function trimKerfOf(
  db: Db,
  productionInvoiceId: bigint,
  materialId: bigint,
): Promise<{ trimMm: number; kerfMm: number }> {
  const [config, tuDong] = await Promise.all([
    db.systemConfig.findUnique({
      where: { id: 1 },
      select: {
        solverTrimStartMm: true,
        solverBladeWidthMm: true,
        solverMctdTrimStartMm: true,
        solverMctdBladeWidthMm: true,
      },
    }),
    db.cuttingProposalLine.findFirst({
      where: {
        feasible: true,
        materialId,
        machine: SolverMachine.tu_dong,
        cuttingProposal: {
          status: CuttingProposalStatus.APPROVED,
          OR: [
            { productionInvoiceId },
            { productionOrder: { productionInvoiceItem: { productionInvoiceId } } },
          ],
        },
      },
      select: { id: true },
    }),
  ]);
  const trimMm = (tuDong ? config?.solverMctdTrimStartMm : config?.solverTrimStartMm) ?? 0;
  const kerfMm =
    (tuDong ? config?.solverMctdBladeWidthMm : config?.solverBladeWidthMm)?.toNumber() ?? 0;
  return { trimMm, kerfMm };
}

/** Nạp + tính cân bằng sắt của 1 (lệnh, loại sắt) - đọc bằng `db` (tx khi gọi trong transaction đã khoá). */
export async function loadSteelUsage(
  db: Db,
  productionInvoiceId: bigint,
  materialId: bigint,
): Promise<SteelUsage & { trimMm: number; kerfMm: number }> {
  const [{ trimMm, kerfMm }, issues, cut, short] = await Promise.all([
    trimKerfOf(db, productionInvoiceId, materialId),
    db.steelIssue.findMany({
      where: { productionInvoiceId, materialId, status: { not: SteelIssueStatus.ISSUED } },
      select: { barCount: true, receivedBarCount: true, barLengthMm: true },
    }),
    db.cutPatternSegment.groupBy({
      by: ['segmentSpecId'],
      where: { cutBundle: { steelIssue: { productionInvoiceId, materialId } } },
      _sum: { qty: true },
    }),
    db.qcReviewSegment.groupBy({
      by: ['segmentSpecId'],
      where: { qcReview: { steelIssue: { productionInvoiceId, materialId }, stepBundleId: null } },
      _sum: { shortQty: true },
    }),
  ]);
  const specIds = [...new Set([...cut, ...short].map((r) => r.segmentSpecId))];
  const specs =
    specIds.length > 0
      ? await db.segmentSpec.findMany({
          where: { id: { in: specIds } },
          select: { id: true, cutLengthMm: true },
        })
      : [];
  const shortBySpec = new Map(short.map((r) => [r.segmentSpecId.toString(), r._sum.shortQty ?? 0]));
  const lengthOf = new Map(specs.map((s) => [s.id.toString(), s.cutLengthMm.toNumber()]));
  const usage = steelUsage({
    bars: issues.map((i) => ({
      barCount: i.barCount,
      receivedBarCount: i.receivedBarCount,
      barLengthMm: Number(i.barLengthMm),
    })),
    segments: cut.map((r) => ({
      cutLengthMm: lengthOf.get(r.segmentSpecId.toString()) ?? 0,
      doneQty: (r._sum.qty ?? 0) - (shortBySpec.get(r.segmentSpecId.toString()) ?? 0),
    })),
    trimMm,
    kerfMm,
  });
  return { ...usage, trimMm, kerfMm };
}
