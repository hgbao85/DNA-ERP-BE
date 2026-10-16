import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  CutBundleStatus,
  MfgStage,
  ProductionBatchStatus,
  StepBundleStatus,
} from '../../generated/prisma/client';
import {
  bucketKey,
  enumerateBuckets,
  MAX_SPAN_DAYS,
  spanDays,
  StatsGroupBy,
  vnDayKey,
  vnDayStart,
} from '../../common/utils/floor-stats.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { FloorStatsQueryDto } from './dto/floor-stats.dto';

/**
 * Loại việc trong báo cáo. Đoạn sắt đi qua nhiều công đoạn (Cắt -> Uốn -> ...) nên MỖI công đoạn là một dòng riêng -
 * KHÔNG cộng chung (cùng 1 đoạn sẽ bị đếm đôi) và không trộn đoạn với mảnh: CAT..XE đếm ĐOẠN (theo cỡ), PHOI/HAN/SON đếm
 * MẢNH (PHOI = mảnh vật tư thành phẩm Phôi báo qua lô báo sản lượng).
 */
export const STAT_OPS = [
  'CAT',
  'UON',
  'DAP',
  'DUC_LO',
  'TAN',
  'TOP_DAU',
  'XE',
  'NHAN',
  'PHOI',
  'HAN',
  'SON',
] as const;
export type StatOp = (typeof STAT_OPS)[number];
const opRank = (op: StatOp) => STAT_OPS.indexOf(op);

export interface FloorStatRow {
  /** Khoá kỳ theo giờ VN: 'YYYY-MM-DD' | 'YYYY-MM' | 'YYYY'. */
  bucket: string;
  op: StatOp;
  /** NULL = đợt cũ chưa ghi người làm (trước QR) hoặc đợt công đoạn phụ gom nhiều người. */
  workerId: string | null;
  workerName: string | null;
  /** Cỡ đoạn + loại sắt ("185mm · Sắt phi 4") hoặc tên mảnh ("Mê ngồi"). */
  label: string;
  passed: number;
  failed: number;
}

export interface FloorStatPending {
  op: StatOp;
  /** Người làm (cùng quy ước FloorStatRow) - để màn hình lọc "đang chờ" theo công nhân cùng với số đã duyệt. */
  workerId: string | null;
  workerName: string | null;
  /** Đã báo, QLSX chưa gửi KCS. */
  notSent: number;
  /** Đã gửi, chờ KCS duyệt. */
  awaitingQc: number;
}

/** Quá nhiều dòng thì bắt chọn khoảng hẹp hơn (đủ rộng cho cả xưởng nhiều tháng - xem MAX_SPAN_DAYS). */
const MAX_ROWS = 50_000;

const USER_NAME = { select: { firstName: true, lastName: true, username: true } } as const;
type NamedUser = { firstName: string; lastName: string; username: string } | null;
const fullName = (u: NamedUser) => (u ? `${u.lastName} ${u.firstName}`.trim() || u.username : null);

const SEG_SPEC = { select: { cutLengthMm: true, material: { select: { name: true } } } } as const;
type SegSpec = { cutLengthMm: { toString(): string }; material: { name: string } };
const specLabel = (s: SegSpec) => `${s.cutLengthMm.toString()}mm · ${s.material.name}`;

/**
 * "Báo cáo sản lượng đạt KCS" (2026-10-15, mục 36): số ĐẠT / LỖI mà KCS đã chốt, theo ngày KCS duyệt (`qc_reviews.reviewedAt`,
 * giờ VN). Sau KCS không đảo được nữa (floor-review.service) nên số ổn định, hợp làm số chính thức cho tính công sau này.
 *
 * Nguồn theo từng nhánh (đúng cách KCS ghi, xem qc-reviews.service):
 *  - Cắt:        đã cắt theo cỡ = Σ cut_pattern_segments của đợt; lỗi theo cỡ = qc_review_segments; đạt = đã cắt − lỗi.
 *  - Công đoạn phụ (Uốn/Dập/...): đã làm theo cỡ = Σ step_batch_segments của các đợt trong bundle; lỗi/đạt như trên.
 *  - Hàn/Sơn (và mảnh Phôi): `production_batches.reportedQty` ĐÃ bị ghi đè = phần ĐẠT khi KCS duyệt; lỗi = qc_reviews.failedQty.
 * Người làm: chủ đợt (cut_bundles.openedById / step_bundles.reportedById / production_batches.reportedById).
 *
 * Trả các dòng chi tiết (kỳ × loại việc × công nhân × cỡ/mảnh); màn hình tự cộng + lọc nên đổi bộ lọc không gọi lại máy chủ.
 * `pending` là số ĐANG chờ (đã báo mà KCS chưa duyệt) tính đến bây giờ - không theo kỳ - để đối chiếu với số công nhân báo.
 */
@Injectable()
export class FloorStatsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async getStats(q: FloorStatsQueryDto) {
    const groupBy: StatsGroupBy = q.groupBy ?? 'day';
    const to = q.to ?? vnDayKey(new Date());
    const from = q.from ?? `${to.slice(0, 8)}01`;
    const start = vnDayStart(from);
    const endDay = vnDayStart(to);
    if (!start || !endDay)
      throw new BadRequestException('Ngày không hợp lệ - dùng dạng YYYY-MM-DD');
    if (start.getTime() > endDay.getTime()) {
      throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
    }
    const span = spanDays(from, to);
    if (span > MAX_SPAN_DAYS[groupBy]) {
      throw new BadRequestException(
        groupBy === 'day'
          ? `Xem theo ngày tối đa ${MAX_SPAN_DAYS.day} ngày - chọn khoảng ngắn hơn hoặc xem theo tháng/năm`
          : `Khoảng ngày quá dài cho cách xem theo ${groupBy === 'month' ? 'tháng' : 'năm'}`,
      );
    }
    const reviewedAt = { gte: start, lt: new Date(endDay.getTime() + 24 * 3600 * 1000) };
    const workerId = q.workerId || undefined;
    const wantSteel = !q.stage || q.stage === 'PHOI'; // cắt + công đoạn phụ chỉ của tổ Phôi
    const stages: MfgStage[] = q.stage ? [q.stage] : [MfgStage.PHOI, MfgStage.HAN, MfgStage.SON];

    const [cutReviews, stepReviews, batchReviews, pendingRows] = await Promise.all([
      wantSteel
        ? this.prisma.qcReview.findMany({
            where: {
              cutBundleId: { not: null },
              reviewedAt,
              ...(workerId ? { cutBundle: { openedById: workerId } } : {}),
            },
            select: {
              reviewedAt: true,
              segments: { select: { segmentSpecId: true, failedQty: true } },
              cutBundle: {
                select: {
                  openedById: true,
                  openedBy: USER_NAME,
                  segments: { select: { segmentSpecId: true, qty: true, segmentSpec: SEG_SPEC } },
                },
              },
            },
          })
        : [],
      wantSteel
        ? this.prisma.qcReview.findMany({
            where: {
              stepBundleId: { not: null },
              reviewedAt,
              ...(workerId ? { stepBundle: { reportedById: workerId } } : {}),
            },
            select: {
              reviewedAt: true,
              segments: { select: { segmentSpecId: true, failedQty: true } },
              stepBundle: {
                select: {
                  step: true,
                  reportedById: true,
                  reportedBy: USER_NAME,
                  batches: {
                    select: {
                      segments: {
                        select: { segmentSpecId: true, qty: true, segmentSpec: SEG_SPEC },
                      },
                    },
                  },
                },
              },
            },
          })
        : [],
      this.prisma.qcReview.findMany({
        where: {
          productionBatchId: { not: null },
          reviewedAt,
          productionBatch: {
            stage: { in: stages },
            ...(workerId ? { reportedById: workerId } : {}),
          },
        },
        select: {
          reviewedAt: true,
          failedQty: true,
          productionBatch: {
            select: {
              stage: true,
              reportedQty: true,
              reportedById: true,
              reportedBy: USER_NAME,
              piece: { select: { name: true } },
            },
          },
        },
      }),
      this.loadPending(stages, wantSteel, workerId),
    ]);

    const rows = new Map<string, FloorStatRow>();
    const add = (
      reviewDate: Date,
      op: StatOp,
      worker: { id: string | null; user: NamedUser },
      label: string,
      passed: number,
      failed: number,
    ) => {
      const bucket = bucketKey(reviewDate, groupBy);
      const key = `${bucket}|${op}|${worker.id ?? ''}|${label}`;
      const cur = rows.get(key);
      if (cur) {
        cur.passed += passed;
        cur.failed += failed;
      } else {
        rows.set(key, {
          bucket,
          op,
          workerId: worker.id,
          workerName: fullName(worker.user),
          label,
          passed,
          failed,
        });
      }
    };

    for (const r of cutReviews) {
      const b = r.cutBundle;
      if (!b) continue;
      const failedBySpec = new Map(
        r.segments.map((s) => [s.segmentSpecId.toString(), s.failedQty]),
      );
      for (const seg of b.segments) {
        const failed = failedBySpec.get(seg.segmentSpecId.toString()) ?? 0;
        add(
          r.reviewedAt,
          'CAT',
          { id: b.openedById, user: b.openedBy },
          specLabel(seg.segmentSpec),
          Math.max(0, seg.qty - failed),
          failed,
        );
      }
    }

    for (const r of stepReviews) {
      const b = r.stepBundle;
      if (!b) continue;
      const failedBySpec = new Map(
        r.segments.map((s) => [s.segmentSpecId.toString(), s.failedQty]),
      );
      // Đã làm theo cỡ = cộng mọi đợt báo trong bundle.
      const doneBySpec = new Map<string, { qty: number; spec: SegSpec }>();
      for (const batch of b.batches) {
        for (const s of batch.segments) {
          const k = s.segmentSpecId.toString();
          const cur = doneBySpec.get(k);
          if (cur) cur.qty += s.qty;
          else doneBySpec.set(k, { qty: s.qty, spec: s.segmentSpec });
        }
      }
      for (const [k, d] of doneBySpec) {
        const failed = failedBySpec.get(k) ?? 0;
        add(
          r.reviewedAt,
          b.step,
          { id: b.reportedById, user: b.reportedBy },
          specLabel(d.spec),
          Math.max(0, d.qty - failed),
          failed,
        );
      }
    }

    for (const r of batchReviews) {
      const pb = r.productionBatch;
      if (!pb || !(STAT_OPS as readonly string[]).includes(pb.stage)) continue;
      // reportedQty đã bị KCS ghi đè thành phần ĐẠT (reviewProductionBatch).
      add(
        r.reviewedAt,
        pb.stage as StatOp,
        { id: pb.reportedById, user: pb.reportedBy },
        pb.piece.name,
        pb.reportedQty,
        r.failedQty,
      );
    }

    if (rows.size > MAX_ROWS) {
      throw new BadRequestException(
        'Khoảng chọn có quá nhiều dữ liệu - chọn khoảng ngắn hơn hoặc xem theo tháng/năm',
      );
    }

    return {
      range: { from, to, groupBy, timezone: 'Asia/Ho_Chi_Minh' },
      buckets: enumerateBuckets(from, to, groupBy),
      rows: [...rows.values()].sort(
        (a, b) =>
          a.bucket.localeCompare(b.bucket) ||
          opRank(a.op) - opRank(b.op) ||
          (a.workerName ?? '').localeCompare(b.workerName ?? '', 'vi') ||
          a.label.localeCompare(b.label, 'vi', { numeric: true }),
      ),
      pending: pendingRows,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Số đã báo mà KCS CHƯA duyệt, theo loại việc (tính đến bây giờ, không theo kỳ). */
  private async loadPending(
    stages: MfgStage[],
    wantSteel: boolean,
    workerId: string | undefined,
  ): Promise<FloorStatPending[]> {
    const [cut, step, batches] = await Promise.all([
      wantSteel
        ? this.prisma.cutPatternSegment.findMany({
            where: {
              cutBundle: {
                status: { in: [CutBundleStatus.CUTTING, CutBundleStatus.AWAITING_QC] },
                ...(workerId ? { openedById: workerId } : {}),
              },
            },
            select: {
              qty: true,
              cutBundle: { select: { status: true, openedById: true, openedBy: USER_NAME } },
            },
          })
        : [],
      wantSteel
        ? this.prisma.stepBatchSegment.findMany({
            where: {
              stepBatch: {
                OR: [
                  { stepBundleId: null },
                  { stepBundle: { status: StepBundleStatus.AWAITING_QC } },
                ],
                ...(workerId ? { reportedById: workerId } : {}),
              },
            },
            select: {
              qty: true,
              stepBatch: {
                select: {
                  step: true,
                  stepBundleId: true,
                  reportedById: true,
                  reportedBy: USER_NAME,
                },
              },
            },
          })
        : [],
      this.prisma.productionBatch.findMany({
        where: {
          status: { in: [ProductionBatchStatus.OPEN, ProductionBatchStatus.AWAITING_QC] },
          stage: { in: stages },
          ...(workerId ? { reportedById: workerId } : {}),
        },
        select: {
          stage: true,
          status: true,
          reportedQty: true,
          reportedById: true,
          reportedBy: USER_NAME,
        },
      }),
    ]);

    const acc = new Map<string, FloorStatPending>();
    const bump = (
      op: StatOp,
      worker: { id: string | null; user: NamedUser },
      kind: 'notSent' | 'awaitingQc',
      qty: number,
    ) => {
      const key = `${op}|${worker.id ?? ''}`;
      const cur = acc.get(key) ?? {
        op,
        workerId: worker.id,
        workerName: fullName(worker.user),
        notSent: 0,
        awaitingQc: 0,
      };
      cur[kind] += qty;
      acc.set(key, cur);
    };
    for (const s of cut)
      bump(
        'CAT',
        { id: s.cutBundle.openedById, user: s.cutBundle.openedBy },
        s.cutBundle.status === CutBundleStatus.AWAITING_QC ? 'awaitingQc' : 'notSent',
        s.qty,
      );
    for (const s of step)
      bump(
        s.stepBatch.step,
        { id: s.stepBatch.reportedById, user: s.stepBatch.reportedBy },
        s.stepBatch.stepBundleId ? 'awaitingQc' : 'notSent',
        s.qty,
      );
    for (const b of batches) {
      if ((STAT_OPS as readonly string[]).includes(b.stage)) {
        bump(
          b.stage as StatOp,
          { id: b.reportedById, user: b.reportedBy },
          b.status === ProductionBatchStatus.AWAITING_QC ? 'awaitingQc' : 'notSent',
          b.reportedQty,
        );
      }
    }
    return [...acc.values()].sort(
      (a, b) =>
        opRank(a.op) - opRank(b.op) || (a.workerName ?? '').localeCompare(b.workerName ?? '', 'vi'),
    );
  }

  /**
   * "Sản lượng của tôi" phía công nhân: CÙNG số liệu nhưng ép `workerId` = người đang đăng nhập. Mọi `workerId`/`stage` client
   * gửi lên đều bị bỏ - công nhân A không bao giờ xem được số của công nhân B (người xem toàn xưởng là QLSX/BOSS/ADMIN
   * qua `getStats`).
   */
  getMyStats(userId: string, q: Pick<FloorStatsQueryDto, 'from' | 'to' | 'groupBy'>) {
    return this.getStats({ from: q.from, to: q.to, groupBy: q.groupBy, workerId: userId });
  }
}
