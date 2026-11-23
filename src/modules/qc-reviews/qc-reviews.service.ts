import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CutBundleStatus,
  MfgStage,
  PieceStepBundleStatus,
  Prisma,
  ProductionBatchStatus,
  StepBundleStatus,
  SteelIssueStatus,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { assertOrderPiHasActiveFloor, assertPiHasActiveFloor, assertOrderNotCancelled } from '../../common/utils/floor-gate.util';
import { processStepLabel } from '../../common/constants/process-steps.constant';

/** Tên loại sắt kèm quy cách (vd 'Sắt vuông 6zem 15') - 1 lệnh có nhiều 'Sắt vuông 6zem' khác quy cách (17/11/2026). */
const materialLabel = (
  m: { name?: string | null; spec?: string | null } | null | undefined,
): string | undefined => [m?.name, m?.spec?.trim()].filter(Boolean).join(' ') || undefined;
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { MaterialYieldRecipeProductionService } from '../material-yield-recipes/material-yield-recipe-production.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SegmentProductionService } from '../segment-stock/segment-production.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { CloudinaryService } from '../uploads/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { queueWorkshopIdOfPi } from '../floor/floor-queue-workshop.util';
import { PaintTransferReminderService } from '../warehouse-transfers/paint-transfer-reminder.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { CreateQcReviewDto } from './dto/create-qc-review.dto';
import { CreateSteelIssueQcReviewDto } from './dto/create-steel-issue-qc-review.dto';
import { ListQcReviewsQueryDto } from './dto/list-qc-reviews-query.dto';
import { QcReviewResponseDto, QcReviewSegmentResponseDto } from './dto/qc-review-response.dto';
import { UpdateQcReviewPhotoDto } from './dto/update-qc-review-photo.dto';

/** 409 khi 2 KCS cùng chấm 1 đợt (P1, 18/11/2026): người thua nhận câu lời thường, không ghi gì. */
const QC_DUPLICATE_MESSAGE = 'Đợt này vừa được KCS khác chấm xong - tải lại trang.';

/** Hạn của transaction chấm (P1): chấm lô mảnh có thể trừ tồn đoạn theo nhiều ô nên cho 20 giây. */
const QC_TX_TIMEOUT_MS = 20_000;

/** Đơn vị trong câu "KCS ghi thiếu": đoạn (Cắt / công đoạn phụ), mảnh (Hàn / Sơn / pat), cái (chân nhôm). */
type ShortUnit = 'đoạn' | 'mảnh' | 'cái';

/** Câu thiếu (P1): chỉ đưa vào tin khi shortQty > 0. */
const buildShortText = (shortQty: number, unit: ShortUnit): string =>
  `KCS ghi thiếu ${shortQty} ${unit} so với số báo (đã trừ, không tính lỗi, không cần làm bù).`;

/** Tuỳ chọn của tin kết quả KCS (P1): `detail` / `todo` chỉ Cắt / công đoạn phụ; `note` chỉ khi chấm đạt mà có thiếu. */
interface QcResultOptions {
  detail?: string;
  todo?: string;
  note?: string;
  /** Xưởng nơi làm (chỉ lô Sơn của lệnh Phước An: sơn ở Phú An) - người nhận lọc theo xưởng này thay vì mã lệnh. */
  workshopId?: string;
}

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
/** P1 (AC29): lỗi / thiếu KCS ghi cho 1 cỡ đoạn, cộng theo cỡ. */
interface SegmentAsked {
  failed: number;
  short: number;
}

/**
 * P1 (AC29, nguyên văn): câu 400 khi lỗi + thiếu của 1 cỡ vượt số đã báo của CHÍNH đợt (đợt cắt / đợt công đoạn phụ).
 * Có thiếu: "Cỡ 441mm: thiếu 5 + lỗi 118 vượt số đã báo trong đợt (120)"; không thiếu: "Cỡ 441mm: lỗi 121 vượt số đã báo trong đợt (120)".
 */
function segmentOverReportedMessage(mm: string, asked: SegmentAsked, reported: number): string {
  const parts =
    asked.short > 0 ? `thiếu ${asked.short} + lỗi ${asked.failed}` : `lỗi ${asked.failed}`;
  return `Cỡ ${mm}mm: ${parts} vượt số đã báo trong đợt (${reported})`;
}

@Injectable()
export class QcReviewsService {
  private readonly logger = new Logger(QcReviewsService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly steelIssuesService: SteelIssuesService,
    private readonly productionBatchesService: ProductionBatchesService,
    private readonly materialYieldRecipeProductionService: MaterialYieldRecipeProductionService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly segmentProductionService: SegmentProductionService,
    private readonly paintReminder: PaintTransferReminderService,
  ) {}

  /** 19/11/2026: lý do lỗi gửi lên không có trong DB -> 400 câu rõ ràng thay vì P2003 (khoá ngoại) ra câu chung.
   *  Gọi trong transaction của từng route chấm KCS, trước mọi lần ghi. */
  private async assertDefectReasonExists(
    tx: Pick<PrismaServiceType, 'defectReason'>,
    defectReasonId: bigint | undefined,
  ): Promise<void> {
    if (defectReasonId === undefined) return;
    const found = await tx.defectReason.findUnique({
      where: { id: defectReasonId },
      select: { id: true },
    });
    if (!found) {
      throw new BadRequestException('Lý do lỗi không tồn tại hoặc đã xoá');
    }
  }

  /** 20/11/2026 (T4-5): có phần không đạt thì bắt buộc chọn nguyên nhân (chuẩn ERP: ghi lỗi phải kèm mã nguyên nhân).
   *  Không đọc DB; chỉ ghi thiếu hoặc đạt hết thì không đòi. Gọi sau khi đã tính tổng lỗi, trước $transaction. */
  private assertDefectReasonForFailed(failedQty: number, defectReasonId: bigint | undefined): void {
    if (failedQty > 0 && defectReasonId === undefined) {
      throw new BadRequestException('Có số lượng không đạt - phải chọn nguyên nhân không đạt');
    }
  }

  /** Phát realtime SAU KHI transaction đã commit (xem RealtimeService). `parentId` (2026-10-17,
   *  xem EntityChangedPayload.parentId) - id của lệnh sản xuất/PI mà bản ghi này thuộc về, để FE lọc
   *  đúng màn chi tiết đang xem (vd core.tsx/VatTuTpDetail.tsx/ChanNhomDetail.tsx). Chỉ 3/6 nhánh
   *  gọi hàm này (reviewProductionBatch/reviewPieceStep/reviewMaterialYieldStep) hiện truyền - 3
   *  nhánh còn lại (review/reviewCutBundle/reviewStepBundle) chưa có màn FE nào cần lọc theo cha nên
   *  chưa nối, không phải thiếu sót. */
  private publishRealtime(
    entityId: bigint | string,
    action: 'QC_RECORDED',
    actorId: string | null,
    parentId?: bigint | string,
  ): void {
    this.realtime.publishEntityChanged({
      entity: 'QC_REVIEW',
      entityId,
      action,
      actorId,
      parentId,
    });
  }

  /** Best-effort NGOÀI transaction - cùng lý do kỹ thuật đã ghi ở nhiều nơi khác (mục 15.2/16.2/
   *  17.2/19.2 changelog notification). */
  private async resolveAwaitingQc(
    entityType: 'CUT_BUNDLE' | 'PRODUCTION_BATCH',
    entityId: bigint,
    type: 'CUT_BUNDLE_TO_KCS' | 'BATCH_TO_KCS',
  ): Promise<void> {
    try {
      await this.notifications.resolve({
        entityType,
        entityId: entityId.toString(),
        types: [type],
      });
    } catch (error) {
      this.logger.error(
        `Failed to resolve ${type} (entity ${entityId}): ${(error as Error).message}`,
      );
    }
  }

  /** `senderRole`: role Phôi cho đợt cắt, Hàn/Sơn cho đợt sản xuất (theo `MfgStage`) - dùng CHUNG
   *  cho cả QC_FAILED lẫn QC_PASSED nên gộp vào 1 hàm duy nhất. */
  private async notifyQcResult(
    piCode: string,
    failedQty: number,
    senderRole: string,
    opts?: QcResultOptions,
  ): Promise<void> {
    try {
      const ws = opts?.workshopId ? { workshopId: opts.workshopId } : {};
      if (failedQty > 0) {
        // note chỉ dành cho QC_PASSED; todo chỉ có ở Cắt / công đoạn phụ (Hàn / Sơn / pat / chân nhôm dùng câu mặc định).
        await this.notifications.emit('QC_FAILED', {
          params: {
            piCode,
            failedQty,
            senderRole,
            ...(opts?.detail ? { detail: opts.detail } : {}),
            ...(opts?.todo ? { todo: opts.todo } : {}),
            ...ws,
          },
        });
      } else {
        await this.notifications.emit('QC_PASSED', {
          params: { piCode, ...ws, ...(opts?.note ? { note: opts.note } : {}) },
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to create QC result notification (PI ${piCode}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * 17/11/2026: nội dung tin QC_FAILED của đợt Phôi (cắt / công đoạn phụ), viết cho QLSX (người nhận thật; công nhân
   * không có hộp thông báo). Gom theo cỡ đoạn; bỏ dòng lỗi 0.
   *
   * P1 (18/11/2026): KCS tự chấm đợt mới nên câu việc không còn "kiểm rồi gửi KCS". Công đoạn phụ tách 2 ý theo số bỏ
   * (`scrap`, nằm trong `qty`): "Bỏ a đoạn" = cắt lại ở máy cắt rồi làm lại các công đoạn trước; "Làm lại b đoạn" = làm
   * lại chính các đoạn đó, không cần cắt. Đợt Cắt bỏ qua `scrap`.
   */
  private buildFailureText(
    step: string,
    materialName: string | null | undefined,
    failedBySize: { mm: string; qty: number; scrap?: number }[],
  ): { detail: string; todo: string } {
    const byMm = new Map<string, { qty: number; scrap: number }>();
    for (const f of failedBySize) {
      if (f.qty <= 0) continue;
      const cur = byMm.get(f.mm) ?? { qty: 0, scrap: 0 };
      cur.qty += f.qty;
      cur.scrap += f.scrap ?? 0;
      byMm.set(f.mm, cur);
    }
    const list = [...byMm].map(([mm, v]) => `${v.qty} đoạn ${mm}mm`).join(', ');
    const label = processStepLabel(step);
    const detail = `${label}${materialName ? ` ${materialName}` : ''}: ${list} lỗi`;
    if (step === 'CAT') {
      return {
        detail,
        todo: `Báo công nhân cắt lại ${list} rồi quét mã máy cắt báo cắt bù; KCS tự chấm đợt mới.`,
      };
    }
    const scrapList = [...byMm]
      .filter(([, v]) => v.scrap > 0)
      .map(([mm, v]) => `${v.scrap} đoạn ${mm}mm`)
      .join(', ');
    const reworkList = [...byMm]
      .filter(([, v]) => v.qty - v.scrap > 0)
      .map(([mm, v]) => `${v.qty - v.scrap} đoạn ${mm}mm`)
      .join(', ');
    const todoParts: string[] = [];
    if (scrapList) {
      todoParts.push(
        `Bỏ ${scrapList}: cắt lại số đoạn đó ở máy cắt, làm lại các công đoạn trước rồi báo ${label} bù.`,
      );
    }
    if (reworkList) {
      todoParts.push(
        `Làm lại ${reworkList}: ${label} lại chính các đoạn đó rồi báo bù (không cần cắt).`,
      );
    }
    return { detail, todo: todoParts.join(' ') };
  }

  /** Gắn câu thiếu (P1) vào tin: có lỗi thì vào `detail`, không lỗi thì vào `note` của QC_PASSED. Không thiếu: giữ nguyên. */
  private withShortText(
    failedQty: number,
    shortQty: number,
    unit: ShortUnit,
    base?: { detail?: string; todo?: string },
    extraNotes: string[] = [],
  ): QcResultOptions {
    if (shortQty <= 0) return { ...base };
    const shortText = buildShortText(shortQty, unit);
    const tail =
      extraNotes.length > 0
        ? ` ${extraNotes.map((n) => (n.endsWith('.') ? n : `${n}.`)).join(' ')}`
        : '';
    if (failedQty <= 0) return { note: `${shortText}${tail}` };
    const detail = base?.detail ? `${base.detail}. ${shortText}` : `${failedQty} lỗi, ${shortText}`;
    return {
      ...base,
      detail,
      ...(base?.todo && tail ? { todo: `${base.todo}${tail}` } : {}),
    };
  }

  /**
   * Xưởng nơi sơn của lô Sơn (lệnh Phước An sơn ở Phú An) để tin KCS đi đúng QLSX. Tra riêng theo productionOrderId vì
   * include của ProductionBatch không có id lệnh. Lỗi chỉ ghi log, trả undefined (tin lọc theo mã lệnh như cũ).
   */
  private async paintWorkshopIdOfOrder(productionOrderId: bigint): Promise<string | undefined> {
    try {
      const order = await this.prisma.productionOrder.findUnique({
        where: { id: productionOrderId },
        select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
      });
      const piId = order?.productionInvoiceItem?.productionInvoiceId;
      if (piId == null) return undefined;
      const ws = await queueWorkshopIdOfPi(this.prisma, MfgStage.SON, piId);
      return ws == null ? undefined : ws.toString();
    } catch (error) {
      this.logger.error(
        `Failed to resolve paint workshop (order ${productionOrderId}): ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  /** Như notifyQcResult nhưng tự đọc mã PI (cần mã PI thật để giới hạn QLSX đúng xưởng). Chạy SAU khi
   *  lượt chấm đã commit nên lỗi đọc mã PI chỉ ghi log và bỏ tin, không làm KCS nhận lỗi. */
  private async notifyQcResultForPi(
    productionInvoiceId: bigint,
    failedQty: number,
    senderRole: string,
    opts?: QcResultOptions,
  ): Promise<void> {
    let piCode: string;
    try {
      const pi = await this.prisma.productionInvoice.findUnique({
        where: { id: productionInvoiceId },
        select: { code: true },
      });
      piCode = pi?.code ?? `#${productionInvoiceId}`;
    } catch (error) {
      this.logger.error(
        `Failed to read PI code for QC result notification (PI ${productionInvoiceId}): ${(error as Error).message}`,
      );
      return;
    }
    await this.notifyQcResult(piCode, failedQty, senderRole, opts);
  }

  private mfgStageToSenderRole(stage: MfgStage): string {
    switch (stage) {
      case MfgStage.PHOI:
        return BUSINESS_ROLES.PHOI_STAFF;
      case MfgStage.HAN:
        return BUSINESS_ROLES.HAN_STAFF;
      case MfgStage.SON:
      default:
        return BUSINESS_ROLES.SON_STAFF;
    }
  }

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
        `Phiếu xuất sắt ${steelIssueId} đang ở trạng thái ${issue.status} - chỉ AWAITING_QC mới duyệt KCS được`,
      );
    }
    await assertPiHasActiveFloor(this.prisma, issue.productionInvoiceId, 'duyệt KCS');
    // X2 (danh sách lỗi 16/11): lô đã có đợt cắt thì AWAITING_QC chỉ là trạng thái TỔNG HỢP từ các đợt
    // (syncIssueStatusFromBundles). Chấm cả lô ở đây thêm 1 lượt lỗi lên đúng các đoạn đã/đang chấm theo
    // đợt (tiến độ Phôi cộng mọi qcReviewSegment theo lô -> lỗi tính 2 lần) và đóng lô QC_PASSED trong
    // khi đợt còn chờ. Route theo lô chỉ còn cho lô cũ chưa có đợt cắt nào (FE không còn gọi từ 05/09).
    const bundleCount = await this.prisma.cutBundle.count({ where: { steelIssueId: issue.id } });
    if (bundleCount > 0) {
      throw new ConflictException(
        `Phiếu xuất sắt ${steelIssueId} đã chia đợt cắt - chấm KCS theo từng đợt cắt, không chấm cả lô`,
      );
    }

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
      // P1 (18/11/2026): DTO hạ failedQty xuống ≥ 0 cho các route mới; route lô cũ giữ luật mỗi dòng ≥ 1 lỗi.
      // shortQty / scrapQty (nếu client gửi) bị bỏ qua, lưu 0.
      if (seg.failedQty < 1) {
        throw new BadRequestException(
          `Cỡ ${spec.cutLengthMm.toString()}mm: số đoạn lỗi phải từ 1 trở lên (bỏ dòng này nếu đạt hết).`,
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
    this.assertDefectReasonForFailed(totalFailed, defectReasonId);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertDefectReasonExists(tx, defectReasonId);
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
        throw new ConflictException(QC_DUPLICATE_MESSAGE);
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
              shortQty: 0,
              scrapQty: 0,
            })),
          },
        },
        include: QC_REVIEW_INCLUDE,
      });
    });

    // Tồn đoạn theo lệnh (13/11/2026): SAU khi KCS đã commit; lỗi chỉ log, không làm hỏng KCS.
    await this.segmentProductionService.recomputeAfterQc(
      issue.productionInvoiceId,
      reviewedById,
      `QC_STEEL_ISSUE:${issue.id}`,
    );

    this.publishRealtime(created.id, 'QC_RECORDED', reviewedById);
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
   *
   * P1 (18/11/2026): mỗi cỡ ghi thêm `shortQty` (thiếu so với số báo, không tính lỗi); lỗi + thiếu ≥ 1 và ≤ số đoạn của
   * cỡ trong đợt. `scrapQty` bị bỏ qua, lưu 0 (đoạn Cắt lỗi luôn phải cắt lại). Có thiếu thì SAU commit đọc
   * `stepOveruseAfterCutShortage` để trả `notes[]` (công đoạn phụ đã dùng vượt số đoạn cắt thực có).
   */
  async reviewCutBundle(
    cutBundleId: string,
    dto: CreateSteelIssueQcReviewDto,
    reviewedById: string,
  ): Promise<QcReviewResponseDto> {
    const bundleBigId = parseBigIntId(cutBundleId);
    const bundle = await this.prisma.cutBundle.findUnique({
      where: { id: bundleBigId },
      include: { steelIssue: { include: { material: true } } },
    });
    if (!bundle) {
      throw new NotFoundException(`Không tìm thấy đợt cắt ${cutBundleId}`);
    }
    if (bundle.status === CutBundleStatus.QC_PASSED) {
      throw new ConflictException(QC_DUPLICATE_MESSAGE);
    }
    if (bundle.status !== CutBundleStatus.AWAITING_QC) {
      throw new ConflictException(
        `Đợt cắt ${cutBundleId} đang ở trạng thái ${bundle.status} - chỉ đợt chờ KCS mới duyệt được`,
      );
    }
    await assertPiHasActiveFloor(this.prisma, bundle.steelIssue.productionInvoiceId, 'duyệt KCS');
    if (bundle.productionOrderId != null) {
      await assertOrderNotCancelled(this.prisma, bundle.productionOrderId, 'duyệt KCS');
    }

    const specIds = dto.segments.map((s) => parseBigIntId(s.segmentSpecId));
    const specs = await this.prisma.segmentSpec.findMany({ where: { id: { in: specIds } } });
    const specById = new Map(specs.map((sp) => [sp.id.toString(), sp]));

    let totalFailed = 0;
    let totalShort = 0;
    const failedBySize: { mm: string; qty: number }[] = [];
    for (const seg of dto.segments) {
      const spec = specById.get(parseBigIntId(seg.segmentSpecId).toString());
      if (!spec) {
        throw new NotFoundException(`Cỡ đoạn ${seg.segmentSpecId} không tồn tại`);
      }
      const shortQty = seg.shortQty ?? 0;
      failedBySize.push({ mm: spec.cutLengthMm.toString(), qty: seg.failedQty });
      if (spec.materialId !== bundle.steelIssue.materialId) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm không thuộc loại sắt của đợt cắt này`,
        );
      }
      if (seg.failedQty + shortQty < 1) {
        throw new BadRequestException(
          `Cỡ ${spec.cutLengthMm.toString()}mm: ghi số lỗi hoặc số thiếu (ít nhất 1), hoặc bỏ dòng này nếu đạt hết.`,
        );
      }
      totalFailed += seg.failedQty;
      totalShort += shortQty;
    }

    const defectReasonId = dto.defectReasonId ? parseBigIntId(dto.defectReasonId) : undefined;
    this.assertDefectReasonForFailed(totalFailed, defectReasonId);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertDefectReasonExists(tx, defectReasonId);
      // Đính chính audit độc lập 09/09 (Nghiêm trọng #5) - cùng lý do/cùng fix review() ở trên.
      const { count } = await tx.cutBundle.updateMany({
        where: { id: bundle.id, status: CutBundleStatus.AWAITING_QC },
        data: { status: CutBundleStatus.QC_PASSED },
      });
      if (count === 0) {
        throw new ConflictException(QC_DUPLICATE_MESSAGE);
      }
      // X1 16/11 (phần sót): đọc số đã cắt SAU khi đã giữ dòng đợt (updateMany trên khoá dòng tới hết transaction) - trước đây
      // đọc ngoài transaction. Hiện chưa có đường nào đổi số đoạn của đợt đã chờ KCS (báo cắt / hủy / hoàn tác đều đòi
      // CUTTING + FOR UPDATE), nên đây là chốt phòng thủ: không để chặn "chấm lỗi vượt số đã cắt" dựa vào luật ở module khác.
      const cutInThisBundle = await tx.cutPatternSegment.groupBy({
        by: ['segmentSpecId'],
        where: { cutBundleId: bundle.id },
        _sum: { qty: true },
      });
      const doneBySpec = new Map(
        cutInThisBundle.map((r) => [r.segmentSpecId.toString(), r._sum.qty ?? 0]),
      );
      // P1: gộp theo cỡ (client gửi trùng cỡ thì cộng lại) rồi so lỗi + thiếu với số đoạn của cỡ trong đợt.
      const askedBySpec = new Map<string, SegmentAsked>();
      for (const seg of dto.segments) {
        const key = parseBigIntId(seg.segmentSpecId).toString();
        const cur = askedBySpec.get(key) ?? { failed: 0, short: 0 };
        askedBySpec.set(key, {
          failed: cur.failed + seg.failedQty,
          short: cur.short + (seg.shortQty ?? 0),
        });
      }
      for (const [key, asked] of askedBySpec) {
        const spec = specById.get(key)!;
        const doneQty = doneBySpec.get(key) ?? 0;
        if (asked.failed + asked.short > doneQty) {
          throw new BadRequestException(
            segmentOverReportedMessage(spec.cutLengthMm.toString(), asked, doneQty),
          );
        }
      }

      return tx.qcReview.create({
        data: {
          steelIssueId: bundle.steelIssueId,
          cutBundleId: bundle.id,
          failedQty: totalFailed,
          shortQty: totalShort,
          defectReasonId,
          reason: dto.reason,
          photoUrl: dto.photoUrl,
          reviewedById,
          segments: {
            create: dto.segments.map((seg) => ({
              segmentSpecId: parseBigIntId(seg.segmentSpecId),
              failedQty: seg.failedQty,
              shortQty: seg.shortQty ?? 0,
              scrapQty: 0,
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

    await this.resolveAwaitingQc('CUT_BUNDLE', bundle.id, 'CUT_BUNDLE_TO_KCS');
    // P1: có thiếu thì SAU commit mới thấy số đoạn cắt thực có mới; lỗi đọc chỉ ghi log, không làm hỏng lượt chấm.
    const notes =
      totalShort > 0
        ? await this.buildCutShortNotes(
            bundle.steelIssue.productionInvoiceId,
            bundle.steelIssue.materialId,
            bundle.productionOrderId ?? null,
            dto.segments.filter((seg) => (seg.shortQty ?? 0) > 0),
          )
        : [];
    const invoice = await this.prisma.productionInvoice.findUnique({
      where: { id: bundle.steelIssue.productionInvoiceId },
      select: { code: true },
    });
    await this.notifyQcResult(
      invoice?.code ?? `#${bundle.steelIssue.productionInvoiceId}`,
      totalFailed,
      BUSINESS_ROLES.PHOI_STAFF,
      this.withShortText(
        totalFailed,
        totalShort,
        'đoạn',
        totalFailed > 0
          ? this.buildFailureText('CAT', materialLabel(bundle.steelIssue.material), failedBySize)
          : undefined,
        notes,
      ),
    );

    await this.segmentProductionService.recomputeAfterQc(
      bundle.steelIssue.productionInvoiceId,
      reviewedById,
      `QC_CUT_BUNDLE:${bundle.id}`,
    );

    this.publishRealtime(cutBundleId, 'QC_RECORDED', reviewedById);
    return this.toResponseDto(created, notes);
  }

  /**
   * P1: câu cảnh báo sau khi chấm Cắt có thiếu - công đoạn phụ nào của cỡ nào đã báo nhiều hơn số đoạn cắt thực có.
   * Chỉ đọc, best-effort (lỗi chỉ ghi log, trả []).
   */
  private async buildCutShortNotes(
    productionInvoiceId: bigint,
    materialId: bigint,
    productionOrderId: bigint | null,
    shortSegments: { segmentSpecId: string }[],
  ): Promise<string[]> {
    try {
      const specIds = [...new Set(shortSegments.map((s) => parseBigIntId(s.segmentSpecId)))];
      const over: {
        step: string;
        cutLengthMm: number;
        overBy: number;
        /** Số đoạn cắt thực có (chưa có trong chữ ký hiện tại của BE-2 - xem openQuestions). */
        cutCap?: number;
      }[] = await this.steelIssuesService.stepOveruseAfterCutShortage(
        productionInvoiceId,
        materialId,
        productionOrderId,
        specIds,
      );
      return over.map((o) => {
        const label = processStepLabel(o.step);
        // Chốt 19/11 (QA nghiệm thu AC34): ghi cả số đoạn cắt thực có (trong ngoặc) lẫn số đoạn vượt, để KCS không đọc nhầm
        // "vượt 39 đoạn" khi chỉ vượt 2: "Uốn cỡ 355mm đã báo nhiều hơn số đoạn cắt thực có (39) 2 đoạn - …".
        const have = o.cutCap != null ? ` (${o.cutCap})` : '';
        return (
          `${label} cỡ ${o.cutLengthMm}mm đã báo nhiều hơn số đoạn cắt thực có${have} ${o.overBy} đoạn - ` +
          `${label} sẽ bị chặn tới khi cắt thêm hoặc KCS ${label} ghi thiếu`
        );
      });
    } catch (error) {
      this.logger.error(
        `Failed to build cut-shortage notes (PI ${productionInvoiceId}): ${(error as Error).message}`,
      );
      return [];
    }
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
   *
   * P1 (18/11/2026): mỗi cỡ ghi lỗi / thiếu (lỗi + thiếu ≥ 1 và ≤ số đã báo của cỡ trong đợt). Cỡ có lỗi thì BẮT BUỘC
   * chọn `scrapQty` (0 ≤ bỏ ≤ lỗi): bỏ = cắt lại, phần còn lại của lỗi = làm lại.
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
      throw new NotFoundException(`Không tìm thấy đợt gửi KCS ${stepBundleId}`);
    }
    if (bundle.status === StepBundleStatus.QC_PASSED) {
      throw new ConflictException(QC_DUPLICATE_MESSAGE);
    }
    if (bundle.status !== StepBundleStatus.AWAITING_QC) {
      throw new ConflictException(
        `Đợt gửi KCS ${stepBundleId} đang ở trạng thái ${String(bundle.status)} - chỉ đợt chờ KCS mới duyệt được`,
      );
    }
    await assertPiHasActiveFloor(this.prisma, bundle.productionInvoiceId, 'duyệt KCS');
    if (bundle.productionOrderId != null) {
      await assertOrderNotCancelled(this.prisma, bundle.productionOrderId, 'duyệt KCS');
    }

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
    let totalShort = 0;
    const failedBySize: { mm: string; qty: number; scrap: number }[] = [];
    const askedBySpec = new Map<string, SegmentAsked>();
    for (const seg of dto.segments) {
      const spec = specById.get(parseBigIntId(seg.segmentSpecId).toString());
      if (!spec) {
        throw new NotFoundException(`Cỡ đoạn ${seg.segmentSpecId} không tồn tại`);
      }
      const mm = spec.cutLengthMm.toString();
      const shortQty = seg.shortQty ?? 0;
      if (spec.materialId !== bundle.materialId) {
        throw new BadRequestException(`Cỡ đoạn ${mm}mm không thuộc loại sắt của đợt gửi KCS này`);
      }
      if (seg.failedQty + shortQty < 1) {
        throw new BadRequestException(
          `Cỡ ${mm}mm: ghi số lỗi hoặc số thiếu (ít nhất 1), hoặc bỏ dòng này nếu đạt hết.`,
        );
      }
      if (seg.failedQty > 0 && seg.scrapQty == null) {
        throw new BadRequestException(
          `Cỡ ${mm}mm: chọn số đoạn lỗi phải bỏ (cắt lại), 0 nếu chỉ làm lại. Màn chấm chưa có ô này thì tải lại trang.`,
        );
      }
      const scrapQty = seg.failedQty > 0 ? (seg.scrapQty ?? 0) : 0;
      if ((seg.scrapQty ?? 0) > seg.failedQty) {
        throw new BadRequestException(
          `Cỡ ${mm}mm: số bỏ (${seg.scrapQty}) lớn hơn số lỗi (${seg.failedQty}).`,
        );
      }
      failedBySize.push({ mm, qty: seg.failedQty, scrap: scrapQty });
      const key = spec.id.toString();
      const cur = askedBySpec.get(key) ?? { failed: 0, short: 0 };
      askedBySpec.set(key, { failed: cur.failed + seg.failedQty, short: cur.short + shortQty });
      totalFailed += seg.failedQty;
      totalShort += shortQty;
    }
    for (const [key, asked] of askedBySpec) {
      const spec = specById.get(key)!;
      const doneQty = doneBySpec.get(key) ?? 0;
      if (asked.failed + asked.short > doneQty) {
        throw new BadRequestException(
          segmentOverReportedMessage(spec.cutLengthMm.toString(), asked, doneQty),
        );
      }
    }

    const defectReasonId = dto.defectReasonId ? parseBigIntId(dto.defectReasonId) : undefined;
    this.assertDefectReasonForFailed(totalFailed, defectReasonId);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertDefectReasonExists(tx, defectReasonId);
      // Đính chính audit độc lập 09/09 (Nghiêm trọng #5) - cùng lý do/cùng fix review() ở trên.
      const { count } = await tx.stepBundle.updateMany({
        where: { id: bundle.id, status: StepBundleStatus.AWAITING_QC },
        data: { status: StepBundleStatus.QC_PASSED },
      });
      if (count === 0) {
        throw new ConflictException(QC_DUPLICATE_MESSAGE);
      }

      return tx.qcReview.create({
        data: {
          stepBundleId: bundle.id,
          failedQty: totalFailed,
          shortQty: totalShort,
          defectReasonId,
          reason: dto.reason,
          photoUrl: dto.photoUrl,
          reviewedById,
          segments: {
            create: dto.segments.map((seg) => ({
              segmentSpecId: parseBigIntId(seg.segmentSpecId),
              failedQty: seg.failedQty,
              shortQty: seg.shortQty ?? 0,
              scrapQty: seg.failedQty > 0 ? (seg.scrapQty ?? 0) : 0,
            })),
          },
        },
        include: QC_REVIEW_INCLUDE,
      });
    });

    await this.segmentProductionService.recomputeAfterQc(
      bundle.productionInvoiceId,
      reviewedById,
      `QC_STEP_BUNDLE:${bundle.id}`,
    );

    // Sau khi transaction commit - best-effort (lỗi chỉ ghi log).
    await this.notifyQcResultForPi(
      bundle.productionInvoiceId,
      totalFailed,
      BUSINESS_ROLES.PHOI_STAFF,
      this.withShortText(
        totalFailed,
        totalShort,
        'đoạn',
        totalFailed > 0
          ? this.buildFailureText(bundle.step, materialLabel(bundle.material), failedBySize)
          : undefined,
      ),
    );

    this.publishRealtime(stepBundleId, 'QC_RECORDED', reviewedById);
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
   *
   * P1 (18/11/2026): KCS ghi thêm `shortQty` (thiếu so với số báo; đã trừ, không tính lỗi, không làm bù). Việc TRỪ ĐOẠN dời
   * từ lúc gửi KCS sang đây, theo số báo − thiếu. Thứ tự trong transaction (MF3: khoá advisory trước, dòng sau): khoá
   * lô → ghi reportedQty = báo − thiếu (so count) → trừ đoạn → ghi reportedQty = báo − lỗi − thiếu → mảnh vào kho
   * (nếu công đoạn cuối) → tạo qc_review.
   */
  async reviewProductionBatch(
    productionBatchId: string,
    dto: CreateQcReviewDto,
    reviewedById: string,
  ): Promise<QcReviewResponseDto> {
    const batch = await this.productionBatchesService.findOneRowOrThrow(productionBatchId);
    if (batch.status === ProductionBatchStatus.QC_DONE) {
      throw new ConflictException(QC_DUPLICATE_MESSAGE);
    }
    if (batch.status !== ProductionBatchStatus.AWAITING_QC) {
      throw new ConflictException(
        `Đợt sản xuất ${productionBatchId} đang ở trạng thái ${batch.status} - chỉ AWAITING_QC mới duyệt KCS được`,
      );
    }
    await assertOrderPiHasActiveFloor(this.prisma, batch.productionOrderId, 'duyệt KCS');

    const shortQty = dto.shortQty ?? 0;
    if (dto.failedQty + shortQty > batch.reportedQty) {
      throw new BadRequestException(
        shortQty > 0
          ? `Thiếu (${shortQty}) + không đạt (${dto.failedQty}) vượt số đã báo (${batch.reportedQty})`
          : `Số không đạt (${dto.failedQty}) không được vượt số lượng đã báo (${batch.reportedQty})`,
      );
    }
    // Số đã tính vào kế hoạch (đạt) và số đoạn bị trừ (báo − thiếu; phần lỗi vẫn là đoạn đã dùng).
    const passedQty = batch.reportedQty - dto.failedQty - shortQty;
    const consumedQty = batch.reportedQty - shortQty;
    const defectReasonId = dto.defectReasonId ? parseBigIntId(dto.defectReasonId) : undefined;
    this.assertDefectReasonForFailed(dto.failedQty, defectReasonId);

    const created = await this.prisma.$transaction(
      async (tx) => {
        await this.assertDefectReasonExists(tx, defectReasonId);
        // Khoá trước (khoá chuyển đổi tồn đoạn khi công tắc bật, rồi production-batch-open): cùng thứ tự với
        // recordProductionBatch / finishProductionBatch nên không vòng chờ. consumeSegmentsAtReviewInTx lấy lại 2 khoá này.
        await this.productionBatchesService.lockBatchKeysInTx(tx, {
          productionOrderId: batch.productionOrderId,
          pieceId: batch.pieceId,
          stage: batch.stage,
        });
        // Đính chính audit độc lập 09/09 (Nghiêm trọng #5) - cùng lý do/cùng fix review() ở trên.
        // Đặc biệt quan trọng ở đây: reportedQty bị GHI ĐÈ (không cộng dồn) - 2 request duyệt trùng
        // mà không chặn sẽ làm sản lượng đã chốt sai lệch thật (không chỉ lost-update audit trail).
        // P1: bước này ghi báo − thiếu (số đoạn dùng thật) để consumeSegmentsAtReviewInTx đọc đúng; bước dưới hạ tiếp
        // về báo − lỗi − thiếu.
        const { count } = await tx.productionBatch.updateMany({
          where: { id: batch.id, status: ProductionBatchStatus.AWAITING_QC },
          data: { status: ProductionBatchStatus.QC_DONE, reportedQty: consumedQty },
        });
        if (count === 0) {
          throw new ConflictException(QC_DUPLICATE_MESSAGE);
        }
        await this.productionBatchesService.consumeSegmentsAtReviewInTx(
          tx,
          batch.id,
          consumedQty,
          reviewedById,
        );
        if (dto.failedQty > 0) {
          await tx.productionBatch.update({
            where: { id: batch.id },
            data: { reportedQty: passedQty },
          });
        }
        // Đợt 7 (người B): KCS đạt ở công đoạn cuối của mảnh -> ghi mảnh vào kho của công đoạn đó.
        await this.productionBatchesService.postPieceOutputIfFinal(
          tx,
          {
            id: batch.id,
            productionOrderId: batch.productionOrderId,
            pieceId: batch.pieceId,
            stage: batch.stage,
            qty: passedQty,
          },
          reviewedById,
        );

        return tx.qcReview.create({
          data: {
            productionBatchId: batch.id,
            failedQty: dto.failedQty,
            shortQty,
            defectReasonId,
            reason: dto.reason,
            photoUrl: dto.photoUrl,
            reviewedById,
          },
          include: QC_REVIEW_INCLUDE,
        });
      },
      { timeout: QC_TX_TIMEOUT_MS },
    );

    // Sau commit, theo thứ tự: đóng tin chờ KCS -> tin vượt đoạn (best-effort) -> tin kết quả -> nhắc kho -> realtime.
    await this.resolveAwaitingQc('PRODUCTION_BATCH', batch.id, 'BATCH_TO_KCS');
    try {
      await this.productionBatchesService.afterReviewCommitted(batch.id, reviewedById);
    } catch (error) {
      this.logger.error(
        `Failed to notify segment overages (batch ${batch.id}): ${(error as Error).message}`,
      );
    }
    // Hàn / Sơn / pat KHÔNG truyền todo (dùng câu mặc định); lô Sơn lấy xưởng nơi sơn; có thiếu mới thêm câu thiếu.
    const sonWorkshopId =
      batch.stage === MfgStage.SON
        ? await this.paintWorkshopIdOfOrder(batch.productionOrderId)
        : undefined;
    await this.notifyQcResult(
      batch.productionOrder?.productionInvoiceItem?.productionInvoice?.code ?? `#${batch.id}`,
      dto.failedQty,
      this.mfgStageToSenderRole(batch.stage),
      {
        ...this.withShortText(dto.failedQty, shortQty, 'mảnh'),
        ...(sonWorkshopId ? { workshopId: sonWorkshopId } : {}),
      },
    );
    // Nhắc thủ kho Hàn chuyển mảnh sang Sơn (lệnh của xưởng không có kho Sơn). Best-effort, không làm hỏng lượt chấm.
    if (batch.stage === MfgStage.HAN) {
      try {
        await this.paintReminder.refreshForOrder(batch.productionOrderId.toString());
      } catch (error) {
        this.logger.error(
          `Failed to refresh paint-transfer reminder (order ${batch.productionOrderId}): ${(error as Error).message}`,
        );
      }
    }
    this.publishRealtime(created.id, 'QC_RECORDED', reviewedById, batch.productionOrderId);

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
    if (bundle.status === PieceStepBundleStatus.QC_PASSED) {
      throw new ConflictException(QC_DUPLICATE_MESSAGE);
    }
    if (bundle.status !== PieceStepBundleStatus.AWAITING_QC) {
      throw new ConflictException(
        `Đợt gửi KCS ${pieceStepBundleId} đang ở trạng thái ${String(bundle.status)} - chỉ AWAITING_QC mới duyệt được`,
      );
    }
    await assertOrderPiHasActiveFloor(this.prisma, bundle.productionOrderId, 'duyệt KCS công đoạn');

    const shortQty = dto.shortQty ?? 0;
    if (dto.failedQty + shortQty > bundle.qty) {
      throw new BadRequestException(
        shortQty > 0
          ? `Thiếu (${shortQty}) + không đạt (${dto.failedQty}) vượt số đã báo (${bundle.qty})`
          : `Số không đạt (${dto.failedQty}) không được vượt số lượng đã gửi (${bundle.qty})`,
      );
    }
    const defectReasonId = dto.defectReasonId ? parseBigIntId(dto.defectReasonId) : undefined;
    this.assertDefectReasonForFailed(dto.failedQty, defectReasonId);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertDefectReasonExists(tx, defectReasonId);
      // Đính chính audit độc lập 09/09 (Nghiêm trọng #5) - cùng lý do/cùng fix review() ở trên.
      // Đặc biệt quan trọng ở đây: autoFinalizePieceOutputIfLastStepComplete() bên dưới cộng
      // failedQty từ MỌI QcReview gắn vào bundle này - 2 request duyệt trùng không chặn sẽ tạo 2
      // dòng QcReview cùng bundleId, cộng trùng failedQty vào sản lượng đã chốt (ProductionBatch).
      const { count } = await tx.pieceStepBundle.updateMany({
        where: { id: bundle.id, status: PieceStepBundleStatus.AWAITING_QC },
        data: { status: PieceStepBundleStatus.QC_PASSED },
      });
      if (count === 0) {
        throw new ConflictException(QC_DUPLICATE_MESSAGE);
      }

      // P1: tạo review (có shortQty) TRƯỚC, rồi mới tự sinh lô pat - hàm đó cộng lỗi + thiếu của mọi review của bundle.
      const review = await tx.qcReview.create({
        data: {
          pieceStepBundleId: bundle.id,
          failedQty: dto.failedQty,
          shortQty,
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

    // Sau khi transaction commit. PieceStepBundle không có cột stage - màn KCS xếp vào Phôi.
    await this.notifyQcResult(
      bundle.productionOrder?.productionInvoiceItem?.productionInvoice?.code ?? `#${bundle.id}`,
      dto.failedQty,
      BUSINESS_ROLES.PHOI_STAFF,
      this.withShortText(dto.failedQty, shortQty, 'mảnh'),
    );
    this.publishRealtime(pieceStepBundleId, 'QC_RECORDED', reviewedById, bundle.productionOrderId);
    return this.toResponseDto(created);
  }

  /**
   * KCS duyệt 1 "đợt gửi KCS theo công đoạn" cho vật tư KHÔNG gắn piece (MaterialYieldStepBundle,
   * 2026-10-01, vd chân nhôm) - mirror ĐÚNG reviewPieceStep() ở trên (cùng 2 kết quả Đạt/Không đạt,
   * cùng ý nghĩa "PASSED = đã qua tay KCS"). Khác reviewPieceStep(): nếu đây là công đoạn CUỐI,
   * credit THẲNG StockLedger/StockQuant cho outputMaterial qua
   * MaterialYieldRecipeProductionService.finalizeRecipeOutputIfLastStepComplete() thay vì tạo
   * ProductionBatch (bảng đó luôn gắn pieceId, không áp dụng được ở đây) - xem doc comment service
   * đó tại sao KHÔNG cần logic cộng dồn delta như bên piece.
   */
  async reviewMaterialYieldStep(
    materialYieldStepBundleId: string,
    dto: CreateQcReviewDto,
    reviewedById: string,
  ): Promise<QcReviewResponseDto> {
    const bundle =
      await this.materialYieldRecipeProductionService.findOneBundleRowOrThrow(
        materialYieldStepBundleId,
      );
    if (bundle.status === PieceStepBundleStatus.QC_PASSED) {
      throw new ConflictException(QC_DUPLICATE_MESSAGE);
    }
    if (bundle.status !== PieceStepBundleStatus.AWAITING_QC) {
      throw new ConflictException(
        `Đợt gửi KCS ${materialYieldStepBundleId} đang ở trạng thái ${String(bundle.status)} - chỉ AWAITING_QC mới duyệt được`,
      );
    }
    await assertPiHasActiveFloor(this.prisma, bundle.productionInvoiceId, 'duyệt KCS công đoạn');

    const shortQty = dto.shortQty ?? 0;
    if (dto.failedQty + shortQty > bundle.qty) {
      throw new BadRequestException(
        shortQty > 0
          ? `Thiếu (${shortQty}) + không đạt (${dto.failedQty}) vượt số đã báo (${bundle.qty})`
          : `Số không đạt (${dto.failedQty}) không được vượt số lượng đã gửi (${bundle.qty})`,
      );
    }
    const defectReasonId = dto.defectReasonId ? parseBigIntId(dto.defectReasonId) : undefined;
    this.assertDefectReasonForFailed(dto.failedQty, defectReasonId);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertDefectReasonExists(tx, defectReasonId);
      const { count } = await tx.materialYieldStepBundle.updateMany({
        where: { id: bundle.id, status: PieceStepBundleStatus.AWAITING_QC },
        data: { status: PieceStepBundleStatus.QC_PASSED },
      });
      if (count === 0) {
        throw new ConflictException(QC_DUPLICATE_MESSAGE);
      }

      const review = await tx.qcReview.create({
        data: {
          materialYieldStepBundleId: bundle.id,
          failedQty: dto.failedQty,
          shortQty,
          defectReasonId,
          reason: dto.reason,
          photoUrl: dto.photoUrl,
          reviewedById,
        },
        include: QC_REVIEW_INCLUDE,
      });

      await this.materialYieldRecipeProductionService.finalizeRecipeOutputIfLastStepComplete(
        tx,
        bundle,
        dto.failedQty + shortQty,
        reviewedById,
      );

      return review;
    });

    this.publishRealtime(
      materialYieldStepBundleId,
      'QC_RECORDED',
      reviewedById,
      bundle.productionInvoiceId,
    );
    try {
      await this.notifications.resolve({
        entityType: 'MATERIAL_YIELD_STEP_BUNDLE',
        entityId: materialYieldStepBundleId,
        types: ['MATERIAL_YIELD_STEP_BUNDLE_TO_KCS'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to resolve MATERIAL_YIELD_STEP_BUNDLE_TO_KCS (bundle ${materialYieldStepBundleId}): ${(error as Error).message}`,
      );
    }
    await this.notifyQcResultForPi(
      bundle.productionInvoiceId,
      dto.failedQty,
      BUSINESS_ROLES.PHOI_STAFF,
      this.withShortText(dto.failedQty, shortQty, 'cái'),
    );
    return this.toResponseDto(created);
  }

  /**
   * Sửa/xóa CHỈ `photoUrl` của 1 QcReview đã tồn tại - dùng khi KCS lỡ chọn nhầm ảnh (vd bug cũ ở
   * kcsCore.tsx upload nhầm lên URL mock, xem changelog audit-upload-file). QcReview đã nằm trong
   * AUDITED_MODELS (audit-log.extension.ts) nên `.update()` dưới đây TỰ ghi AuditLog (before/after,
   * actor, ip) - không cần ghi tay. failedQty/reason/defectReasonId/reviewedAt/reviewedById BẤT
   * BIẾN, không đụng tới.
   *
   * 2026-09-11 lần 2 (theo Sếp Trương Văn Nhân, hỏi qua chat nội bộ "ai được quyền sửa" - trả lời
   * "cho người nhập được sửa luôn"): mở thêm cho CHÍNH người đã tạo review này
   * (`reviewedById === actorUserId`), KHÔNG chỉ ADMIN như thiết kế ban đầu - route bỏ
   * `@RequireRole(ADMIN)`, actor/role check chuyển vào service vì cần đọc dữ liệu record (biết ai
   * là người nhập) mới quyết được, decorator tĩnh không làm được.
   */
  async updatePhoto(
    id: string,
    dto: UpdateQcReviewPhotoDto,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<QcReviewResponseDto> {
    const bigId = parseBigIntId(id);
    const existing = await this.prisma.qcReview.findUnique({ where: { id: bigId } });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy phiếu KCS ${id}`);
    }
    if (existing.reviewedById !== actorUserId && !actorRoles.includes(DEFAULT_ROLES.ADMIN)) {
      throw new ForbiddenException('Chỉ người đã chấm review này hoặc Admin mới sửa được ảnh');
    }
    const newPhotoUrl = dto.photoUrl ?? null;

    const updated = await this.prisma.qcReview.update({
      where: { id: bigId },
      data: { photoUrl: newPhotoUrl },
      include: QC_REVIEW_INCLUDE,
    });

    if (existing.photoUrl && existing.photoUrl !== newPhotoUrl) {
      await this.cloudinaryService.deleteByUrl(existing.photoUrl);
    }

    return this.toResponseDto(updated);
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

  private toResponseDto(review: QcReviewRow, notes: string[] = []): QcReviewResponseDto {
    return new QcReviewResponseDto({
      id: review.id.toString(),
      steelIssueId: review.steelIssueId?.toString() ?? null,
      productionBatchId: review.productionBatchId?.toString() ?? null,
      cutBundleId: review.cutBundleId?.toString() ?? null,
      stepBundleId: review.stepBundleId?.toString() ?? null,
      pieceStepBundleId: review.pieceStepBundleId?.toString() ?? null,
      materialYieldStepBundleId: review.materialYieldStepBundleId?.toString() ?? null,
      failedQty: review.failedQty,
      shortQty: review.shortQty,
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
            shortQty: s.shortQty,
            scrapQty: s.scrapQty,
          }),
      ),
      notes,
    });
  }
}
