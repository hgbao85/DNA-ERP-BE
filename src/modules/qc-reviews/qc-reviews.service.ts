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
import { ListQcReviewsQueryDto } from './dto/list-qc-reviews-query.dto';
import { QcReviewResponseDto, QcReviewSegmentResponseDto } from './dto/qc-review-response.dto';

const QC_REVIEW_INCLUDE = {
  defectReason: true,
  segments: { include: { segmentSpec: true } },
} satisfies Prisma.QcReviewInclude;
type QcReviewRow = Prisma.QcReviewGetPayload<{ include: typeof QC_REVIEW_INCLUDE }>;

/**
 * KCS duyệt (Phôi + Hàn/Sơn + VTTP), thay phần kcsDuyetPhoi của phoi-sat.service.ts và
 * kcsDuyetStage của san-luong.service.ts mock. qc_reviews dùng chung 4 nhánh qua FK XOR (CHECK DB
 * qc_reviews_goods_xor_chk): steelIssueId (review(), Phase 9), productionBatchId
 * (reviewProductionBatch(), Phase 9d), stepBundleId, pieceStepBundleId - mỗi nhánh 1 endpoint REST
 * riêng chỉ để URL rõ ràng, đúng thiết kế gốc "service dùng chung logic"
 * (docs/dna-erp-backend-implementation-plan.html mục 9.2). "Đề xuất cấp lại" (ReplenishRequest, chỉ
 * sinh từ scrapQty ở reviewProductionBatch()) đã BỎ HẲN 2026-09-08 lần 2 cùng "Sửa được/Phế" - xem
 * changelog "Bù đủ dồn về bảng tổng": mọi nhánh giờ chỉ Đạt/Không đạt, "Lỗi" là số lịch sử cộng
 * dồn, Bù đủ = 1 đợt/lô HOÀN TOÀN MỚI gửi duyệt lại.
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
      // Đính chính audit độc lập 09/09 (Nghiêm trọng #5): trước đây update() ghi status vô điều
      // kiện - 2 request duyệt gần như đồng thời (double-click, mạng chập chờn tự gửi lại) cho
      // cùng đợt AWAITING_QC đều pass check status (đọc snapshot NGOÀI transaction ở đầu hàm),
      // đều tạo QcReview + update status, không có gì phát hiện đợt đã bị duyệt bởi request kia -
      // lost-update/duplicate review. updateMany lọc kèm đúng trạng thái kỳ vọng + so count, cùng
      // idiom ProductionInvoicesService.approveItem()/WarehouseTransfersService.confirm(): request
      // nào commit trước thắng, request thua khớp 0 dòng -> rollback toàn bộ (kể cả review vừa tạo).
      const { count } = await tx.steelIssue.updateMany({
        where: { id: issue.id, status: SteelIssueStatus.AWAITING_QC },
        data: { status: SteelIssueStatus.QC_PASSED },
      });
      if (count === 0) {
        throw new ConflictException(
          `Steel issue ${steelIssueId} đã bị 1 request khác duyệt KCS trong lúc đang xử lý - không ghi đè`,
        );
      }

      return tx.qcReview.create({
        data: {
          steelIssueId: issue.id,
          failedQty: totalFailed,
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
      // Đính chính audit độc lập 09/09 (Nghiêm trọng #5) - cùng lý do/cùng fix review() ở trên.
      const { count } = await tx.cutBundle.updateMany({
        where: { id: bundle.id, status: CutBundleStatus.AWAITING_QC },
        data: { status: CutBundleStatus.QC_PASSED },
      });
      if (count === 0) {
        throw new ConflictException(
          `Đợt cắt ${cutBundleId} đã bị 1 request khác duyệt KCS trong lúc đang xử lý - không ghi đè`,
        );
      }

      return tx.qcReview.create({
        data: {
          steelIssueId: bundle.steelIssueId,
          cutBundleId: bundle.id,
          failedQty: totalFailed,
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
  /**
   * Duyệt 1 StepBundle (2026-09-07, đổi scope lần 2) - StepBundle không còn thuộc đúng 1
   * SteelIssue/CutBundle nào (scope PI + loại sắt), nên `QcReview` tạo ra CHỈ ghi `stepBundleId`
   * (LÀ 1 LEG THẬT trong XOR qc_reviews_goods_xor_chk, mirror pieceStepBundleId) - KHÔNG còn kèm
   * `steelIssueId` như bản đầu.
   */
  async reviewStepBundle(
    stepBundleId: string,
    dto: CreateSteelIssueQcReviewDto,
    reviewedById: string,
  ): Promise<QcReviewResponseDto> {
    const bundleBigId = parseBigIntId(stepBundleId);
    const bundle = await this.prisma.stepBundle.findUnique({
      where: { id: bundleBigId },
      include: { material: true },
    });
    if (!bundle) {
      throw new NotFoundException(`Đợt gửi KCS ${stepBundleId} not found`);
    }
    if (bundle.status !== StepBundleStatus.AWAITING_QC) {
      throw new ConflictException(
        `Đợt gửi KCS ${stepBundleId} đang ở trạng thái ${bundle.status} - chỉ đợt chờ KCS mới duyệt được`,
      );
    }
    await assertPiHasActiveFloor(this.prisma, bundle.productionInvoiceId, 'duyệt KCS');

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
      if (spec.materialId !== bundle.materialId) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm không thuộc loại sắt của đợt gửi KCS này`,
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
      // Đính chính audit độc lập 09/09 (Nghiêm trọng #5) - cùng lý do/cùng fix review() ở trên.
      const { count } = await tx.stepBundle.updateMany({
        where: { id: bundle.id, status: StepBundleStatus.AWAITING_QC },
        data: { status: StepBundleStatus.QC_PASSED },
      });
      if (count === 0) {
        throw new ConflictException(
          `Đợt gửi KCS ${stepBundleId} đã bị 1 request khác duyệt trong lúc đang xử lý - không ghi đè`,
        );
      }

      return tx.qcReview.create({
        data: {
          stepBundleId: bundle.id,
          failedQty: totalFailed,
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
    });

    return this.toResponseDto(created);
  }

  /**
   * Duyệt 1 ProductionBatch đang AWAITING_QC (bước "Chốt & gửi KCS" cuối, Hàn/Sơn/VTTP). Đơn giản
   * hoá 2026-09-08 lần 2 (xem changelog "Bù đủ dồn về bảng tổng") - bỏ hẳn phân loại "Sửa
   * được"/"Phế" (scrapQty, ReplenishRequest) + cơ chế report-done/recheck: CHỈ 2 kết quả Đạt/Không
   * đạt, mirror ĐÚNG reviewPieceStep() bên dưới. failedQty không tính "đã báo" nữa (ghi đè
   * reportedQty = phần ĐẠT), công nhân tự báo lại toàn bộ phần lỗi ở 1 lô HOÀN TOÀN MỚI sau (qua
   * ProductionBatchesService.create() bình thường - "Bù đủ" chỉ pre-fill số lượng ở FE, không có
   * API riêng).
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
    const passedQty = batch.reportedQty - dto.failedQty;
    const defectReasonId = dto.defectReasonId ? parseBigIntId(dto.defectReasonId) : undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      // Đính chính audit độc lập 09/09 (Nghiêm trọng #5) - cùng lý do/cùng fix review() ở trên.
      // Đặc biệt quan trọng ở đây: reportedQty bị GHI ĐÈ (không cộng dồn) - 2 request duyệt trùng
      // mà không chặn sẽ làm sản lượng đã chốt sai lệch thật (không chỉ lost-update audit trail).
      const { count } = await tx.productionBatch.updateMany({
        where: { id: batch.id, status: ProductionBatchStatus.AWAITING_QC },
        data: { status: ProductionBatchStatus.QC_DONE, reportedQty: passedQty },
      });
      if (count === 0) {
        throw new ConflictException(
          `Production batch ${productionBatchId} đã bị 1 request khác duyệt KCS trong lúc đang xử lý - không ghi đè`,
        );
      }

      return tx.qcReview.create({
        data: {
          productionBatchId: batch.id,
          failedQty: dto.failedQty,
          defectReasonId,
          reason: dto.reason,
          photoUrl: dto.photoUrl,
          reviewedById,
        },
        include: QC_REVIEW_INCLUDE,
      });
    });

    return this.toResponseDto(created);
  }

  /**
   * KCS duyệt 1 "đợt gửi KCS theo công đoạn" (PieceStepBundle, 2026-09-07) - mirror ĐÚNG cách Phôi/
   * Sắt chấm (reviewCutBundle()): CHỈ 2 kết quả Đạt/Không đạt (quyết định nghiệp vụ 2026-09-07,
   * Sếp Trương Văn Nhân qua chat nội bộ: "sửa được thì không tính là lỗi" - toàn bộ failedQty coi
   * như "không đạt", Phôi tự sửa rồi báo Bù đủ bằng 1 bundle MỚI, không qua cấp bù kho). Từ
   * 2026-09-08 lần 2, reviewProductionBatch() (Hàn/Sơn/VTTP chốt cuối) cũng đã quy về ĐÚNG pattern
   * này - `CreateQcReviewDto` dùng chung shape cho cả 2 method, không tách DTO riêng. bundle.status
   * luôn → QC_PASSED sau khi duyệt (kể cả có lỗi) - "PASSED" nghĩa là "đã qua tay KCS", không phải
   * "0 lỗi", cùng ngữ nghĩa CutBundleStatus.QC_PASSED.
   *
   * Cập nhật 2026-09-08 (bỏ hẳn "Chốt & gửi KCS" thủ công cho VTTP có khai processSteps): NẾU đây
   * là công đoạn CUỐI theo processSteps của mảnh, tự sinh thẳng ProductionBatch(QC_DONE) qua
   * ProductionBatchesService.autoFinalizePieceOutputIfLastStepComplete() trong CÙNG transaction -
   * xem doc comment method đó. Với mọi công đoạn KHÔNG phải cuối, hành vi giữ nguyên như cũ: không
   * đụng ProductionBatch, thuần là cổng kiểm tra chất lượng theo công đoạn.
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
      // Đính chính audit độc lập 09/09 (Nghiêm trọng #5) - cùng lý do/cùng fix review() ở trên.
      // Đặc biệt quan trọng ở đây: autoFinalizePieceOutputIfLastStepComplete() bên dưới cộng
      // failedQty từ MỌI QcReview gắn vào bundle này - 2 request duyệt trùng không chặn sẽ tạo 2
      // dòng QcReview cùng bundleId, cộng trùng failedQty vào sản lượng đã chốt (ProductionBatch).
      const { count } = await tx.pieceStepBundle.updateMany({
        where: { id: bundle.id, status: PieceStepBundleStatus.AWAITING_QC },
        data: { status: PieceStepBundleStatus.QC_PASSED },
      });
      if (count === 0) {
        throw new ConflictException(
          `Đợt gửi KCS ${pieceStepBundleId} đã bị 1 request khác duyệt trong lúc đang xử lý - không ghi đè`,
        );
      }

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

      await this.productionBatchesService.autoFinalizePieceOutputIfLastStepComplete(
        tx,
        bundle.productionOrder.bomRevisionId,
        bundle.productionOrderId,
        bundle.pieceId,
        bundle.step,
        reviewedById,
      );

      return review;
    });

    return this.toResponseDto(created);
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

  private toResponseDto(review: QcReviewRow): QcReviewResponseDto {
    return new QcReviewResponseDto({
      id: review.id.toString(),
      steelIssueId: review.steelIssueId?.toString() ?? null,
      productionBatchId: review.productionBatchId?.toString() ?? null,
      cutBundleId: review.cutBundleId?.toString() ?? null,
      stepBundleId: review.stepBundleId?.toString() ?? null,
      pieceStepBundleId: review.pieceStepBundleId?.toString() ?? null,
      failedQty: review.failedQty,
      defectReasonId: review.defectReasonId?.toString() ?? null,
      defectReasonLabel: review.defectReason?.label ?? null,
      reason: review.reason,
      photoUrl: review.photoUrl,
      reviewedAt: review.reviewedAt,
      reviewedById: review.reviewedById,
      segments: review.segments.map(
        (s) =>
          new QcReviewSegmentResponseDto({
            segmentSpecId: s.segmentSpecId.toString(),
            cutLengthMm: s.segmentSpec.cutLengthMm.toNumber(),
            failedQty: s.failedQty,
          }),
      ),
    });
  }
}
