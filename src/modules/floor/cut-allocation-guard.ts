import {
  CuttingProposalStatus,
  FloorQueueStatus,
  MfgStage,
  Prisma,
  ProductionInvoiceStatus,
  WorkstationKind,
} from '../../generated/prisma/client';

// Kiểm "dòng chia còn hiệu lực không" cho các thao tác sửa tay (PATCH / tách / sắp lại).

/** Dòng chia máy + những gì cần để biết dòng còn hiệu lực không. */
export const ROW_GUARD_SELECT = (workshopId: bigint) =>
  ({
    cuttingProposal: { select: { status: true } },
    workstation: { select: { isActive: true, kind: true, workshopId: true } },
    pattern: { select: { barCount: true, bundles: true } },
    productionInvoice: {
      select: {
        status: true,
        floorQueueEntries: {
          where: { stage: MfgStage.PHOI, status: FloorQueueStatus.DONE },
          select: { id: true },
          take: 1,
        },
        items: {
          where: { workshopId, productionOrder: { isNot: null } },
          select: { id: true },
          take: 1,
        },
      },
    },
  }) satisfies Prisma.CutAllocationInclude;

export type GuardedRow = Prisma.CutAllocationGetPayload<{
  include: ReturnType<typeof ROW_GUARD_SELECT>;
}>;

export function isGuardedRowStale(row: GuardedRow): boolean {
  const pi = row.productionInvoice;
  return (
    row.cuttingProposal.status !== CuttingProposalStatus.APPROVED ||
    pi.status === ProductionInvoiceStatus.DONE ||
    pi.status === ProductionInvoiceStatus.CANCELLED ||
    pi.floorQueueEntries.length > 0 ||
    pi.items.length === 0 ||
    !row.workstation.isActive ||
    // Máy đã chuyển xưởng / không còn là máy cắt: bảng (loadSnapshot) cũng coi là dòng cũ.
    row.workstation.kind !== WorkstationKind.CUT ||
    row.workstation.workshopId !== row.workshopId
  );
}

export const STALE_MESSAGE =
  'Dòng này đã cũ (phương án cắt đã tính lại hoặc lệnh đã xong Phôi). Bấm Chia lại.';

export const BUNDLE_LOCKED_MESSAGE =
  'Kiểu cắt theo bó không tách sang máy khác. Máy hư thì dùng Đổi máy và chọn lý do Máy hư';
export const BUNDLE_MOVE_REASON_MESSAGE =
  'Dòng cắt theo bó chỉ đổi máy khi máy hư - chọn lý do Máy hư';
