import { FloorReportKind, Prisma } from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';

/**
 * Sổ ghi từng lần báo sản lượng xưởng (`FloorReport`, 2026-10-12) - dùng chung cho Phôi (cắt + công
 * đoạn phụ, SteelIssuesService) và Phôi/Hàn/Sơn báo mảnh (ProductionBatchesService). Xem doc comment
 * model FloorReport (schema.prisma) và changelog-2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md mục 21.
 */
export interface FloorReportLineInput {
  segmentSpecId?: bigint;
  pieceId?: bigint;
  qty: number;
}

export interface FloorReportInput {
  kind: FloorReportKind;
  reportedById: string;
  idempotencyKey?: string | null;
  cutBundleId?: bigint;
  stepBatchId?: bigint;
  productionBatchId?: bigint;
  reversalOfId?: bigint;
  /** Máy/điểm làm việc đã quét QR (2026-10-13) - vắng = báo từ màn thống kê cũ. */
  workstationId?: bigint;
  /** PI của lần báo - ghi thẳng vì đợt có thể bị xoá khi đảo hết (xem FloorReport.productionInvoiceId). */
  productionInvoiceId?: bigint | null;
  /** Lý do - dòng đảo do QLSX đảo 1 lần báo sai. */
  reason?: string;
  lines: FloorReportLineInput[];
}

/** Ngữ cảnh của 1 lần báo đi qua màn quét QR (FloorScanService) - các hàm báo cũ nhận thêm tham số này. */
export interface FloorReportContext {
  workstationId?: bigint;
}

/** Ghi 1 lần báo - gọi TRONG cùng transaction với thay đổi số lượng, để không bao giờ có "đã cộng số
 *  mà không có dòng sổ" (hoặc ngược lại). Trùng idempotencyKey -> Prisma ném P2002, transaction rollback
 *  luôn phần cộng số -> bên gọi bắt bằng isIdempotencyConflict() rồi trả kết quả lần trước. */
export async function writeFloorReport(tx: PrismaTx, input: FloorReportInput) {
  return tx.floorReport.create({
    data: {
      kind: input.kind,
      reportedById: input.reportedById,
      idempotencyKey: input.idempotencyKey ?? null,
      cutBundleId: input.cutBundleId,
      stepBatchId: input.stepBatchId,
      productionBatchId: input.productionBatchId,
      reversalOfId: input.reversalOfId,
      workstationId: input.workstationId,
      productionInvoiceId: input.productionInvoiceId ?? null,
      reason: input.reason,
      lines: {
        create: input.lines.map((l) => ({
          segmentSpecId: l.segmentSpecId,
          pieceId: l.pieceId,
          qty: l.qty,
        })),
      },
    },
  });
}

/** Lần báo đã ghi với khoá này (client gửi lại vì mạng chập chờn / bấm Lưu 2 lần). */
export async function findFloorReportByKey(
  client: Pick<PrismaTx, 'floorReport'>,
  idempotencyKey: string | null | undefined,
) {
  if (!idempotencyKey) return null;
  return client.floorReport.findUnique({ where: { idempotencyKey } });
}

/** P2002 trên floor_reports.idempotencyKey - 2 request cùng khoá chạy song song, request thứ 2 thua.
 *  Prisma 7 + driver adapter (adapter-pg) KHÔNG có `meta.target` - tên cột nằm ở
 *  `meta.driverAdapterError.cause.constraint.fields` (vd `["\"idempotencyKey\""]`, đã thử trên DB thật
 *  2026-10-13). Đọc cả 2 chỗ: chỉ đọc `meta.target` thì hàm này luôn false và request thua nhận 500. */
export function isIdempotencyConflict(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  const meta = e.meta as
    | {
        target?: unknown;
        driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } };
      }
    | undefined;
  const raw = [meta?.target, meta?.driverAdapterError?.cause?.constraint?.fields].flat();
  return raw.some((f) => typeof f === 'string' && f.includes('idempotencyKey'));
}
