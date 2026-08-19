import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CuttingProposalStatus,
  Prisma,
  ProcessStep,
  StockLedgerRefType,
  SteelIssueStatus,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { CompleteCuttingDto } from './dto/complete-cutting.dto';
import { CompleteStepDto } from './dto/complete-step.dto';
import { CreateSteelIssueDto } from './dto/create-steel-issue.dto';
import { CutBundleResponseDto, CutPatternSegmentResponseDto } from './dto/cut-bundle-response.dto';
import { ListSteelIssuesQueryDto } from './dto/list-steel-issues-query.dto';
import { SteelIssuePlanItemResponseDto } from './dto/steel-issue-plan-item-response.dto';
import { SteelIssueResponseDto } from './dto/steel-issue-response.dto';

const STEEL_ISSUE_INCLUDE = {
  productionInvoice: { select: { code: true, salesOrder: { select: { code: true } } } },
  material: true,
} satisfies Prisma.SteelIssueInclude;

const STEEL_ISSUE_DETAIL_INCLUDE = {
  ...STEEL_ISSUE_INCLUDE,
  bundles: { include: { segments: { include: { segmentSpec: true } } } },
} satisfies Prisma.SteelIssueInclude;

type SteelIssueRow = Prisma.SteelIssueGetPayload<{ include: typeof STEEL_ISSUE_INCLUDE }>;
type SteelIssueDetail = Prisma.SteelIssueGetPayload<{ include: typeof STEEL_ISSUE_DETAIL_INCLUDE }>;
type OrderForBom = { id: bigint; bomRevisionId: bigint; quantity: number };

/// Kho vật lý duy nhất liên quan (cat_sat_iea chỉ tính vật tư sắt) - cùng giá trị
/// STEEL_WAREHOUSE_CODE trong cutting-proposals.service.ts, không tách file constant riêng vì
/// đúng convention đã có (giữ local, hardcode có chú thích) ở chính module nguồn đó.
const STEEL_WAREHOUSE_CODE = 'phoi-son-han';

/// Kho ảo cố định - điểm đến của bút toán "sắt xuất dùng cho sản xuất" (STEEL_ISSUE), chuyển từ
/// CuttingProposalsService.approve() sang đây ở B4 Đợt 2 (xem STEEL_ISSUE_RESERVATION_CUTOVER).
const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';

/**
 * B4 Đợt 2 (Sếp chốt 2026-08-17, changelog mục 13) - mốc CHUYỂN ĐỔI cơ chế trừ tồn kho sắt.
 *
 * TRƯỚC mốc này: CuttingProposalsService.approve() trừ tồn thật (StockLedger) ngay lúc duyệt
 * phương án cắt (quyết định Sếp 2026-08-07). Mọi CuttingProposal có `approvedAt` TRƯỚC mốc này
 * ĐÃ bị trừ tồn theo cơ chế đó rồi - create() ở dưới KHÔNG được trừ lần 2 cho chúng, chỉ theo dõi
 * thực thi như hành vi cũ.
 *
 * TỪ mốc này trở đi: approve() chỉ GIỮ CHỖ (StockReservation), KHÔNG trừ tồn thật nữa - create()
 * mới là nơi trừ tồn thật + tiêu giữ chỗ tương ứng.
 *
 * Chọn mốc cố định (không phải "check trạng thái nào") để không cần viết script backfill dữ liệu
 * cũ - an toàn hơn (không có rủi ro script tự sai mà không ai biết), đổi lại code phải giữ nhánh
 * rẽ này cho tới khi mọi CuttingProposal duyệt trước mốc đã được Phôi xuất hết (dọn sau, không
 * cấp bách). QUAN TRỌNG: giá trị dưới đây là mốc dev/test của phiên viết code này - PHẢI cập nhật
 * đúng ngày/giờ deploy thật lên production trước khi release, nếu không mọi phương án duyệt giữa
 * lúc code này viết và lúc deploy thật sẽ bị hiểu sai cơ chế.
 */
const STEEL_ISSUE_RESERVATION_CUTOVER = new Date('2026-08-18T00:00:00.000Z');

/**
 * Xuất sắt cho Phôi (M2, thay phoi-sat.service.ts mock) - lớp theo dõi THỰC THI vật lý dưới 1
 * CuttingProposal đã APPROVED cho 1 (production_invoice, material).
 *
 * B4 Đợt 3d (2026-08-19, changelog 2026-08-18-xuat-sat-po-pi-vat-tu.md mục 2) - gộp theo CẢ PI
 * thay vì theo (production_order, piece): 1 PI có thể có nhiều SKU/PO (xem memory
 * project_pi_multi_sku_multi_po), phần mềm đề xuất mua/cắt sắt vốn đã tính gộp ở cấp PI, và Phôi
 * tự phân bổ vật lý theo mảnh nào khi cắt thật - hệ thống không cần (và không thể) biết trước
 * "cây này cho mảnh nào" vì SegmentSpec dùng chung toàn hệ thống, không thuộc riêng 1 mảnh. Hệ
 * quả: `requiredSteps` (công đoạn ngoài Cắt như uốn/dập) giờ là HỢP (union) của mọi mảnh dùng
 * material này trong cả PI, không còn suy theo đúng 1 mảnh - xem resolveRequiredSteps().
 *
 * Hệ quả khác đã xử lý riêng: WarehouseTransfersService.getPieceTransferPlan() trước đây đếm số
 * mảnh "vật tư thành phẩm" (needsHan=false) đã xong qua SteelIssue.pieceId - không còn tính được
 * nữa, đã CHẶN CỨNG (throw) nhánh đó vì thực tế nghiệp vụ hiện tại mọi mảnh đều needsHan=true.
 *
 * B4 Đợt 2 (2026-08-17): create() giờ CÓ THỂ ghi StockLedger - xem STEEL_ISSUE_RESERVATION_CUTOVER
 * ở trên. TRƯỚC đây (2026-08-07 - 2026-08-17) cố ý KHÔNG ghi vì CuttingProposalsService.approve()
 * đã trừ tồn 1 lần gộp ngay lúc duyệt - comment cũ vẫn đúng cho nhánh "trước cutover" bên dưới.
 * State machine 1 chiều ISSUED -> RECEIVED -> AWAITING_QC -> QC_PASSED.
 *
 * Lệch tài liệu gốc điểm 2: tài liệu phác thảo thêm 1 endpoint riêng `POST
 * /steel-issues/:id/rework`, tách khỏi qc-review. Nhưng mô tả transition của chính qc-review
 * trong cùng tài liệu ("AWAITING_QC -> QC_PASSED hoặc -> RECEIVED tuỳ failedQty") mâu thuẫn với
 * việc có 1 rework issue MỚI (rework_of) - không rõ ràng dòng nào là dòng "còn dở". Đã bỏ hẳn
 * endpoint rework riêng, theo đúng hành vi mock đã validate qua UI (phoi-sat.service.ts
 * kcsDuyetPhoi): qc-review LUÔN đóng đợt gốc thành QC_PASSED, và tự sinh 1 SteelIssue con
 * (status RECEIVED, reworkOfId = đợt gốc) trong CÙNG transaction nếu có phần sửa được - xem
 * QcReviewsService.review().
 */
@Injectable()
export class SteelIssuesService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
  ) {}

  async create(
    productionInvoiceId: string,
    dto: CreateSteelIssueDto,
    issuedById: string,
    warehouseScope: string | null,
    idempotencyKey?: string,
  ): Promise<SteelIssueResponseDto> {
    // null = tổng kho (BOSS/ADMIN) - không có gì để chặn.
    if (warehouseScope && warehouseScope !== STEEL_WAREHOUSE_CODE) {
      throw new ForbiddenException(
        `Caller bị giới hạn ở kho '${warehouseScope}', không được xuất sắt kho '${STEEL_WAREHOUSE_CODE}'`,
      );
    }

    if (idempotencyKey) {
      const existing = await this.prisma.steelIssue.findUnique({
        where: { idempotencyKey },
        include: STEEL_ISSUE_INCLUDE,
      });
      if (existing) {
        return this.toResponseDto(
          existing,
          await this.resolveRequiredSteps(existing.productionInvoiceId, existing.materialId),
        );
      }
    }

    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);
    const materialId = parseBigIntId(dto.materialId);
    const orders = await this.findOrdersForInvoice(invoice.id);
    await this.assertMaterialUsedInInvoice(orders, materialId, invoice.id);
    const poIds = orders.map((o) => o.id);
    const { cuttingProposalId, approvedAt } = await this.assertMaterialInApprovedProposal(
      invoice.id,
      poIds,
      materialId,
    );
    // approvedAt null về lý thuyết không xảy ra (status đã lọc APPROVED ở query trên, field này
    // luôn được set cùng lúc chuyển status) - coi như "trước cutover" nếu có, an toàn hơn (không
    // trừ tồn lần 2) là sai theo chiều ngược lại.
    const isPostCutover = (approvedAt ?? new Date(0)) >= STEEL_ISSUE_RESERVATION_CUTOVER;

    const created = await this.prisma.$transaction(
      async (tx) => {
        const issue = await tx.steelIssue.create({
          data: {
            productionInvoiceId: invoice.id,
            materialId,
            barLengthMm: dto.barLengthMm,
            barCount: dto.barCount,
            issuedById,
            idempotencyKey,
          },
          include: STEEL_ISSUE_INCLUDE,
        });

        if (isPostCutover) {
          await this.consumeReservationAndDeduct(tx, {
            cuttingProposalId,
            materialId,
            barCount: dto.barCount,
            steelIssueId: issue.id,
            issuedById,
          });
        }

        return issue;
      },
      { timeout: 15_000 },
    );

    return this.toResponseDto(created, await this.resolveRequiredSteps(invoice.id, materialId));
  }

  /**
   * B4 Đợt 2 - phần "tiêu hao" thật của thiết kế đặt-giữ/tiêu-hao (changelog mục 13). Chỉ gọi cho
   * phương án duyệt SAU STEEL_ISSUE_RESERVATION_CUTOVER (xem create()). Bê nguyên pattern khoá
   * `FOR UPDATE` + bút toán trong CÙNG transaction đã dùng ở CuttingProposalsService.approve() -
   * cùng lý do: đọc số dư - quyết định - ghi bút toán phải nằm trọn 1 khoá, nếu không 2 lượt xuất
   * gần nhau cho cùng vật tư sẽ cùng đọc thấy 1 số dư còn lại và cùng "ăn" quá phần được giữ.
   */
  private async consumeReservationAndDeduct(
    tx: PrismaTx,
    input: {
      cuttingProposalId: bigint;
      materialId: bigint;
      barCount: number;
      steelIssueId: bigint;
      issuedById: string;
    },
  ): Promise<void> {
    const [reservation] = await tx.$queryRaw<
      { id: bigint; warehouseId: bigint; quantity: Prisma.Decimal; consumedQty: Prisma.Decimal }[]
    >`
      SELECT "id", "warehouseId", "quantity", "consumedQty" FROM "stock_reservations"
      WHERE "refType" = 'CUTTING_PROPOSAL' AND "refId" = ${input.cuttingProposalId.toString()}
        AND "materialId" = ${input.materialId} AND "status" = 'ACTIVE'
      FOR UPDATE
    `;
    if (!reservation) {
      throw new ConflictException(
        `Không tìm thấy giữ chỗ tồn kho cho vật tư ${input.materialId} của phương án cắt ${input.cuttingProposalId} - chưa từng giữ chỗ (tồn + hàng mua chưa đủ), hoặc phương án đã bị supersede/huỷ`,
      );
    }
    const remaining = reservation.quantity.toNumber() - reservation.consumedQty.toNumber();
    // Chặn xuất thừa - CHẶN CỨNG, KHÔNG dung sai (Sếp chốt 2026-08-18, mục 13.7 changelog).
    // KHÔNG thêm dung sai kiểu SystemConfig.purchaseOverReceiptTolerancePercent bên Mua hàng vào
    // đây: chỗ đó có dung sai vì sai số đến TỪ NCC BÊN NGOÀI (đóng gói theo lô/cân, không ép được
    // khớp tuyệt đối). Ở đây là nội bộ và `totalBars` từ solver ĐÃ tính sẵn cả hao hụt cắt - vượt
    // định mức nghĩa là có vấn đề thật (gõ nhầm, cắt hỏng ngoài kế hoạch, hoặc lấy sắt cho việc
    // khác núp bóng đơn này), phải chặn lại để hỏi chứ không cho qua êm. Định mức sinh ra chính
    // là để kiểm soát việc này - nới lỏng ở đây là tự vô hiệu hoá BOM/solver phía trước.
    if (input.barCount > remaining) {
      throw new BadRequestException(
        `Xuất ${input.barCount} cây vượt quá phần đã giữ chỗ còn lại (${remaining} cây) cho vật tư ${input.materialId} - phương án cắt ${input.cuttingProposalId} không đủ hứa`,
      );
    }

    // Chặn tồn âm cục bộ (lỗ #2, mục 13.4) - không sửa StockLedgerService.postEntry() dùng chung
    // (nhiều luồng khác hợp lệ phải cho âm, vd kho ảo SUPPLIER) - chặn ngay tại đây, cùng khoá.
    // Phòng ca hiếm: tồn vật lý bị điều chỉnh tay (Admin > Sửa nhanh tồn kho) lệch khỏi giữ chỗ.
    const [stockRow] = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
      SELECT "qty" FROM "stock_quant"
      WHERE "warehouseId" = ${reservation.warehouseId} AND "materialId" = ${input.materialId}
      FOR UPDATE
    `;
    const onHand = Math.floor(stockRow?.qty.toNumber() ?? 0);
    if (onHand < input.barCount) {
      throw new ConflictException(
        `Tồn kho vật lý (${onHand} cây) không đủ xuất ${input.barCount} cây cho vật tư ${input.materialId} - có thể đã bị điều chỉnh tay (Admin > Sửa nhanh tồn kho), kiểm tra lại trước khi xuất`,
      );
    }

    const productionWarehouse = await tx.warehouse.findUniqueOrThrow({
      where: { code: PRODUCTION_WAREHOUSE_CODE },
    });
    await this.stockLedgerService.postEntry(
      {
        fromWarehouseId: reservation.warehouseId,
        toWarehouseId: productionWarehouse.id,
        materialId: input.materialId,
        qty: input.barCount,
        refType: StockLedgerRefType.STEEL_ISSUE,
        refId: input.steelIssueId.toString(),
        createdById: input.issuedById,
        idempotencyKey: `steel-issue:${input.steelIssueId}:consume`,
      },
      tx,
    );

    // RELEASED chỉ mang ĐÚNG 1 nghĩa: "đã huỷ/bị thay thế" (xem
    // StockReservationsService.releaseByRef(), B4 Đợt 3b) - KHÔNG dùng để đánh dấu "đã tiêu hết".
    // Dòng tiêu hết vẫn ACTIVE (getAvailableQty() đã tự trừ về 0 qua consumedQty, không cần đổi
    // status). Trước đây đánh RELEASED ở đây khi tiêu hết -> hàng về đợt sau (topUpFromReceipt)
    // không tìm thấy dòng ACTIVE để cộng vào, tạo dòng mới cùng idempotencyKey -> P2002 500 (bug
    // thật, phát hiện khi review lại thiết kế 3b - nhận hàng nhiều đợt là chuyện bình thường).
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: {
        consumedQty: reservation.consumedQty.toNumber() + input.barCount,
      },
    });
  }

  /** Flat, KHÔNG cần productionInvoiceId - xem ListSteelIssuesQueryDto tại sao endpoint này tồn
   *  tại riêng (permission PHOI_STAFF/KCS_STAFF không đủ để tự resolve productionInvoiceId). */
  async findAll(query: ListSteelIssuesQueryDto): Promise<Paginated<SteelIssueResponseDto>> {
    const where: Prisma.SteelIssueWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.steelIssue.findMany({ ...args, include: STEEL_ISSUE_INCLUDE }),
        count: (args) => this.prisma.steelIssue.count(args),
      },
      query,
      where,
      { issuedAt: 'desc' as const },
    );
    const requiredStepsMap = await this.attachRequiredStepsMap(result.data);
    return {
      data: result.data.map((r) =>
        this.toResponseDto(
          r,
          requiredStepsMap.get(`${r.productionInvoiceId}:${r.materialId}`) ?? [ProcessStep.CAT],
        ),
      ),
      meta: result.meta,
    };
  }

  async findAllForInvoice(
    productionInvoiceId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<SteelIssueResponseDto>> {
    const bigId = parseBigIntId(productionInvoiceId);
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.steelIssue.findMany({ ...args, include: STEEL_ISSUE_INCLUDE }),
        count: (args) => this.prisma.steelIssue.count(args),
      },
      query,
      { productionInvoiceId: bigId },
      { issuedAt: 'desc' as const },
    );
    const requiredStepsMap = await this.attachRequiredStepsMap(result.data);
    return {
      data: result.data.map((r) =>
        this.toResponseDto(
          r,
          requiredStepsMap.get(`${r.productionInvoiceId}:${r.materialId}`) ?? [ProcessStep.CAT],
        ),
      ),
      meta: result.meta,
    };
  }

  async findOne(id: string): Promise<SteelIssueResponseDto> {
    const issue = await this.findOneOrThrow(id);
    return this.toResponseDto(
      issue,
      await this.resolveRequiredSteps(issue.productionInvoiceId, issue.materialId),
    );
  }

  async getBundles(id: string): Promise<CutBundleResponseDto[]> {
    const detail = await this.findDetailOrThrow(id);
    return detail.bundles.map((b) => this.toBundleResponseDto(b));
  }

  async receive(id: string): Promise<SteelIssueResponseDto> {
    const issue = await this.findOneOrThrow(id);
    if (issue.status !== SteelIssueStatus.ISSUED) {
      throw new ConflictException(
        `Steel issue ${id} đang ở trạng thái ${issue.status} - chỉ ISSUED mới xác nhận nhận được`,
      );
    }
    const updated = await this.prisma.steelIssue.update({
      where: { id: issue.id },
      data: { status: SteelIssueStatus.RECEIVED },
      include: STEEL_ISSUE_INCLUDE,
    });
    return this.toResponseDto(
      updated,
      await this.resolveRequiredSteps(updated.productionInvoiceId, updated.materialId),
    );
  }

  async completeCutting(id: string, dto: CompleteCuttingDto): Promise<SteelIssueResponseDto> {
    const issue = await this.findOneOrThrow(id);
    if (issue.status !== SteelIssueStatus.RECEIVED) {
      throw new ConflictException(
        `Steel issue ${id} đang ở trạng thái ${issue.status} - chỉ RECEIVED mới báo cắt xong được`,
      );
    }
    if (dto.bundles.length === 0) {
      throw new BadRequestException('Phải khai báo ít nhất 1 bundle đã cắt');
    }

    const requiredSteps = await this.resolveRequiredSteps(
      issue.productionInvoiceId,
      issue.materialId,
    );
    const completedSteps: ProcessStep[] = [ProcessStep.CAT];
    const done = requiredSteps.every((s) => completedSteps.includes(s));

    await this.prisma.$transaction(async (tx) => {
      for (const bundle of dto.bundles) {
        await tx.cutBundle.create({
          data: {
            steelIssueId: issue.id,
            proposalPatternId: bundle.proposalPatternId
              ? parseBigIntId(bundle.proposalPatternId)
              : undefined,
            barCount: bundle.barCount,
            wastePerBarMm: bundle.wastePerBarMm,
            segments: {
              create: bundle.segments.map((s) => ({
                segmentSpecId: parseBigIntId(s.segmentSpecId),
                countPerBar: s.countPerBar,
              })),
            },
          },
        });
      }
      await tx.steelIssue.update({
        where: { id: issue.id },
        data: {
          status: done ? SteelIssueStatus.AWAITING_QC : SteelIssueStatus.IN_PROCESS,
          completedSteps,
          actualBarCount: dto.actualBarCount,
          completedAt: done ? new Date() : null,
        },
      });
    });

    const reloaded = await this.findOneOrThrow(id);
    return this.toResponseDto(reloaded, requiredSteps);
  }

  /**
   * Đánh dấu 1 công đoạn chi tiết (uốn/dập/...) xong sau khi đã cắt (IN_PROCESS) - chuyển
   * AWAITING_QC ngay khi mọi requiredSteps đã có mặt trong completedSteps. Idempotent với step đã
   * đánh dấu (double-click không lỗi).
   */
  async completeStep(id: string, dto: CompleteStepDto): Promise<SteelIssueResponseDto> {
    const issue = await this.findOneOrThrow(id);
    if (issue.status !== SteelIssueStatus.IN_PROCESS) {
      throw new ConflictException(
        `Steel issue ${id} đang ở trạng thái ${issue.status} - chỉ IN_PROCESS mới đánh dấu công đoạn được`,
      );
    }
    const requiredSteps = await this.resolveRequiredSteps(
      issue.productionInvoiceId,
      issue.materialId,
    );
    if (!requiredSteps.includes(dto.step)) {
      throw new BadRequestException(
        `Công đoạn ${dto.step} không thuộc danh sách công đoạn đã chọn sẵn của vật tư này`,
      );
    }
    if (issue.completedSteps.includes(dto.step)) {
      return this.toResponseDto(issue, requiredSteps);
    }

    const completedSteps = [...issue.completedSteps, dto.step];
    const done = requiredSteps.every((s) => completedSteps.includes(s));
    const updated = await this.prisma.steelIssue.update({
      where: { id: issue.id },
      data: {
        completedSteps,
        status: done ? SteelIssueStatus.AWAITING_QC : SteelIssueStatus.IN_PROCESS,
        completedAt: done ? new Date() : null,
      },
      include: STEEL_ISSUE_INCLUDE,
    });
    return this.toResponseDto(updated, requiredSteps);
  }

  /**
   * Union processSteps của MỌI PieceBom (mọi mảnh, mọi SKU/PO) dùng materialId này trong cả PI +
   * CAT mặc định (công đoạn tối thiểu bắt buộc - luôn xảy ra qua completeCutting).
   *
   * B4 Đợt 3d: trước đây tính theo ĐÚNG 1 mảnh (bomRevisionId, pieceId, materialId) vì mỗi đợt
   * xuất gắn 1 mảnh cụ thể. Từ khi gộp theo cả PI, hệ thống KHÔNG biết trước cây sắt xuất ra sẽ
   * về mảnh nào (Phôi tự phân bổ vật lý lúc cắt) - phải giả định XẤU NHẤT: nếu BẤT KỲ mảnh nào
   * trong PI dùng material này cần 1 công đoạn (vd Uốn), cả đợt xuất phải xác nhận công đoạn đó
   * mới được chuyển AWAITING_QC, dù thực tế phần cắt cho 1 mảnh không cần. Đây không phải giảm độ
   * chính xác mà là điều kiện bắt buộc để không lọt hàng cần xử lý thêm qua KCS mà thiếu bước.
   */
  private async resolveRequiredSteps(
    productionInvoiceId: bigint,
    materialId: bigint,
  ): Promise<ProcessStep[]> {
    const orders = await this.findOrdersForInvoice(productionInvoiceId);
    const set = new Set<ProcessStep>([ProcessStep.CAT]);
    if (orders.length === 0) return [...set];

    const bomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const rows = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId: { in: bomRevisionIds }, segmentSpec: { materialId } },
      select: { processSteps: true },
    });
    for (const row of rows) for (const step of row.processSteps) set.add(step);
    return [...set];
  }

  /** Batch cho findAll/findAllForInvoice - gom theo `${productionInvoiceId}:${materialId}`, 2
   *  query cho cả tập đợt xuất liên quan (tránh N+1). */
  private async attachRequiredStepsMap(
    issues: SteelIssueRow[],
  ): Promise<Map<string, ProcessStep[]>> {
    const invoiceIds = [...new Set(issues.map((i) => i.productionInvoiceId))];
    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: { in: invoiceIds } } },
      select: {
        bomRevisionId: true,
        productionInvoiceItem: { select: { productionInvoiceId: true } },
      },
    });

    const bomRevisionIdsByInvoice = new Map<string, Set<bigint>>();
    for (const o of orders) {
      const invoiceId = o.productionInvoiceItem?.productionInvoiceId;
      if (invoiceId == null) continue;
      const key = invoiceId.toString();
      const set = bomRevisionIdsByInvoice.get(key) ?? new Set<bigint>();
      set.add(o.bomRevisionId);
      bomRevisionIdsByInvoice.set(key, set);
    }

    const allBomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const pieceBoms = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId: { in: allBomRevisionIds } },
      select: {
        bomRevisionId: true,
        processSteps: true,
        segmentSpec: { select: { materialId: true } },
      },
    });
    const stepsByRevisionMaterial = new Map<string, ProcessStep[]>();
    for (const pb of pieceBoms) {
      const key = `${pb.bomRevisionId}:${pb.segmentSpec.materialId}`;
      const arr = stepsByRevisionMaterial.get(key) ?? [];
      stepsByRevisionMaterial.set(key, [...new Set([...arr, ...pb.processSteps])]);
    }

    const result = new Map<string, ProcessStep[]>();
    for (const issue of issues) {
      const key = `${issue.productionInvoiceId}:${issue.materialId}`;
      if (result.has(key)) continue;
      const bomRevisionIds = bomRevisionIdsByInvoice.get(issue.productionInvoiceId.toString());
      const set = new Set<ProcessStep>([ProcessStep.CAT]);
      for (const bomRevisionId of bomRevisionIds ?? []) {
        const steps = stepsByRevisionMaterial.get(`${bomRevisionId}:${issue.materialId}`) ?? [];
        for (const s of steps) set.add(s);
      }
      result.set(key, [...set]);
    }
    return result;
  }

  /**
   * Tạo đợt rework (reworkOfId = đợt gốc) - gọi từ QcReviewsService.review() SAU KHI transaction
   * chính (tạo QcReview + đóng đợt gốc QC_PASSED) đã commit, cùng idiom
   * WarehouseTransfersService.confirm() gọi StockLedgerService.postEntry() ngoài transaction
   * riêng của nó (extended Prisma client không chia sẻ `tx` xuyên service gọn gàng). An toàn khi
   * gọi lại: resolve-or-return theo reworkOfId - 1 đợt gốc chỉ sinh tối đa 1 đợt rework (đúng
   * bất biến "KCS chỉ duyệt 1 lần/đợt", xem guard status AWAITING_QC ở review()).
   */
  async createReworkIssue(original: SteelIssueRow, barCount: number): Promise<void> {
    const existing = await this.prisma.steelIssue.findFirst({
      where: { reworkOfId: original.id },
    });
    if (existing) {
      return;
    }
    await this.prisma.steelIssue.create({
      data: {
        productionInvoiceId: original.productionInvoiceId,
        materialId: original.materialId,
        barLengthMm: original.barLengthMm,
        barCount,
        status: SteelIssueStatus.RECEIVED,
        issuedById: original.issuedById,
        reworkOfId: original.id,
      },
    });
  }

  async findOneRowOrThrow(id: string): Promise<SteelIssueRow> {
    return this.findOneOrThrow(id);
  }

  /** "Cần xuất bao nhiêu" theo LOẠI SẮT cho cả PI - query trực tiếp, không có bảng cache riêng. */
  async getIssuePlan(productionInvoiceId: string): Promise<SteelIssuePlanItemResponseDto[]> {
    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);
    const orders = await this.findOrdersForInvoice(invoice.id);
    if (orders.length === 0) return [];

    const bomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const [bomPieces, pieceBoms, issues] = await Promise.all([
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId: { in: bomRevisionIds } },
        include: { piece: true },
      }),
      this.prisma.pieceBom.findMany({
        where: { bomRevisionId: { in: bomRevisionIds } },
        include: { segmentSpec: { include: { material: true } } },
      }),
      // Chỉ đợt gốc (không tính rework) - đúng cách daXuatOf() bên mock cộng dồn.
      this.prisma.steelIssue.findMany({
        where: { productionInvoiceId: invoice.id, reworkOfId: null },
        select: { materialId: true, barCount: true },
      }),
    ]);

    const issuedByMaterial = new Map<string, number>();
    for (const i of issues) {
      const key = i.materialId.toString();
      issuedByMaterial.set(key, (issuedByMaterial.get(key) ?? 0) + i.barCount);
    }

    const bomPiecesByRevision = new Map<string, typeof bomPieces>();
    for (const bp of bomPieces) {
      const key = bp.bomRevisionId.toString();
      const arr = bomPiecesByRevision.get(key) ?? [];
      arr.push(bp);
      bomPiecesByRevision.set(key, arr);
    }
    const pieceBomsByRevisionPiece = new Map<string, typeof pieceBoms>();
    for (const pb of pieceBoms) {
      const key = `${pb.bomRevisionId}:${pb.pieceId}`;
      const arr = pieceBomsByRevisionPiece.get(key) ?? [];
      arr.push(pb);
      pieceBomsByRevisionPiece.set(key, arr);
    }

    // Cộng dồn requiredSegments theo material, lặp qua TỪNG order (không phải từng bomRevisionId
    // duy nhất) vì mỗi order có quantity riêng - 1 PI có thể có nhiều SKU/PO khác bomRevisionId
    // (xem memory project_pi_multi_sku_multi_po), mỗi order đóng góp riêng vào tổng.
    const requiredSegmentsByMaterial = new Map<string, number>();
    const materialMeta = new Map<string, { code: string; name: string }>();
    for (const order of orders) {
      const bomKey = order.bomRevisionId.toString();
      for (const bp of bomPiecesByRevision.get(bomKey) ?? []) {
        for (const r of pieceBomsByRevisionPiece.get(`${bomKey}:${bp.pieceId}`) ?? []) {
          const materialId = r.segmentSpec.materialId;
          const mKey = materialId.toString();
          const segments = r.qtyPerPiece * bp.qtyPerUnit * order.quantity;
          requiredSegmentsByMaterial.set(
            mKey,
            (requiredSegmentsByMaterial.get(mKey) ?? 0) + segments,
          );
          if (!materialMeta.has(mKey)) {
            materialMeta.set(mKey, {
              code: r.segmentSpec.material.code,
              name: r.segmentSpec.material.name,
            });
          }
        }
      }
    }

    const materialIdsUsed = [...requiredSegmentsByMaterial.keys()].map((k) => BigInt(k));
    const poIds = orders.map((o) => o.id);
    const stockInfoByMaterial = await this.buildStockInfoByMaterial(
      invoice.id,
      poIds,
      materialIdsUsed,
    );

    return materialIdsUsed.map((materialId) => {
      const key = materialId.toString();
      const meta = materialMeta.get(key)!;
      const stockInfo = stockInfoByMaterial.get(key);
      return new SteelIssuePlanItemResponseDto({
        materialId: key,
        materialCode: meta.code,
        materialName: meta.name,
        requiredSegments: requiredSegmentsByMaterial.get(key) ?? 0,
        issuedBarCount: issuedByMaterial.get(key) ?? 0,
        remainingToIssue: stockInfo?.remainingToIssue ?? null,
        physicalStockQty: stockInfo?.physicalStockQty ?? null,
      });
    });
  }

  /**
   * B4 Đợt 3c (mục 13.6 changelog) - 2 con số cho thủ kho biết TRƯỚC khi xuất, thay vì nhập mù:
   *   - remainingToIssue: phần CÒN được xuất theo giữ chỗ (đúng logic
   *     SteelIssuesService.consumeReservationAndDeduct dùng để chặn xuất thừa) - null nếu phương
   *     án duyệt TRƯỚC cutover (không giữ chỗ) hoặc chưa có phương án nào.
   *   - physicalStockQty: tồn vật lý thật (stock_quant) - null nếu vật tư chưa gán Kho.
   * Tính 1 LẦN cho mỗi vật tư trong `materialIds` (không lặp theo mảnh) - xem gọi ở getIssuePlan().
   */
  private async buildStockInfoByMaterial(
    productionInvoiceId: bigint,
    productionOrderIds: bigint[],
    materialIds: bigint[],
  ): Promise<Map<string, { remainingToIssue: number | null; physicalStockQty: number | null }>> {
    const result = new Map<
      string,
      { remainingToIssue: number | null; physicalStockQty: number | null }
    >();
    if (materialIds.length === 0) return result;

    const [materials, lines] = await Promise.all([
      this.prisma.material.findMany({
        where: { id: { in: materialIds } },
        select: { id: true, warehouseId: true },
      }),
      // Cùng điều kiện assertMaterialInApprovedProposal() - phương án đã duyệt phủ đúng PI này
      // (trực tiếp hoặc qua từng PO thành viên).
      this.prisma.cuttingProposalLine.findMany({
        where: {
          materialId: { in: materialIds },
          feasible: true,
          cuttingProposal: {
            status: CuttingProposalStatus.APPROVED,
            OR: [
              { productionInvoiceId },
              ...(productionOrderIds.length > 0
                ? [{ productionOrderId: { in: productionOrderIds } }]
                : []),
            ],
          },
        },
        select: { materialId: true, cuttingProposalId: true },
      }),
    ]);

    const warehouseIdByMaterial = new Map(materials.map((m) => [m.id.toString(), m.warehouseId]));
    const cuttingProposalIdByMaterial = new Map(
      lines.map((l) => [l.materialId.toString(), l.cuttingProposalId]),
    );

    const refIds = [
      ...new Set([...cuttingProposalIdByMaterial.values()].map((id) => id.toString())),
    ];
    const reservations =
      refIds.length > 0
        ? await this.prisma.stockReservation.findMany({
            where: {
              refType: 'CUTTING_PROPOSAL',
              refId: { in: refIds },
              materialId: { in: materialIds },
              status: 'ACTIVE',
            },
            select: { refId: true, materialId: true, quantity: true, consumedQty: true },
          })
        : [];
    const reservationByKey = new Map(reservations.map((r) => [`${r.refId}:${r.materialId}`, r]));

    const warehouseIds = [
      ...new Set(materials.map((m) => m.warehouseId).filter((id): id is bigint => id != null)),
    ];
    const quants =
      warehouseIds.length > 0
        ? await this.prisma.stockQuant.findMany({
            where: { warehouseId: { in: warehouseIds }, materialId: { in: materialIds } },
            select: { warehouseId: true, materialId: true, qty: true },
          })
        : [];
    const quantByKey = new Map(
      quants.map((q) => [`${q.warehouseId}:${q.materialId}`, q.qty.toNumber()]),
    );

    for (const materialId of materialIds) {
      const key = materialId.toString();
      const warehouseId = warehouseIdByMaterial.get(key) ?? null;
      const cuttingProposalId = cuttingProposalIdByMaterial.get(key);
      const reservation = cuttingProposalId
        ? reservationByKey.get(`${cuttingProposalId}:${materialId}`)
        : undefined;
      result.set(key, {
        remainingToIssue: reservation
          ? Math.max(0, reservation.quantity.toNumber() - reservation.consumedQty.toNumber())
          : null,
        physicalStockQty:
          warehouseId != null ? (quantByKey.get(`${warehouseId}:${materialId}`) ?? 0) : null,
      });
    }
    return result;
  }

  /**
   * B4 Đợt 3d: xác thực vật tư client chọn khi xuất thật sự thuộc định mức (BOM) của BẤT KỲ mảnh
   * nào trong PI này - không còn xác thực theo 1 mảnh cụ thể (client không còn khai mảnh khi
   * xuất, xem CreateSteelIssueDto).
   */
  private async assertMaterialUsedInInvoice(
    orders: OrderForBom[],
    materialId: bigint,
    invoiceId: bigint,
  ): Promise<void> {
    if (orders.length === 0) {
      throw new NotFoundException(
        `Production invoice ${invoiceId} chưa có lệnh sản xuất nào được duyệt`,
      );
    }
    const bomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const pieceBoms = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId: { in: bomRevisionIds } },
      include: { segmentSpec: true },
    });
    const materialIds = new Set(pieceBoms.map((pb) => pb.segmentSpec.materialId));
    if (!materialIds.has(materialId)) {
      throw new BadRequestException(
        `Vật tư ${materialId} không thuộc định mức (BOM) của PI ${invoiceId} - chọn đúng 1 trong các loại sắt đang dùng (${[...materialIds].join(', ')})`,
      );
    }
  }

  /**
   * Phương án cắt đã duyệt phủ vật tư này chưa - tính CẢ 2 kiểu neo:
   * - neo thẳng vào PI này (đợt gộp, CuttingProposal.productionInvoiceId), hoặc
   * - neo vào 1 trong các PO thành viên (SKU cắt riêng, đường mặc định).
   *
   * B4 Đợt 2: giờ TRẢ VỀ luôn `cuttingProposal` (id + approvedAt) thay vì chỉ assert/throw - cần
   * `approvedAt` để biết phương án này thuộc "trước" hay "sau" STEEL_ISSUE_RESERVATION_CUTOVER, và
   * cần `id` để tìm đúng StockReservation tương ứng (refType=CUTTING_PROPOSAL, refId=id đó).
   */
  private async assertMaterialInApprovedProposal(
    productionInvoiceId: bigint,
    productionOrderIds: bigint[],
    materialId: bigint,
  ): Promise<{ cuttingProposalId: bigint; approvedAt: Date | null }> {
    const line = await this.prisma.cuttingProposalLine.findFirst({
      where: {
        materialId,
        // `feasible: true` là BẮT BUỘC, không thừa: saveSuccess() tạo dòng cho MỌI vật tư solver
        // trả về, kể cả loại nó báo không cắt được (feasible=false, không có pattern nào). Thiếu
        // điều kiện này thì Phôi được phép xuất sắt cho đúng loại không có phương án cắt để làm
        // theo - mà loại đó cũng bị approve() loại khỏi đề xuất mua nên còn chẳng có sắt để xuất.
        feasible: true,
        cuttingProposal: {
          status: CuttingProposalStatus.APPROVED,
          OR: [
            { productionInvoiceId },
            ...(productionOrderIds.length > 0
              ? [{ productionOrderId: { in: productionOrderIds } }]
              : []),
          ],
        },
      },
      select: { cuttingProposal: { select: { id: true, approvedAt: true } } },
    });
    if (!line) {
      throw new ConflictException(
        `Chưa có phương án cắt (CuttingProposal) đã duyệt và cắt được cho vật tư ${materialId} của PI ${productionInvoiceId} - chưa thể xuất sắt`,
      );
    }
    return {
      cuttingProposalId: line.cuttingProposal.id,
      approvedAt: line.cuttingProposal.approvedAt,
    };
  }

  private async findInvoiceOrThrow(id: string) {
    const bigId = parseBigIntId(id);
    const invoice = await this.prisma.productionInvoice.findUnique({ where: { id: bigId } });
    if (!invoice) {
      throw new NotFoundException(`Production invoice ${id} not found`);
    }
    return invoice;
  }

  /** Mọi ProductionOrder (đã duyệt) thuộc 1 PI - 1 PI có thể có nhiều SKU/PO khác bomRevisionId
   *  (xem memory project_pi_multi_sku_multi_po). */
  private async findOrdersForInvoice(productionInvoiceId: bigint): Promise<OrderForBom[]> {
    return this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId } },
      select: { id: true, bomRevisionId: true, quantity: true },
    });
  }

  private async findOneOrThrow(id: string): Promise<SteelIssueRow> {
    const bigId = parseBigIntId(id);
    const issue = await this.prisma.steelIssue.findUnique({
      where: { id: bigId },
      include: STEEL_ISSUE_INCLUDE,
    });
    if (!issue) {
      throw new NotFoundException(`Steel issue ${id} not found`);
    }
    return issue;
  }

  private async findDetailOrThrow(id: string): Promise<SteelIssueDetail> {
    const bigId = parseBigIntId(id);
    const issue = await this.prisma.steelIssue.findUnique({
      where: { id: bigId },
      include: STEEL_ISSUE_DETAIL_INCLUDE,
    });
    if (!issue) {
      throw new NotFoundException(`Steel issue ${id} not found`);
    }
    return issue;
  }

  private toBundleResponseDto(bundle: SteelIssueDetail['bundles'][number]): CutBundleResponseDto {
    return new CutBundleResponseDto({
      id: bundle.id.toString(),
      proposalPatternId: bundle.proposalPatternId?.toString() ?? null,
      isOffPlan: bundle.proposalPatternId === null,
      barCount: bundle.barCount,
      wastePerBarMm: bundle.wastePerBarMm,
      segments: bundle.segments.map(
        (s) =>
          new CutPatternSegmentResponseDto({
            segmentSpecId: s.segmentSpecId.toString(),
            cutLengthMm: s.segmentSpec.cutLengthMm,
            countPerBar: s.countPerBar,
          }),
      ),
    });
  }

  private toResponseDto(issue: SteelIssueRow, requiredSteps: ProcessStep[]): SteelIssueResponseDto {
    return new SteelIssueResponseDto({
      id: issue.id.toString(),
      productionInvoiceId: issue.productionInvoiceId.toString(),
      piCode: issue.productionInvoice.code,
      salesOrderCode: issue.productionInvoice.salesOrder?.code ?? null,
      materialId: issue.materialId.toString(),
      materialCode: issue.material.code,
      materialName: issue.material.name,
      barLengthMm: issue.barLengthMm,
      barCount: issue.barCount,
      status: issue.status,
      actualBarCount: issue.actualBarCount,
      issuedAt: issue.issuedAt,
      issuedById: issue.issuedById,
      completedAt: issue.completedAt,
      reworkOfId: issue.reworkOfId?.toString() ?? null,
      completedSteps: issue.completedSteps,
      requiredSteps,
    });
  }
}
