import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReplenishRequestStatus, SteelIssueStatus } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { CreateQcReviewDto } from './dto/create-qc-review.dto';
import { FulfillReplenishRequestDto } from './dto/fulfill-replenish-request.dto';
import { ListQcReviewsQueryDto } from './dto/list-qc-reviews-query.dto';
import { ListReplenishRequestsQueryDto } from './dto/list-replenish-requests-query.dto';
import { QcReviewResponseDto } from './dto/qc-review-response.dto';
import { RejectReplenishRequestDto } from './dto/reject-replenish-request.dto';
import { ReplenishRequestResponseDto } from './dto/replenish-request-response.dto';

const QC_REVIEW_INCLUDE = { defectReason: true } satisfies Prisma.QcReviewInclude;
type QcReviewRow = Prisma.QcReviewGetPayload<{ include: typeof QC_REVIEW_INCLUDE }>;

const REPLENISH_REQUEST_INCLUDE = {
  qcReview: { include: { steelIssue: true } },
} satisfies Prisma.ReplenishRequestInclude;
type ReplenishRequestRow = Prisma.ReplenishRequestGetPayload<{
  include: typeof REPLENISH_REQUEST_INCLUDE;
}>;

/**
 * KCS duyệt (Phôi) + đề xuất cấp lại sắt phế (M2, thay phần kcsDuyetPhoi/capLaiSat của
 * phoi-sat.service.ts mock). qc_reviews dùng chung Phôi/Hàn-Sơn qua FK XOR (CHECK DB
 * qc_reviews_goods_xor_chk) - bản này chỉ nhánh Phôi (steelIssueId), productionBatchId để
 * trống tới khi hạng mục "Sản lượng theo công đoạn" thêm model ProductionBatch.
 */
@Injectable()
export class QcReviewsService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly steelIssuesService: SteelIssuesService,
  ) {}

  /**
   * Duyệt 1 SteelIssue đang AWAITING_QC. Luôn đóng đợt gốc thành QC_PASSED (đúng hành vi mock
   * kcsDuyetPhoi, xem comment đầu SteelIssuesService lý do KHÔNG theo sát endpoint rework riêng
   * của tài liệu gốc); phần sửa được (rework) tự sinh 1 SteelIssue con sau khi transaction
   * chính commit, phần phế (scrap) tự sinh 1 ReplenishRequest trong cùng transaction.
   */
  async review(
    steelIssueId: string,
    dto: CreateQcReviewDto,
    reviewedById: string,
  ): Promise<QcReviewResponseDto> {
    const issue = await this.steelIssuesService.findOneRowOrThrow(steelIssueId);
    if (issue.status !== SteelIssueStatus.AWAITING_QC) {
      throw new ConflictException(
        `Steel issue ${steelIssueId} đang ở trạng thái ${issue.status} - chỉ AWAITING_QC mới duyệt KCS được`,
      );
    }

    const baseQty = issue.actualBarCount ?? issue.barCount;
    if (dto.failedQty > baseQty) {
      throw new BadRequestException(
        `failedQty (${dto.failedQty}) không được vượt số cây đã báo cắt (${baseQty})`,
      );
    }
    const scrapQty = dto.scrapQty ?? 0;
    if (scrapQty > dto.failedQty) {
      throw new BadRequestException(
        `scrapQty (${scrapQty}) không được vượt failedQty (${dto.failedQty})`,
      );
    }
    const reworkQty = dto.failedQty - scrapQty;
    const defectReasonId = dto.defectReasonId ? parseBigIntId(dto.defectReasonId) : undefined;

    const created = await this.prisma.$transaction(async (tx) => {
      const review = await tx.qcReview.create({
        data: {
          steelIssueId: issue.id,
          failedQty: dto.failedQty,
          scrapQty: dto.scrapQty,
          defectReasonId,
          reason: dto.reason,
          photoUrl: dto.photoUrl,
          reviewedById,
        },
        include: QC_REVIEW_INCLUDE,
      });

      await tx.steelIssue.update({
        where: { id: issue.id },
        data: { status: SteelIssueStatus.QC_PASSED },
      });

      if (scrapQty > 0) {
        await tx.replenishRequest.create({
          data: { qcReviewId: review.id, qty: scrapQty },
        });
      }

      return review;
    });

    if (reworkQty > 0) {
      await this.steelIssuesService.createReworkIssue(issue, reworkQty);
    }

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

  /** Kho cấp bù bằng 1 đợt SteelIssue mới đã tạo trước đó (kho tự tạo qua endpoint xuất thường). */
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

    const steelIssueBigId = parseBigIntId(dto.steelIssueId);
    const steelIssue = await this.prisma.steelIssue.findUnique({ where: { id: steelIssueBigId } });
    if (!steelIssue) {
      throw new NotFoundException(`Steel issue ${dto.steelIssueId} not found`);
    }
    const original = request.qcReview.steelIssue;
    if (
      original &&
      (steelIssue.pieceId !== original.pieceId || steelIssue.materialId !== original.materialId)
    ) {
      throw new BadRequestException(
        `Đợt sắt ${dto.steelIssueId} không cùng mảnh/loại sắt với đợt cần cấp bù`,
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

  private toResponseDto(review: QcReviewRow): QcReviewResponseDto {
    return new QcReviewResponseDto({
      id: review.id.toString(),
      steelIssueId: review.steelIssueId?.toString() ?? null,
      productionBatchId: review.productionBatchId?.toString() ?? null,
      failedQty: review.failedQty,
      scrapQty: review.scrapQty,
      defectReasonId: review.defectReasonId?.toString() ?? null,
      defectReasonLabel: review.defectReason?.label ?? null,
      reason: review.reason,
      photoUrl: review.photoUrl,
      reviewedAt: review.reviewedAt,
      reviewedById: review.reviewedById,
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
