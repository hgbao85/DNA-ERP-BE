import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessoryItemKind,
  BomRevisionStatus,
  DetailGroup,
  ManhGroup,
  MaterialDetailKind,
  MfgStage,
  PlanFormStatus,
  Prisma,
  ReviewDecision,
} from '../../generated/prisma/client';
import {
  MATERIAL_GROUP_SYSTEM_KEYS,
  MaterialGroupSystemKey,
} from '../../common/constants/material-group-system-keys.constant';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { nextProductionInvoiceCode } from '../../common/utils/production-invoice-code.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { BomRevisionsService } from '../bom-revisions/bom-revisions.service';
import { CreateSkuDto } from './dto/create-sku.dto';
import { SkuResponseDto } from './dto/sku-response.dto';
import {
  SkuDetailReviewResponseDto,
  SkuManhReviewResponseDto,
} from './dto/sku-review-response.dto';
import {
  DetailLineGroup,
  QuotaMaterialLineDto,
  QuotaPieceDto,
  QuotaPieceMaterialLineDto,
  UpdateQuotaDto,
} from './dto/update-quota.dto';
import { ReviewQuotaDto } from './dto/review-quota.dto';

const PLAN_FORM_INCLUDE = {
  mfgProduct: true,
  manhReviews: true,
  detailReviews: true,
  salesOrder: { include: { customer: true } },
  productionInvoice: true,
} satisfies Prisma.PlanFormInclude;

type PlanFormWithRefs = Prisma.PlanFormGetPayload<{ include: typeof PLAN_FORM_INCLUDE }>;

/** PrismaServiceType (client mở rộng qua $extends) có shape tx callback khác Prisma.TransactionClient
 *  gốc - suy ra đúng type từ chính $transaction của nó thay vì dùng type generated thẳng. */
type PrismaTx = Parameters<Parameters<PrismaServiceType['$transaction']>[0]>[0];

// Mảnh giờ chứa cả 5 nhóm vật tư (Sắt/Dây/Đinh/Tán rút/Nút nhựa) trong 1 lần nhập/duyệt duy
// nhất - chỉ còn đúng 1 group SAT còn dùng, DAY/DINH (enum cũ) không còn được ghi tiếp.
const MANH_GROUPS: ManhGroup[] = [ManhGroup.SAT];
// Định mức chi tiết giờ chứa cả 3 nhóm (Sơn/Phụ kiện/Bao bì) trong 1 lần nhập/duyệt duy nhất -
// chỉ còn đúng 1 group DAY_SON còn dùng (sentinel), VAT_TU_PHU_KIEN/BAO_BI_DONG_GOI (enum cũ)
// không còn được ghi tiếp.
const DETAIL_GROUPS: DetailGroup[] = [DetailGroup.DAY_SON];

/** Lưới an toàn cho $transaction ghi định mức (updateManhQuota/updateDetailQuota) - cao hơn
 *  mặc định 5000ms của Prisma vì replacePieces/replaceConsumableLines/replaceAccessoryItems
 *  vẫn còn round-trip theo số piece/segment dù đã batch phần đọc (xem fetchMaterialsOrThrow,
 *  resolveOrCreatePieces). Không phải fix chính - chỉ là biên độ dự phòng khi DB chậm bất
 *  thường; nếu timeout vẫn xảy ra thường xuyên, cần tối ưu round-trip tiếp chứ không tăng số
 *  này thêm. */
const QUOTA_TRANSACTION_TIMEOUT_MS = 15_000;

interface ReconstructedQuota {
  manhData: unknown;
  detailQuota: unknown;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key);
    if (arr) arr.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/**
 * SKU quota-approval pipeline (dịch ngược PlanFormService trong mock FE). Status rút gọn còn
 * 3 giá trị: IN_PROGRESS -> WAITING_BOSS_APPROVAL -> APPROVED (hoặc rewind về IN_PROGRESS qua
 * reject-boss). Mảnh và chi tiết là 2 NHÁNH ĐỘC LẬP tiến song song, không bắt buộc theo thứ
 * tự nào - tiến độ "KHSX đã chốt xong nhánh này chưa" nằm ở manhForwardedAt/detailForwardedAt
 * (set qua approveParts()/approveDetail()), không còn suy ra từ vị trí tuyến tính của status.
 * Khi CẢ HAI đã forwarded, status tự chuyển WAITING_BOSS_APPROVAL (xem advanceForwardedTrack).
 * Bước QLSX duyệt cục bộ (WAITING_QLSX_APPROVAL) đã bị loại khỏi pipeline từ trước - approveDetail()
 * chuyển thẳng KHSX -> Sếp (khi nhánh còn lại cũng đã xong). Quy tắc "từ chối chỉ xoá quyết định
 * duyệt, không xoá dữ liệu đã nhập" mirror đúng mock - xem plan file rippling-conjuring-cloud.md
 * mục "Sửa luôn 2 chỗ mock".
 *
 * Việc 2: `manhData`/`detailQuota` KHÔNG còn là nguồn sự thật - dữ liệu định mức thật nằm ở
 * Piece/SegmentSpec/BomRevision (+5 bảng dòng con) quan hệ thật, mỗi PlanForm sở hữu đúng 1
 * BomRevision (tạo lười ở lần ghi định mức đầu tiên, xem resolveDraftBomRevision). 2 cột
 * JSON trên PlanForm được TÁI DỰNG ở tầng đọc (reconstructQuotaBatch) từ dữ liệu quan hệ đó
 * để giữ đúng shape response cũ - cột JSON thật trên DB coi như đã chết, sẽ xoá ở migration
 * theo sau (xem plan). Sếp duyệt cuối (approve()) sẽ activate BomRevision DRAFT thành ACTIVE.
 */
@Injectable()
export class SkusService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly bomRevisionsService: BomRevisionsService,
  ) {}

  async create(dto: CreateSkuDto, actorUserId: string): Promise<SkuResponseDto> {
    const mfgProductBigId = parseBigIntId(dto.mfgProductId);
    const product = await this.prisma.mfgProduct.findUnique({ where: { id: mfgProductBigId } });
    if (!product) {
      throw new NotFoundException(`Product ${dto.mfgProductId} not found`);
    }

    // SKU độc lập với Sales Order: salesOrderId chỉ được gắn khi FE thật sự truyền lên (không
    // còn tự động mượn Sales Order đầu tiên trong hệ thống như trước - xem SKUReviewPage cũ).
    // Chỉ khi có salesOrderId mới cần PI (Production Invoice) đi kèm.
    let salesOrderBigId: bigint | undefined;
    let productionInvoiceId: bigint | undefined;
    let customerName = dto.customerName?.trim() || undefined;
    if (dto.salesOrderId) {
      salesOrderBigId = parseBigIntId(dto.salesOrderId);
      const salesOrder = await this.prisma.salesOrder.findUnique({
        where: { id: salesOrderBigId },
        include: { customer: true },
      });
      if (!salesOrder) {
        throw new NotFoundException(`Sales order ${dto.salesOrderId} not found`);
      }
      customerName = customerName ?? salesOrder.customer.name;
      productionInvoiceId = await this.resolveProductionInvoice(salesOrderBigId, mfgProductBigId);
    }

    const created = await this.prisma.planForm.create({
      data: {
        salesOrderId: salesOrderBigId,
        mfgProductId: mfgProductBigId,
        productionInvoiceId,
        customerName,
        note: dto.note,
        createdById: actorUserId,
      },
      include: PLAN_FORM_INCLUDE,
    });
    return this.toResponseDtoWithQuota(created);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<SkuResponseDto>> {
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.planForm.findMany({
            ...args,
            include: PLAN_FORM_INCLUDE,
          }),
        count: (args) => this.prisma.planForm.count(args),
      },
      query,
      undefined,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );
    const quotas = await this.reconstructQuotaBatch(result.data);
    return {
      data: result.data.map((pf) => this.toResponseDto(pf, quotas.get(pf.id.toString())!)),
      meta: result.meta,
    };
  }

  async findOne(id: string): Promise<SkuResponseDto> {
    return this.toResponseDtoWithQuota(await this.findOneOrThrow(id));
  }

  /** Xoá SKU (dọn dẹp quản trị, vd tạo nhầm) - hard delete, mirror deletePlanForms() trong mock. */
  async remove(id: string): Promise<void> {
    const pf = await this.findOneOrThrow(id);
    await this.prisma.$transaction([
      this.prisma.planFormManhReview.deleteMany({ where: { planFormId: pf.id } }),
      this.prisma.planFormDetailReview.deleteMany({ where: { planFormId: pf.id } }),
      this.prisma.planForm.delete({ where: { id: pf.id } }),
    ]);
  }

  // ─── Manh quota (mảnh - Sắt/Dây/Đinh/Tán rút/Nút nhựa, 1 lần nhập/duyệt duy nhất) ───────────

  async updateManhQuota(id: string, dto: UpdateQuotaDto): Promise<SkuResponseDto> {
    const pf = await this.findOneOrThrow(id);
    const revision = await this.resolveDraftBomRevision(pf);
    const enteredAt = new Date();

    const updated = await this.prisma.$transaction(
      async (tx) => {
        if (!dto.pieces) {
          throw new BadRequestException('manh-quota yêu cầu field "pieces"');
        }
        await this.replacePieces(tx, revision.id, pf.mfgProductId, dto.pieces);

        // Nhập lại (kể cả sau khi bị từ chối) coi như đã sửa xong - xoá quyết định duyệt cũ
        // (status/reason/reviewedAt về null), giữ enteredBy/enteredAt mới.
        await tx.planFormManhReview.upsert({
          where: { planFormId_group: { planFormId: pf.id, group: ManhGroup.SAT } },
          create: { planFormId: pf.id, group: ManhGroup.SAT, enteredBy: dto.enteredBy, enteredAt },
          update: {
            enteredBy: dto.enteredBy,
            enteredAt,
            status: null,
            reason: null,
            reviewedAt: null,
          },
        });
        // Nhập lại sau khi nhánh mảnh đã forward (KHSX đã "chốt xong") coi như bung lại - KHSX
        // phải duyệt + forward lại nhánh này. Nếu cả 2 nhánh đã từng forward xong (status đang
        // WAITING_BOSS_APPROVAL), lùi về IN_PROGRESS - không để Sếp duyệt nhầm dữ liệu cũ.
        return tx.planForm.update({
          where: { id: pf.id },
          data: {
            manhForwardedAt: null,
            ...(pf.status === PlanFormStatus.WAITING_BOSS_APPROVAL
              ? { status: PlanFormStatus.IN_PROGRESS }
              : {}),
          },
          include: PLAN_FORM_INCLUDE,
        });
      },
      { timeout: QUOTA_TRANSACTION_TIMEOUT_MS },
    );
    return this.toResponseDtoWithQuota(updated);
  }

  async reviewManhQuota(id: string, dto: ReviewQuotaDto): Promise<SkuResponseDto> {
    await this.findOneOrThrow(id);
    const bigId = parseBigIntId(id);
    await this.prisma.planFormManhReview.upsert({
      where: { planFormId_group: { planFormId: bigId, group: ManhGroup.SAT } },
      create: {
        planFormId: bigId,
        group: ManhGroup.SAT,
        status: dto.status,
        reason: dto.reason,
        reviewedAt: new Date(),
      },
      update: { status: dto.status, reason: dto.reason, reviewedAt: new Date() },
    });
    return this.findOne(id);
  }

  /** KHSX xác nhận mảnh đã duyệt xong (nhánh độc lập với chi tiết - xem advanceForwardedTrack). */
  async approveParts(id: string): Promise<SkuResponseDto> {
    const pf = await this.findOneOrThrow(id);
    this.assertAllApproved(pf.manhReviews, MANH_GROUPS, 'mảnh');
    return this.advanceForwardedTrack(pf, 'manh');
  }

  // ─── Detail quota (chi tiết - Sơn/Phụ kiện/Bao bì, 1 lần nhập/duyệt duy nhất) ───────────────

  async updateDetailQuota(id: string, dto: UpdateQuotaDto): Promise<SkuResponseDto> {
    const pf = await this.findOneOrThrow(id);
    const revision = await this.resolveDraftBomRevision(pf);
    const enteredAt = new Date();

    const updated = await this.prisma.$transaction(
      async (tx) => {
        if (!dto.detailLines) {
          throw new BadRequestException('detail-quota yêu cầu field "detailLines"');
        }
        const linesOf = (g: DetailLineGroup): QuotaMaterialLineDto[] =>
          dto
            .detailLines!.filter((l) => l.group === g)
            .map((l) => ({ materialId: l.materialId, qtyPerUnit: l.qtyPerUnit }));

        // Sơn/Phụ kiện/Bao bì đều dùng chung 1 nhóm vật tư hệ thống ("Vật tư khác", OTHER) -
        // Sơn tách qua stage=SON, Phụ kiện/Bao bì tách qua AccessoryItemKind (xem
        // replaceAccessoryItems). Material.detailKind (gán ở Admin > Vật tư, xem
        // MaterialsService.resolveDetailKind) khoá cứng 1 material vào ĐÚNG 1 trong 3 mục đích
        // này - assertMaterialDetailKind ở replaceConsumableLines/replaceAccessoryItems chặn
        // material sai phân loại, nên cũng tự động chặn luôn trường hợp 1 material vừa được
        // gửi làm Phụ kiện vừa làm Bao bì trong cùng 1 lần nhập (không cần check riêng nữa).
        const otherGroupId = await this.resolveSystemGroupId(tx, MATERIAL_GROUP_SYSTEM_KEYS.OTHER);
        await this.replaceConsumableLines(
          tx,
          revision.id,
          MfgStage.SON,
          linesOf('DAY_SON'),
          otherGroupId,
          MaterialDetailKind.PAINT,
          'Sơn',
        );
        await this.replaceAccessoryItems(
          tx,
          revision.id,
          otherGroupId,
          AccessoryItemKind.ACCESSORY,
          MaterialDetailKind.ACCESSORY,
          'Phụ kiện',
          linesOf('VAT_TU_PHU_KIEN'),
        );
        await this.replaceAccessoryItems(
          tx,
          revision.id,
          otherGroupId,
          AccessoryItemKind.PACKAGING,
          MaterialDetailKind.PACKAGING,
          'Bao bì',
          linesOf('BAO_BI_DONG_GOI'),
        );

        // Nhập lại (kể cả sau khi bị từ chối) coi như đã sửa xong - xoá quyết định duyệt cũ
        // (status/reason/reviewedAt về null), giữ enteredBy/enteredAt mới.
        await tx.planFormDetailReview.upsert({
          where: { planFormId_group: { planFormId: pf.id, group: DetailGroup.DAY_SON } },
          create: {
            planFormId: pf.id,
            group: DetailGroup.DAY_SON,
            enteredBy: dto.enteredBy,
            enteredAt,
          },
          update: {
            enteredBy: dto.enteredBy,
            enteredAt,
            status: null,
            reason: null,
            reviewedAt: null,
          },
        });
        // Cùng lý do với updateManhQuota - nhập lại sau khi nhánh chi tiết đã forward thì bung
        // lại, và lùi status về IN_PROGRESS nếu cả 2 nhánh đã từng forward xong.
        return tx.planForm.update({
          where: { id: pf.id },
          data: {
            detailForwardedAt: null,
            ...(pf.status === PlanFormStatus.WAITING_BOSS_APPROVAL
              ? { status: PlanFormStatus.IN_PROGRESS }
              : {}),
          },
          include: PLAN_FORM_INCLUDE,
        });
      },
      { timeout: QUOTA_TRANSACTION_TIMEOUT_MS },
    );
    return this.toResponseDtoWithQuota(updated);
  }

  async reviewDetailQuota(id: string, dto: ReviewQuotaDto): Promise<SkuResponseDto> {
    await this.findOneOrThrow(id);
    const bigId = parseBigIntId(id);
    await this.prisma.planFormDetailReview.upsert({
      where: { planFormId_group: { planFormId: bigId, group: DetailGroup.DAY_SON } },
      create: {
        planFormId: bigId,
        group: DetailGroup.DAY_SON,
        status: dto.status,
        reason: dto.reason,
        reviewedAt: new Date(),
      },
      update: { status: dto.status, reason: dto.reason, reviewedAt: new Date() },
    });
    return this.findOne(id);
  }

  /** KHSX xác nhận chi tiết đã duyệt xong (nhánh độc lập với mảnh - xem advanceForwardedTrack).
   *  KHÔNG còn đòi hỏi mảnh phải xong trước - 2 nhánh tiến song song, ai xong trước forward
   *  trước; khi cả 2 đã forwarded, advanceForwardedTrack tự chuyển thẳng sang Sếp duyệt (bước
   *  QLSX duyệt cục bộ đã bị loại khỏi pipeline từ trước). */
  async approveDetail(id: string): Promise<SkuResponseDto> {
    const pf = await this.findOneOrThrow(id);
    this.assertAllApproved(pf.detailReviews, DETAIL_GROUPS, 'chi tiết');
    return this.advanceForwardedTrack(pf, 'detail');
  }

  /**
   * Set đúng 1 mốc forwarded (manh/detail) của nhánh vừa được KHSX xác nhận xong; nếu SAU đó cả
   * 2 mốc đều khác null (nhánh còn lại đã forward từ trước) thì chuyển thẳng
   * WAITING_BOSS_APPROVAL trong cùng 1 lệnh ghi - không cần biết nhánh nào forward trước.
   */
  private async advanceForwardedTrack(
    pf: PlanFormWithRefs,
    track: 'manh' | 'detail',
  ): Promise<SkuResponseDto> {
    const now = new Date();
    const manhForwardedAt = track === 'manh' ? now : pf.manhForwardedAt;
    const detailForwardedAt = track === 'detail' ? now : pf.detailForwardedAt;
    const bothForwarded = manhForwardedAt != null && detailForwardedAt != null;

    const updated = await this.prisma.planForm.update({
      where: { id: pf.id },
      data: {
        ...(track === 'manh' ? { manhForwardedAt: now } : { detailForwardedAt: now }),
        ...(bothForwarded ? { status: PlanFormStatus.WAITING_BOSS_APPROVAL } : {}),
      },
      include: PLAN_FORM_INCLUDE,
    });
    return this.toResponseDtoWithQuota(updated);
  }

  // ─── Sếp (Boss) ─────────────────────────────────────────────────────────────

  /**
   * Duyệt cuối - nếu PlanForm sở hữu 1 BomRevision DRAFT (đã nhập định mức), activate nó (bản
   * ACTIVE trước đó của cùng SKU tự chuyển RETIRED, xem BomRevisionsService.activateInTransaction).
   * Toàn bộ chạy trong 1 transaction - trước đây activate() và update status là 2 write rời
   * nhau, crash giữa chừng để lại BomRevision đã ACTIVE nhưng PlanForm vẫn kẹt ở
   * WAITING_BOSS_APPROVAL, không cách nào tự phục hồi. Update status dùng updateMany + đếm
   * count thay vì update() trực tiếp: WHERE guard đúng status hiện tại ngay trong câu lệnh ghi,
   * không phải đọc-rồi-ghi (assertStatus ở trên chỉ fail-fast cho request rõ ràng sai trạng
   * thái, không đủ chặn 2 request cùng đọc thấy WAITING_BOSS_APPROVAL rồi cùng ghi APPROVED khi
   * PlanForm không có BomRevision DRAFT nào để tận dụng lock của activateInTransaction).
   *
   * idempotencyKey lưu vào bossApproveIdempotencyKey khi commit thành công - client mất kết nối
   * ngay sau khi server đã commit, retry cùng key sẽ được trả lại đúng response cũ (short-circuit
   * dưới) thay vì 409 do status không còn WAITING_BOSS_APPROVAL nữa. Trùng key với 1 PlanForm
   * KHÁC là lỗi client thật (unique constraint), không phải replay hợp lệ - để nguyên cho
   * AllExceptionsFilter map P2002 thành 409, không cần bắt riêng ở đây.
   */
  async approve(id: string, idempotencyKey: string): Promise<SkuResponseDto> {
    const pf = await this.findOneOrThrow(id);

    if (pf.bossApproveIdempotencyKey === idempotencyKey) {
      return this.toResponseDtoWithQuota(pf);
    }
    this.assertStatus(pf, PlanFormStatus.WAITING_BOSS_APPROVAL);

    const updated = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.bomRevision.findFirst({
        where: { sourcePlanFormId: pf.id, status: BomRevisionStatus.DRAFT },
      });
      if (draft) {
        await this.bomRevisionsService.activateInTransaction(tx, draft.id.toString());
      }

      const { count } = await tx.planForm.updateMany({
        where: { id: pf.id, status: PlanFormStatus.WAITING_BOSS_APPROVAL },
        data: {
          status: PlanFormStatus.APPROVED,
          bossApproveIdempotencyKey: idempotencyKey,
          bossRejectReason: null,
        },
      });
      if (count === 0) {
        throw new ConflictException(
          `Plan form ${pf.id} đã được xử lý bởi 1 request khác trong lúc chờ duyệt - không ghi đè`,
        );
      }

      return tx.planForm.findUniqueOrThrow({ where: { id: pf.id }, include: PLAN_FORM_INCLUDE });
    });

    return this.toResponseDtoWithQuota(updated);
  }

  async rejectByBoss(id: string, reason?: string): Promise<SkuResponseDto> {
    const pf = await this.findOneOrThrow(id);
    this.assertStatus(pf, PlanFormStatus.WAITING_BOSS_APPROVAL);
    return this.rewindToDetailReview(pf.id, reason);
  }

  /**
   * Rewind về IN_PROGRESS, xoá SẠCH quyết định duyệt lẫn 2 mốc forwarded (không đụng dữ liệu
   * định mức đã nhập - BomRevision DRAFT vẫn giữ nguyên nội dung) - KHSX phải duyệt + forward lại
   * CẢ 2 nhánh nhưng account chuyên trách không phải nhập lại gì, mirror đúng
   * rejectToDetailReview() trong mock. `reason` (nếu Sếp có nhập) lưu vào
   * PlanForm.bossRejectReason - khác lý do KHSX từ chối từng nhánh (ManhReview/DetailReview.reason,
   * đã bị xoá ở trên) nên phải giữ riêng ở tầng PlanForm.
   */
  private async rewindToDetailReview(id: bigint, reason?: string): Promise<SkuResponseDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.planFormManhReview.deleteMany({ where: { planFormId: id } });
      await tx.planFormDetailReview.deleteMany({ where: { planFormId: id } });
      return tx.planForm.update({
        where: { id },
        data: {
          status: PlanFormStatus.IN_PROGRESS,
          manhForwardedAt: null,
          detailForwardedAt: null,
          bossRejectReason: reason ?? null,
        },
        include: PLAN_FORM_INCLUDE,
      });
    });
    return this.toResponseDtoWithQuota(updated);
  }

  // ─── Ghi định mức quan hệ thật (Việc 2) ──────────────────────────────────────

  /**
   * 1 PlanForm sở hữu đúng 1 BomRevision (sourcePlanFormId @unique) - tạo lười ở lần ghi
   * định mức đầu tiên. Bắt lỗi P2002 (đua race 2 request ghi gần như đồng thời) và fetch lại
   * thay vì để lỗi 409 giả lộ ra ngoài. Nếu revision đã có nhưng KHÔNG còn DRAFT (đã
   * ACTIVE/RETIRED - PlanForm đã qua duyệt cuối), từ chối sửa tiếp thay vì âm thầm mutate
   * lịch sử đã chốt.
   */
  private async resolveDraftBomRevision(pf: PlanFormWithRefs): Promise<{ id: bigint }> {
    const existing = await this.prisma.bomRevision.findFirst({
      where: { sourcePlanFormId: pf.id },
    });
    if (existing) {
      if (existing.status !== BomRevisionStatus.DRAFT) {
        throw new ConflictException(
          `Plan form ${pf.id} đã có BomRevision ở trạng thái ${existing.status} - không thể sửa định mức sau khi đã duyệt`,
        );
      }
      return existing;
    }

    try {
      const created = await this.bomRevisionsService.create(
        pf.mfgProductId.toString(),
        pf.id.toString(),
      );
      return { id: parseBigIntId(created.id) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.prisma.bomRevision.findFirst({
          where: { sourcePlanFormId: pf.id },
        });
        if (raced) {
          if (raced.status !== BomRevisionStatus.DRAFT) {
            throw new ConflictException(
              `Plan form ${pf.id} đã có BomRevision ở trạng thái ${raced.status} - không thể sửa định mức sau khi đã duyệt`,
            );
          }
          return raced;
        }
      }
      throw e;
    }
  }

  /** Batch resolve-or-create Piece theo tên (không phân biệt hoa/thường) trong phạm vi 1 sản
   *  phẩm - 1 findMany cho toàn bộ `names` thay vì 1 findFirst + vòng lặp findUnique mỗi tên
   *  (bản cũ, nguồn round-trip chính gây timeout transaction khi nhập nhiều mảnh cùng lúc).
   *  Vẫn `create` riêng từng piece MỚI (không createMany) để giữ đúng audit log CREATE trên
   *  Piece (Piece nằm trong AUDITED_MODELS, createMany không đi qua extension). Trả về map
   *  tên đã chuẩn hoá (trim + lowercase) -> pieceId. */
  private async resolveOrCreatePieces(
    tx: PrismaTx,
    mfgProductId: bigint,
    names: string[],
  ): Promise<Map<string, bigint>> {
    const existing = await tx.piece.findMany({ where: { mfgProductId } });
    const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p.id]));
    const codes = new Set(existing.map((p) => p.code));

    const result = new Map<string, bigint>();
    for (const rawName of names) {
      const trimmed = rawName.trim();
      const key = trimmed.toLowerCase();
      if (result.has(key)) continue;

      const existingId = byName.get(key);
      if (existingId !== undefined) {
        result.set(key, existingId);
        continue;
      }

      const base = this.slugify(trimmed) || 'MANH';
      let code = base;
      let suffix = 1;
      while (codes.has(code)) {
        suffix += 1;
        code = `${base}-${suffix}`;
      }
      codes.add(code);

      const piece = await tx.piece.create({
        data: { mfgProductId, code, name: trimmed, groupNumber: 1 },
      });
      result.set(key, piece.id);
    }
    return result;
  }

  /** Batch fetch Material theo id, ném NotFoundException (dùng `display` gốc từ DTO trong
   *  message) nếu thiếu id nào - 1 findMany thay vì 1 findUnique mỗi material, dùng chung cho
   *  replacePieces/replaceConsumableLines/replaceAccessoryItems. */
  private async fetchMaterialsOrThrow(
    tx: PrismaTx,
    refs: { display: string; id: bigint }[],
  ): Promise<
    Map<
      string,
      {
        id: bigint;
        code: string;
        materialGroupId: bigint | null;
        detailKind: MaterialDetailKind | null;
      }
    >
  > {
    const uniqueIds = [...new Map(refs.map((r) => [r.id.toString(), r.id])).values()];
    const materials = uniqueIds.length
      ? await tx.material.findMany({ where: { id: { in: uniqueIds } } })
      : [];
    const byId = new Map(materials.map((m) => [m.id.toString(), m]));
    for (const ref of refs) {
      if (!byId.has(ref.id.toString())) {
        throw new NotFoundException(`Material ${ref.display} not found`);
      }
    }
    return byId;
  }

  private slugify(value: string): string {
    return (
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 36) || 'MANH'
    );
  }

  /** resolve-or-create SegmentSpec theo (materialId, cutLengthMm) - material phải thuộc
   *  nhóm vật tư Sắt (steelGroupId, xem resolveSystemGroupId). Nhận `material` đã fetch sẵn
   *  (xem fetchMaterialsOrThrow) thay vì tự findUnique - tránh N round-trip khi có nhiều segment. */
  private async resolveOrCreateSegmentSpec(
    tx: PrismaTx,
    material: { id: bigint; code: string; materialGroupId: bigint | null },
    cutLengthMm: number,
    steelGroupId: bigint,
  ): Promise<{ id: bigint }> {
    await this.assertOrAssignMaterialGroup(tx, material, steelGroupId, 'Sắt');
    return tx.segmentSpec.upsert({
      where: { materialId_cutLengthMm: { materialId: material.id, cutLengthMm } },
      create: { materialId: material.id, cutLengthMm },
      update: {},
    });
  }

  /** Id của 1 nhóm vật tư hệ thống (seed sẵn ở prisma/seed.ts - xem
   *  material-group-system-keys.constant.ts). KHÔNG tự tạo nếu thiếu như
   *  resolveMaterialGroupId cũ (đã xoá) - thiếu nghĩa là deploy hỏng/chưa chạy seed, không
   *  phải "lần dùng đầu tiên". */
  private async resolveSystemGroupId(
    tx: PrismaTx,
    systemKey: MaterialGroupSystemKey,
  ): Promise<bigint> {
    const group = await tx.materialGroup.findUnique({ where: { systemKey } });
    if (!group) {
      throw new InternalServerErrorException(
        `Nhóm vật tư hệ thống "${systemKey}" chưa được seed - chạy "npm run seed" ở BE`,
      );
    }
    return group.id;
  }

  /** Sơn/Phụ kiện/Bao bì dùng chung nhóm vật tư OTHER nên materialGroupId không còn phân biệt
   *  được material nào dành cho mục đích nào - material.detailKind (gán ở Admin > Vật tư,
   *  xem MaterialsService.resolveDetailKind) đảm nhận việc đó. Không tự gán như
   *  assertOrAssignMaterialGroup (detailKind là lựa chọn nghiệp vụ của admin, không có "lần
   *  dùng đầu tiên" nào hợp lý để suy luận) - thiếu hoặc sai thì từ chối rõ ràng. */
  private assertMaterialDetailKind(
    material: { code: string; detailKind: MaterialDetailKind | null },
    expected: MaterialDetailKind,
    groupLabel: string,
  ): void {
    if (material.detailKind !== expected) {
      throw new BadRequestException(
        `Material "${material.code}" chưa được phân loại đúng cho ${groupLabel} - vào Admin > Vật tư gán Phân loại = ${groupLabel} cho vật tư này trước`,
      );
    }
  }

  /** Vật tư chưa thuộc nhóm nào -> tự gán vào nhóm đang nhập (lần dùng đầu tiên); đã thuộc
   *  nhóm khác -> từ chối (1 vật tư không thể vừa là Dây vừa là Đinh, vừa Sắt vừa Sơn...). */
  private async assertOrAssignMaterialGroup(
    tx: PrismaTx,
    material: { id: bigint; code: string; materialGroupId: bigint | null },
    materialGroupId: bigint,
    groupLabel: string,
  ): Promise<void> {
    if (material.materialGroupId == null) {
      await tx.material.update({ where: { id: material.id }, data: { materialGroupId } });
    } else if (material.materialGroupId !== materialGroupId) {
      throw new BadRequestException(
        `Material "${material.code}" đã thuộc nhóm vật tư khác - không thể dùng cho nhóm ${groupLabel} này`,
      );
    }
  }

  /** Id nhóm vật tư hệ thống ứng với 1 `PieceMaterialLineDto.group` (WIRE/NAIL/RIVET/PLASTIC_BUTTON). */
  private async resolvePieceMaterialLineGroupId(
    tx: PrismaTx,
    group: QuotaPieceMaterialLineDto['group'],
  ): Promise<bigint> {
    const systemKey = MATERIAL_GROUP_SYSTEM_KEYS[group];
    return this.resolveSystemGroupId(tx, systemKey);
  }

  /**
   * Thay toàn bộ mảnh + vật tư con (5 nhóm: Sắt/Dây/Đinh/Tán rút/Nút nhựa) trên revision
   * (xoá hết rồi tạo lại theo đúng `pieces` gửi lên) - full-replace, đúng UX "gửi lại là ghi
   * đè toàn bộ" hiện tại (không patch từng dòng). bomRevisionId đã xác định duy nhất 1 sản
   * phẩm nên không cần lọc thêm theo mfgProductId khi xoá. Sắt đi qua PieceBom/SegmentSpec
   * (khái niệm "đoạn cắt", cutting-proposals phụ thuộc vào bảng này); 4 nhóm còn lại đi qua
   * PieceMaterialItem (phẳng, không có khái niệm cắt) - KHÔNG được trộn lẫn 2 bảng này.
   */
  private async replacePieces(
    tx: PrismaTx,
    bomRevisionId: bigint,
    mfgProductId: bigint,
    pieces: QuotaPieceDto[],
  ): Promise<void> {
    const steelGroupId = await this.resolveSystemGroupId(tx, MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR);
    await tx.pieceBom.deleteMany({ where: { bomRevisionId } });
    await tx.pieceMaterialItem.deleteMany({ where: { bomRevisionId } });
    await tx.bomPiece.deleteMany({ where: { bomRevisionId } });

    // Batch trước 2 nguồn round-trip chính (Piece + Material) thay vì query lại cho từng
    // piece/segment/materialLine - đây là phần từng vượt quá timeout mặc định 5s của
    // interactive transaction khi nhập nhiều mảnh cùng lúc.
    const materialRefs: { display: string; id: bigint }[] = [];
    for (const p of pieces) {
      for (const seg of p.segments) {
        materialRefs.push({ display: seg.materialId, id: parseBigIntId(seg.materialId) });
      }
      for (const line of p.materialLines ?? []) {
        materialRefs.push({ display: line.materialId, id: parseBigIntId(line.materialId) });
      }
    }
    const materialsById = await this.fetchMaterialsOrThrow(tx, materialRefs);
    const pieceIds = await this.resolveOrCreatePieces(
      tx,
      mfgProductId,
      pieces.map((p) => p.name),
    );
    const pieceIdOf = (name: string) => pieceIds.get(name.trim().toLowerCase())!;

    const bomPieceRows = pieces.map((p) => ({
      bomRevisionId,
      pieceId: pieceIdOf(p.name),
      qtyPerUnit: p.qtyPerUnit,
      isWoven: this.isPieceWoven(p),
    }));
    if (bomPieceRows.length) {
      await tx.bomPiece.createMany({ data: bomPieceRows });
    }

    const pieceBomRows: {
      bomRevisionId: bigint;
      mfgProductId: bigint;
      pieceId: bigint;
      segmentSpecId: bigint;
      qtyPerPiece: number;
      note: string | null;
    }[] = [];
    const pieceMaterialRows: {
      bomRevisionId: bigint;
      mfgProductId: bigint;
      pieceId: bigint;
      materialId: bigint;
      qtyPerPiece: number;
      note: string | null;
    }[] = [];

    for (const p of pieces) {
      const pieceId = pieceIdOf(p.name);
      for (const seg of p.segments) {
        const material = materialsById.get(parseBigIntId(seg.materialId).toString())!;
        const spec = await this.resolveOrCreateSegmentSpec(
          tx,
          material,
          seg.cutLengthMm,
          steelGroupId,
        );
        pieceBomRows.push({
          bomRevisionId,
          mfgProductId,
          pieceId,
          segmentSpecId: spec.id,
          qtyPerPiece: seg.qtyPerPiece,
          note: seg.note ?? null,
        });
      }
      for (const line of p.materialLines ?? []) {
        const materialId = parseBigIntId(line.materialId);
        const material = materialsById.get(materialId.toString())!;
        const materialGroupId = await this.resolvePieceMaterialLineGroupId(tx, line.group);
        await this.assertOrAssignMaterialGroup(tx, material, materialGroupId, line.group);
        pieceMaterialRows.push({
          bomRevisionId,
          mfgProductId,
          pieceId,
          materialId,
          qtyPerPiece: line.qtyPerPiece,
          note: line.note ?? null,
        });
      }
    }

    if (pieceBomRows.length) {
      await tx.pieceBom.createMany({ data: pieceBomRows });
    }
    if (pieceMaterialRows.length) {
      await tx.pieceMaterialItem.createMany({ data: pieceMaterialRows });
    }

    await this.syncIsWoven(tx, pieces, pieceIdOf);
  }

  /** Mảnh "có đan" = có đủ cả 3 nhóm Dây + Đinh + Nút nhựa trong materialLines (RIVET/Tán rút
   *  không tính - xem trao đổi nghiệp vụ). Nguồn sự thật CHÍNH là snapshot `BomPiece.isWoven`
   *  (ghi theo đúng bomRevisionId ở bomPieceRows trên) - weaving-issues module đọc từ đó, không
   *  đọc field này. */
  private isPieceWoven(p: QuotaPieceDto): boolean {
    const requiredGroups: QuotaPieceMaterialLineDto['group'][] = ['WIRE', 'NAIL', 'PLASTIC_BUTTON'];
    const groups = new Set((p.materialLines ?? []).map((l) => l.group));
    return requiredGroups.every((g) => groups.has(g));
  }

  /** Piece.isWoven là master data dùng chung giữa các revision (KHÔNG dùng để quyết định hiển
   *  thị xuất/nhập đan - xem BomPiece.isWoven) nhưng vẫn đồng bộ lại mỗi lần replacePieces để
   *  không lệch với snapshot mới nhất, phòng khi có consumer khác đọc field này (vd module
   *  products cũ). Chỉ update piece thực sự đổi giá trị để không làm nhiễu AuditLog (Piece nằm
   *  trong AUDITED_MODELS). */
  private async syncIsWoven(
    tx: PrismaTx,
    pieces: QuotaPieceDto[],
    pieceIdOf: (name: string) => bigint,
  ): Promise<void> {
    const desiredById = new Map<bigint, boolean>();
    for (const p of pieces) {
      desiredById.set(pieceIdOf(p.name), this.isPieceWoven(p));
    }
    if (!desiredById.size) return;

    const current = await tx.piece.findMany({
      where: { id: { in: [...desiredById.keys()] } },
      select: { id: true, isWoven: true },
    });
    const toUpdate = current.filter((p) => desiredById.get(p.id) !== p.isWoven);
    await Promise.all(
      toUpdate.map((p) =>
        tx.piece.update({ where: { id: p.id }, data: { isWoven: desiredById.get(p.id)! } }),
      ),
    );
  }

  /**
   * Thay toàn bộ ConsumableBom của 1 nhóm trên revision. `materialGroupId` (Dây/Đinh/Sơn -
   * xem resolveSystemGroupId) quyết định chỉ xoá/ghi đè đúng các dòng thuộc nhóm vật tư đó
   * (không đụng nhóm còn lại cùng stage, vd Dây/Đinh cùng stage=DAN); vật tư chọn vào lần
   * đầu sẽ tự gán vào đúng nhóm (materialGroupId hiện null), lần sau nếu material đã thuộc
   * nhóm khác thì từ chối (tránh 1 material vừa là Dây vừa là Đinh). Gán-nhóm chạy TRƯỚC
   * deleteMany (không phải sau như trước) để dòng gửi lại của vật tư chưa có nhóm không bị
   * xoá sót rồi đụng unique constraint (bomRevisionId, stage, materialId) khi tạo lại.
   * Riêng nhóm OTHER (Sơn) còn kiểm thêm `expectedDetailKind` - xem assertMaterialDetailKind.
   */
  private async replaceConsumableLines(
    tx: PrismaTx,
    bomRevisionId: bigint,
    stage: MfgStage,
    items: QuotaMaterialLineDto[],
    materialGroupId: bigint,
    expectedDetailKind: MaterialDetailKind,
    groupLabel: string,
  ): Promise<void> {
    const materialIds = items.map((it) => parseBigIntId(it.materialId));
    const materialsById = await this.fetchMaterialsOrThrow(
      tx,
      items.map((it, i) => ({ display: it.materialId, id: materialIds[i] })),
    );
    for (const materialId of materialIds) {
      const material = materialsById.get(materialId.toString())!;
      await this.assertOrAssignMaterialGroup(tx, material, materialGroupId, groupLabel);
      this.assertMaterialDetailKind(material, expectedDetailKind, groupLabel);
    }

    await tx.consumableBom.deleteMany({
      where: { bomRevisionId, stage, material: { materialGroupId } },
    });

    if (items.length) {
      await tx.consumableBom.createMany({
        data: items.map((it, i) => ({
          bomRevisionId,
          stage,
          materialId: materialIds[i],
          qtyPerUnit: it.qtyPerUnit,
        })),
      });
    }
  }

  /** Thay toàn bộ BomAccessoryItem của 1 "kind" (Phụ kiện/Bao bì - cột `kind` phân biệt trực
   *  tiếp, KHÔNG còn qua material.materialGroupId vì 2 tab này giờ dùng chung 1 nhóm vật tư
   *  "Vật tư khác"). `materialGroupId` vẫn được gán/kiểm cho material (assertOrAssignMaterialGroup)
   *  để đảm bảo vật tư chọn ở đây thuộc đúng nhóm hệ thống, không lẫn Sắt/Dây/Đinh...
   *  `expectedDetailKind` kiểm thêm material.detailKind khớp đúng Phụ kiện/Bao bì (xem
   *  assertMaterialDetailKind) - đây cũng là thứ chặn 1 material bị gửi vừa làm Phụ kiện vừa
   *  làm Bao bì trong cùng 1 lần nhập, vì detailKind chỉ có thể khớp ĐÚNG 1 trong 2 kind. */
  private async replaceAccessoryItems(
    tx: PrismaTx,
    bomRevisionId: bigint,
    materialGroupId: bigint,
    kind: AccessoryItemKind,
    expectedDetailKind: MaterialDetailKind,
    groupLabel: string,
    items: QuotaMaterialLineDto[],
  ): Promise<void> {
    const materialIds = items.map((it) => parseBigIntId(it.materialId));
    const materialsById = await this.fetchMaterialsOrThrow(
      tx,
      items.map((it, i) => ({ display: it.materialId, id: materialIds[i] })),
    );
    for (const materialId of materialIds) {
      const material = materialsById.get(materialId.toString())!;
      await this.assertOrAssignMaterialGroup(tx, material, materialGroupId, groupLabel);
      this.assertMaterialDetailKind(material, expectedDetailKind, groupLabel);
    }

    await tx.bomAccessoryItem.deleteMany({ where: { bomRevisionId, kind } });

    if (items.length) {
      await tx.bomAccessoryItem.createMany({
        data: items.map((it, i) => ({
          bomRevisionId,
          materialId: materialIds[i],
          kind,
          qtyPerUnit: it.qtyPerUnit,
        })),
      });
    }
  }

  /**
   * Dựng lại manhData/detailQuota từ dữ liệu quan hệ thật cho 1 lô PlanForm - batch (1 query
   * mỗi bảng dòng con trên toàn bộ revisionId liên quan, gom nhóm trong bộ nhớ) để tránh N+1
   * khi `findAll()` liệt kê tới 100 bản ghi/trang (mỗi trang Spec đều quét toàn bộ list).
   * Revision dùng để đọc = revision PlanForm đó sở hữu (sourcePlanFormId, DRAFT khi đang làm/
   * ACTIVE khi đã duyệt xong); PlanForm origin=PRODUCTION_CONFIRM chưa từng nhập gì thì fallback
   * sang BomRevision ACTIVE hiện tại của sản phẩm. PlanForm bình thường CHƯA nhập gì (không sở
   * hữu revision, không phải PRODUCTION_CONFIRM) trả về null - KHÔNG "mượn" dữ liệu của bản
   * khác, tránh hiện sai "đã có dữ liệu" cho 1 PlanForm mới toanh.
   */
  private async reconstructQuotaBatch(
    pfs: PlanFormWithRefs[],
  ): Promise<Map<string, ReconstructedQuota>> {
    const result = new Map<string, ReconstructedQuota>();
    if (pfs.length === 0) return result;

    const ownRevisions = await this.prisma.bomRevision.findMany({
      where: { sourcePlanFormId: { in: pfs.map((p) => p.id) } },
    });
    const ownByPlanFormId = new Map(ownRevisions.map((r) => [r.sourcePlanFormId!.toString(), r]));

    const fallbackCandidates = pfs.filter(
      (p) => !ownByPlanFormId.has(p.id.toString()) && p.origin === 'PRODUCTION_CONFIRM',
    );
    const fallbackProductIds = [...new Set(fallbackCandidates.map((p) => p.mfgProductId))];
    const activeRevisions = fallbackProductIds.length
      ? await this.prisma.bomRevision.findMany({
          where: { mfgProductId: { in: fallbackProductIds }, status: BomRevisionStatus.ACTIVE },
        })
      : [];
    const activeByProductId = new Map(activeRevisions.map((r) => [r.mfgProductId.toString(), r]));

    const revisionByPlanFormId = new Map<string, { id: bigint } | undefined>();
    for (const pf of pfs) {
      const own = ownByPlanFormId.get(pf.id.toString());
      if (own) {
        revisionByPlanFormId.set(pf.id.toString(), own);
      } else if (pf.origin === 'PRODUCTION_CONFIRM') {
        revisionByPlanFormId.set(
          pf.id.toString(),
          activeByProductId.get(pf.mfgProductId.toString()),
        );
      } else {
        revisionByPlanFormId.set(pf.id.toString(), undefined);
      }
    }

    const revisionIds = [
      ...new Set(
        [...revisionByPlanFormId.values()].filter((r): r is { id: bigint } => !!r).map((r) => r.id),
      ),
    ];
    if (revisionIds.length === 0) {
      for (const pf of pfs) result.set(pf.id.toString(), { manhData: null, detailQuota: null });
      return result;
    }

    const [systemGroups, bomPieces, pieceBoms, pieceMaterialItems, consumableBoms, accessoryItems] =
      await Promise.all([
        this.prisma.materialGroup.findMany({
          where: { systemKey: { in: Object.values(MATERIAL_GROUP_SYSTEM_KEYS) } },
        }),
        this.prisma.bomPiece.findMany({
          where: { bomRevisionId: { in: revisionIds } },
          include: { piece: true },
        }),
        this.prisma.pieceBom.findMany({
          where: { bomRevisionId: { in: revisionIds } },
          include: { segmentSpec: { include: { material: true } } },
        }),
        this.prisma.pieceMaterialItem.findMany({
          where: { bomRevisionId: { in: revisionIds } },
          include: { material: true },
        }),
        this.prisma.consumableBom.findMany({
          where: { bomRevisionId: { in: revisionIds } },
          include: { material: true },
        }),
        this.prisma.bomAccessoryItem.findMany({
          where: { bomRevisionId: { in: revisionIds } },
          include: { material: true },
        }),
      ]);

    const bomPiecesByRev = groupBy(bomPieces, (r) => r.bomRevisionId.toString());
    const pieceBomsByRevPiece = new Map<string, typeof pieceBoms>();
    for (const row of pieceBoms) {
      const key = `${row.bomRevisionId}:${row.pieceId}`;
      const arr = pieceBomsByRevPiece.get(key);
      if (arr) arr.push(row);
      else pieceBomsByRevPiece.set(key, [row]);
    }
    const pieceMaterialItemsByRevPiece = new Map<string, typeof pieceMaterialItems>();
    for (const row of pieceMaterialItems) {
      const key = `${row.bomRevisionId}:${row.pieceId}`;
      const arr = pieceMaterialItemsByRevPiece.get(key);
      if (arr) arr.push(row);
      else pieceMaterialItemsByRevPiece.set(key, [row]);
    }
    const consumableByRev = groupBy(consumableBoms, (r) => r.bomRevisionId.toString());
    const accessoryByRev = groupBy(accessoryItems, (r) => r.bomRevisionId.toString());
    // Đọc lại không throw khi thiếu nhóm (khác đường ghi qua resolveSystemGroupId) - thiếu
    // thì filter dưới đây rỗng, trang vẫn hiển thị được (không vỡ) thay vì 500 cả danh sách.
    const groupIdByKey = new Map(systemGroups.map((g) => [g.systemKey!, g.id]));

    const toMaterialLine = (r: (typeof consumableBoms)[number]) => ({
      id: Number(r.id),
      materialId: r.materialId.toString(),
      materialCode: r.material.code,
      materialName: r.material.name,
      materialSpec: r.material.spec,
      materialUnit: r.material.unit,
      qtyPerUnit: r.qtyPerUnit.toNumber(),
    });
    const toAccessoryLine = (r: (typeof accessoryItems)[number]) => ({
      id: Number(r.id),
      materialId: r.materialId.toString(),
      materialCode: r.material.code,
      materialName: r.material.name,
      materialSpec: r.material.spec,
      materialUnit: r.material.unit,
      qtyPerUnit: r.qtyPerUnit.toNumber(),
    });
    const toPieceMaterialLine = (r: (typeof pieceMaterialItems)[number]) => ({
      id: Number(r.id),
      materialId: r.materialId.toString(),
      materialCode: r.material.code,
      materialName: r.material.name,
      materialSpec: r.material.spec,
      materialUnit: r.material.unit,
      qtyPerPiece: r.qtyPerPiece.toNumber(),
      note: r.note,
    });

    for (const pf of pfs) {
      const revision = revisionByPlanFormId.get(pf.id.toString());
      if (!revision) {
        result.set(pf.id.toString(), { manhData: null, detailQuota: null });
        continue;
      }
      const revKey = revision.id.toString();

      const wireGroupId = groupIdByKey.get(MATERIAL_GROUP_SYSTEM_KEYS.WIRE);
      const nailGroupId = groupIdByKey.get(MATERIAL_GROUP_SYSTEM_KEYS.NAIL);
      const rivetGroupId = groupIdByKey.get(MATERIAL_GROUP_SYSTEM_KEYS.RIVET);
      const plasticButtonGroupId = groupIdByKey.get(MATERIAL_GROUP_SYSTEM_KEYS.PLASTIC_BUTTON);

      // Mảnh giờ chứa cả 5 nhóm vật tư: steel (segments, phân cấp đoạn cắt - PieceBom/
      // SegmentSpec) và wire/nail/rivet/plasticButton (phẳng theo mảnh - PieceMaterialItem),
      // mỗi nhóm SCOPE THEO TỪNG PIECE (khác day/dinh cũ vốn phẳng toàn revision).
      const pieces = (bomPiecesByRev.get(revKey) ?? []).map((bp) => {
        const lineItems =
          pieceMaterialItemsByRevPiece.get(`${bp.bomRevisionId}:${bp.pieceId}`) ?? [];
        return {
          id: Number(bp.id),
          pieceId: bp.pieceId.toString(),
          name: bp.piece.name,
          qtyPerUnit: bp.qtyPerUnit,
          steel: (pieceBomsByRevPiece.get(`${bp.bomRevisionId}:${bp.pieceId}`) ?? []).map((sg) => ({
            id: Number(sg.id),
            segmentSpecId: sg.segmentSpecId.toString(),
            materialId: sg.segmentSpec.materialId.toString(),
            materialCode: sg.segmentSpec.material.code,
            materialName: sg.segmentSpec.material.name,
            materialSpec: sg.segmentSpec.material.spec,
            materialUnit: sg.segmentSpec.material.unit,
            cutLengthMm: sg.segmentSpec.cutLengthMm,
            qtyPerPiece: sg.qtyPerPiece,
            note: sg.note,
          })),
          wire: lineItems
            .filter((r) => wireGroupId != null && r.material.materialGroupId === wireGroupId)
            .map(toPieceMaterialLine),
          nail: lineItems
            .filter((r) => nailGroupId != null && r.material.materialGroupId === nailGroupId)
            .map(toPieceMaterialLine),
          rivet: lineItems
            .filter((r) => rivetGroupId != null && r.material.materialGroupId === rivetGroupId)
            .map(toPieceMaterialLine),
          plasticButton: lineItems
            .filter(
              (r) =>
                plasticButtonGroupId != null && r.material.materialGroupId === plasticButtonGroupId,
            )
            .map(toPieceMaterialLine),
        };
      });

      // stage=SON là đủ để nhận diện Sơn - không nhóm vật tư nào khác dùng stage này trên
      // ConsumableBom (xem comment model trong schema.prisma).
      const daySon = (consumableByRev.get(revKey) ?? [])
        .filter((r) => r.stage === MfgStage.SON)
        .map(toMaterialLine);

      const accessoryRows = accessoryByRev.get(revKey) ?? [];
      const vatTuPhuKien = accessoryRows
        .filter((r) => r.kind === AccessoryItemKind.ACCESSORY)
        .map(toAccessoryLine);
      const baoBiDongGoi = accessoryRows
        .filter((r) => r.kind === AccessoryItemKind.PACKAGING)
        .map(toAccessoryLine);

      result.set(pf.id.toString(), {
        manhData: { pieces },
        detailQuota: { daySon, vatTuPhuKien, baoBiDongGoi },
      });
    }

    return result;
  }

  private async toResponseDtoWithQuota(pf: PlanFormWithRefs): Promise<SkuResponseDto> {
    const quotas = await this.reconstructQuotaBatch([pf]);
    return this.toResponseDto(pf, quotas.get(pf.id.toString())!);
  }

  // ─── Shared lookups / guards ──────────────────────────────────────────────

  private async findOneOrThrow(id: string): Promise<PlanFormWithRefs> {
    const bigId = parseBigIntId(id);
    const pf = await this.prisma.planForm.findUnique({
      where: { id: bigId },
      include: PLAN_FORM_INCLUDE,
    });
    if (!pf) {
      throw new NotFoundException(`Plan form ${id} not found`);
    }
    return pf;
  }

  private assertStatus(pf: PlanFormWithRefs, expected: PlanFormStatus): void {
    if (pf.status !== expected) {
      throw new ConflictException(
        `Plan form ${pf.id} phải ở trạng thái ${expected} (đang là ${pf.status})`,
      );
    }
  }

  private isAllApproved(
    reviews: { group: string; status: ReviewDecision | null }[],
    requiredGroups: string[],
  ): boolean {
    const approvedGroups = new Set(
      reviews.filter((r) => r.status === ReviewDecision.APPROVED).map((r) => r.group),
    );
    return requiredGroups.every((g) => approvedGroups.has(g));
  }

  private assertAllApproved(
    reviews: { group: string; status: ReviewDecision | null }[],
    requiredGroups: string[],
    label: string,
  ): void {
    if (!this.isAllApproved(reviews, requiredGroups)) {
      const approvedGroups = new Set(
        reviews.filter((r) => r.status === ReviewDecision.APPROVED).map((r) => r.group),
      );
      const missing = requiredGroups.filter((g) => !approvedGroups.has(g));
      throw new ConflictException(`Chưa duyệt đủ nhóm ${label}: còn thiếu ${missing.join(', ')}`);
    }
  }

  /**
   * "1 SKU (salesOrderId+mfgProductId) chỉ có đúng 1 PI" - tìm PI đã có cho đúng cặp này
   * (qua PlanForm khác cùng cặp), không có thì tạo mới. Mirror resolveProductionInvoice()
   * trong mock (dùng exportOrderId+mfgProduct.factoryCode).
   */
  private async resolveProductionInvoice(
    salesOrderId: bigint,
    mfgProductId: bigint,
  ): Promise<bigint> {
    const existingPf = await this.prisma.planForm.findFirst({
      where: { salesOrderId, mfgProductId, productionInvoiceId: { not: null } },
      select: { productionInvoiceId: true },
    });
    if (existingPf?.productionInvoiceId) {
      return existingPf.productionInvoiceId;
    }

    const salesOrderItem = await this.prisma.salesOrderItem.findFirst({
      where: { salesOrderId, mfgProductId },
    });
    // status bỏ qua - mặc định PLANNING qua @default trong schema (mirror mock: PI mới luôn PLANNING).
    const code = await nextProductionInvoiceCode(this.prisma);
    const pi = await this.prisma.productionInvoice.create({
      data: { code, salesOrderId },
    });
    if (salesOrderItem) {
      await this.prisma.productionInvoiceItem.create({
        data: {
          productionInvoiceId: pi.id,
          mfgProductId,
          quantity: salesOrderItem.totalQty,
          deliveryDeadline: salesOrderItem.deliveryDate,
        },
      });
    }
    return pi.id;
  }

  private toResponseDto(pf: PlanFormWithRefs, quota: ReconstructedQuota): SkuResponseDto {
    return new SkuResponseDto({
      id: pf.id.toString(),
      salesOrderId: pf.salesOrderId?.toString() ?? null,
      mfgProductId: pf.mfgProductId.toString(),
      factoryCode: pf.mfgProduct.factoryCode,
      productName: pf.mfgProduct.name,
      customerName: pf.customerName ?? pf.salesOrder?.customer.name ?? null,
      productionInvoiceId: pf.productionInvoiceId?.toString() ?? null,
      piCode: pf.productionInvoice?.code ?? null,
      status: pf.status,
      note: pf.note,
      origin: pf.origin,
      manhData: quota.manhData,
      detailQuota: quota.detailQuota,
      manhForwardedAt: pf.manhForwardedAt,
      detailForwardedAt: pf.detailForwardedAt,
      bossRejectReason: pf.bossRejectReason,
      createdById: pf.createdById,
      createdAt: pf.createdAt,
      updatedAt: pf.updatedAt,
      manhReviews: pf.manhReviews.map(
        (r) =>
          new SkuManhReviewResponseDto({
            group: r.group,
            status: r.status,
            reason: r.reason,
            enteredBy: r.enteredBy,
            enteredAt: r.enteredAt,
            reviewedAt: r.reviewedAt,
          }),
      ),
      detailReviews: pf.detailReviews.map(
        (r) =>
          new SkuDetailReviewResponseDto({
            group: r.group,
            status: r.status,
            reason: r.reason,
            enteredBy: r.enteredBy,
            enteredAt: r.enteredAt,
            reviewedAt: r.reviewedAt,
          }),
      ),
    });
  }
}
