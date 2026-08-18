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
  productionOrder: {
    include: { productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } } },
  },
  piece: true,
  material: true,
} satisfies Prisma.SteelIssueInclude;

const STEEL_ISSUE_DETAIL_INCLUDE = {
  ...STEEL_ISSUE_INCLUDE,
  bundles: { include: { segments: { include: { segmentSpec: true } } } },
} satisfies Prisma.SteelIssueInclude;

type SteelIssueRow = Prisma.SteelIssueGetPayload<{ include: typeof STEEL_ISSUE_INCLUDE }>;
type SteelIssueDetail = Prisma.SteelIssueGetPayload<{ include: typeof STEEL_ISSUE_DETAIL_INCLUDE }>;

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
 * CuttingProposal đã APPROVED cho 1 (production_order, piece).
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
    productionOrderId: string,
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
          await this.resolveRequiredSteps(existing.productionOrder.bomRevisionId, existing.pieceId),
        );
      }
    }

    const order = await this.findOrderOrThrow(productionOrderId);
    const pieceBigId = parseBigIntId(dto.pieceId);
    const piece = await this.prisma.piece.findUnique({ where: { id: pieceBigId } });
    if (!piece) {
      throw new NotFoundException(`Piece ${dto.pieceId} not found`);
    }

    const materialId = await this.resolveMaterialForPiece(order.bomRevisionId, pieceBigId);
    const { cuttingProposalId, approvedAt } = await this.assertMaterialInApprovedProposal(
      order.id,
      order.productionInvoiceItem?.productionInvoiceId ?? null,
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
            productionOrderId: order.id,
            pieceId: pieceBigId,
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

    return this.toResponseDto(
      created,
      await this.resolveRequiredSteps(order.bomRevisionId, pieceBigId),
    );
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

  /** Flat, KHÔNG cần productionOrderId - xem ListSteelIssuesQueryDto tại sao endpoint này tồn tại
   *  riêng (permission PHOI_STAFF/KCS_STAFF không đủ để tự resolve productionOrderId). */
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
          requiredStepsMap.get(`${r.productionOrder.bomRevisionId}:${r.pieceId}`) ?? [
            ProcessStep.CAT,
          ],
        ),
      ),
      meta: result.meta,
    };
  }

  async findAllForOrder(
    productionOrderId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<SteelIssueResponseDto>> {
    const bigId = parseBigIntId(productionOrderId);
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.steelIssue.findMany({ ...args, include: STEEL_ISSUE_INCLUDE }),
        count: (args) => this.prisma.steelIssue.count(args),
      },
      query,
      { productionOrderId: bigId },
      { issuedAt: 'desc' as const },
    );
    const requiredStepsMap = await this.attachRequiredStepsMap(result.data);
    return {
      data: result.data.map((r) =>
        this.toResponseDto(
          r,
          requiredStepsMap.get(`${r.productionOrder.bomRevisionId}:${r.pieceId}`) ?? [
            ProcessStep.CAT,
          ],
        ),
      ),
      meta: result.meta,
    };
  }

  async findOne(id: string): Promise<SteelIssueResponseDto> {
    const issue = await this.findOneOrThrow(id);
    return this.toResponseDto(
      issue,
      await this.resolveRequiredSteps(issue.productionOrder.bomRevisionId, issue.pieceId),
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
      await this.resolveRequiredSteps(updated.productionOrder.bomRevisionId, updated.pieceId),
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
      issue.productionOrder.bomRevisionId,
      issue.pieceId,
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
      issue.productionOrder.bomRevisionId,
      issue.pieceId,
    );
    if (!requiredSteps.includes(dto.step)) {
      throw new BadRequestException(
        `Công đoạn ${dto.step} không thuộc danh sách công đoạn đã chọn sẵn của mảnh này`,
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

  /** Union processSteps của mọi PieceBom (bomRevisionId, pieceId) + CAT mặc định (công đoạn tối
   *  thiểu bắt buộc - luôn xảy ra qua completeCutting). */
  private async resolveRequiredSteps(
    bomRevisionId: bigint,
    pieceId: bigint,
  ): Promise<ProcessStep[]> {
    const rows = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId, pieceId },
      select: { processSteps: true },
    });
    const set = new Set<ProcessStep>([ProcessStep.CAT]);
    for (const row of rows) for (const step of row.processSteps) set.add(step);
    return [...set];
  }

  /** Batch cho findAll/findAllForOrder - 1 query pieceBom cho cả tập bomRevisionId liên quan, gom
   *  trong bộ nhớ (tránh N+1). Key = `${bomRevisionId}:${pieceId}`. */
  private async attachRequiredStepsMap(
    issues: SteelIssueRow[],
  ): Promise<Map<string, ProcessStep[]>> {
    const bomRevisionIds = [...new Set(issues.map((i) => i.productionOrder.bomRevisionId))];
    const rows = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId: { in: bomRevisionIds } },
      select: { bomRevisionId: true, pieceId: true, processSteps: true },
    });
    const byKey = new Map<string, Set<ProcessStep>>();
    for (const row of rows) {
      const key = `${row.bomRevisionId}:${row.pieceId}`;
      const set = byKey.get(key) ?? new Set<ProcessStep>([ProcessStep.CAT]);
      for (const step of row.processSteps) set.add(step);
      byKey.set(key, set);
    }
    const result = new Map<string, ProcessStep[]>();
    for (const [key, set] of byKey) result.set(key, [...set]);
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
        productionOrderId: original.productionOrderId,
        pieceId: original.pieceId,
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

  /** "Cần xuất bao nhiêu" theo mảnh - query trực tiếp, không có bảng cache riêng. */
  async getIssuePlan(productionOrderId: string): Promise<SteelIssuePlanItemResponseDto[]> {
    const order = await this.findOrderOrThrow(productionOrderId);

    const [bomPieces, pieceBoms, issues] = await Promise.all([
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId: order.bomRevisionId },
        include: { piece: true },
      }),
      this.prisma.pieceBom.findMany({
        where: { bomRevisionId: order.bomRevisionId },
        include: { segmentSpec: { include: { material: true } } },
      }),
      // Chỉ đợt gốc (không tính rework) - đúng cách daXuatOf() bên mock cộng dồn.
      this.prisma.steelIssue.findMany({
        where: { productionOrderId: order.id, reworkOfId: null },
        select: { pieceId: true, barCount: true },
      }),
    ]);

    const issuedByPiece = new Map<string, number>();
    for (const i of issues) {
      const key = i.pieceId.toString();
      issuedByPiece.set(key, (issuedByPiece.get(key) ?? 0) + i.barCount);
    }

    const pieceBomsByPiece = new Map<string, typeof pieceBoms>();
    for (const pb of pieceBoms) {
      const key = pb.pieceId.toString();
      const arr = pieceBomsByPiece.get(key) ?? [];
      arr.push(pb);
      pieceBomsByPiece.set(key, arr);
    }

    // B4 Đợt 3c - vật tư THẬT SỰ dùng (đã lọc mảnh nhiều loại sắt) - tính trước để tra
    // remainingToIssue/physicalStockQty ĐÚNG 1 LẦN/vật tư, không lặp theo từng mảnh dù nhiều
    // mảnh dùng chung 1 loại sắt (vd DOAN-DAI/DOAN-NGAN/VIEN-BAN đều dùng STL-HOP-25X50).
    const materialIdsUsed = new Set<bigint>();
    for (const bp of bomPieces) {
      const rows = pieceBomsByPiece.get(bp.pieceId.toString()) ?? [];
      const ids = new Set(rows.map((r) => r.segmentSpec.materialId));
      if (ids.size === 1) materialIdsUsed.add([...ids][0]);
    }
    const stockInfoByMaterial = await this.buildStockInfoByMaterial(order, [...materialIdsUsed]);

    return bomPieces
      .map((bp) => {
        const key = bp.pieceId.toString();
        const rows = pieceBomsByPiece.get(key) ?? [];
        if (rows.length === 0) return null;
        const materialIds = new Set(rows.map((r) => r.segmentSpec.materialId.toString()));
        // Mảnh dùng >1 loại sắt - chưa hỗ trợ ở view này, xem resolveMaterialForPiece().
        if (materialIds.size > 1) return null;
        const requiredSegments =
          rows.reduce((s, r) => s + r.qtyPerPiece * bp.qtyPerUnit, 0) * order.quantity;
        const material = rows[0].segmentSpec.material;
        const stockInfo = stockInfoByMaterial.get(material.id.toString());
        return new SteelIssuePlanItemResponseDto({
          pieceId: key,
          pieceCode: bp.piece.code,
          pieceName: bp.piece.name,
          materialId: material.id.toString(),
          materialCode: material.code,
          materialName: material.name,
          requiredSegments,
          issuedBarCount: issuedByPiece.get(key) ?? 0,
          remainingToIssue: stockInfo?.remainingToIssue ?? null,
          physicalStockQty: stockInfo?.physicalStockQty ?? null,
        });
      })
      .filter((x): x is SteelIssuePlanItemResponseDto => x !== null);
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
    order: { id: bigint; productionInvoiceItem: { productionInvoiceId: bigint | null } | null },
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
      // Cùng điều kiện assertMaterialInApprovedProposal() - phương án đã duyệt phủ đúng lệnh SX
      // này (trực tiếp hoặc qua đợt gộp).
      this.prisma.cuttingProposalLine.findMany({
        where: {
          materialId: { in: materialIds },
          feasible: true,
          cuttingProposal: {
            status: CuttingProposalStatus.APPROVED,
            OR: [
              { productionOrderId: order.id },
              ...(order.productionInvoiceItem?.productionInvoiceId != null
                ? [{ productionInvoiceId: order.productionInvoiceItem.productionInvoiceId }]
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
   * 1 mảnh giả định chỉ dùng 1 loại sắt (mọi đoạn cấu thành cắt từ cùng material, chỉ khác
   * chiều dài) - đúng dữ liệu mock thật (mỗi lineId/mảnh luôn gắn 1 loaiSat). Ném lỗi rõ ràng
   * nếu BOM thật đi ngược giả định này, thay vì âm thầm chọn material đầu tiên.
   */
  private async resolveMaterialForPiece(bomRevisionId: bigint, pieceId: bigint): Promise<bigint> {
    const pieceBoms = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId, pieceId },
      include: { segmentSpec: true },
    });
    if (pieceBoms.length === 0) {
      throw new NotFoundException(
        `Mảnh ${pieceId} không thuộc định mức (BOM) của lệnh sản xuất này`,
      );
    }
    const materialIds = new Set(pieceBoms.map((pb) => pb.segmentSpec.materialId));
    if (materialIds.size > 1) {
      throw new BadRequestException(
        `Mảnh ${pieceId} dùng nhiều hơn 1 loại sắt (${materialIds.size}) - chưa hỗ trợ xuất sắt cho mảnh ghép nhiều loại sắt trong 1 đợt`,
      );
    }
    return [...materialIds][0];
  }

  /**
   * Phương án cắt đã duyệt phủ vật tư này chưa - tính CẢ 2 kiểu neo:
   * - neo thẳng vào lệnh SX này (SKU cắt riêng, đường mặc định), hoặc
   * - neo vào đợt gộp (PI.isMerged) mà SKU của lệnh SX này là thành viên.
   *
   * Thiếu nhánh thứ hai thì Phôi KHÔNG xuất được sắt cho mọi SKU đã gộp: phương án lúc đó nằm ở
   * cấp nhóm, không lệnh SX riêng lẻ nào "sở hữu" nó.
   */
  /**
   * B4 Đợt 2: giờ TRẢ VỀ luôn `cuttingProposal` (id + approvedAt) thay vì chỉ assert/throw - cần
   * `approvedAt` để biết phương án này thuộc "trước" hay "sau" STEEL_ISSUE_RESERVATION_CUTOVER, và
   * cần `id` để tìm đúng StockReservation tương ứng (refType=CUTTING_PROPOSAL, refId=id đó).
   */
  private async assertMaterialInApprovedProposal(
    productionOrderId: bigint,
    productionInvoiceId: bigint | null,
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
            { productionOrderId },
            ...(productionInvoiceId !== null ? [{ productionInvoiceId }] : []),
          ],
        },
      },
      select: { cuttingProposal: { select: { id: true, approvedAt: true } } },
    });
    if (!line) {
      throw new ConflictException(
        `Chưa có phương án cắt (CuttingProposal) đã duyệt và cắt được cho vật tư ${materialId} của lệnh sản xuất ${productionOrderId} - chưa thể xuất sắt`,
      );
    }
    return {
      cuttingProposalId: line.cuttingProposal.id,
      approvedAt: line.cuttingProposal.approvedAt,
    };
  }

  private async findOrderOrThrow(id: string) {
    const bigId = parseBigIntId(id);
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: bigId },
      // productionInvoiceId để biết SKU này có thuộc một đợt cắt gộp không - phương án cắt khi đó
      // neo ở cấp nhóm chứ không ở lệnh SX (xem assertMaterialInApprovedProposal).
      include: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
    });
    if (!order) {
      throw new NotFoundException(`Production order ${id} not found`);
    }
    return order;
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
      productionOrderId: issue.productionOrderId.toString(),
      poNumber: issue.productionOrder.poNumber,
      salesOrderCode: issue.productionOrder.productionInvoiceItem.salesOrder?.code ?? null,
      pieceId: issue.pieceId.toString(),
      pieceCode: issue.piece.code,
      pieceName: issue.piece.name,
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
