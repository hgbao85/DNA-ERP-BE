import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CutBundleStatus,
  PieceStepBundleStatus,
  Prisma,
  ProductionBatchStatus,
  ReplenishRequestStatus,
  StepBundleStatus,
  SteelIssueStatus,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import {
  assertOrderPiHasActiveFloor,
  assertPiHasActiveFloor,
} from '../../common/utils/floor-gate.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { CreateQcReviewDto } from './dto/create-qc-review.dto';
import { CreateSteelIssueQcReviewDto } from './dto/create-steel-issue-qc-review.dto';
import { FulfillReplenishRequestDto } from './dto/fulfill-replenish-request.dto';
import { ListQcReviewsQueryDto } from './dto/list-qc-reviews-query.dto';
import { ListReplenishRequestsQueryDto } from './dto/list-replenish-requests-query.dto';
import { QcRecheckDto } from './dto/qc-recheck.dto';
import { QcReviewResponseDto, QcReviewSegmentResponseDto } from './dto/qc-review-response.dto';
import { RecheckProductionBatchDto } from './dto/recheck-production-batch.dto';
import { RejectReplenishRequestDto } from './dto/reject-replenish-request.dto';
import { ReportProductionBatchDoneDto } from './dto/report-production-batch-done.dto';
import { ReportSegmentDoneDto } from './dto/report-segment-done.dto';
import { ReplenishRequestResponseDto } from './dto/replenish-request-response.dto';

const QC_REVIEW_INCLUDE = {
  defectReason: true,
  segments: { include: { segmentSpec: true } },
} satisfies Prisma.QcReviewInclude;
type QcReviewRow = Prisma.QcReviewGetPayload<{ include: typeof QC_REVIEW_INCLUDE }>;

const REPLENISH_REQUEST_INCLUDE = {
  qcReview: { include: { steelIssue: true } },
} satisfies Prisma.ReplenishRequestInclude;
type ReplenishRequestRow = Prisma.ReplenishRequestGetPayload<{
  include: typeof REPLENISH_REQUEST_INCLUDE;
}>;

/**
 * KCS duyệt (Phôi + Hàn/Sơn) + đề xuất cấp lại (M2, thay phần kcsDuyetPhoi/capLaiSat của
 * phoi-sat.service.ts và phần kcsDuyetStage của san-luong.service.ts mock). qc_reviews dùng
 * chung 2 nhánh qua FK XOR (CHECK DB qc_reviews_goods_xor_chk): steelIssueId (review(), Phase 9)
 * và productionBatchId (reviewProductionBatch(), Phase 9d) - 2 endpoint REST riêng
 * (POST steel-issues/:id/qc-review vs POST production-batches/:id/qc-review) chỉ để URL rõ
 * ràng, đúng thiết kế gốc "service dùng chung logic" (docs/dna-erp-backend-implementation-plan.
 * html mục 9.2) - nhưng 2 hành vi SAU KHI duyệt khác nhau thật (xem review() vs
 * reviewProductionBatch()), nên tách 2 method thay vì 1 method rẽ nhánh nội bộ.
 */
@Injectable()
export class QcReviewsService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly steelIssuesService: SteelIssuesService,
    private readonly productionBatchesService: ProductionBatchesService,
  ) {}

  /**
   * Duyệt 1 SteelIssue đang AWAITING_QC — chấm THEO TỪNG CỠ ĐOẠN, CHỈ 2 kết quả: Đạt/Không đạt
   * (2026-08-24, vòng 2 - xem doc comment QcReviewSegment). Luôn đóng đợt thành QC_PASSED ngay.
   * "Không đạt" nghĩa là đoạn hỏng thật - Phôi tự bù bằng sắt kiếm ngoài thực tế (KHÔNG qua
   * recordCutBatch, KHÔNG đụng cây sắt kho đã cấp), báo qua reportSegmentDone() rồi KCS phải
   * recheck() mới tính là đạt (xem 2 method bên dưới).
   *
   * `segments` rỗng = đạt hết. Mỗi cỡ đoạn: failedQty không được vượt số đã cắt CHO CHÍNH ĐỢT
   * NÀY (không phải cộng dồn cả PI - KCS chấm đúng lô mình đang xem).
   */
  async review(
    steelIssueId: string,
    dto: CreateSteelIssueQcReviewDto,
    reviewedById: string,
  ): Promise<QcReviewResponseDto> {
    const issue = await this.steelIssuesService.findOneRowOrThrow(steelIssueId);
    if (issue.status !== SteelIssueStatus.AWAITING_QC) {
      throw new ConflictException(
        `Steel issue ${steelIssueId} đang ở trạng thái ${issue.status} - chỉ AWAITING_QC mới duyệt KCS được`,
      );
    }
    await assertPiHasActiveFloor(this.prisma, issue.productionInvoiceId, 'duyệt KCS');

    const specIds = dto.segments.map((s) => parseBigIntId(s.segmentSpecId));
    const [specs, cutInThisIssue] = await Promise.all([
      this.prisma.segmentSpec.findMany({ where: { id: { in: specIds } } }),
      this.prisma.cutPatternSegment.groupBy({
        by: ['segmentSpecId'],
        where: { cutBundle: { steelIssueId: issue.id } },
        _sum: { qty: true },
      }),
    ]);
    const specById = new Map(specs.map((sp) => [sp.id.toString(), sp]));
    const doneBySpec = new Map(
      cutInThisIssue.map((r) => [r.segmentSpecId.toString(), r._sum.qty ?? 0]),
    );

    let totalFailed = 0;
    for (const seg of dto.segments) {
      const spec = specById.get(parseBigIntId(seg.segmentSpecId).toString());
      if (!spec) {
        throw new NotFoundException(`Cỡ đoạn ${seg.segmentSpecId} không tồn tại`);
      }
      if (spec.materialId !== issue.materialId) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm không thuộc loại sắt của đợt xuất này`,
        );
      }
      const doneQty = doneBySpec.get(spec.id.toString()) ?? 0;
      if (seg.failedQty > doneQty) {
        throw new BadRequestException(
          `Chấm lỗi ${seg.failedQty} đoạn ${spec.cutLengthMm.toString()}mm vượt số đã cắt ` +
            `(${doneQty}) trong chính đợt này`,
        );
      }
      totalFailed += seg.failedQty;
    }

    const defectReasonId = dto.defectReasonId ? parseBigIntId(dto.defectReasonId) : undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      const review = await tx.qcReview.create({
        data: {
          steelIssueId: issue.id,
          failedQty: totalFailed,
          scrapQty: 0,
          defectReasonId,
          reason: dto.reason,
          photoUrl: dto.photoUrl,
          reviewedById,
          segments: {
            create: dto.segments.map((seg) => ({
              segmentSpecId: parseBigIntId(seg.segmentSpecId),
              failedQty: seg.failedQty,
            })),
          },
        },
        include: QC_REVIEW_INCLUDE,
      });

      await tx.steelIssue.update({
        where: { id: issue.id },
        data: { status: SteelIssueStatus.QC_PASSED },
      });

      return review;
    });

    return this.toResponseDto(created);
  }

  /**
   * Duyệt 1 ĐỢT CẮT đang AWAITING_QC (2026-09-05) - thay review() ở luồng mới.
   *
   * Khác review() đúng 2 điểm, phần chấm lỗi giữ nguyên hoàn toàn:
   *  1. Đơn vị là đợt cắt (CutBundle), không phải cả lô nhận - "vượt số đã cắt" đối chiếu theo
   *     ĐÚNG đợt đang chấm, không cộng dồn mọi đợt của lô.
   *  2. Chỉ đóng đợt cắt (CutBundle.status = QC_PASSED). SteelIssue.status GIỮ NGUYÊN RECEIVED -
   *     lô nhận từ 2026-09-05 chỉ còn 2 nấc (việc của kho), Phôi vẫn nhập đợt cắt mới cho lô đó
   *     bình thường ngay cả khi đợt trước đang/đã qua KCS.
   *
   * Dòng QcReview ghi CẢ steelIssueId lẫn cutBundleId: giữ nguyên CHECK qc_reviews_goods_xor_chk
   * và mọi truy vấn cũ theo lô (cấp bù, thống kê) vẫn chạy đúng.
   */
  async reviewCutBundle(
    cutBundleId: string,
    dto: CreateSteelIssueQcReviewDto,
    reviewedById: string,
  ): Promise<QcReviewResponseDto> {
    const bundleBigId = parseBigIntId(cutBundleId);
    const bundle = await this.prisma.cutBundle.findUnique({
      where: { id: bundleBigId },
      include: { steelIssue: true },
    });
    if (!bundle) {
      throw new NotFoundException(`Đợt cắt ${cutBundleId} not found`);
    }
    if (bundle.status !== CutBundleStatus.AWAITING_QC) {
      throw new ConflictException(
        `Đợt cắt ${cutBundleId} đang ở trạng thái ${bundle.status} - chỉ đợt chờ KCS mới duyệt được`,
      );
    }
    await assertPiHasActiveFloor(this.prisma, bundle.steelIssue.productionInvoiceId, 'duyệt KCS');

    const specIds = dto.segments.map((s) => parseBigIntId(s.segmentSpecId));
    const [specs, cutInThisBundle] = await Promise.all([
      this.prisma.segmentSpec.findMany({ where: { id: { in: specIds } } }),
      this.prisma.cutPatternSegment.groupBy({
        by: ['segmentSpecId'],
        where: { cutBundleId: bundle.id },
        _sum: { qty: true },
      }),
    ]);
    const specById = new Map(specs.map((sp) => [sp.id.toString(), sp]));
    const doneBySpec = new Map(
      cutInThisBundle.map((r) => [r.segmentSpecId.toString(), r._sum.qty ?? 0]),
    );

    let totalFailed = 0;
    for (const seg of dto.segments) {
      const spec = specById.get(parseBigIntId(seg.segmentSpecId).toString());
      if (!spec) {
        throw new NotFoundException(`Cỡ đoạn ${seg.segmentSpecId} không tồn tại`);
      }
      if (spec.materialId !== bundle.steelIssue.materialId) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm không thuộc loại sắt của đợt cắt này`,
        );
      }
      const doneQty = doneBySpec.get(spec.id.toString()) ?? 0;
      if (seg.failedQty > doneQty) {
        throw new BadRequestException(
          `Chấm lỗi ${seg.failedQty} đoạn ${spec.cutLengthMm.toString()}mm vượt số đã cắt ` +
            `(${doneQty}) trong chính đợt cắt này`,
        );
      }
      totalFailed += seg.failedQty;
    }

    const defectReasonId = dto.defectReasonId ? parseBigIntId(dto.defectReasonId) : undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      const review = await tx.qcReview.create({
        data: {
          steelIssueId: bundle.steelIssueId,
          cutBundleId: bundle.id,
          failedQty: totalFailed,
          scrapQty: 0,
          defectReasonId,
          reason: dto.reason,
          photoUrl: dto.photoUrl,
          reviewedById,
          segments: {
            create: dto.segments.map((seg) => ({
              segmentSpecId: parseBigIntId(seg.segmentSpecId),
              failedQty: seg.failedQty,
            })),
          },
        },
        include: QC_REVIEW_INCLUDE,
      });

      await tx.cutBundle.update({
        where: { id: bundle.id },
        data: { status: CutBundleStatus.QC_PASSED },
      });

      return review;
    });

    // Ngoài transaction chính (chỉ ROLL-UP hiển thị cho các màn xem tổng quan không đổi, xem
    // SteelIssuesService.syncIssueStatusFromBundles) - không bắt buộc phải cùng transaction với
    // việc tạo review, lệch 1 nhịp ở đây không ảnh hưởng tính đúng đắn của review vừa tạo.
    await this.steelIssuesService.syncIssueStatusFromBundles(bundle.steelIssueId);

    return this.toResponseDto(created);
  }

  /**
   * KCS duyệt 1 "đợt gửi KCS theo công đoạn PHỤ" (StepBundle - Uốn/Dập/Tán/..., 2026-09-07) - CÙNG
   * khuôn reviewCutBundle() ở trên (chấm theo cỡ đoạn qua QcReviewSegment, CHỈ Đạt/Không đạt) chỉ
   * khác nguồn "đã làm được bao nhiêu" đọc từ StepBatchSegment (Σ đã báo cho ĐÚNG stepBundle này)
   * thay vì CutPatternSegment. Dòng QcReview ghi CẢ steelIssueId (denormalized, mirror cutBundleId
   * - CÙNG cách "cột lọc phụ nằm ngoài XOR nhưng vẫn ghi leg chính", xem doc comment schema) lẫn
   * stepBundleId - để tái dùng NGUYÊN VẸN reportSegmentDoneForRow()/recheckForReview() vốn đọc
   * review.steelIssueId làm leg chính, không cần sửa gì thêm ở 2 hàm đó. KHÔNG đụng CutBundle.status
   * - vòng đời StepBundle hoàn toàn độc lập với vòng đời Cắt (xem StepBundle doc comment schema).
   */
  async reviewStepBundle(
    stepBundleId: string,
    dto: CreateSteelIssueQcReviewDto,
    reviewedById: string,
  ): Promise<QcReviewResponseDto> {
    const bundleBigId = parseBigIntId(stepBundleId);
    const bundle = await this.prisma.stepBundle.findUnique({
      where: { id: bundleBigId },
      include: { cutBundle: { include: { steelIssue: true } } },
    });
    if (!bundle) {
      throw new NotFoundException(`Đợt gửi KCS ${stepBundleId} not found`);
    }
    if (bundle.status !== StepBundleStatus.AWAITING_QC) {
      throw new ConflictException(
        `Đợt gửi KCS ${stepBundleId} đang ở trạng thái ${bundle.status} - chỉ đợt chờ KCS mới duyệt được`,
      );
    }
    await assertPiHasActiveFloor(
      this.prisma,
      bundle.cutBundle.steelIssue.productionInvoiceId,
      'duyệt KCS',
    );

    const specIds = dto.segments.map((s) => parseBigIntId(s.segmentSpecId));
    const [specs, doneInThisBundle] = await Promise.all([
      this.prisma.segmentSpec.findMany({ where: { id: { in: specIds } } }),
      this.prisma.stepBatchSegment.groupBy({
        by: ['segmentSpecId'],
        where: { segmentSpecId: { in: specIds }, stepBatch: { stepBundleId: bundle.id } },
        _sum: { qty: true },
      }),
    ]);
    const specById = new Map(specs.map((sp) => [sp.id.toString(), sp]));
    const doneBySpec = new Map(
      doneInThisBundle.map((r) => [r.segmentSpecId.toString(), r._sum.qty ?? 0]),
    );

    let totalFailed = 0;
    for (const seg of dto.segments) {
      const spec = specById.get(parseBigIntId(seg.segmentSpecId).toString());
      if (!spec) {
        throw new NotFoundException(`Cỡ đoạn ${seg.segmentSpecId} không tồn tại`);
      }
      if (spec.materialId !== bundle.cutBundle.steelIssue.materialId) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm không thuộc loại sắt của đợt cắt này`,
        );
      }
      const doneQty = doneBySpec.get(spec.id.toString()) ?? 0;
      if (seg.failedQty > doneQty) {
        throw new BadRequestException(
          `Chấm lỗi ${seg.failedQty} đoạn ${spec.cutLengthMm.toString()}mm vượt số đã báo ` +
            `(${doneQty}) trong chính đợt gửi KCS này`,
        );
      }
      totalFailed += seg.failedQty;
    }

    const defectReasonId = dto.defectReasonId ? parseBigIntId(dto.defectReasonId) : undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      const review = await tx.qcReview.create({
        data: {
          steelIssueId: bundle.cutBundle.steelIssueId,
          stepBundleId: bundle.id,
          failedQty: totalFailed,
          scrapQty: 0,
          defectReasonId,
          reason: dto.reason,
          photoUrl: dto.photoUrl,
          reviewedById,
          segments: {
            create: dto.segments.map((seg) => ({
              segmentSpecId: parseBigIntId(seg.segmentSpecId),
              failedQty: seg.failedQty,
            })),
          },
        },
        include: QC_REVIEW_INCLUDE,
      });

      await tx.stepBundle.update({
        where: { id: bundle.id },
        data: { status: StepBundleStatus.QC_PASSED },
      });

      return review;
    });

    return this.toResponseDto(created);
  }

  /**
   * Phôi tự báo đã bù đủ cho 1 cỡ đoạn không đạt (đã tự kiếm sắt bù ngoài thực tế) - CHỜ KCS
   * recheck() mới tính là đạt (KHÔNG tự cộng resolvedQty ở đây, sản lượng chỉ tính sau khi qua
   * kiểm). Chặn nếu cỡ đó đã hết lỗi hoặc đang chờ duyệt lại rồi (chỉ 1 lượt báo tại 1 thời điểm).
   *
   * `dto.qty` (2026-09-07) - số đoạn Phôi TỰ KHAI đã sửa xong, PHẢI nằm trong (0, outstanding] -
   * lưu THUẦN THAM KHẢO (`phoiReportedQty`) cho KCS xem trước khi tự đếm lại, KHÔNG tự cộng vào
   * resolvedQty (đúng nguyên tắc KCS là bước kiểm soát duy nhất, xem doc comment schema).
   */
  async reportSegmentDone(
    steelIssueId: string,
    segmentSpecId: string,
    dto: ReportSegmentDoneDto,
  ): Promise<QcReviewResponseDto> {
    const segRow = await this.findLatestReviewSegmentOrThrow(segmentSpecId, { steelIssueId });
    return this.reportSegmentDoneForRow(segRow, `đợt sắt ${steelIssueId}`, dto.qty);
  }

  /**
   * Cùng reportSegmentDone() nhưng scope theo ĐÚNG đợt cắt (2026-09-05) - dùng cho luồng mới, nơi
   * 1 lô nhận (SteelIssue) có thể có NHIỀU đợt cắt cùng bị lỗi cùng 1 cỡ đoạn: tra theo
   * steelIssueId (findLatestReviewSegmentOrThrow bản cũ) sẽ lấy nhầm review MỚI NHẤT của CẢ LÔ,
   * có thể là của đợt cắt khác. Bắt buộc lọc thêm cutBundleId để đúng đợt Phôi đang xem.
   */
  async reportSegmentDoneForBundle(
    cutBundleId: string,
    segmentSpecId: string,
    dto: ReportSegmentDoneDto,
  ): Promise<QcReviewResponseDto> {
    const segRow = await this.findLatestReviewSegmentOrThrow(segmentSpecId, { cutBundleId });
    return this.reportSegmentDoneForRow(segRow, `đợt cắt ${cutBundleId}`, dto.qty);
  }

  /** Cùng reportSegmentDone() nhưng scope theo ĐÚNG StepBundle (2026-09-07, công đoạn phụ) - cùng
   *  lý do reportSegmentDoneForBundle() tồn tại. */
  async reportSegmentDoneForStepBundle(
    stepBundleId: string,
    segmentSpecId: string,
    dto: ReportSegmentDoneDto,
  ): Promise<QcReviewResponseDto> {
    const segRow = await this.findLatestReviewSegmentOrThrow(segmentSpecId, { stepBundleId });
    return this.reportSegmentDoneForRow(segRow, `đợt gửi KCS ${stepBundleId}`, dto.qty);
  }

  private async reportSegmentDoneForRow(
    segRow: QcReviewRow['segments'][number] & { qcReviewId: bigint },
    label: string,
    qty: number,
  ): Promise<QcReviewResponseDto> {
    const outstanding = segRow.failedQty - segRow.resolvedQty;
    if (outstanding <= 0) {
      throw new ConflictException(`Cỡ đoạn của ${label} đã hết lỗi, không cần báo bù nữa`);
    }
    if (segRow.phoiReportedAt) {
      throw new ConflictException(`Cỡ đoạn của ${label} đã báo bù đủ rồi, đang chờ KCS duyệt lại`);
    }
    if (qty > outstanding) {
      throw new BadRequestException(
        `Cỡ đoạn của ${label} chỉ còn lỗi ${outstanding} đoạn - không thể báo bù ${qty} đoạn`,
      );
    }
    const review = await this.findReviewOrThrow(segRow.qcReviewId);
    if (!review.steelIssueId) {
      throw new BadRequestException(`${label} không thuộc nhánh Phôi`);
    }
    const issue = await this.steelIssuesService.findOneRowOrThrow(review.steelIssueId.toString());
    await assertPiHasActiveFloor(this.prisma, issue.productionInvoiceId, 'báo bù đủ hàng lỗi');

    await this.prisma.qcReviewSegment.update({
      where: { id: segRow.id },
      data: { phoiReportedAt: new Date(), phoiReportedQty: qty },
    });

    return this.toResponseDto(await this.findReviewOrThrow(segRow.qcReviewId));
  }

  /**
   * KCS duyệt lại các cỡ đoạn Phôi đã báo "Bù đủ" - chỉ cho những cỡ đang phoiReportedAt != null.
   * `remainingFailedQty = 0` → hết lỗi (resolvedQty = failedQty). `> 0` → còn hỏng, resolvedQty
   * cộng đúng phần vừa đạt, phoiReportedAt reset về null để Phôi báo lại lượt mới cho phần còn
   * lại. failedQty KHÔNG đổi (bất biến) - xem doc comment QcReviewSegment.
   */
  async recheck(steelIssueId: string, dto: QcRecheckDto): Promise<QcReviewResponseDto> {
    const review = await this.prisma.qcReview.findFirst({
      where: { steelIssueId: parseBigIntId(steelIssueId) },
      orderBy: { reviewedAt: 'desc' },
      include: QC_REVIEW_INCLUDE,
    });
    if (!review) {
      throw new NotFoundException(`Đợt sắt ${steelIssueId} chưa có KCS chấm nào`);
    }
    return this.recheckForReview(review, dto, `đợt sắt ${steelIssueId}`);
  }

  /** Cùng recheck() nhưng scope theo ĐÚNG đợt cắt (2026-09-05) - xem lý do ở
   *  reportSegmentDoneForBundle(). */
  async recheckForBundle(cutBundleId: string, dto: QcRecheckDto): Promise<QcReviewResponseDto> {
    const review = await this.prisma.qcReview.findFirst({
      where: { cutBundleId: parseBigIntId(cutBundleId) },
      orderBy: { reviewedAt: 'desc' },
      include: QC_REVIEW_INCLUDE,
    });
    if (!review) {
      throw new NotFoundException(`Đợt cắt ${cutBundleId} chưa có KCS chấm nào`);
    }
    return this.recheckForReview(review, dto, `đợt cắt ${cutBundleId}`);
  }

  /** Cùng recheck() nhưng scope theo ĐÚNG StepBundle (2026-09-07, công đoạn phụ) - cùng lý do
   *  recheckForBundle() tồn tại. */
  async recheckForStepBundle(
    stepBundleId: string,
    dto: QcRecheckDto,
  ): Promise<QcReviewResponseDto> {
    const review = await this.prisma.qcReview.findFirst({
      where: { stepBundleId: parseBigIntId(stepBundleId) },
      orderBy: { reviewedAt: 'desc' },
      include: QC_REVIEW_INCLUDE,
    });
    if (!review) {
      throw new NotFoundException(`Đợt gửi KCS ${stepBundleId} chưa có KCS chấm nào`);
    }
    return this.recheckForReview(review, dto, `đợt gửi KCS ${stepBundleId}`);
  }

  private async recheckForReview(
    review: QcReviewRow,
    dto: QcRecheckDto,
    label: string,
  ): Promise<QcReviewResponseDto> {
    if (!review.steelIssueId) {
      throw new BadRequestException(`${label} không thuộc nhánh Phôi`);
    }
    const issue = await this.steelIssuesService.findOneRowOrThrow(review.steelIssueId.toString());
    await assertPiHasActiveFloor(this.prisma, issue.productionInvoiceId, 'duyệt lại hàng lỗi');

    const updates: {
      id: bigint;
      resolvedQty: number;
      phoiReportedAt: Date | null;
      phoiReportedQty: number | null;
    }[] = [];
    for (const seg of dto.segments) {
      const specBigId = parseBigIntId(seg.segmentSpecId);
      const segRow = review.segments.find((s) => s.segmentSpecId === specBigId);
      if (!segRow) {
        throw new NotFoundException(`${label} không có lỗi nào ở cỡ đoạn ${seg.segmentSpecId}`);
      }
      if (!segRow.phoiReportedAt) {
        throw new ConflictException(
          `Cỡ đoạn ${seg.segmentSpecId} chưa được Phôi báo "Bù đủ" - chưa tới lượt duyệt lại`,
        );
      }
      const outstanding = segRow.failedQty - segRow.resolvedQty;
      if (seg.remainingFailedQty > outstanding) {
        throw new BadRequestException(
          `Còn hỏng ${seg.remainingFailedQty} vượt số đang lỗi (${outstanding}) của cỡ đoạn ${seg.segmentSpecId}`,
        );
      }
      // Còn hỏng (remainingFailedQty > 0) → mở lại lượt báo mới: reset CẢ phoiReportedAt lẫn
      // phoiReportedQty (lời khai cũ không còn ý nghĩa cho phần còn lại). Đạt hết → giữ nguyên cả
      // 2 làm lịch sử (khớp hành vi cũ của phoiReportedAt).
      updates.push({
        id: segRow.id,
        resolvedQty: segRow.resolvedQty + (outstanding - seg.remainingFailedQty),
        phoiReportedAt: seg.remainingFailedQty > 0 ? null : segRow.phoiReportedAt,
        phoiReportedQty: seg.remainingFailedQty > 0 ? null : segRow.phoiReportedQty,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const u of updates) {
        await tx.qcReviewSegment.update({
          where: { id: u.id },
          data: {
            resolvedQty: u.resolvedQty,
            phoiReportedAt: u.phoiReportedAt,
            phoiReportedQty: u.phoiReportedQty,
          },
        });
      }
    });

    return this.toResponseDto(await this.findReviewOrThrow(review.id));
  }

  /**
   * Duyệt 1 ProductionBatch đang AWAITING_QC. Khác review() (Phôi): KHÔNG tự sinh lô rework mới
   * (đúng hành vi mock kcsDuyetStage() + db-schema doc "Mock hiện KHÔNG tạo lô rework mới cho
   * Hàn/Sơn") - phần sửa được (rework) không tính done, chỉ ghi đè reportedQty = phần ĐẠT (passed)
   * trên đúng batch gốc, công nhân tự báo lại phần rework ở 1 lô mới sau (qua
   * ProductionBatchesService.create() bình thường, không phải rework_of).
   */
  async reviewProductionBatch(
    productionBatchId: string,
    dto: CreateQcReviewDto,
    reviewedById: string,
  ): Promise<QcReviewResponseDto> {
    const batch = await this.productionBatchesService.findOneRowOrThrow(productionBatchId);
    if (batch.status !== ProductionBatchStatus.AWAITING_QC) {
      throw new ConflictException(
        `Production batch ${productionBatchId} đang ở trạng thái ${batch.status} - chỉ AWAITING_QC mới duyệt KCS được`,
      );
    }
    await assertOrderPiHasActiveFloor(this.prisma, batch.productionOrderId, 'duyệt KCS');

    if (dto.failedQty > batch.reportedQty) {
      throw new BadRequestException(
        `failedQty (${dto.failedQty}) không được vượt số lượng đã báo (${batch.reportedQty})`,
      );
    }
    const scrapQty = dto.scrapQty ?? 0;
    if (scrapQty > dto.failedQty) {
      throw new BadRequestException(
        `scrapQty (${scrapQty}) không được vượt failedQty (${dto.failedQty})`,
      );
    }
    const passedQty = batch.reportedQty - dto.failedQty;
    const defectReasonId = dto.defectReasonId ? parseBigIntId(dto.defectReasonId) : undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      const review = await tx.qcReview.create({
        data: {
          productionBatchId: batch.id,
          failedQty: dto.failedQty,
          scrapQty: dto.scrapQty,
          defectReasonId,
          reason: dto.reason,
          photoUrl: dto.photoUrl,
          reviewedById,
        },
        include: QC_REVIEW_INCLUDE,
      });

      await tx.productionBatch.update({
        where: { id: batch.id },
        data: { status: ProductionBatchStatus.QC_DONE, reportedQty: passedQty },
      });

      if (scrapQty > 0) {
        await tx.replenishRequest.create({
          data: { qcReviewId: review.id, qty: scrapQty },
        });
      }

      return review;
    });

    return this.toResponseDto(created);
  }

  /**
   * KCS duyệt 1 "đợt gửi KCS theo công đoạn" (PieceStepBundle, 2026-09-07) - mirror ĐÚNG cách Phôi/
   * Sắt chấm (reviewCutBundle()): CHỈ 2 kết quả Đạt/Không đạt, KHÔNG tách "sửa được"/"phế" như
   * reviewProductionBatch() (Hàn/Sơn) - quyết định nghiệp vụ 2026-09-07, Sếp Trương Văn Nhân qua
   * chat nội bộ: "sửa được thì không tính là lỗi" (nghĩa là KHÔNG có khái niệm phế riêng ở nhánh
   * này - toàn bộ failedQty coi như "không đạt", Phôi tự sửa rồi báo Bù đủ, KHÔNG qua
   * ReplenishRequest/kho cấp mới). FE (kcsCore.tsx) tắt showFailMode riêng cho dòng công đoạn nên
   * KHÔNG gửi scrapQty - dto.scrapQty CỐ Ý bị bỏ qua ở đây (không tạo ReplenishRequest), dù
   * CreateQcReviewDto vẫn dùng chung shape với reviewProductionBatch() cho gọn, không tách DTO
   * riêng. KHÔNG đụng ProductionBatch.reportedQty - bundle này không sinh sản lượng, thuần là cổng
   * kiểm tra chất lượng theo công đoạn (xem PieceStepBundle doc comment BE). bundle.status luôn →
   * QC_PASSED sau khi duyệt (kể cả có lỗi) - "PASSED" nghĩa là "đã qua tay KCS", không phải "0
   * lỗi", cùng ngữ nghĩa CutBundleStatus.QC_PASSED.
   */
  async reviewPieceStep(
    pieceStepBundleId: string,
    dto: CreateQcReviewDto,
    reviewedById: string,
  ): Promise<QcReviewResponseDto> {
    const bundle =
      await this.productionBatchesService.findOnePieceStepBundleRowOrThrow(pieceStepBundleId);
    if (bundle.status !== PieceStepBundleStatus.AWAITING_QC) {
      throw new ConflictException(
        `Đợt gửi KCS ${pieceStepBundleId} đang ở trạng thái ${bundle.status} - chỉ AWAITING_QC mới duyệt được`,
      );
    }
    await assertOrderPiHasActiveFloor(this.prisma, bundle.productionOrderId, 'duyệt KCS công đoạn');

    if (dto.failedQty > bundle.qty) {
      throw new BadRequestException(
        `failedQty (${dto.failedQty}) không được vượt số lượng đã gửi (${bundle.qty})`,
      );
    }
    const defectReasonId = dto.defectReasonId ? parseBigIntId(dto.defectReasonId) : undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      const review = await tx.qcReview.create({
        data: {
          pieceStepBundleId: bundle.id,
          failedQty: dto.failedQty,
          defectReasonId,
          reason: dto.reason,
          photoUrl: dto.photoUrl,
          reviewedById,
        },
        include: QC_REVIEW_INCLUDE,
      });

      await tx.pieceStepBundle.update({
        where: { id: bundle.id },
        data: { status: PieceStepBundleStatus.QC_PASSED },
      });

      return review;
    });

    return this.toResponseDto(created);
  }

  /**
   * "Bù đủ" cho đợt công đoạn (PieceStepBundle, 2026-09-07) - CÙNG khuôn reportProductionBatchDone()
   * bên dưới, chỉ khác anchor. `review.scrapQty` LUÔN null cho nhánh này (reviewPieceStep() không
   * còn ghi - xem doc comment ở đó) nên `reworkable` = `failedQty` nguyên vẹn, không có phần phế
   * cần loại trừ.
   */
  async reportPieceStepDone(
    pieceStepBundleId: string,
    dto: ReportProductionBatchDoneDto,
  ): Promise<QcReviewResponseDto> {
    const bundle =
      await this.productionBatchesService.findOnePieceStepBundleRowOrThrow(pieceStepBundleId);
    await assertOrderPiHasActiveFloor(this.prisma, bundle.productionOrderId, 'báo bù đủ hàng lỗi');

    const review = await this.prisma.qcReview.findFirst({
      where: { pieceStepBundleId: bundle.id },
      orderBy: { reviewedAt: 'desc' },
      include: QC_REVIEW_INCLUDE,
    });
    if (!review) {
      throw new NotFoundException(`Đợt ${pieceStepBundleId} chưa có KCS chấm nào`);
    }
    const reworkable = review.failedQty - (review.scrapQty ?? 0);
    const outstanding = reworkable - review.resolvedQty;
    if (outstanding <= 0) {
      throw new ConflictException(`Đợt ${pieceStepBundleId} đã hết lỗi, không cần báo bù nữa`);
    }
    if (review.phoiReportedAt) {
      throw new ConflictException(
        `Đợt ${pieceStepBundleId} đã báo bù đủ rồi, đang chờ KCS duyệt lại`,
      );
    }
    if (dto.qty > outstanding) {
      throw new BadRequestException(
        `Đợt ${pieceStepBundleId} chỉ còn lỗi ${outstanding} - không thể báo bù ${dto.qty}`,
      );
    }

    await this.prisma.qcReview.update({
      where: { id: review.id },
      data: { phoiReportedAt: new Date(), phoiReportedQty: dto.qty },
    });
    return this.toResponseDto(await this.findReviewOrThrow(review.id));
  }

  /**
   * KCS duyệt lại đợt công đoạn đã báo "Bù đủ" (PieceStepBundle, 2026-09-07) - CÙNG khuôn
   * recheckProductionBatch() bên dưới nhưng ĐƠN GIẢN HƠN: KHÔNG cộng vào đâu cả sau khi xác nhận
   * đạt (khác productionBatchId phải cộng ProductionBatch.reportedQty vì đó là nguồn sản lượng
   * thật) - PieceStepBundle không sinh sản lượng, resolvedQty tăng CHỈ để hiển thị/tracking, đúng
   * bản chất "cổng kiểm tra chất lượng" thuần tuý của bundle này.
   */
  async recheckPieceStep(
    pieceStepBundleId: string,
    dto: RecheckProductionBatchDto,
  ): Promise<QcReviewResponseDto> {
    const bundle =
      await this.productionBatchesService.findOnePieceStepBundleRowOrThrow(pieceStepBundleId);
    await assertOrderPiHasActiveFloor(this.prisma, bundle.productionOrderId, 'duyệt lại hàng lỗi');

    const review = await this.prisma.qcReview.findFirst({
      where: { pieceStepBundleId: bundle.id },
      orderBy: { reviewedAt: 'desc' },
      include: QC_REVIEW_INCLUDE,
    });
    if (!review) {
      throw new NotFoundException(`Đợt ${pieceStepBundleId} chưa có KCS chấm nào`);
    }
    if (!review.phoiReportedAt) {
      throw new ConflictException(
        `Đợt ${pieceStepBundleId} chưa được báo "Bù đủ" - chưa tới lượt duyệt lại`,
      );
    }
    const reworkable = review.failedQty - (review.scrapQty ?? 0);
    const outstanding = reworkable - review.resolvedQty;
    if (dto.remainingFailedQty > outstanding) {
      throw new BadRequestException(
        `Còn hỏng ${dto.remainingFailedQty} vượt số đang lỗi (${outstanding}) của đợt ${pieceStepBundleId}`,
      );
    }
    const justResolved = outstanding - dto.remainingFailedQty;

    await this.prisma.qcReview.update({
      where: { id: review.id },
      data: {
        resolvedQty: review.resolvedQty + justResolved,
        phoiReportedAt: dto.remainingFailedQty > 0 ? null : review.phoiReportedAt,
        phoiReportedQty: dto.remainingFailedQty > 0 ? null : review.phoiReportedQty,
      },
    });

    return this.toResponseDto(await this.findReviewOrThrow(review.id));
  }

  /**
   * "Bù đủ" cho lô Hàn/Sơn/VTTP (2026-09-07) - THAY THẾ cách làm cũ "công nhân tự tạo 1 lô báo cáo
   * hoàn toàn mới cho phần rework" (xem doc comment reviewProductionBatch() - vẫn đúng cho lô nào
   * KHÔNG bấm Bù đủ, 2 cách cùng tồn tại). Chỉ áp dụng cho phần SỬA ĐƯỢC
   * (`failedQty - (scrapQty ?? 0)`) - phần đã cấp `scrapQty` xử lý qua ReplenishRequest riêng
   * (hàng hỏng hẳn, xin nguyên liệu MỚI, không phải "sửa lại"). Chặn nếu cỡ đã hết lỗi hoặc đang
   * chờ duyệt lại rồi - cùng logic reportSegmentDoneForRow() bên Sắt nhưng ở CẤP REVIEW (không có
   * "cỡ đoạn" để bóc).
   */
  async reportProductionBatchDone(
    productionBatchId: string,
    dto: ReportProductionBatchDoneDto,
  ): Promise<QcReviewResponseDto> {
    const batch = await this.productionBatchesService.findOneRowOrThrow(productionBatchId);
    await assertOrderPiHasActiveFloor(this.prisma, batch.productionOrderId, 'báo bù đủ hàng lỗi');

    const review = await this.prisma.qcReview.findFirst({
      where: { productionBatchId: batch.id },
      orderBy: { reviewedAt: 'desc' },
      include: QC_REVIEW_INCLUDE,
    });
    if (!review) {
      throw new NotFoundException(`Lô ${productionBatchId} chưa có KCS chấm nào`);
    }
    const reworkable = review.failedQty - (review.scrapQty ?? 0);
    const outstanding = reworkable - review.resolvedQty;
    if (outstanding <= 0) {
      throw new ConflictException(`Lô ${productionBatchId} đã hết lỗi, không cần báo bù nữa`);
    }
    if (review.phoiReportedAt) {
      throw new ConflictException(
        `Lô ${productionBatchId} đã báo bù đủ rồi, đang chờ KCS duyệt lại`,
      );
    }
    if (dto.qty > outstanding) {
      throw new BadRequestException(
        `Lô ${productionBatchId} chỉ còn lỗi ${outstanding} - không thể báo bù ${dto.qty}`,
      );
    }

    await this.prisma.qcReview.update({
      where: { id: review.id },
      data: { phoiReportedAt: new Date(), phoiReportedQty: dto.qty },
    });
    return this.toResponseDto(await this.findReviewOrThrow(review.id));
  }

  /**
   * KCS duyệt lại lô đã báo "Bù đủ" (2026-09-07) - `remainingFailedQty=0` → đạt hết phần sửa được,
   * `>0` → còn hỏng bấy nhiêu (mở lại lượt báo mới, phoiReportedAt/Qty reset về null).
   *
   * Khác Sắt (QcReviewSegment, chỉ TRACKING hiển thị): ở đây phần MỚI XÁC NHẬN ĐẠT được CỘNG THẲNG
   * vào `ProductionBatch.reportedQty` (dù batch đã QC_DONE) - bắt buộc phải làm vậy vì
   * `passedQty` của 1 mảnh (production-batches.service.ts) CỘNG THẲNG `reportedQty` từ mọi batch
   * QC_DONE, không đọc `resolvedQty` ở đâu cả. Không làm bước này thì "Bù đủ" chỉ là tracking
   * thuần, không thay được cách làm cũ (tạo lô mới) - đã trao đổi rõ và được chốt làm THẬT.
   */
  async recheckProductionBatch(
    productionBatchId: string,
    dto: RecheckProductionBatchDto,
  ): Promise<QcReviewResponseDto> {
    const batch = await this.productionBatchesService.findOneRowOrThrow(productionBatchId);
    await assertOrderPiHasActiveFloor(this.prisma, batch.productionOrderId, 'duyệt lại hàng lỗi');

    const review = await this.prisma.qcReview.findFirst({
      where: { productionBatchId: batch.id },
      orderBy: { reviewedAt: 'desc' },
      include: QC_REVIEW_INCLUDE,
    });
    if (!review) {
      throw new NotFoundException(`Lô ${productionBatchId} chưa có KCS chấm nào`);
    }
    if (!review.phoiReportedAt) {
      throw new ConflictException(
        `Lô ${productionBatchId} chưa được báo "Bù đủ" - chưa tới lượt duyệt lại`,
      );
    }
    const reworkable = review.failedQty - (review.scrapQty ?? 0);
    const outstanding = reworkable - review.resolvedQty;
    if (dto.remainingFailedQty > outstanding) {
      throw new BadRequestException(
        `Còn hỏng ${dto.remainingFailedQty} vượt số đang lỗi (${outstanding}) của lô ${productionBatchId}`,
      );
    }
    const justResolved = outstanding - dto.remainingFailedQty;

    await this.prisma.$transaction(async (tx) => {
      await tx.qcReview.update({
        where: { id: review.id },
        data: {
          resolvedQty: review.resolvedQty + justResolved,
          phoiReportedAt: dto.remainingFailedQty > 0 ? null : review.phoiReportedAt,
          phoiReportedQty: dto.remainingFailedQty > 0 ? null : review.phoiReportedQty,
        },
      });
      if (justResolved > 0) {
        await tx.productionBatch.update({
          where: { id: batch.id },
          data: { reportedQty: { increment: justResolved } },
        });
      }
    });

    return this.toResponseDto(await this.findReviewOrThrow(review.id));
  }

  async findAll(query: ListQcReviewsQueryDto): Promise<Paginated<QcReviewResponseDto>> {
    const where: Prisma.QcReviewWhereInput = {
      steelIssueId: query.steelIssueId ? parseBigIntId(query.steelIssueId) : undefined,
      defectReasonId: query.defectReasonId ? parseBigIntId(query.defectReasonId) : undefined,
    };
    const result = await paginate(
      {
        findMany: (args) => this.prisma.qcReview.findMany({ ...args, include: QC_REVIEW_INCLUDE }),
        count: (args) => this.prisma.qcReview.count(args),
      },
      query,
      where,
      { reviewedAt: 'desc' as const },
    );
    return { data: result.data.map((r) => this.toResponseDto(r)), meta: result.meta };
  }

  async findAllReplenishRequests(
    query: ListReplenishRequestsQueryDto,
  ): Promise<Paginated<ReplenishRequestResponseDto>> {
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.replenishRequest.findMany({ ...args, include: REPLENISH_REQUEST_INCLUDE }),
        count: (args) => this.prisma.replenishRequest.count(args),
      },
      query,
      { status: query.status ?? ReplenishRequestStatus.OPEN },
      { createdAt: 'desc' as const },
    );
    return { data: result.data.map((r) => this.toReplenishResponseDto(r)), meta: result.meta };
  }

  /**
   * Kho cấp bù bằng 1 đợt SteelIssue mới đã tạo trước đó (kho tự tạo qua endpoint xuất thường).
   * CHỈ áp dụng cho request sinh từ nhánh Phôi (qcReview.steelIssueId) - request sinh từ nhánh
   * Hàn/Sơn (qcReview.productionBatchId, Phase 9d) BỊ CHẶN ở đây theo đúng quyết định tài liệu
   * gốc (dna-erp-backend-implementation-plan.html mục 9.2: "Hàn/Sơn cấp lại bán-thành-phẩm nghĩa
   * là gì chưa có quyết định nghiệp vụ" - dừng ở OPEN/reject cho tới khi có quyết định).
   */
  async fulfillReplenishRequest(
    id: string,
    dto: FulfillReplenishRequestDto,
    actorUserId: string,
  ): Promise<ReplenishRequestResponseDto> {
    const request = await this.findReplenishRequestOrThrow(id);
    if (request.status !== ReplenishRequestStatus.OPEN) {
      throw new ConflictException(
        `Replenish request ${id} đang ở trạng thái ${request.status} - chỉ OPEN mới cấp bù được`,
      );
    }
    if (!request.qcReview.steelIssueId) {
      throw new BadRequestException(
        `Replenish request ${id} sinh từ công đoạn Hàn/Sơn - cấp bù bán-thành-phẩm cho Hàn/Sơn ` +
          'chưa có quyết định nghiệp vụ, chỉ hỗ trợ fulfill cho nhánh Phôi',
      );
    }

    const steelIssueBigId = parseBigIntId(dto.steelIssueId);
    const steelIssue = await this.prisma.steelIssue.findUnique({ where: { id: steelIssueBigId } });
    if (!steelIssue) {
      throw new NotFoundException(`Steel issue ${dto.steelIssueId} not found`);
    }
    const original = request.qcReview.steelIssue;
    if (original && steelIssue.materialId !== original.materialId) {
      throw new BadRequestException(
        `Đợt sắt ${dto.steelIssueId} không cùng loại sắt với đợt cần cấp bù`,
      );
    }
    // Medium fix: trước đây chỉ so materialId, không so PI - cấp bù của PI-A có thể bị gắn nhầm
    // vào 1 SteelIssue đã xuất trước đó cho PI-B (cùng loại sắt, khác PI), làm kế hoạch xuất sắt
    // của cả 2 PI lệch khỏi thực tế vật lý. SteelIssue.productionInvoiceId có sẵn trực tiếp.
    if (original && steelIssue.productionInvoiceId !== original.productionInvoiceId) {
      throw new BadRequestException(
        `Đợt sắt ${dto.steelIssueId} không cùng PI với đợt cần cấp bù (PI ${original.productionInvoiceId})`,
      );
    }

    const updated = await this.prisma.replenishRequest.update({
      where: { id: request.id },
      data: {
        status: ReplenishRequestStatus.FULFILLED,
        fulfilledByIssueId: steelIssue.id,
        fulfilledAt: new Date(),
        fulfilledById: actorUserId,
      },
      include: REPLENISH_REQUEST_INCLUDE,
    });
    return this.toReplenishResponseDto(updated);
  }

  async rejectReplenishRequest(
    id: string,
    dto: RejectReplenishRequestDto,
  ): Promise<ReplenishRequestResponseDto> {
    const request = await this.findReplenishRequestOrThrow(id);
    if (request.status !== ReplenishRequestStatus.OPEN) {
      throw new ConflictException(
        `Replenish request ${id} đang ở trạng thái ${request.status} - chỉ OPEN mới từ chối được`,
      );
    }
    const updated = await this.prisma.replenishRequest.update({
      where: { id: request.id },
      data: { status: ReplenishRequestStatus.REJECTED, rejectionReason: dto.reason },
      include: REPLENISH_REQUEST_INCLUDE,
    });
    return this.toReplenishResponseDto(updated);
  }

  private async findReplenishRequestOrThrow(id: string): Promise<ReplenishRequestRow> {
    const bigId = parseBigIntId(id);
    const request = await this.prisma.replenishRequest.findUnique({
      where: { id: bigId },
      include: REPLENISH_REQUEST_INCLUDE,
    });
    if (!request) {
      throw new NotFoundException(`Replenish request ${id} not found`);
    }
    return request;
  }

  /**
   * Lấy đúng segment của LƯỢT DUYỆT MỚI NHẤT cho 1 lô nhận HOẶC 1 đợt cắt cụ thể (2026-09-05,
   * thêm nhánh `cutBundleId` - trước chỉ nhận steelIssueId, mỗi SteelIssue từng chỉ có đúng 1
   * QcReview nên đủ; giờ 1 lô nhận có thể có NHIỀU đợt cắt cùng bị lỗi, PHẢI lọc thêm cutBundleId
   * nếu không sẽ lấy nhầm review của đợt cắt khác cùng lô - xem reportSegmentDoneForBundle()).
   */
  private async findLatestReviewSegmentOrThrow(
    segmentSpecId: string,
    scope: { steelIssueId: string } | { cutBundleId: string } | { stepBundleId: string },
  ): Promise<QcReviewRow['segments'][number] & { qcReviewId: bigint }> {
    const specBigId = parseBigIntId(segmentSpecId);
    const label =
      'steelIssueId' in scope
        ? `đợt sắt ${scope.steelIssueId}`
        : 'cutBundleId' in scope
          ? `đợt cắt ${scope.cutBundleId}`
          : `đợt gửi KCS ${scope.stepBundleId}`;
    const review = await this.prisma.qcReview.findFirst({
      where:
        'steelIssueId' in scope
          ? { steelIssueId: parseBigIntId(scope.steelIssueId) }
          : 'cutBundleId' in scope
            ? { cutBundleId: parseBigIntId(scope.cutBundleId) }
            : { stepBundleId: parseBigIntId(scope.stepBundleId) },
      orderBy: { reviewedAt: 'desc' },
      include: QC_REVIEW_INCLUDE,
    });
    if (!review) {
      throw new NotFoundException(`${label} chưa có KCS chấm nào`);
    }
    const segRow = review.segments.find((s) => s.segmentSpecId === specBigId);
    if (!segRow) {
      throw new NotFoundException(`${label} không có lỗi nào ở cỡ đoạn này`);
    }
    return segRow;
  }

  private async findReviewOrThrow(id: bigint): Promise<QcReviewRow> {
    return this.prisma.qcReview.findUniqueOrThrow({ where: { id }, include: QC_REVIEW_INCLUDE });
  }

  private toResponseDto(review: QcReviewRow): QcReviewResponseDto {
    return new QcReviewResponseDto({
      id: review.id.toString(),
      steelIssueId: review.steelIssueId?.toString() ?? null,
      productionBatchId: review.productionBatchId?.toString() ?? null,
      cutBundleId: review.cutBundleId?.toString() ?? null,
      stepBundleId: review.stepBundleId?.toString() ?? null,
      pieceStepBundleId: review.pieceStepBundleId?.toString() ?? null,
      failedQty: review.failedQty,
      scrapQty: review.scrapQty,
      defectReasonId: review.defectReasonId?.toString() ?? null,
      defectReasonLabel: review.defectReason?.label ?? null,
      reason: review.reason,
      photoUrl: review.photoUrl,
      reviewedAt: review.reviewedAt,
      reviewedById: review.reviewedById,
      resolvedQty: review.resolvedQty,
      phoiReportedAt: review.phoiReportedAt,
      phoiReportedQty: review.phoiReportedQty,
      segments: review.segments.map(
        (s) =>
          new QcReviewSegmentResponseDto({
            segmentSpecId: s.segmentSpecId.toString(),
            cutLengthMm: s.segmentSpec.cutLengthMm.toNumber(),
            failedQty: s.failedQty,
            resolvedQty: s.resolvedQty,
            phoiReportedAt: s.phoiReportedAt,
            phoiReportedQty: s.phoiReportedQty,
          }),
      ),
    });
  }

  private toReplenishResponseDto(request: ReplenishRequestRow): ReplenishRequestResponseDto {
    return new ReplenishRequestResponseDto({
      id: request.id.toString(),
      qcReviewId: request.qcReviewId.toString(),
      status: request.status,
      qty: request.qty,
      fulfilledByIssueId: request.fulfilledByIssueId?.toString() ?? null,
      fulfilledAt: request.fulfilledAt,
      fulfilledById: request.fulfilledById,
      rejectionReason: request.rejectionReason,
    });
  }
}
