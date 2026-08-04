import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BomRevisionStatus,
  DetailGroup,
  ManhGroup,
  MaterialKind,
  MfgStage,
  PlanFormStatus,
  Prisma,
  ReviewDecision,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { BomRevisionsService } from '../bom-revisions/bom-revisions.service';
import { CreatePlanFormDto } from './dto/create-plan-form.dto';
import { PlanFormResponseDto } from './dto/plan-form-response.dto';
import {
  PlanFormDetailReviewResponseDto,
  PlanFormManhReviewResponseDto,
} from './dto/plan-form-review-response.dto';
import { QuotaMaterialLineDto, QuotaPieceDto, UpdateQuotaDto } from './dto/update-quota.dto';
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

const MANH_GROUPS: ManhGroup[] = [ManhGroup.SAT, ManhGroup.DAY, ManhGroup.DINH];
const DETAIL_GROUPS: DetailGroup[] = [
  DetailGroup.DAY_SON,
  DetailGroup.VAT_TU_PHU_KIEN,
  DetailGroup.BAO_BI_DONG_GOI,
];

/** Tên 2 MaterialGroup dùng để phân biệt Dây/Đinh - cả 2 cùng stage=DAN + kind=CONSUMABLE
 *  trên ConsumableBom nên không tự phân biệt được qua stage/kind, phải qua materialGroupId. */
const DAY_MATERIAL_GROUP_NAME = 'Dây';
const DINH_MATERIAL_GROUP_NAME = 'Đinh';

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
 * SKU quota-approval pipeline (dịch ngược PlanFormService trong mock FE). 8-status state
 * machine: WAITING_PARTS -> APPROVED_PARTS -> WAITING_DETAIL -> APPROVED_DETAIL ->
 * WAITING_QLSX_APPROVAL -> WAITING_BOSS_APPROVAL -> APPROVED (hoặc rewind về
 * APPROVED_DETAIL qua reject-qlsx/reject-boss). Quy tắc "1 trong 3 nhóm có dữ liệu là đủ
 * để tự chuyển status" và "từ chối chỉ xoá quyết định duyệt, không xoá dữ liệu đã nhập"
 * mirror đúng mock - xem plan file rippling-conjuring-cloud.md mục "Sửa luôn 2 chỗ mock".
 *
 * Việc 2: `manhData`/`detailQuota` KHÔNG còn là nguồn sự thật - dữ liệu định mức thật nằm ở
 * Piece/SegmentSpec/BomRevision (+5 bảng dòng con) quan hệ thật, mỗi PlanForm sở hữu đúng 1
 * BomRevision (tạo lười ở lần ghi định mức đầu tiên, xem resolveDraftBomRevision). 2 cột
 * JSON trên PlanForm được TÁI DỰNG ở tầng đọc (reconstructQuotaBatch) từ dữ liệu quan hệ đó
 * để giữ đúng shape response cũ - cột JSON thật trên DB coi như đã chết, sẽ xoá ở migration
 * theo sau (xem plan). Sếp duyệt cuối (approve()) sẽ activate BomRevision DRAFT thành ACTIVE.
 */
@Injectable()
export class PlanFormsService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly bomRevisionsService: BomRevisionsService,
  ) {}

  async create(dto: CreatePlanFormDto, actorUserId: string): Promise<PlanFormResponseDto> {
    const salesOrderBigId = parseBigIntId(dto.salesOrderId);
    const mfgProductBigId = parseBigIntId(dto.mfgProductId);

    const salesOrder = await this.prisma.salesOrder.findUnique({ where: { id: salesOrderBigId } });
    if (!salesOrder) {
      throw new NotFoundException(`Sales order ${dto.salesOrderId} not found`);
    }
    const product = await this.prisma.mfgProduct.findUnique({ where: { id: mfgProductBigId } });
    if (!product) {
      throw new NotFoundException(`Product ${dto.mfgProductId} not found`);
    }

    const productionInvoiceId = await this.resolveProductionInvoice(
      salesOrderBigId,
      mfgProductBigId,
    );

    const created = await this.prisma.planForm.create({
      data: {
        salesOrderId: salesOrderBigId,
        mfgProductId: mfgProductBigId,
        productionInvoiceId,
        note: dto.note,
        createdById: actorUserId,
      },
      include: PLAN_FORM_INCLUDE,
    });
    return this.toResponseDtoWithQuota(created);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<PlanFormResponseDto>> {
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

  async findOne(id: string): Promise<PlanFormResponseDto> {
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

  // ─── Manh quota (Sắt/Dây/Đinh) ──────────────────────────────────────────────

  async updateManhQuota(
    id: string,
    group: ManhGroup,
    dto: UpdateQuotaDto,
  ): Promise<PlanFormResponseDto> {
    const pf = await this.findOneOrThrow(id);
    const revision = await this.resolveDraftBomRevision(pf);
    const enteredAt = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      if (group === ManhGroup.SAT) {
        if (!dto.pieces) {
          throw new BadRequestException('group=SAT yêu cầu field "pieces"');
        }
        await this.replaceSteelPieces(tx, revision.id, pf.mfgProductId, dto.pieces);
      } else {
        if (!dto.items) {
          throw new BadRequestException(`group=${group} yêu cầu field "items"`);
        }
        const groupName =
          group === ManhGroup.DAY ? DAY_MATERIAL_GROUP_NAME : DINH_MATERIAL_GROUP_NAME;
        const materialGroupId = await this.resolveMaterialGroupId(tx, groupName);
        await this.replaceConsumableLines(
          tx,
          revision.id,
          MfgStage.DAN,
          dto.items,
          [MaterialKind.CONSUMABLE],
          materialGroupId,
        );
      }

      // Nhập lại (kể cả sau khi bị từ chối) coi như đã sửa xong - xoá quyết định duyệt cũ
      // của riêng nhóm này (status/reason/reviewedAt về null), giữ enteredBy/enteredAt mới.
      await tx.planFormManhReview.upsert({
        where: { planFormId_group: { planFormId: pf.id, group } },
        create: { planFormId: pf.id, group, enteredBy: dto.enteredBy, enteredAt },
        update: {
          enteredBy: dto.enteredBy,
          enteredAt,
          status: null,
          reason: null,
          reviewedAt: null,
        },
      });
      return tx.planForm.update({
        where: { id: pf.id },
        data: {
          status:
            pf.status === PlanFormStatus.WAITING_PARTS ? PlanFormStatus.APPROVED_PARTS : pf.status,
        },
        include: PLAN_FORM_INCLUDE,
      });
    });
    return this.toResponseDtoWithQuota(updated);
  }

  async reviewManhQuota(
    id: string,
    group: ManhGroup,
    dto: ReviewQuotaDto,
  ): Promise<PlanFormResponseDto> {
    await this.findOneOrThrow(id);
    const bigId = parseBigIntId(id);
    await this.prisma.planFormManhReview.upsert({
      where: { planFormId_group: { planFormId: bigId, group } },
      create: {
        planFormId: bigId,
        group,
        status: dto.status,
        reason: dto.reason,
        reviewedAt: new Date(),
      },
      update: { status: dto.status, reason: dto.reason, reviewedAt: new Date() },
    });
    return this.findOne(id);
  }

  /** KHSX xác nhận cả 3 nhóm mảnh đã duyệt -> chuyển bộ phận nhập định mức chi tiết. */
  async approveParts(id: string): Promise<PlanFormResponseDto> {
    const pf = await this.findOneOrThrow(id);
    this.assertAllApproved(pf.manhReviews, MANH_GROUPS, 'mảnh (Sắt/Dây/Đinh)');

    const updated = await this.prisma.planForm.update({
      where: { id: pf.id },
      data: { status: PlanFormStatus.WAITING_DETAIL },
      include: PLAN_FORM_INCLUDE,
    });
    return this.toResponseDtoWithQuota(updated);
  }

  // ─── Detail quota (Sơn/Phụ kiện/Bao bì) ─────────────────────────────────────

  async updateDetailQuota(
    id: string,
    group: DetailGroup,
    dto: UpdateQuotaDto,
  ): Promise<PlanFormResponseDto> {
    const pf = await this.findOneOrThrow(id);
    const revision = await this.resolveDraftBomRevision(pf);
    const enteredAt = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      if (!dto.items) {
        throw new BadRequestException(`group=${group} yêu cầu field "items"`);
      }
      if (group === DetailGroup.DAY_SON) {
        await this.replaceConsumableLines(tx, revision.id, MfgStage.SON, dto.items, [
          MaterialKind.PAINT,
        ]);
      } else if (group === DetailGroup.VAT_TU_PHU_KIEN) {
        await this.replaceAccessoryItems(tx, revision.id, MaterialKind.ACCESSORY, dto.items);
      } else {
        await this.replaceAccessoryItems(tx, revision.id, MaterialKind.PACKAGING, dto.items);
      }

      await tx.planFormDetailReview.upsert({
        where: { planFormId_group: { planFormId: pf.id, group } },
        create: { planFormId: pf.id, group, enteredBy: dto.enteredBy, enteredAt },
        update: {
          enteredBy: dto.enteredBy,
          enteredAt,
          status: null,
          reason: null,
          reviewedAt: null,
        },
      });
      return tx.planForm.update({
        where: { id: pf.id },
        data: {
          status:
            pf.status === PlanFormStatus.WAITING_DETAIL
              ? PlanFormStatus.APPROVED_DETAIL
              : pf.status,
        },
        include: PLAN_FORM_INCLUDE,
      });
    });
    return this.toResponseDtoWithQuota(updated);
  }

  async reviewDetailQuota(
    id: string,
    group: DetailGroup,
    dto: ReviewQuotaDto,
  ): Promise<PlanFormResponseDto> {
    await this.findOneOrThrow(id);
    const bigId = parseBigIntId(id);
    await this.prisma.planFormDetailReview.upsert({
      where: { planFormId_group: { planFormId: bigId, group } },
      create: {
        planFormId: bigId,
        group,
        status: dto.status,
        reason: dto.reason,
        reviewedAt: new Date(),
      },
      update: { status: dto.status, reason: dto.reason, reviewedAt: new Date() },
    });
    return this.findOne(id);
  }

  /** KHSX xác nhận cả manh lẫn chi tiết đã duyệt -> gửi QLSX duyệt. */
  async approveDetail(id: string): Promise<PlanFormResponseDto> {
    const pf = await this.findOneOrThrow(id);
    this.assertAllApproved(pf.manhReviews, MANH_GROUPS, 'mảnh (Sắt/Dây/Đinh)');
    this.assertAllApproved(pf.detailReviews, DETAIL_GROUPS, 'chi tiết (Sơn/Phụ kiện/Bao bì)');

    const updated = await this.prisma.planForm.update({
      where: { id: pf.id },
      data: { status: PlanFormStatus.WAITING_QLSX_APPROVAL },
      include: PLAN_FORM_INCLUDE,
    });
    return this.toResponseDtoWithQuota(updated);
  }

  // ─── QLSX ───────────────────────────────────────────────────────────────────

  /** Duyệt cục bộ - không đổi status, chỉ mở khoá nút "Gửi sếp duyệt" (mirror mock). */
  async reviewQlsx(id: string): Promise<PlanFormResponseDto> {
    const pf = await this.findOneOrThrow(id);
    this.assertStatus(pf, PlanFormStatus.WAITING_QLSX_APPROVAL);
    const updated = await this.prisma.planForm.update({
      where: { id: pf.id },
      data: { qlsxReviewedAt: new Date() },
      include: PLAN_FORM_INCLUDE,
    });
    return this.toResponseDtoWithQuota(updated);
  }

  async requestBossApproval(id: string): Promise<PlanFormResponseDto> {
    const pf = await this.findOneOrThrow(id);
    this.assertStatus(pf, PlanFormStatus.WAITING_QLSX_APPROVAL);
    const updated = await this.prisma.planForm.update({
      where: { id: pf.id },
      data: { status: PlanFormStatus.WAITING_BOSS_APPROVAL },
      include: PLAN_FORM_INCLUDE,
    });
    return this.toResponseDtoWithQuota(updated);
  }

  async rejectByQlsx(id: string): Promise<PlanFormResponseDto> {
    const pf = await this.findOneOrThrow(id);
    this.assertStatus(pf, PlanFormStatus.WAITING_QLSX_APPROVAL);
    return this.rewindToDetailReview(pf.id);
  }

  // ─── Sếp (Boss) ─────────────────────────────────────────────────────────────

  /** Duyệt cuối - nếu PlanForm sở hữu 1 BomRevision DRAFT (đã nhập định mức), activate nó
   *  (bản ACTIVE trước đó của cùng SKU tự chuyển RETIRED, xem BomRevisionsService.activate). */
  async approve(id: string): Promise<PlanFormResponseDto> {
    const pf = await this.findOneOrThrow(id);
    this.assertStatus(pf, PlanFormStatus.WAITING_BOSS_APPROVAL);

    const draft = await this.prisma.bomRevision.findFirst({
      where: { sourcePlanFormId: pf.id, status: BomRevisionStatus.DRAFT },
    });
    if (draft) {
      await this.bomRevisionsService.activate(draft.id.toString());
    }

    const updated = await this.prisma.planForm.update({
      where: { id: pf.id },
      data: { status: PlanFormStatus.APPROVED },
      include: PLAN_FORM_INCLUDE,
    });
    return this.toResponseDtoWithQuota(updated);
  }

  async rejectByBoss(id: string): Promise<PlanFormResponseDto> {
    const pf = await this.findOneOrThrow(id);
    this.assertStatus(pf, PlanFormStatus.WAITING_BOSS_APPROVAL);
    return this.rewindToDetailReview(pf.id);
  }

  /**
   * Rewind về APPROVED_DETAIL, xoá SẠCH quyết định duyệt (không đụng dữ liệu định mức đã
   * nhập - BomRevision DRAFT vẫn giữ nguyên nội dung) - KHSX phải duyệt lại từng nhóm nhưng
   * account chuyên trách không phải nhập lại gì, mirror đúng rejectToDetailReview() trong mock.
   */
  private async rewindToDetailReview(id: bigint): Promise<PlanFormResponseDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.planFormManhReview.deleteMany({ where: { planFormId: id } });
      await tx.planFormDetailReview.deleteMany({ where: { planFormId: id } });
      return tx.planForm.update({
        where: { id },
        data: { status: PlanFormStatus.APPROVED_DETAIL, qlsxReviewedAt: null },
        include: PLAN_FORM_INCLUDE,
      });
    });
    return this.toResponseDtoWithQuota(updated);
  }

  // ─── Production-confirm PlanForm (tạo khi Sếp duyệt 1 item PI - xem ProductionInvoicesService) ──

  /**
   * Tìm hoặc tạo PlanForm origin=PRODUCTION_CONFIRM cho đúng (salesOrderId, mfgProductId) của
   * PI item vừa được Sếp duyệt - mirror ensurePlanFormForConfirmedItem() trong mock
   * (LenhSXPage). Không cần seed định mức ở đây nữa: PlanForm này không sở hữu BomRevision
   * riêng, tầng đọc (reconstructQuotaBatch) tự fallback sang BomRevision ACTIVE hiện tại của
   * sản phẩm - luôn phản ánh đúng bản đã THẬT SỰ được Sếp duyệt, không lấy nhầm bản nháp.
   */
  async ensureProductionConfirmPlanForm(
    salesOrderId: bigint,
    mfgProductId: bigint,
    productionInvoiceId: bigint,
    actorUserId: string,
  ): Promise<void> {
    const existing = await this.prisma.planForm.findFirst({
      where: { salesOrderId, mfgProductId, origin: 'PRODUCTION_CONFIRM' },
    });
    if (existing) return;

    await this.prisma.planForm.create({
      data: {
        salesOrderId,
        mfgProductId,
        productionInvoiceId,
        origin: 'PRODUCTION_CONFIRM',
        createdById: actorUserId,
      },
    });
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

  /** resolve-or-create Piece theo tên (không phân biệt hoa/thường) trong phạm vi 1 sản phẩm. */
  private async resolveOrCreatePiece(
    tx: PrismaTx,
    mfgProductId: bigint,
    name: string,
  ): Promise<{ id: bigint }> {
    const trimmed = name.trim();
    const existing = await tx.piece.findFirst({
      where: { mfgProductId, name: { equals: trimmed, mode: 'insensitive' } },
    });
    if (existing) return existing;

    const base = this.slugify(trimmed) || 'MANH';
    let code = base;
    let suffix = 1;

    while (await tx.piece.findUnique({ where: { mfgProductId_code: { mfgProductId, code } } })) {
      suffix += 1;
      code = `${base}-${suffix}`;
    }
    return tx.piece.create({ data: { mfgProductId, code, name: trimmed, groupNumber: 1 } });
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

  /** resolve-or-create SegmentSpec theo (materialId, cutLengthMm) - material phải kind=STEEL_BAR. */
  private async resolveOrCreateSegmentSpec(
    tx: PrismaTx,
    materialId: bigint,
    cutLengthMm: number,
  ): Promise<{ id: bigint }> {
    const material = await tx.material.findUnique({ where: { id: materialId } });
    if (!material) {
      throw new NotFoundException(`Material ${materialId} not found`);
    }
    if (material.kind !== MaterialKind.STEEL_BAR) {
      throw new BadRequestException(
        `Material "${material.code}" phải có kind=STEEL_BAR để tạo đoạn sắt (đang là ${material.kind})`,
      );
    }
    return tx.segmentSpec.upsert({
      where: { materialId_cutLengthMm: { materialId, cutLengthMm } },
      create: { materialId, cutLengthMm },
      update: {},
    });
  }

  /** resolve-or-create 1 MaterialGroup theo tên (dùng cho "Dây"/"Đinh" - xem module comment). */
  private async resolveMaterialGroupId(tx: PrismaTx, name: string): Promise<bigint> {
    const existing = await tx.materialGroup.findUnique({ where: { name } });
    if (existing) return existing.id;
    const created = await tx.materialGroup.create({ data: { name } });
    return created.id;
  }

  /**
   * Thay toàn bộ mảnh + đoạn sắt của nhóm SAT trên revision (xoá hết rồi tạo lại theo đúng
   * `pieces` gửi lên) - full-replace, đúng UX "gửi lại là ghi đè toàn bộ" hiện tại (không
   * patch từng dòng). bomRevisionId đã xác định duy nhất 1 sản phẩm nên không cần lọc thêm
   * theo mfgProductId khi xoá.
   */
  private async replaceSteelPieces(
    tx: PrismaTx,
    bomRevisionId: bigint,
    mfgProductId: bigint,
    pieces: QuotaPieceDto[],
  ): Promise<void> {
    await tx.pieceBom.deleteMany({ where: { bomRevisionId } });
    await tx.bomPiece.deleteMany({ where: { bomRevisionId } });

    for (const p of pieces) {
      const piece = await this.resolveOrCreatePiece(tx, mfgProductId, p.name);
      await tx.bomPiece.create({
        data: { bomRevisionId, pieceId: piece.id, qtyPerUnit: p.qtyPerUnit },
      });
      for (const seg of p.segments) {
        const spec = await this.resolveOrCreateSegmentSpec(
          tx,
          parseBigIntId(seg.materialId),
          seg.cutLengthMm,
        );
        await tx.pieceBom.create({
          data: {
            bomRevisionId,
            mfgProductId,
            pieceId: piece.id,
            segmentSpecId: spec.id,
            qtyPerPiece: seg.qtyPerPiece,
            needsHan: seg.needsHan ?? true,
            needsSon: seg.needsSon ?? true,
          },
        });
      }
    }
  }

  /**
   * Thay toàn bộ ConsumableBom của 1 nhóm trên revision. Khi `materialGroupId` được truyền
   * (nhóm Dây/Đinh - cùng stage=DAN nên không tự phân biệt qua stage được), chỉ xoá/ghi đè
   * đúng các dòng thuộc nhóm vật tư đó (không đụng nhóm còn lại cùng stage); vật tư chọn vào
   * lần đầu sẽ tự gán vào đúng nhóm (materialGroupId hiện null), lần sau nếu material đã
   * thuộc nhóm khác thì từ chối (tránh 1 material vừa là Dây vừa là Đinh).
   */
  private async replaceConsumableLines(
    tx: PrismaTx,
    bomRevisionId: bigint,
    stage: MfgStage,
    items: QuotaMaterialLineDto[],
    allowedKinds: MaterialKind[],
    materialGroupId?: bigint,
  ): Promise<void> {
    await tx.consumableBom.deleteMany({
      where: {
        bomRevisionId,
        stage,
        ...(materialGroupId ? { material: { materialGroupId } } : {}),
      },
    });

    for (const it of items) {
      const materialId = parseBigIntId(it.materialId);
      const material = await tx.material.findUnique({ where: { id: materialId } });
      if (!material) {
        throw new NotFoundException(`Material ${it.materialId} not found`);
      }
      if (!allowedKinds.includes(material.kind)) {
        throw new BadRequestException(
          `Material "${material.code}" phải có kind thuộc [${allowedKinds.join(', ')}] (đang là ${material.kind})`,
        );
      }
      if (materialGroupId) {
        if (material.materialGroupId == null) {
          await tx.material.update({ where: { id: materialId }, data: { materialGroupId } });
        } else if (material.materialGroupId !== materialGroupId) {
          throw new BadRequestException(
            `Material "${material.code}" đã thuộc nhóm vật tư khác - không thể dùng cho nhóm Dây/Đinh này`,
          );
        }
      }
      await tx.consumableBom.create({
        data: { bomRevisionId, stage, materialId, qtyPerUnit: it.qtyPerUnit },
      });
    }
  }

  /** Thay toàn bộ BomAccessoryItem của 1 nhóm (Phụ kiện/Bao bì, phân biệt qua material.kind). */
  private async replaceAccessoryItems(
    tx: PrismaTx,
    bomRevisionId: bigint,
    kind: MaterialKind,
    items: QuotaMaterialLineDto[],
  ): Promise<void> {
    await tx.bomAccessoryItem.deleteMany({ where: { bomRevisionId, material: { kind } } });

    for (const it of items) {
      const materialId = parseBigIntId(it.materialId);
      const material = await tx.material.findUnique({ where: { id: materialId } });
      if (!material) {
        throw new NotFoundException(`Material ${it.materialId} not found`);
      }
      if (material.kind !== kind) {
        throw new BadRequestException(
          `Material "${material.code}" phải có kind=${kind} (đang là ${material.kind})`,
        );
      }
      await tx.bomAccessoryItem.create({
        data: { bomRevisionId, materialId, qtyPerUnit: it.qtyPerUnit },
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

    const [dayGroup, dinhGroup, bomPieces, pieceBoms, consumableBoms, accessoryItems] =
      await Promise.all([
        this.prisma.materialGroup.findUnique({ where: { name: DAY_MATERIAL_GROUP_NAME } }),
        this.prisma.materialGroup.findUnique({ where: { name: DINH_MATERIAL_GROUP_NAME } }),
        this.prisma.bomPiece.findMany({
          where: { bomRevisionId: { in: revisionIds } },
          include: { piece: true },
        }),
        this.prisma.pieceBom.findMany({
          where: { bomRevisionId: { in: revisionIds } },
          include: { segmentSpec: { include: { material: true } } },
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
    const consumableByRev = groupBy(consumableBoms, (r) => r.bomRevisionId.toString());
    const accessoryByRev = groupBy(accessoryItems, (r) => r.bomRevisionId.toString());

    const toMaterialLine = (r: (typeof consumableBoms)[number]) => ({
      id: Number(r.id),
      materialId: r.materialId.toString(),
      materialCode: r.material.code,
      materialName: r.material.name,
      materialUnit: r.material.unit,
      qtyPerUnit: r.qtyPerUnit.toNumber(),
    });
    const toAccessoryLine = (r: (typeof accessoryItems)[number]) => ({
      id: Number(r.id),
      materialId: r.materialId.toString(),
      materialCode: r.material.code,
      materialName: r.material.name,
      materialUnit: r.material.unit,
      qtyPerUnit: r.qtyPerUnit.toNumber(),
    });

    for (const pf of pfs) {
      const revision = revisionByPlanFormId.get(pf.id.toString());
      if (!revision) {
        result.set(pf.id.toString(), { manhData: null, detailQuota: null });
        continue;
      }
      const revKey = revision.id.toString();

      const sat = (bomPiecesByRev.get(revKey) ?? []).map((bp) => ({
        id: Number(bp.id),
        pieceId: bp.pieceId.toString(),
        name: bp.piece.name,
        qtyPerUnit: bp.qtyPerUnit,
        segments: (pieceBomsByRevPiece.get(`${bp.bomRevisionId}:${bp.pieceId}`) ?? []).map(
          (sg) => ({
            id: Number(sg.id),
            segmentSpecId: sg.segmentSpecId.toString(),
            materialId: sg.segmentSpec.materialId.toString(),
            materialCode: sg.segmentSpec.material.code,
            materialName: sg.segmentSpec.material.name,
            cutLengthMm: sg.segmentSpec.cutLengthMm,
            qtyPerPiece: sg.qtyPerPiece,
            needsHan: sg.needsHan,
            needsSon: sg.needsSon,
          }),
        ),
      }));

      const danRows = (consumableByRev.get(revKey) ?? []).filter((r) => r.stage === MfgStage.DAN);
      const day = danRows
        .filter((r) => dayGroup && r.material.materialGroupId === dayGroup.id)
        .map(toMaterialLine);
      const dinh = danRows
        .filter((r) => dinhGroup && r.material.materialGroupId === dinhGroup.id)
        .map(toMaterialLine);

      const daySon = (consumableByRev.get(revKey) ?? [])
        .filter((r) => r.stage === MfgStage.SON)
        .map(toMaterialLine);

      const accessoryRows = accessoryByRev.get(revKey) ?? [];
      const vatTuPhuKien = accessoryRows
        .filter((r) => r.material.kind === MaterialKind.ACCESSORY)
        .map(toAccessoryLine);
      const baoBiDongGoi = accessoryRows
        .filter((r) => r.material.kind === MaterialKind.PACKAGING)
        .map(toAccessoryLine);

      result.set(pf.id.toString(), {
        manhData: { sat, day, dinh },
        detailQuota: { daySon, vatTuPhuKien, baoBiDongGoi },
      });
    }

    return result;
  }

  private async toResponseDtoWithQuota(pf: PlanFormWithRefs): Promise<PlanFormResponseDto> {
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

  private assertAllApproved(
    reviews: { group: string; status: ReviewDecision | null }[],
    requiredGroups: string[],
    label: string,
  ): void {
    const approvedGroups = new Set(
      reviews.filter((r) => r.status === ReviewDecision.APPROVED).map((r) => r.group),
    );
    const missing = requiredGroups.filter((g) => !approvedGroups.has(g));
    if (missing.length > 0) {
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
    const placeholderCode = `PI-TMP-${randomUUID()}`;
    const pi = await this.prisma.productionInvoice.create({
      data: { code: placeholderCode, salesOrderId },
    });
    await this.prisma.productionInvoice.update({
      where: { id: pi.id },
      data: { code: `PI-${pi.id}` },
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

  private toResponseDto(pf: PlanFormWithRefs, quota: ReconstructedQuota): PlanFormResponseDto {
    return new PlanFormResponseDto({
      id: pf.id.toString(),
      salesOrderId: pf.salesOrderId.toString(),
      mfgProductId: pf.mfgProductId.toString(),
      factoryCode: pf.mfgProduct.factoryCode,
      productName: pf.mfgProduct.name,
      customerName: pf.salesOrder.customer.name,
      productionInvoiceId: pf.productionInvoiceId?.toString() ?? null,
      piCode: pf.productionInvoice?.code ?? null,
      status: pf.status,
      note: pf.note,
      origin: pf.origin,
      manhData: quota.manhData,
      detailQuota: quota.detailQuota,
      qlsxReviewedAt: pf.qlsxReviewedAt,
      createdById: pf.createdById,
      createdAt: pf.createdAt,
      updatedAt: pf.updatedAt,
      manhReviews: pf.manhReviews.map(
        (r) =>
          new PlanFormManhReviewResponseDto({
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
          new PlanFormDetailReviewResponseDto({
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
