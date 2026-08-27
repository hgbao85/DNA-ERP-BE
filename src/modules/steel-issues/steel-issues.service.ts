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
import { StockReservationsService } from '../stock/stock-reservations.service';
import { RecordCutBatchDto } from './dto/record-cut-batch.dto';
import {
  PhoiProgressItemResponseDto,
  PhoiProgressSegmentDto,
} from './dto/phoi-progress-response.dto';
import { CompleteStepDto } from './dto/complete-step.dto';
import { CreateSteelIssueDto } from './dto/create-steel-issue.dto';
import { CutBundleResponseDto, CutPatternSegmentResponseDto } from './dto/cut-bundle-response.dto';
import { ListSteelIssuesQueryDto } from './dto/list-steel-issues-query.dto';
import { PiOrderSummaryResponseDto } from './dto/pi-order-summary-response.dto';
import { RecordStepBatchDto } from './dto/record-step-batch.dto';
import { SteelIssuePlanItemResponseDto } from './dto/steel-issue-plan-item-response.dto';
import { SteelIssueResponseDto } from './dto/steel-issue-response.dto';
import { StepBatchResponseDto, StepBatchSegmentResponseDto } from './dto/step-batch-response.dto';

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
    private readonly stockReservationsService: StockReservationsService,
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
    const { approvedAt } = await this.assertMaterialInApprovedProposal(
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
            // L5 (2026-08-26): rút từ POOL của cả PI+vật tư, không còn 1 cuttingProposalId cụ thể
            // - xem StockReservationsService.drainPool và docstring hàm dưới đây.
            productionInvoiceId: invoice.id,
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
   * phương án duyệt SAU STEEL_ISSUE_RESERVATION_CUTOVER (xem create()).
   *
   * L5 (2026-08-26): rút từ POOL giữ chỗ của (PI, vật tư) qua StockReservationsService.drainPool()
   * - KHÔNG còn khoá cứng vào 1 cuttingProposalId cụ thể. Trước đây tra đúng 1 dòng theo
   * cuttingProposalId do assertMaterialInApprovedProposal() TÌM NGẪU NHIÊN (findFirst không
   * orderBy) trong số các phương án cắt riêng lẻ của từng SKU cùng PI - trong khi hàng mua về lại
   * luôn cộng vào phương án duyệt SAU CÙNG (PurchaseProposal.cuttingProposalId bị ghi đè mỗi lần
   * merge). 2 quy tắc lệch nhau nghĩa là: SKU nào KHÔNG trùng con số `findFirst` chọn được thì
   * giữ chỗ của nó không bao giờ lớn lên dù hàng đã về kho, rồi kẹt cứng (ConflictException) khi
   * Phôi xuất, dù PI đó rõ ràng đã đủ sắt. drainPool() gộp mọi dòng giữ chỗ của PI+vật tư thành 1
   * pool và rút theo tổng - đường lệch đó không còn tồn tại.
   */
  private async consumeReservationAndDeduct(
    tx: PrismaTx,
    input: {
      productionInvoiceId: bigint;
      materialId: bigint;
      barCount: number;
      steelIssueId: bigint;
      issuedById: string;
    },
  ): Promise<void> {
    const { warehouseId } = await this.stockReservationsService.drainPool(tx, {
      productionInvoiceId: input.productionInvoiceId,
      materialId: input.materialId,
      qty: input.barCount,
    });

    // Chặn tồn âm cục bộ (lỗ #2, mục 13.4) - không sửa StockLedgerService.postEntry() dùng chung
    // (nhiều luồng khác hợp lệ phải cho âm, vd kho ảo SUPPLIER) - chặn ngay tại đây, cùng khoá.
    // Phòng ca hiếm: tồn vật lý bị điều chỉnh tay (Admin > Sửa nhanh tồn kho) lệch khỏi giữ chỗ.
    const [stockRow] = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
      SELECT "qty" FROM "stock_quant"
      WHERE "warehouseId" = ${warehouseId} AND "materialId" = ${input.materialId}
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
        fromWarehouseId: warehouseId,
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

  /**
   * Nhập MỘT đợt cắt (append-only, cộng dồn) - thay `completeCutting()` cũ (2026-08-22, làm lại
   * lần 2 sau rollback 08-21).
   *
   * Khác hẳn hàm cũ ở 2 điểm nghiệp vụ:
   *  1. Số đoạn là số Phôi ĐẾM THẬT, không còn chép từ `CuttingProposalPattern`. Hàm cũ bắt chọn
   *     1 kiểu cắt đã duyệt rồi FE bung `pattern.segments` ra làm "số thực cắt" - tức là ghi lại
   *     kế hoạch chứ không ghi thực tế.
   *  2. Không còn one-shot: mỗi ca báo 1 đợt, trạng thái GIỮ NGUYÊN `RECEIVED`. Chuyển sang chờ
   *     KCS là hành động riêng (`finishCutting`) - nút cũ vừa bịa số liệu vừa đổi trạng thái, gộp
   *     2 việc không liên quan.
   *
   * Chốt cân bằng vật chất ngay tại đây (đã kiểm khớp thực tế trên PI-2026-046):
   *   barCount × barLengthMm = barCount × trim + Σ(qty × cutLengthMm) + Σqty × kerf + mauNguyen + scrap
   * `scrapMm` là phần dư, TỰ TÍNH - không bắt Phôi gõ vì không ai cân được đống đầu mẩu. Ra số ÂM
   * nghĩa là cắt ra nhiều hơn lượng sắt đưa vào, bất khả về vật lý nên chặn cứng.
   *
   * CHỈ chạy khi RECEIVED (2026-08-24, vòng 2: gỡ nhánh cho phép QC_PASSED đã thử ở vòng 1 cùng
   * ngày) - phần bù đoạn không đạt sau KCS giờ KHÔNG đi qua đây nữa, Phôi tự bù bằng sắt kiếm
   * ngoài thực tế, không đụng cây sắt kho đã cấp (xem QcReviewsService.reportSegmentDone/recheck).
   */
  async recordCutBatch(id: string, dto: RecordCutBatchDto): Promise<CutBundleResponseDto> {
    const issue = await this.findOneOrThrow(id);
    if (issue.status !== SteelIssueStatus.RECEIVED) {
      throw new ConflictException(
        `Steel issue ${id} đang ở trạng thái ${issue.status} - chỉ RECEIVED mới nhập đợt cắt được`,
      );
    }

    const specIds = dto.segments.map((seg) => parseBigIntId(seg.segmentSpecId));
    if (new Set(specIds.map(String)).size !== specIds.length) {
      throw new BadRequestException(
        'Cùng một cỡ đoạn khai làm nhiều dòng - gộp lại thành 1 dòng (UNIQUE cutBundleId+segmentSpecId)',
      );
    }

    const [specs, usedBars, config, allowedSpecIds] = await Promise.all([
      this.prisma.segmentSpec.findMany({ where: { id: { in: specIds } } }),
      this.prisma.cutBundle.aggregate({
        where: { steelIssueId: issue.id },
        _sum: { barCount: true },
      }),
      this.prisma.systemConfig.findUnique({ where: { id: 1 } }),
      this.findBomSegmentSpecIds(issue.productionInvoiceId),
    ]);

    const specById = new Map(specs.map((sp) => [sp.id.toString(), sp]));
    for (const seg of dto.segments) {
      const spec = specById.get(parseBigIntId(seg.segmentSpecId).toString());
      if (!spec) {
        throw new NotFoundException(`Cỡ đoạn ${seg.segmentSpecId} không tồn tại`);
      }
      // Chặn khai nhầm cỡ của LOẠI SẮT KHÁC vào đợt này - đợt xuất gắn đúng 1 materialId, khai
      // lẫn sang vật tư khác làm hỏng cả tiến độ lẫn cân bằng mà không lộ ra ở đâu.
      if (spec.materialId !== issue.materialId) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm không thuộc loại sắt của đợt xuất này`,
        );
      }
      // Sếp chốt: Phôi chỉ được khai cỡ ĐÃ CÓ TRONG ĐỊNH MỨC. Cắt ra cỡ lạ thì phần sắt đó tự rơi
      // vào phế liệu qua phép trừ cân bằng - đúng về kế toán (sắt không thành chi tiết theo định
      // mức thì không phải thành phẩm).
      if (!allowedSpecIds.has(spec.id.toString())) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm không có trong định mức của lệnh sản xuất này`,
        );
      }
    }

    const alreadyUsed = usedBars._sum.barCount ?? 0;
    if (alreadyUsed + dto.barCount > issue.barCount) {
      throw new BadRequestException(
        `Đợt này dùng ${dto.barCount} cây, đã dùng ${alreadyUsed} cây - vượt ${issue.barCount} cây kho đã giao`,
      );
    }

    // Tính bằng ĐƠN VỊ 1/10 mm trên số nguyên, KHÔNG dùng float: cutLengthMm là Decimal(7,1) (vd
    // 452.7) và chính solver cũng cố ý tránh float nhị phân (SCALING_FACTOR=10 trong
    // de_xuat_logic.py). Cộng dồn vài chục số thập phân bằng float sẽ lệch đúng ở chỗ so sánh
    // scrap < 0, biến sai số làm tròn thành lỗi 400 vô cớ.
    const deci = (n: number) => Math.round(n * 10);
    const trimDeci = deci(config?.solverTrimStartMm ?? 10);
    const kerfDeci = deci(config?.solverBladeWidthMm?.toNumber() ?? 1);
    const mauNguyenMm = dto.mauNguyenMm ?? 0;

    let segmentDeci = 0;
    let pieceCount = 0;
    for (const seg of dto.segments) {
      const spec = specById.get(parseBigIntId(seg.segmentSpecId).toString())!;
      segmentDeci += deci(spec.cutLengthMm.toNumber()) * seg.qty;
      pieceCount += seg.qty;
    }

    const availableDeci = deci(issue.barLengthMm) * dto.barCount;
    const consumedDeci =
      trimDeci * dto.barCount + segmentDeci + kerfDeci * pieceCount + deci(mauNguyenMm);
    const scrapDeci = availableDeci - consumedDeci;
    if (scrapDeci < 0) {
      throw new BadRequestException(
        `Không cân đối: ${dto.barCount} cây x ${issue.barLengthMm}mm = ${availableDeci / 10}mm, ` +
          `nhưng khai ra ${consumedDeci / 10}mm (tề đầu ${(trimDeci * dto.barCount) / 10} + đoạn ` +
          `${segmentDeci / 10} + mạch cưa ${(kerfDeci * pieceCount) / 10} + mẩu nguyên ` +
          `${mauNguyenMm}). Thừa ${-scrapDeci / 10}mm không lấy đâu ra - kiểm lại số đoạn hoặc số cây.`,
      );
    }

    const created = await this.prisma.cutBundle.create({
      data: {
        steelIssueId: issue.id,
        proposalPatternId: dto.proposalPatternId ? parseBigIntId(dto.proposalPatternId) : undefined,
        barCount: dto.barCount,
        mauNguyenMm,
        scrapMm: Math.round(scrapDeci / 10),
        segments: {
          create: dto.segments.map((seg) => ({
            segmentSpecId: parseBigIntId(seg.segmentSpecId),
            qty: seg.qty,
          })),
        },
      },
      include: { segments: { include: { segmentSpec: true } } },
    });
    return this.toBundleResponseDto(created);
  }

  /**
   * "Xong, mời KCS" - RECEIVED sang AWAITING_QC (hoặc IN_PROCESS nếu còn công đoạn chi tiết chưa
   * đánh dấu). CỐ Ý là hành động riêng, KHÔNG tự chuyển khi "Còn lại" về 0: ca cắt thiếu vì sắt
   * hỏng/cong là có thật và vẫn phải đi tiếp được, tự động hoá theo định mức sẽ làm những đợt đó
   * kẹt vĩnh viễn.
   *
   * `actualBarCount` giờ SUY từ tổng các đợt đã nhập, không phải một ô người dùng tự gõ - hai
   * nguồn cho cùng một con số thì kiểu gì cũng lệch.
   */
  async finishCutting(id: string): Promise<SteelIssueResponseDto> {
    const issue = await this.findOneOrThrow(id);
    if (issue.status !== SteelIssueStatus.RECEIVED) {
      throw new ConflictException(
        `Steel issue ${id} đang ở trạng thái ${issue.status} - chỉ RECEIVED mới báo cắt xong được`,
      );
    }
    const used = await this.prisma.cutBundle.aggregate({
      where: { steelIssueId: issue.id },
      _sum: { barCount: true },
    });
    const actualBarCount = used._sum.barCount ?? 0;
    if (actualBarCount === 0) {
      throw new BadRequestException(
        'Chưa nhập đợt cắt nào cho lệnh này - nhập số đoạn đã cắt trước khi mời KCS',
      );
    }

    const requiredSteps = await this.resolveRequiredSteps(
      issue.productionInvoiceId,
      issue.materialId,
    );
    const completedSteps: ProcessStep[] = [ProcessStep.CAT];
    const done = requiredSteps.every((step) => completedSteps.includes(step));

    await this.prisma.steelIssue.update({
      where: { id: issue.id },
      data: {
        status: done ? SteelIssueStatus.AWAITING_QC : SteelIssueStatus.IN_PROCESS,
        completedSteps,
        actualBarCount,
        completedAt: done ? new Date() : null,
      },
    });

    const reloaded = await this.findOneOrThrow(id);
    return this.toResponseDto(reloaded, requiredSteps);
  }

  /**
   * Tập segmentSpecId hợp lệ để khai cắt cho 1 PI = mọi cỡ đoạn xuất hiện trong định mức của mọi
   * ProductionOrder thuộc PI. Dùng để chặn khai cỡ ngoài định mức (xem recordCutBatch).
   */
  private async findBomSegmentSpecIds(productionInvoiceId: bigint): Promise<Set<string>> {
    const orders = await this.findOrdersForInvoice(productionInvoiceId);
    if (orders.length === 0) return new Set();
    const rows = await this.prisma.pieceBom.findMany({
      where: { bomRevisionId: { in: [...new Set(orders.map((o) => o.bomRevisionId))] } },
      select: { segmentSpecId: true },
    });
    return new Set(rows.map((r) => r.segmentSpecId.toString()));
  }

  /**
   * Tiến độ cắt theo (LOẠI SẮT -> CỠ ĐOẠN) cho cả 1 PI - nguồn dữ liệu bảng "Cần / Đã cắt /
   * Còn lại" ở màn Lệnh sản xuất (Phôi).
   *
   * `required` suy từ ĐỊNH MỨC, cố ý KHÔNG lấy từ CuttingProposalPattern: pattern là kế hoạch của
   * solver và thường cắt DƯ (đo thật trên PI-2026-046: dư 26 đoạn ở 11/35 cỡ, vì đoạn ngắn được
   * xếp lấp phần đuôi cây vốn cắt để lấy đoạn dài). Lấy pattern làm mốc thì "Còn lại" không bao
   * giờ về 0 đúng lúc.
   *
   * `done` cộng CẢ đợt rework (không lọc reworkOfId như getIssuePlan): ở đây đang đếm SẢN LƯỢNG
   * thực tế đã cắt ra, mọi đoạn cắt được đều là đoạn thật.
   */
  async getPhoiProgress(productionInvoiceId: string): Promise<PhoiProgressItemResponseDto[]> {
    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);
    const orders = await this.findOrdersForInvoice(invoice.id);
    if (orders.length === 0) return [];

    const bomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const [bomPieces, pieceBoms, issues, cutSegments, qcSegments] = await Promise.all([
      this.prisma.bomPiece.findMany({ where: { bomRevisionId: { in: bomRevisionIds } } }),
      this.prisma.pieceBom.findMany({
        where: { bomRevisionId: { in: bomRevisionIds } },
        include: { segmentSpec: { include: { material: true } } },
      }),
      this.prisma.steelIssue.findMany({
        where: { productionInvoiceId: invoice.id, reworkOfId: null },
        select: { materialId: true, barCount: true },
      }),
      this.prisma.cutPatternSegment.findMany({
        where: { cutBundle: { steelIssue: { productionInvoiceId: invoice.id } } },
        select: { segmentSpecId: true, qty: true },
      }),
      // KCS chấm lỗi theo cỡ đoạn (2026-08-24, vòng 2) - "Đã cắt" giữ nguyên số THÔ (không trừ
      // gì cả, xem doc comment PhoiProgressSegmentDto.done), phần lỗi tách hẳn sang trường
      // "failed" riêng = outstanding (failedQty - resolvedQty, chỉ phần KCS CHƯA duyệt lại đạt).
      this.prisma.qcReviewSegment.findMany({
        where: { qcReview: { steelIssue: { productionInvoiceId: invoice.id } } },
        select: { segmentSpecId: true, failedQty: true, resolvedQty: true },
      }),
    ]);

    const issuedByMaterial = new Map<string, number>();
    for (const i of issues) {
      const key = i.materialId.toString();
      issuedByMaterial.set(key, (issuedByMaterial.get(key) ?? 0) + i.barCount);
    }

    const doneBySpec = new Map<string, number>();
    for (const cs of cutSegments) {
      const key = cs.segmentSpecId.toString();
      doneBySpec.set(key, (doneBySpec.get(key) ?? 0) + cs.qty);
    }
    const failedBySpec = new Map<string, number>();
    for (const qs of qcSegments) {
      const key = qs.segmentSpecId.toString();
      const outstanding = qs.failedQty - qs.resolvedQty;
      failedBySpec.set(key, (failedBySpec.get(key) ?? 0) + outstanding);
    }

    const qtyPerUnitByKey = new Map(
      bomPieces.map((bp) => [`${bp.bomRevisionId}:${bp.pieceId}`, bp.qtyPerUnit]),
    );
    const pieceBomsByRevision = new Map<string, typeof pieceBoms>();
    for (const pb of pieceBoms) {
      const key = pb.bomRevisionId.toString();
      const arr = pieceBomsByRevision.get(key) ?? [];
      arr.push(pb);
      pieceBomsByRevision.set(key, arr);
    }

    // Khoá theo segmentSpecId (không phải cutLengthMm): cutLengthMm là Decimal, 2 Decimal cùng giá
    // trị không === nhau nên dùng làm khoá Map sẽ tách nhầm 1 cỡ thành nhiều dòng. segmentSpecId
    // đã @@unique([materialId, cutLengthMm]) nên khoá theo nó là tương đương mà an toàn.
    const requiredBySpec = new Map<string, number>();
    const specMeta = new Map<
      string,
      { materialId: string; materialCode: string; materialName: string; cutLengthMm: number }
    >();
    const registerSpec = (row: (typeof pieceBoms)[number]) => {
      const specKey = row.segmentSpecId.toString();
      if (!specMeta.has(specKey)) {
        specMeta.set(specKey, {
          materialId: row.segmentSpec.materialId.toString(),
          materialCode: row.segmentSpec.material.code,
          materialName: row.segmentSpec.material.name,
          cutLengthMm: row.segmentSpec.cutLengthMm.toNumber(),
        });
      }
      return specKey;
    };

    // Lặp theo TỪNG order (không phải từng bomRevisionId duy nhất) - mỗi order có quantity riêng,
    // 1 PI gộp có thể chứa nhiều SKU khác bomRevision, mỗi cái đóng góp riêng vào tổng.
    for (const order of orders) {
      const bomKey = order.bomRevisionId.toString();
      for (const row of pieceBomsByRevision.get(bomKey) ?? []) {
        const qtyPerUnit = qtyPerUnitByKey.get(`${bomKey}:${row.pieceId}`) ?? 0;
        const segments = row.qtyPerPiece * qtyPerUnit * order.quantity;
        if (segments <= 0) continue;
        const specKey = registerSpec(row);
        requiredBySpec.set(specKey, (requiredBySpec.get(specKey) ?? 0) + segments);
      }
    }

    // Cỡ ĐÃ cắt nhưng KHÔNG có trong định mức của PI này vẫn phải hiện ra (required = 0) - giấu đi
    // là giấu luôn dữ liệu sai, thợ sẽ không hiểu vì sao cân đối lệch.
    const orphanSpecIds = [...doneBySpec.keys()].filter((k) => !specMeta.has(k));
    if (orphanSpecIds.length > 0) {
      const orphans = await this.prisma.segmentSpec.findMany({
        where: { id: { in: orphanSpecIds.map((k) => BigInt(k)) } },
        include: { material: true },
      });
      for (const o of orphans) {
        specMeta.set(o.id.toString(), {
          materialId: o.materialId.toString(),
          materialCode: o.material.code,
          materialName: o.material.name,
          cutLengthMm: o.cutLengthMm.toNumber(),
        });
      }
    }

    const byMaterial = new Map<string, PhoiProgressItemResponseDto>();
    for (const [specKey, meta] of specMeta) {
      let item = byMaterial.get(meta.materialId);
      if (!item) {
        item = new PhoiProgressItemResponseDto({
          materialId: meta.materialId,
          materialCode: meta.materialCode,
          materialName: meta.materialName,
          issuedBarCount: issuedByMaterial.get(meta.materialId) ?? 0,
          segments: [],
        });
        byMaterial.set(meta.materialId, item);
      }
      const rawDone = doneBySpec.get(specKey) ?? 0;
      const failed = failedBySpec.get(specKey) ?? 0;
      item.segments.push(
        new PhoiProgressSegmentDto({
          segmentSpecId: specKey,
          cutLengthMm: meta.cutLengthMm,
          required: requiredBySpec.get(specKey) ?? 0,
          // BẤT BIẾN - số đã cắt thật, không trừ gì vì lỗi (xem doc comment DTO). "Còn lại" ở FE
          // tự tính required - (done - failed).
          done: rawDone,
          failed,
        }),
      );
    }

    // Cỡ dài trước - thợ cắt đoạn dài trước để phần đuôi còn lại đủ cho đoạn ngắn, đúng thứ tự
    // solver in ra ở bảng hướng dẫn cắt.
    for (const item of byMaterial.values()) {
      item.segments.sort((a, b) => b.cutLengthMm - a.cutLengthMm);
    }
    return [...byMaterial.values()].sort((a, b) => a.materialCode.localeCompare(b.materialCode));
  }

  /**
   * Tiến độ 1 công đoạn chi tiết SAU Cắt (Uốn/Dập/...) theo TỪNG cỡ đoạn cho 1 PI - cùng khuôn
   * dạng "Cần/Đã .../Còn lại" như getPhoiProgress(), khác nguồn `done`: đọc từ StepBatchSegment
   * (bảng mirror CutPatternSegment cho step != CAT, xem RecordStepBatchDto) thay vì
   * CutPatternSegment. `required` CHỈ tính những dòng PieceBom có processSteps chứa đúng step
   * này - khác getPhoiProgress (Cắt áp dụng mặc định cho MỌI dòng, không lọc processSteps, xem
   * resolveRequiredSteps()).
   */
  async getStepProgress(
    productionInvoiceId: string,
    step: ProcessStep,
  ): Promise<PhoiProgressItemResponseDto[]> {
    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);
    const orders = await this.findOrdersForInvoice(invoice.id);
    if (orders.length === 0) return [];

    const bomRevisionIds = [...new Set(orders.map((o) => o.bomRevisionId))];
    const [bomPieces, pieceBoms, issues, stepSegments, qcSegments] = await Promise.all([
      this.prisma.bomPiece.findMany({ where: { bomRevisionId: { in: bomRevisionIds } } }),
      this.prisma.pieceBom.findMany({
        where: { bomRevisionId: { in: bomRevisionIds }, processSteps: { has: step } },
        include: { segmentSpec: { include: { material: true } } },
      }),
      this.prisma.steelIssue.findMany({
        where: { productionInvoiceId: invoice.id, reworkOfId: null },
        select: { materialId: true, barCount: true },
      }),
      this.prisma.stepBatchSegment.findMany({
        where: { stepBatch: { step, steelIssue: { productionInvoiceId: invoice.id } } },
        select: { segmentSpecId: true, qty: true },
      }),
      this.prisma.qcReviewSegment.findMany({
        where: { qcReview: { steelIssue: { productionInvoiceId: invoice.id } } },
        select: { segmentSpecId: true, failedQty: true, resolvedQty: true },
      }),
    ]);

    const issuedByMaterial = new Map<string, number>();
    for (const i of issues) {
      const key = i.materialId.toString();
      issuedByMaterial.set(key, (issuedByMaterial.get(key) ?? 0) + i.barCount);
    }

    const doneBySpec = new Map<string, number>();
    for (const ss of stepSegments) {
      const key = ss.segmentSpecId.toString();
      doneBySpec.set(key, (doneBySpec.get(key) ?? 0) + ss.qty);
    }
    const failedBySpec = new Map<string, number>();
    for (const qs of qcSegments) {
      const key = qs.segmentSpecId.toString();
      const outstanding = qs.failedQty - qs.resolvedQty;
      failedBySpec.set(key, (failedBySpec.get(key) ?? 0) + outstanding);
    }

    const qtyPerUnitByKey = new Map(
      bomPieces.map((bp) => [`${bp.bomRevisionId}:${bp.pieceId}`, bp.qtyPerUnit]),
    );
    const pieceBomsByRevision = new Map<string, typeof pieceBoms>();
    for (const pb of pieceBoms) {
      const key = pb.bomRevisionId.toString();
      const arr = pieceBomsByRevision.get(key) ?? [];
      arr.push(pb);
      pieceBomsByRevision.set(key, arr);
    }

    const requiredBySpec = new Map<string, number>();
    const specMeta = new Map<
      string,
      { materialId: string; materialCode: string; materialName: string; cutLengthMm: number }
    >();
    const registerSpec = (row: (typeof pieceBoms)[number]) => {
      const specKey = row.segmentSpecId.toString();
      if (!specMeta.has(specKey)) {
        specMeta.set(specKey, {
          materialId: row.segmentSpec.materialId.toString(),
          materialCode: row.segmentSpec.material.code,
          materialName: row.segmentSpec.material.name,
          cutLengthMm: row.segmentSpec.cutLengthMm.toNumber(),
        });
      }
      return specKey;
    };

    for (const order of orders) {
      const bomKey = order.bomRevisionId.toString();
      for (const row of pieceBomsByRevision.get(bomKey) ?? []) {
        const qtyPerUnit = qtyPerUnitByKey.get(`${bomKey}:${row.pieceId}`) ?? 0;
        const segments = row.qtyPerPiece * qtyPerUnit * order.quantity;
        if (segments <= 0) continue;
        const specKey = registerSpec(row);
        requiredBySpec.set(specKey, (requiredBySpec.get(specKey) ?? 0) + segments);
      }
    }

    const orphanSpecIds = [...doneBySpec.keys()].filter((k) => !specMeta.has(k));
    if (orphanSpecIds.length > 0) {
      const orphans = await this.prisma.segmentSpec.findMany({
        where: { id: { in: orphanSpecIds.map((k) => BigInt(k)) } },
        include: { material: true },
      });
      for (const o of orphans) {
        specMeta.set(o.id.toString(), {
          materialId: o.materialId.toString(),
          materialCode: o.material.code,
          materialName: o.material.name,
          cutLengthMm: o.cutLengthMm.toNumber(),
        });
      }
    }

    const byMaterial = new Map<string, PhoiProgressItemResponseDto>();
    for (const [specKey, meta] of specMeta) {
      let item = byMaterial.get(meta.materialId);
      if (!item) {
        item = new PhoiProgressItemResponseDto({
          materialId: meta.materialId,
          materialCode: meta.materialCode,
          materialName: meta.materialName,
          issuedBarCount: issuedByMaterial.get(meta.materialId) ?? 0,
          segments: [],
        });
        byMaterial.set(meta.materialId, item);
      }
      item.segments.push(
        new PhoiProgressSegmentDto({
          segmentSpecId: specKey,
          cutLengthMm: meta.cutLengthMm,
          required: requiredBySpec.get(specKey) ?? 0,
          done: doneBySpec.get(specKey) ?? 0,
          failed: failedBySpec.get(specKey) ?? 0,
        }),
      );
    }

    for (const item of byMaterial.values()) {
      item.segments.sort((a, b) => b.cutLengthMm - a.cutLengthMm);
    }
    return [...byMaterial.values()].sort((a, b) => a.materialCode.localeCompare(b.materialCode));
  }

  /**
   * Ghi 1 đợt "đã gia công" cho công đoạn chi tiết SAU Cắt (Uốn/Dập/...) - append-only, cộng dồn,
   * mirror recordCutBatch() nhưng KHÔNG có cân bằng vật chất (bước này không tác động lên cây sắt,
   * chỉ xử lý tiếp trên các đoạn ĐÃ cắt ra). Chặn vượt số đã cắt (catDone) - không thể gia công
   * nhiều hơn số đoạn thực có. CHỈ chạy khi IN_PROCESS, và step chưa nằm trong completedSteps -
   * "Xong {bước}" (completeStep) chốt lại, không nhập thêm được sau đó.
   */
  async recordStepBatch(id: string, dto: RecordStepBatchDto): Promise<StepBatchResponseDto> {
    if (dto.step === ProcessStep.CAT) {
      throw new BadRequestException('Công đoạn Cắt dùng route cut-batches riêng, không qua đây');
    }
    const issue = await this.findOneOrThrow(id);
    if (issue.status !== SteelIssueStatus.IN_PROCESS) {
      throw new ConflictException(
        `Steel issue ${id} đang ở trạng thái ${issue.status} - chỉ IN_PROCESS mới nhập được công đoạn chi tiết`,
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
      throw new ConflictException(
        `Công đoạn ${dto.step} của đợt này đã báo xong - không nhập thêm được`,
      );
    }

    const specIds = dto.segments.map((seg) => parseBigIntId(seg.segmentSpecId));
    if (new Set(specIds.map(String)).size !== specIds.length) {
      throw new BadRequestException('Cùng một cỡ đoạn khai làm nhiều dòng - gộp lại thành 1 dòng');
    }

    const [specs, allowedSpecIds, catDoneRows, stepDoneRows] = await Promise.all([
      this.prisma.segmentSpec.findMany({ where: { id: { in: specIds } } }),
      this.findStepSegmentSpecIds(issue.productionInvoiceId, dto.step),
      this.prisma.cutPatternSegment.findMany({
        where: {
          segmentSpecId: { in: specIds },
          cutBundle: { steelIssue: { productionInvoiceId: issue.productionInvoiceId } },
        },
        select: { segmentSpecId: true, qty: true },
      }),
      this.prisma.stepBatchSegment.findMany({
        where: {
          segmentSpecId: { in: specIds },
          stepBatch: {
            step: dto.step,
            steelIssue: { productionInvoiceId: issue.productionInvoiceId },
          },
        },
        select: { segmentSpecId: true, qty: true },
      }),
    ]);

    const specById = new Map(specs.map((sp) => [sp.id.toString(), sp]));
    const catDoneBySpec = new Map<string, number>();
    for (const r of catDoneRows) {
      const k = r.segmentSpecId.toString();
      catDoneBySpec.set(k, (catDoneBySpec.get(k) ?? 0) + r.qty);
    }
    const stepDoneBySpec = new Map<string, number>();
    for (const r of stepDoneRows) {
      const k = r.segmentSpecId.toString();
      stepDoneBySpec.set(k, (stepDoneBySpec.get(k) ?? 0) + r.qty);
    }

    for (const seg of dto.segments) {
      const specKey = parseBigIntId(seg.segmentSpecId).toString();
      const spec = specById.get(specKey);
      if (!spec) {
        throw new NotFoundException(`Cỡ đoạn ${seg.segmentSpecId} không tồn tại`);
      }
      if (spec.materialId !== issue.materialId) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm không thuộc loại sắt của đợt xuất này`,
        );
      }
      if (!allowedSpecIds.has(specKey)) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm không cần công đoạn ${dto.step} theo định mức`,
        );
      }
      const catDone = catDoneBySpec.get(specKey) ?? 0;
      const stepDoneSoFar = stepDoneBySpec.get(specKey) ?? 0;
      if (stepDoneSoFar + seg.qty > catDone) {
        throw new BadRequestException(
          `Cỡ đoạn ${spec.cutLengthMm.toString()}mm: đã cắt ${catDone} đoạn, đã báo ${dto.step} ` +
            `${stepDoneSoFar} đoạn - không thể báo thêm ${seg.qty} (vượt số đã cắt)`,
        );
      }
    }

    const created = await this.prisma.stepBatch.create({
      data: {
        steelIssueId: issue.id,
        step: dto.step,
        segments: {
          create: dto.segments.map((seg) => ({
            segmentSpecId: parseBigIntId(seg.segmentSpecId),
            qty: seg.qty,
          })),
        },
      },
      include: { segments: { include: { segmentSpec: true } } },
    });

    return new StepBatchResponseDto({
      id: created.id.toString(),
      step: created.step,
      segments: created.segments.map(
        (s) =>
          new StepBatchSegmentResponseDto({
            segmentSpecId: s.segmentSpecId.toString(),
            cutLengthMm: s.segmentSpec.cutLengthMm.toNumber(),
            qty: s.qty,
          }),
      ),
    });
  }

  /** Tập segmentSpecId hợp lệ để khai công đoạn `step` cho 1 PI - mirror findBomSegmentSpecIds()
   *  nhưng lọc thêm processSteps chứa đúng step, vì không phải cỡ đoạn nào cũng cần MỌI công đoạn
   *  (khác Cắt, luôn bắt buộc cho mọi cỡ). */
  private async findStepSegmentSpecIds(
    productionInvoiceId: bigint,
    step: ProcessStep,
  ): Promise<Set<string>> {
    const orders = await this.findOrdersForInvoice(productionInvoiceId);
    if (orders.length === 0) return new Set();
    const rows = await this.prisma.pieceBom.findMany({
      where: {
        bomRevisionId: { in: [...new Set(orders.map((o) => o.bomRevisionId))] },
        processSteps: { has: step },
      },
      select: { segmentSpecId: true },
    });
    return new Set(rows.map((r) => r.segmentSpecId.toString()));
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

  /**
   * Danh sách PO/SKU (ProductionOrder) thuộc 1 PI - khối "tham khảo" cho màn Lệnh sản xuất Phôi.
   * KHÔNG mang số liệu tiến độ (tiến độ chỉ có ở cấp PI × loại sắt, xem getPhoiProgress) - Phôi
   * không biết trước cây sắt về SKU nào lúc cắt (xem changelog
   * 2026-08-19-xuat-sat-theo-pi-hoan-tat.html).
   */
  async getOrderSummary(productionInvoiceId: string): Promise<PiOrderSummaryResponseDto[]> {
    const invoice = await this.findInvoiceOrThrow(productionInvoiceId);
    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: invoice.id } },
      select: {
        poNumber: true,
        quantity: true,
        mfgProduct: { select: { name: true } },
        productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } },
      },
    });
    return orders.map(
      (o) =>
        new PiOrderSummaryResponseDto({
          poNumber: o.poNumber,
          salesOrderCode: o.productionInvoiceItem?.salesOrder?.code ?? null,
          productName: o.mfgProduct.name,
          quantity: o.quantity,
        }),
    );
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
    const stockInfoByMaterial = await this.buildStockInfoByMaterial(invoice.id, materialIdsUsed);

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
    materialIds: bigint[],
  ): Promise<Map<string, { remainingToIssue: number | null; physicalStockQty: number | null }>> {
    const result = new Map<
      string,
      { remainingToIssue: number | null; physicalStockQty: number | null }
    >();
    if (materialIds.length === 0) return result;

    // L5 (2026-08-26): TỔNG cả pool giữ chỗ ACTIVE của (PI, vật tư) - KHÔNG còn tra qua 1
    // cuttingProposalId "đại diện" chọn bằng Map (GHI ĐÈ khi 2 SKU cùng dùng 1 loại sắt - trước
    // đây chỉ thấy giữ chỗ của SKU nào ghi SAU trong mảng `lines`, "còn lại" hiện sai/thiếu cho
    // SKU kia dù Phôi vẫn xuất được bình thường qua drainPool()). Không cần join qua
    // cuttingProposalLine nữa: "không có dòng giữ chỗ ACTIVE nào" (materialId vắng mặt trong
    // reservations) và "chưa có phương án duyệt nào" là 2 điều kiện LUÔN trùng nhau trong thực tế
    // - reserve() chỉ chạy được từ trong CuttingProposalsService.approve() (đã APPROVED), và
    // releaseByRef() (supersede) đánh RELEASED đúng lúc cuttingProposal đó rời khỏi APPROVED - nên
    // giữ đúng ý nghĩa cũ (remainingToIssue=null khi "chưa có gì để biết", không phải "=0") mà
    // không cần truy vấn cuttingProposalLine thêm 1 lần nữa.
    const [materials, reservations] = await Promise.all([
      this.prisma.material.findMany({
        where: { id: { in: materialIds } },
        select: { id: true, warehouseId: true },
      }),
      this.prisma.stockReservation.findMany({
        where: { productionInvoiceId, materialId: { in: materialIds }, status: 'ACTIVE' },
        select: { materialId: true, quantity: true, consumedQty: true },
      }),
    ]);

    const warehouseIdByMaterial = new Map(materials.map((m) => [m.id.toString(), m.warehouseId]));

    const remainingByMaterial = new Map<string, number>();
    for (const r of reservations) {
      const key = r.materialId.toString();
      const remaining = Math.max(0, r.quantity.toNumber() - r.consumedQty.toNumber());
      remainingByMaterial.set(key, (remainingByMaterial.get(key) ?? 0) + remaining);
    }

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
      result.set(key, {
        remainingToIssue: remainingByMaterial.has(key) ? remainingByMaterial.get(key)! : null,
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
  /**
   * Chỉ còn vai trò GUARD (đảm bảo tồn tại ≥1 phương án cắt đã duyệt và cắt được cho vật tư này
   * trong PI) + xác định mốc cutover - KHÔNG còn trả `cuttingProposalId` (L5, 2026-08-26): giữ
   * chỗ giờ tra theo pool của productionInvoiceId (đã có sẵn ở caller, xem
   * StockReservationsService.drainPool), không cần chọn ra 1 phương án cụ thể nữa - loại bỏ hẳn
   * lựa chọn NGẪU NHIÊN cũ của `findFirst` (không orderBy) từng là nguồn gây lệch với
   * PurchaseProposal.cuttingProposalId ở receiveItem() (lỗ #5).
   */
  private async assertMaterialInApprovedProposal(
    productionInvoiceId: bigint,
    productionOrderIds: bigint[],
    materialId: bigint,
  ): Promise<{ approvedAt: Date | null }> {
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
      select: { cuttingProposal: { select: { approvedAt: true } } },
    });
    if (!line) {
      throw new ConflictException(
        `Chưa có phương án cắt (CuttingProposal) đã duyệt và cắt được cho vật tư ${materialId} của PI ${productionInvoiceId} - chưa thể xuất sắt`,
      );
    }
    return { approvedAt: line.cuttingProposal.approvedAt };
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
      mauNguyenMm: bundle.mauNguyenMm,
      scrapMm: bundle.scrapMm,
      segments: bundle.segments.map(
        (s) =>
          new CutPatternSegmentResponseDto({
            segmentSpecId: s.segmentSpecId.toString(),
            cutLengthMm: Number(s.segmentSpec.cutLengthMm),
            qty: s.qty,
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
