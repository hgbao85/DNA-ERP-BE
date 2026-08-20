import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import {
  BomRevisionStatus,
  CuttingProposalStatus,
  NotificationAudience,
  Prisma,
  PurchaseProposalStatus,
  ProdApprovalStatus,
  ProdItemStageType,
  StockReservationRefType,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { ExternalApiHttpError, ExternalApiService } from '../external/external-api.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import {
  CuttingProposalDisplayStatus,
  CuttingProposalResponseDto,
} from './dto/cutting-proposal-response.dto';
import {
  CuttingBatchLevelDto,
  CuttingBatchOrderDto,
  CuttingBatchOutcome,
  CuttingBatchSuggestionDto,
} from './dto/cutting-batch-suggestion.dto';
import {
  CandidateMaterialDto,
  CuttingBatchCandidateDto,
  CuttingBatchCandidateListDto,
  CuttingBatchPreviewDto,
  CuttingBatchPreviewLineDto,
  PreviewCuttingBatchDto,
} from './dto/cutting-batch-candidate.dto';
import { bestWasteAcrossStockLengths } from './best-fill.util';

const SOLVER_PROPOSE_PATH = '/api/v1/de_xuat/propose/';
const SYSTEM_CONFIG_ID = 1;

interface SolverBomRow {
  part: string;
  qty_per_set: number;
  material: string;
  spec: string;
  cut_length: number;
  qty_per_part: number;
}

interface SolverProposeResponse {
  status: string;
  summary: {
    total_bars_all: number;
    total_waste_mm: number;
    waste_percentage: number;
    /// true nếu có ít nhất 1 loại sắt CẮT ĐƯỢC (feasible) nhưng vượt max_waste_percentage với
    /// các stock_lengths cố định - KHÔNG bao phủ ca "hoàn toàn không cắt được" (feasible=false).
    /// Thuần tổng hợp cho hiển thị nhanh; cổng chặn tự-duyệt đọc purchase_plan[].over_threshold
    /// (per-dòng) trực tiếp, không đọc field này (xem autoApproveBlockReason).
    any_over_threshold: boolean;
  };
  purchase_plan: Array<{
    material: string;
    feasible: boolean;
    /// true nếu loại này feasible nhưng vượt max_waste_percentage của CHÍNH nó (riêng hoặc mặc
    /// định). Từ 2026-08-18 (review sau khi bỏ auto_scan): CHẶN tự-duyệt (xem
    /// autoApproveBlockReason) - trước đó cờ này bị bỏ qua, hệ thống từng tự duyệt/trừ kho/tạo
    /// đề xuất mua cho các phương án vượt ngưỡng mà không ai biết. Chỉ có ở dòng feasible=true
    /// (api/views.py không gắn field này cho dòng infeasible).
    over_threshold?: boolean;
    /// Ngưỡng hao hụt % ĐÃ ÁP DỤNG cho loại sắt này (riêng hoặc mặc định) - có ở CẢ 2 nhánh
    /// feasible/infeasible.
    max_waste_pct_threshold?: number | null;
    /// CHỈ có ở dòng feasible=false. true = CP-SAT hết time_limit_seconds mà CHƯA kết luận được
    /// (status UNKNOWN) - KHÁC hẳn infeasible THẬT (đã chứng minh vô nghiệm). Xem
    /// cat_sat/de_xuat_logic.py::_unsolved.
    timed_out?: boolean;
    /// CHỈ có ở dòng feasible=false, và chỉ khi có giá trị (không phải mọi ca infeasible đều có -
    /// xem _best_achievable/_no_solution). "Tốt nhất có thể" nếu chấp nhận nới ngưỡng.
    best_achievable?: { length: number; waste_pct: number; bars: number } | null;
    /// CHỈ có ở dòng feasible=false. Lý do nguyên văn từ solver.
    reason?: string;
    best_stock_length?: number;
    total_bars?: number;
    total_waste_mm?: number;
    waste_percentage?: number;
    /// Mẩu sắt còn nguyên (chưa cắt) từ cây cắt dở của loại sắt này - nhập kho, không phải hao hụt.
    mau_nguyen_mm?: number;
    /// So sánh hao hụt giữa các chiều dài chuẩn đã chấm - thuần hiển thị.
    length_comparison?: Array<{ length: number; bars: number; waste_pct: number }>;
    cutting_patterns?: Array<{
      pattern_id: number;
      bars: number;
      waste_per_bar?: number;
      mau_nguyen_mm?: number;
      pieces_breakdown?: Array<{ size: number; count: number }>;
    }>;
  }>;
}

const LIST_INCLUDE = {
  productionOrder: {
    include: {
      mfgProduct: true,
      productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } },
    },
  },
  // Nhánh phương án cắt cấp nhóm (PI gộp): không có ProductionOrder đơn lẻ nào để lấy poNumber/
  // tên sản phẩm - đọc từ PI và các SKU bên trong nó. Xem toResponseDto.
  productionInvoice: {
    include: {
      items: { include: { mfgProduct: true, salesOrder: { select: { code: true } } } },
    },
  },
} satisfies Prisma.CuttingProposalInclude;

const DETAIL_INCLUDE = {
  ...LIST_INCLUDE,
  lines: {
    include: {
      material: true,
      patterns: { include: { segments: { include: { segmentSpec: true } } } },
    },
  },
} satisfies Prisma.CuttingProposalInclude;

/**
 * Đầu vào đã dựng xong của 1 lần gọi solver. Có 2 nguồn dựng ra nó (xem buildOrderJob/
 * buildInvoiceJob) nhưng phần gọi solver + lưu kết quả dùng chung hoàn toàn.
 */
type SolverJob = {
  /** Nhãn cho log/thông báo QLSX: mã lệnh SX, hoặc mã PI khi cắt chung cả nhóm. */
  label: string;
  numSets: number;
  bomRows: SolverBomRow[];
  segmentSpecLookup: Map<string, bigint>;
};

type CuttingProposalRow = Prisma.CuttingProposalGetPayload<{ include: typeof LIST_INCLUDE }>;
type CuttingProposalDetail = Prisma.CuttingProposalGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/**
 * 1 lần gọi solver cat_sat_iea cho 1 ProductionOrder. Gọi tự động (fire-and-forget) ngay sau
 * khi ProductionOrder được tạo (xem ProductionInvoicesService.approveItem) - KHÔNG chặn
 * response, tạo ngay 1 dòng CALCULATING rồi cập nhật DRAFT/FAILED khi solver trả lời. Tính
 * THÀNH CÔNG là tự động duyệt (approve()) luôn ngay sau đó (Sếp chốt 2026-08-15 - không cần
 * QLSX bấm duyệt riêng), nên chỉ cần 1 lần Sếp duyệt PI item là đi thẳng tới Mua hàng, không
 * dừng lại chờ ai. Cũng dùng lại cho nút "Tính lại" thủ công (có Idempotency-Key).
 */
@Injectable()
export class CuttingProposalsService {
  private readonly logger = new Logger(CuttingProposalsService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly externalApiService: ExternalApiService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly stockReservationsService: StockReservationsService,
  ) {}

  async requestForOrder(
    productionOrderId: bigint,
    options: { idempotencyKey?: string; requestedById?: string } = {},
  ): Promise<CuttingProposalResponseDto> {
    if (options.idempotencyKey) {
      const existing = await this.prisma.cuttingProposal.findUnique({
        where: { idempotencyKey: options.idempotencyKey },
        include: LIST_INCLUDE,
      });
      if (existing) {
        return this.toResponseDto(existing);
      }
    }

    const proposal = await this.prisma.cuttingProposal.create({
      data: {
        productionOrderId,
        idempotencyKey: options.idempotencyKey,
        requestedById: options.requestedById,
      },
      include: LIST_INCLUDE,
    });

    void this.runSolverAndSave(
      proposal.id,
      () => this.buildOrderJob(productionOrderId),
      options.requestedById,
    ).catch((error: unknown) => {
      this.logger.error(
        `Cutting proposal ${proposal.id} (production order ${productionOrderId}) failed: ${
          (error as Error).message
        }`,
      );
    });

    return this.toResponseDto(proposal);
  }

  /**
   * Tính phương án cắt CHUNG cho cả một đợt gộp (PI.isMerged) - gọi tự động khi Sếp duyệt cả cụm
   * (ProductionInvoicesService.approveBatch).
   *
   * Đây là lý do tồn tại của cả tính năng gộp: nhu cầu của mọi SKU trong nhóm được ném vào CÙNG
   * một bài toán, nên các đoạn khác cỡ của các sản phẩm khác nhau xếp chung được lên một cây sắt.
   * Tính riêng từng SKU rồi cộng lại cho ra kết quả y hệt lúc chưa gộp.
   */
  async requestForInvoice(
    productionInvoiceId: bigint,
    options: { idempotencyKey?: string; requestedById?: string } = {},
  ): Promise<CuttingProposalResponseDto> {
    // idempotencyKey đối xứng với requestForOrder() - lời gọi tự động (duyệt cả cụm) không truyền
    // gì (options.idempotencyKey undefined -> luôn tạo mới), còn nút "Tính lại" thủ công cho
    // phiếu gộp (2026-08-19, xem route mới ở controller) gửi kèm để chặn double-click tạo trùng.
    if (options.idempotencyKey) {
      const existing = await this.prisma.cuttingProposal.findUnique({
        where: { idempotencyKey: options.idempotencyKey },
        include: LIST_INCLUDE,
      });
      if (existing) {
        return this.toResponseDto(existing);
      }
    }

    const proposal = await this.prisma.cuttingProposal.create({
      data: {
        productionInvoiceId,
        idempotencyKey: options.idempotencyKey,
        requestedById: options.requestedById,
      },
      include: LIST_INCLUDE,
    });

    void this.runSolverAndSave(
      proposal.id,
      () => this.buildInvoiceJob(productionInvoiceId),
      options.requestedById,
    ).catch((error: unknown) => {
      this.logger.error(
        `Cutting proposal ${proposal.id} (merged PI ${productionInvoiceId}) failed: ${
          (error as Error).message
        }`,
      );
    });

    return this.toResponseDto(proposal);
  }

  /** List toàn hệ thống (không lọc theo PO) - dùng cho màn Admin "Quản lý cắt sắt". */
  async findAll(query: PaginationQueryDto): Promise<Paginated<CuttingProposalResponseDto>> {
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.cuttingProposal.findMany({ ...args, include: LIST_INCLUDE }),
        count: (args) => this.prisma.cuttingProposal.count(args),
      },
      query,
      undefined,
      { requestedAt: 'desc' as const },
    );
    return { data: result.data.map((p) => this.toResponseDto(p)), meta: result.meta };
  }

  async findAllForOrder(
    productionOrderId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<CuttingProposalResponseDto>> {
    const bigId = parseBigIntId(productionOrderId);
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.cuttingProposal.findMany({ ...args, include: LIST_INCLUDE }),
        count: (args) => this.prisma.cuttingProposal.count(args),
      },
      query,
      { productionOrderId: bigId },
      { requestedAt: 'desc' as const },
    );
    return { data: result.data.map((p) => this.toResponseDto(p)), meta: result.meta };
  }

  /**
   * Mọi phương án cắt (mọi trạng thái) phủ 1 PI - gồm CẢ phương án neo thẳng vào PI (đợt gộp,
   * productionInvoiceId) LẪN phương án neo vào từng PO thành viên (SKU cắt riêng, đường mặc
   * định) - cùng logic OR đã dùng ở SteelIssuesService.assertMaterialInApprovedProposal (BE).
   * Dùng cho FE tra đúng pattern đã duyệt khi Phôi báo cắt xong (steel-issues-api.ts), từ khi
   * SteelIssue gộp theo cả PI thay vì theo 1 PO (changelog 2026-08-18-xuat-sat-po-pi-vat-tu.md).
   */
  async findAllForInvoice(
    productionInvoiceId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<CuttingProposalResponseDto>> {
    const bigId = parseBigIntId(productionInvoiceId);
    const orders = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: bigId } },
      select: { id: true },
    });
    const poIds = orders.map((o) => o.id);
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.cuttingProposal.findMany({ ...args, include: LIST_INCLUDE }),
        count: (args) => this.prisma.cuttingProposal.count(args),
      },
      query,
      {
        OR: [
          { productionInvoiceId: bigId },
          ...(poIds.length > 0 ? [{ productionOrderId: { in: poIds } }] : []),
        ],
      },
      { requestedAt: 'desc' as const },
    );
    return { data: result.data.map((p) => this.toResponseDto(p)), meta: result.meta };
  }

  async findOne(id: string): Promise<CuttingProposalResponseDto> {
    const bigId = parseBigIntId(id);
    const proposal = await this.prisma.cuttingProposal.findUnique({
      where: { id: bigId },
      include: DETAIL_INCLUDE,
    });
    if (!proposal) {
      throw new NotFoundException(`Cutting proposal ${id} not found`);
    }
    return this.toDetailResponseDto(proposal);
  }

  /**
   * Gợi ý gộp đợt cắt cho KHSX - CHỈ ĐỌC, không gọi solver, không ghi gì.
   *
   * Trả về từng LOẠI SẮT đang vượt ngưỡng hao hụt, kèm bậc thang "gộp thêm đơn thì xuống bao
   * nhiêu". Tính bằng quy hoạch động (best-fill.util.ts, ~0,2ms/lần) chứ không gọi solver -
   * chấm vài trăm tổ hợp vẫn dưới 100ms.
   *
   * Ứng viên là ProductionInvoiceItem CHƯA được Sếp duyệt. Lý do (chốt với Sếp 2026-08-12): duyệt
   * xong là ProductionOrder ra đời và solver tự chạy riêng cho đơn đó (xem
   * ProductionInvoicesService.approveItem) - gộp phải xong TRƯỚC thời điểm ấy mới có tác dụng.
   *
   * Lọc 1 CHIỀU: chỉ loại sắt vượt ngưỡng mới hiện ra, nhưng đơn được gộp VÀO thì không lọc -
   * chính đơn đang đạt ngưỡng mới là nguồn cỡ đoạn cứu đơn đang vượt. Lọc cả 2 đầu là tính năng
   * chết ngay vì không còn gì để gộp.
   */
  async getBatchSuggestions(): Promise<CuttingBatchSuggestionDto[]> {
    const ctx = await this.loadBatchContext();
    if (ctx === null) return [];
    const { byMaterial, materials, config } = ctx;
    const stockLengths = config.solverStockLengths as number[];
    const trimMm = config.solverTrimStartMm;
    const kerfMm = config.solverBladeWidthMm;

    const suggestions: CuttingBatchSuggestionDto[] = [];
    for (const material of materials) {
      const entries = byMaterial.get(material.id);
      if (!entries) continue;
      const thresholdPct =
        material.maxCuttingWastePercentage?.toNumber() ?? config.solverMaxWastePercentage;

      // Xếp theo hạn gần nhất trước; KHÔNG có hạn thì xuống cuối (không được để dữ liệu thiếu
      // đẩy 1 đơn lên làm mốc neo "gấp nhất").
      const sorted = [...entries].sort((a, b) => {
        const da = this.frameDeadlineOf(a.item);
        const db = this.frameDeadlineOf(b.item);
        if (da === null && db === null) return 0;
        if (da === null) return 1;
        if (db === null) return -1;
        return da.getTime() - db.getTime();
      });

      // Mốc neo = đơn GẤP NHẤT trong số các đơn TỰ NÓ đã vượt ngưỡng. Không lấy đơn gấp nhất nói
      // chung: đơn gấp nhất có thể đang đạt ngưỡng trong khi 1 đơn khác cùng loại sắt thì vượt -
      // lấy nhầm sẽ bỏ sót đúng vấn đề cần giải.
      const anchorIndex = sorted.findIndex(
        (e) =>
          (bestWasteAcrossStockLengths([...e.demand.keys()], stockLengths, trimMm, kerfMm)
            ?.minWastePct ?? Number.POSITIVE_INFINITY) > thresholdPct,
      );
      if (anchorIndex === -1) continue; // mọi đơn của loại sắt này đều đã đạt -> không hiện

      const anchor = sorted[anchorIndex];
      const members = [anchor, ...sorted.filter((_, idx) => idx !== anchorIndex)];

      const levels: CuttingBatchLevelDto[] = [];
      for (let n = 1; n <= members.length; n++) {
        const slice = members.slice(0, n);
        const level = this.buildBatchLevel(slice, stockLengths, trimMm, kerfMm, thresholdPct);
        if (level === null) continue;
        levels.push(level);
        // Dừng ngay khi đạt ngưỡng - gộp thêm chỉ tăng chi phí cắt sớm mà không cần thiết.
        if (level.meetsThreshold) break;
      }
      if (levels.length === 0) continue;

      suggestions.push(
        new CuttingBatchSuggestionDto({
          materialId: material.id.toString(),
          materialCode: material.code,
          materialName: material.name,
          thresholdPct,
          outcome: levels[levels.length - 1].meetsThreshold
            ? CuttingBatchOutcome.FIXED_BY_MERGE
            : CuttingBatchOutcome.UNFIXABLE_BY_MERGE,
          anchor: this.toBatchOrderDto(anchor.item),
          orders: members.map((m) => this.toBatchOrderDto(m.item)),
          levels,
        }),
      );
    }

    // Vấn đề gấp nhất lên đầu; loại "gộp không cứu được" xuống cuối vì không phải việc KHSX làm
    // ngay được (phải sửa thiết kế hoặc ngưỡng).
    return suggestions.sort((a, b) => {
      if (a.outcome !== b.outcome) {
        return a.outcome === CuttingBatchOutcome.FIXED_BY_MERGE ? -1 : 1;
      }
      const da = a.anchor.deadline;
      const db = b.anchor.deadline;
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da.getTime() - db.getTime();
    });
  }

  /**
   * Bảng chọn của KHSX: MỌI SKU chưa được Sếp duyệt, kèm hao hụt từng loại sắt khi SKU đó cắt một
   * mình và cờ vượt ngưỡng.
   *
   * Khác getBatchSuggestions() ở chỗ KHÔNG lọc theo ngưỡng - KHSX cần nhìn toàn cảnh để tự ghép
   * bất kỳ SKU nào (yêu cầu Sếp 2026-08-13). Tổ hợp hệ thống tự đề xuất trả kèm ở
   * `recommendedItemIds` để FE tick sẵn.
   */
  async getBatchCandidates(): Promise<CuttingBatchCandidateListDto> {
    const ctx = await this.loadBatchContext();
    if (ctx === null) {
      return new CuttingBatchCandidateListDto({ items: [], recommendedItemIds: [] });
    }
    const { items, byMaterial, materials, config, itemsWithoutBom } = ctx;
    const stockLengths = config.solverStockLengths as number[];
    const trimMm = config.solverTrimStartMm;
    const kerfMm = config.solverBladeWidthMm;
    const materialById = new Map(materials.map((m) => [m.id, m]));

    // itemId -> các loại sắt của nó (kèm nhu cầu) - đảo chiều byMaterial để dựng theo dòng SKU.
    const materialsByItem = new Map<
      bigint,
      { materialId: bigint; demand: Map<number, number> }[]
    >();
    for (const [materialId, entries] of byMaterial) {
      for (const e of entries) {
        const bucket = materialsByItem.get(e.item.id) ?? [];
        bucket.push({ materialId, demand: e.demand });
        materialsByItem.set(e.item.id, bucket);
      }
    }

    const dtoItems = items.map((item) => {
      const mats = materialsByItem.get(item.id) ?? [];
      return new CuttingBatchCandidateDto({
        productionInvoiceItemId: item.id.toString(),
        mfgProductCode: item.mfgProduct.factoryCode,
        mfgProductName: item.mfgProduct.name,
        quantity: item.quantity,
        salesOrderCode: item.productionInvoice.salesOrder?.code ?? null,
        productionInvoiceCode: item.productionInvoice.code,
        deadline: this.frameDeadlineOf(item),
        prodApprovalStatus: item.prodApprovalStatus,
        rejectReason: item.rejectReason,
        hasActiveBom: !itemsWithoutBom.has(item.id),
        materials: mats
          .map(({ materialId, demand }) => {
            const material = materialById.get(materialId);
            if (!material) return null;
            const thresholdPct =
              material.maxCuttingWastePercentage?.toNumber() ?? config.solverMaxWastePercentage;
            const best = bestWasteAcrossStockLengths(
              [...demand.keys()],
              stockLengths,
              trimMm,
              kerfMm,
            );
            // Không cắt nổi ở mọi chiều dài mua được -> coi như vượt ngưỡng tuyệt đối, KHÔNG ẩn đi.
            const wastePct = best?.minWastePct ?? 100;
            return new CandidateMaterialDto({
              materialId: material.id.toString(),
              materialCode: material.code,
              materialName: material.name,
              standaloneWastePct: wastePct,
              standaloneMinBars: this.minBarsFor(demand, stockLengths, trimMm, kerfMm),
              thresholdPct,
              overThreshold: wastePct > thresholdPct,
              // Các SKU KHÁC cùng dùng loại sắt này - chính là danh sách "gộp được với ai".
              mergeableWithSkus: (byMaterial.get(materialId) ?? [])
                .filter((e) => e.item.id !== item.id)
                .map((e) => e.item.mfgProduct.factoryCode),
            });
          })
          .filter((m): m is CandidateMaterialDto => m !== null)
          .sort((a, b) => b.standaloneWastePct - a.standaloneWastePct),
      });
    });

    // Tổ hợp đề xuất = hợp của mọi SKU xuất hiện ở mức gộp cuối (mức tối thiểu đủ đạt) của các
    // loại sắt CỨU ĐƯỢC. Loại "gộp không cứu được" không đưa vào - tick sẵn một nhóm vô ích chỉ
    // khiến KHSX gộp nhầm.
    const suggestions = await this.getBatchSuggestions();
    const recommended = new Set<string>();
    for (const s of suggestions) {
      if (s.outcome !== CuttingBatchOutcome.FIXED_BY_MERGE) continue;
      const last = s.levels[s.levels.length - 1];
      if (!last?.meetsThreshold) continue;
      for (const o of s.orders.slice(0, last.orderCount)) {
        recommended.add(o.productionInvoiceItemId);
      }
    }

    return new CuttingBatchCandidateListDto({
      items: dtoItems.sort((a, b) => {
        // SKU có loại sắt vượt ngưỡng lên đầu, rồi tới hạn gần nhất.
        const oa = a.materials.some((m) => m.overThreshold) ? 0 : 1;
        const ob = b.materials.some((m) => m.overThreshold) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        if (a.deadline === null && b.deadline === null) return 0;
        if (a.deadline === null) return 1;
        if (b.deadline === null) return -1;
        return a.deadline.getTime() - b.deadline.getTime();
      }),
      recommendedItemIds: [...recommended],
    });
  }

  /**
   * Tính thử cho ĐÚNG tổ hợp SKU mà KHSX đang tick - chỉ đọc, không gọi solver, không ghi gì.
   * Mỗi loại sắt 1 dòng; loại nào chỉ 1 SKU trong tổ hợp dùng thì vẫn hiện (bớt 0 cây) để KHSX
   * thấy gộp không giúp gì cho nó, thay vì tưởng đã tối ưu hết.
   */
  async previewBatch(dto: PreviewCuttingBatchDto): Promise<CuttingBatchPreviewDto> {
    const selectedIds = new Set(dto.productionInvoiceItemIds.map((id) => parseBigIntId(id)));
    const ctx = await this.loadBatchContext();
    if (ctx === null) {
      return new CuttingBatchPreviewDto({ lines: [], totalBarsSaved: 0, daysCutEarly: null });
    }
    const { byMaterial, materials, config } = ctx;
    const stockLengths = config.solverStockLengths as number[];
    const trimMm = config.solverTrimStartMm;
    const kerfMm = config.solverBladeWidthMm;

    const lines: CuttingBatchPreviewLineDto[] = [];
    for (const material of materials) {
      const members = (byMaterial.get(material.id) ?? []).filter((e) => selectedIds.has(e.item.id));
      if (members.length === 0) continue;
      const thresholdPct =
        material.maxCuttingWastePercentage?.toNumber() ?? config.solverMaxWastePercentage;
      const level = this.buildBatchLevel(members, stockLengths, trimMm, kerfMm, thresholdPct);
      if (level === null) continue;
      lines.push(
        new CuttingBatchPreviewLineDto({
          materialId: material.id.toString(),
          materialCode: material.code,
          materialName: material.name,
          thresholdPct,
          contributingSkus: members.map((m) => m.item.mfgProduct.factoryCode),
          cutSizesMm: level.cutSizesMm,
          minWastePct: level.minWastePct,
          minBars: level.minBars,
          barsSeparate: level.barsSeparate,
          barsSavedVsSeparate: level.barsSavedVsSeparate,
          meetsThreshold: level.meetsThreshold,
          daysCutEarly: level.daysCutEarly,
        }),
      );
    }

    // Độ lệch hạn tính trên TOÀN tổ hợp, không phải từng loại sắt: cả đợt cắt cùng một lúc.
    const deadlines = [...selectedIds]
      .map((id) => ctx.items.find((i) => i.id === id))
      .filter((i): i is (typeof ctx.items)[number] => i !== undefined)
      .map((i) => this.frameDeadlineOf(i))
      .filter((d): d is Date => d !== null)
      .map((d) => d.getTime());

    return new CuttingBatchPreviewDto({
      lines: lines.sort((a, b) => b.barsSavedVsSeparate - a.barsSavedVsSeparate),
      totalBarsSaved: lines.reduce((s, l) => s + l.barsSavedVsSeparate, 0),
      daysCutEarly:
        deadlines.length >= 2
          ? Math.round((Math.max(...deadlines) - Math.min(...deadlines)) / 86_400_000)
          : null,
    });
  }

  /**
   * Nạp dữ liệu nền dùng chung cho cả 3 endpoint gộp đợt cắt. Trả null khi không có SKU nào đang
   * chờ duyệt (khỏi bắn tiếp 4 truy vấn vô ích).
   */
  private async loadBatchContext() {
    const items = await this.prisma.productionInvoiceItem.findMany({
      where: {
        // "Sếp chưa duyệt" = chưa APPROVED. PHẢI viết dạng OR có nhánh null: item vừa sinh từ đơn
        // hàng mang prodApprovalStatus = null (KHSX chưa gửi QLSX) và `notIn` của SQL KHÔNG khớp
        // NULL, dùng notIn sẽ loại mất đúng nhóm đơn mới nhất - tức nhóm cần gộp nhất.
        //
        // REJECTED nằm trong danh sách có chủ đích: Sếp từ chối một đợt gộp thì các SKU trong đó
        // phải QUAY LẠI đây để KHSX gộp tổ hợp khác (yêu cầu Sếp 2026-08-14) - thiếu nhánh này thì
        // SKU bị từ chối biến mất khỏi hệ thống, không ai gộp lại được.
        OR: [
          { prodApprovalStatus: null },
          {
            prodApprovalStatus: {
              in: [
                ProdApprovalStatus.WAITING_QLSX,
                ProdApprovalStatus.WAITING_BOSS,
                ProdApprovalStatus.REJECTED,
              ],
            },
          },
        ],
        // Đang nằm trong một đợt gộp rồi thì không hiện ra để gộp tiếp - tránh KHSX vô tình gộp
        // chồng và làm sai phương án cắt của đợt kia.
        productionInvoice: { isMerged: false },
      },
      include: {
        mfgProduct: true,
        stages: true,
        productionInvoice: { include: { salesOrder: true } },
      },
    });
    if (items.length === 0) return null;

    // Chưa có ProductionOrder (chỉ sinh khi duyệt) nên chưa có bomRevisionId ghim sẵn -> lấy bản
    // định mức đang ACTIVE tại thời điểm chấm. Sản phẩm chưa có bản ACTIVE thì không tính được,
    // nhưng VẪN trả về dòng đó (cờ hasActiveBom=false) - im lặng bỏ sẽ khiến KHSX tưởng SKU đó
    // không có vấn đề gì.
    const mfgProductIds = [...new Set(items.map((i) => i.mfgProductId))];
    const activeRevisions = await this.prisma.bomRevision.findMany({
      where: { mfgProductId: { in: mfgProductIds }, status: BomRevisionStatus.ACTIVE },
      select: { id: true, mfgProductId: true },
    });
    const revisionByProduct = new Map(activeRevisions.map((r) => [r.mfgProductId, r.id]));
    const itemsWithoutBom = new Set(
      items.filter((i) => !revisionByProduct.has(i.mfgProductId)).map((i) => i.id),
    );
    if (itemsWithoutBom.size > 0) {
      this.logger.warn(
        `Gộp đợt cắt: ${itemsWithoutBom.size} item chưa có BomRevision ACTIVE nên không tính được ` +
          `(id: ${[...itemsWithoutBom].map((id) => id.toString()).join(', ')})`,
      );
    }

    const perSetByRevision = await this.buildPerSetDemandByRevision([
      ...revisionByProduct.values(),
    ]);
    const config = await this.prisma.systemConfig.findUniqueOrThrow({
      where: { id: SYSTEM_CONFIG_ID },
    });

    // Nhu cầu TUYỆT ĐỐI theo loại sắt: materialId -> danh sách (SKU, nhu cầu theo cỡ đoạn)
    const byMaterial = new Map<
      bigint,
      { item: (typeof items)[number]; demand: Map<number, number> }[]
    >();
    for (const item of items) {
      const revisionId = revisionByProduct.get(item.mfgProductId);
      if (revisionId === undefined) continue;
      const perSet = perSetByRevision.get(revisionId);
      if (!perSet) continue;
      for (const [materialId, byCutLength] of perSet) {
        const demand = new Map<number, number>();
        for (const [cutLengthMm, qtyPerSet] of byCutLength) {
          const total = qtyPerSet * item.quantity;
          if (total > 0) demand.set(cutLengthMm, total);
        }
        if (demand.size === 0) continue;
        const bucket = byMaterial.get(materialId) ?? [];
        bucket.push({ item, demand });
        byMaterial.set(materialId, bucket);
      }
    }
    if (byMaterial.size === 0) return null;

    const materials = await this.prisma.material.findMany({
      where: { id: { in: [...byMaterial.keys()] } },
      select: { id: true, code: true, name: true, maxCuttingWastePercentage: true },
    });

    return { items, byMaterial, materials, config, itemsWithoutBom };
  }

  /**
   * Duyệt phương án cắt cuối cùng - Phôi cắt theo pattern của bản này (7.2 doc gốc). Đồng thời
   * tự sinh 1 PurchaseProposal (Phase 8 - Mua hàng, rút gọn: chỉ vật tư sắt) cho các dòng khả
   * thi (feasible, totalBars > 0) - không có API tạo thủ công, Mua hàng chỉ tiêu thụ bản ghi
   * này. `buyQty` = phần THIẾU (totalBars - phần lấy được từ tồn khả dụng).
   *
   * B4 Đợt 2 (Sếp chốt 2026-08-17, xem changelog mục 13): bước này KHÔNG còn trừ tồn vật lý
   * thật (StockLedger) - chỉ GIỮ CHỖ (StockReservation, qua stockReservationsService). Tồn vật
   * lý chỉ giảm khi SteelIssuesService.create() ghi nhận Phôi thực sự lấy sắt. `actualStock` mỗi
   * dòng vẫn chụp tồn VẬT LÝ thật (stock_quant, có khoá FOR UPDATE chống đọc trùng số dư) để
   * hiển thị/audit - `consumeQty`/`buyQty` tính theo tồn KHẢ DỤNG (onHand trừ phần đã giữ chỗ),
   * 2 con số khác nhau, không được lẫn.
   *
   * Kho nguồn (tồn có sẵn) và kho xuất KHÔNG còn hardcode "phoi-son-han" (Sếp chốt 2026-08-15,
   * mục 2: mỗi vật tư nhập/xuất đúng theo Kho đã khai trên chính vật tư đó - Material.warehouseId,
   * xem MaterialsService.create()) - tra động theo TỪNG vật tư trong buyableLines, không còn giả
   * định cả phương án cắt chung 1 kho.
   *
   * `actorUserId` = null khi gọi TỰ ĐỘNG từ runSolverAndSave() (Sếp chốt 2026-08-15, mục 1: không
   * cần QLSX bấm duyệt riêng - tính xong là duyệt luôn); vẫn nhận string thật khi gọi qua endpoint
   * thủ công POST /:id/approve (dự phòng cho ca hiếm auto-duyệt lỗi, xem runSolverAndSave()).
   */
  async approve(id: string, actorUserId: string | null): Promise<CuttingProposalResponseDto> {
    const bigId = parseBigIntId(id);
    const proposal = await this.prisma.cuttingProposal.findUnique({
      where: { id: bigId },
      include: { lines: true },
    });
    if (!proposal) {
      throw new NotFoundException(`Cutting proposal ${id} not found`);
    }
    if (proposal.status !== CuttingProposalStatus.DRAFT) {
      throw new ConflictException(
        `Cutting proposal ${id} ở trạng thái ${proposal.status} - chỉ DRAFT mới duyệt được`,
      );
    }

    const buyableLines = proposal.lines.filter(
      (line) => line.feasible && line.totalBars != null && line.totalBars > 0,
    );

    // materialId -> kho đã khai cho chính vật tư đó (Material.warehouseId) - nguồn xác thực duy
    // nhất cho "vật tư này tồn/nhập ở kho nào", KHÔNG còn 1 hằng số dùng chung cho cả phương án.
    const warehouseByMaterialId = new Map<bigint, { warehouseId: bigint; warehouseCode: string }>();
    if (buyableLines.length > 0) {
      const materials = await this.prisma.material.findMany({
        where: { id: { in: [...new Set(buyableLines.map((l) => l.materialId))] } },
        select: {
          id: true,
          code: true,
          warehouseId: true,
          warehouse: { select: { code: true } },
        },
      });
      for (const m of materials) {
        if (!m.warehouseId || !m.warehouse) {
          throw new BadRequestException(
            `Vật tư ${m.code} chưa được cấu hình Kho - vào Admin > Vật tư để gán Kho trước khi duyệt phương án cắt`,
          );
        }
        warehouseByMaterialId.set(m.id, {
          warehouseId: m.warehouseId,
          warehouseCode: m.warehouse.code,
        });
      }
    }

    // "Anh em cùng nhóm" phải bám theo ĐÚNG cái neo của chính phương án này. CuttingProposal neo
    // vào đúng MỘT trong hai (productionOrderId cho SKU cắt riêng, productionInvoiceId cho đợt
    // gộp) - quy ước ở tầng service, không có CHECK constraint, nên phải tự phân nhánh ở đây.
    //
    // Lọc thẳng `productionOrderId: proposal.productionOrderId` như trước là BUG THẬT: với phương
    // án của PI gộp trường đó luôn null, Prisma dịch thành `WHERE "productionOrderId" IS NULL` và
    // khớp MỌI phương án gộp khác trong hệ thống - duyệt nhóm A đá bay phương án đang chờ của
    // nhóm B không liên quan (tái hiện được bằng 2 nhóm gộp độc lập chạy song song).
    const siblingAnchor = proposal.productionOrderId
      ? { productionOrderId: proposal.productionOrderId }
      : proposal.productionInvoiceId
        ? { productionInvoiceId: proposal.productionInvoiceId }
        : null;

    const updated = await this.prisma.$transaction(
      async (tx) => {
        // Khoá chính dòng phương án rồi ĐỌC LẠI trạng thái: kiểm tra DRAFT ở trên nằm ngoài
        // transaction nên là đọc-rồi-ghi kinh điển - 2 request duyệt cùng lúc đều thấy DRAFT, đều đi
        // tiếp, tạo 2 PurchaseProposal cho cùng một nhu cầu và trừ kho 2 lần. Từ đây mọi lượt duyệt
        // cùng một phương án bị xếp hàng, và khoá chỉ nhả khi bút toán kho phía dưới đã ghi xong.
        const [locked] = await tx.$queryRaw<{ status: CuttingProposalStatus }[]>`
        SELECT "status" FROM "cutting_proposals" WHERE "id" = ${bigId} FOR UPDATE
      `;
        if (!locked) {
          throw new NotFoundException(`Cutting proposal ${id} not found`);
        }
        if (locked.status !== CuttingProposalStatus.DRAFT) {
          throw new ConflictException(
            `Cutting proposal ${id} ở trạng thái ${locked.status} - chỉ DRAFT mới duyệt được`,
          );
        }

        // siblingAnchor null = phương án không neo vào đâu (dữ liệu hỏng, không sinh ra được qua
        // requestForOrder/requestForInvoice) - không có "anh em" nào để xác định, thà bỏ qua bước
        // supersede còn hơn quét trúng toàn bộ bảng.
        if (siblingAnchor) {
          // Cần biết ĐÚNG id của từng phương án bị supersede để giải phóng giữ chỗ của nó (B4 Đợt
          // 3b, lỗ #4) - updateMany() không trả lại danh sách id đã đổi, nên tách findMany trước.
          // Số lượng "anh em" thực tế gần như luôn 0-1, chi phí thêm 1 query không đáng kể.
          const superseded = await tx.cuttingProposal.findMany({
            where: {
              ...siblingAnchor,
              id: { not: bigId },
              status: { in: [CuttingProposalStatus.DRAFT, CuttingProposalStatus.APPROVED] },
            },
            select: { id: true },
          });
          if (superseded.length > 0) {
            await tx.cuttingProposal.updateMany({
              where: { id: { in: superseded.map((s) => s.id) } },
              data: { status: CuttingProposalStatus.SUPERSEDED },
            });
            // PHẢI release TRƯỚC bước tính available của chính lượt duyệt đang chạy (dưới đây) -
            // nếu không, "Tính lại" sẽ không thấy được phần tồn/hàng-đang-chờ-về mà phương án cũ
            // đang giữ, báo thiếu và đi mua trùng oan (mục 13.4 lỗ #4). Không hoàn phần đã tiêu
            // (consumedQty) - sắt đã rời kho vật lý thật, không có gì để trả lại.
            for (const s of superseded) {
              await this.stockReservationsService.releaseByRef(tx, {
                refType: StockReservationRefType.CUTTING_PROPOSAL,
                refId: s.id.toString(),
              });
            }
          }
        }
        const result = await tx.cuttingProposal.update({
          where: { id: bigId },
          data: {
            status: CuttingProposalStatus.APPROVED,
            approvedAt: new Date(),
            approvedById: actorUserId,
          },
          include: LIST_INCLUDE,
        });

        const consumptions: { materialId: bigint; consumeQty: number; warehouseId: bigint }[] = [];

        if (buyableLines.length > 0) {
          const items: { materialId: bigint; buyQty: number; actualStock: number }[] = [];
          // Khoá theo THỨ TỰ materialId tăng dần, không theo thứ tự dòng trong phương án: 2 phương
          // án gộp chạm cùng 2 loại sắt theo thứ tự ngược nhau sẽ khoá chéo và deadlock. Thứ tự
          // khoá nhất quán toàn hệ thống là cách chuẩn để loại hẳn ca đó.
          const orderedLines = [...buyableLines].sort((a, b) =>
            a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0,
          );
          for (const line of orderedLines) {
            const { warehouseId } = warehouseByMaterialId.get(line.materialId)!;
            // Khoá dòng stock_quant liên quan trong lúc tính "tồn khả dụng" - chặn 2 phương án
            // cắt cùng vật tư được duyệt gần như đồng thời cùng đọc thấy 1 số dư (giống pattern
            // WarehouseTransfersService.createTransfer()). Khoá này CHỈ có tác dụng vì bút toán
            // trừ kho nằm trong cùng transaction ở dưới - trigger trg_sync_stock_quant cập nhật
            // stock_quant lúc INSERT stock_ledger, nên nếu bút toán ra ngoài transaction thì khoá
            // đã nhả trước khi số dư kịp đổi và lượt duyệt kế tiếp vẫn đọc thấy số cũ.
            const locked = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
            SELECT "qty" FROM "stock_quant"
            WHERE "warehouseId" = ${warehouseId} AND "materialId" = ${line.materialId}
            FOR UPDATE
          `;
            const onHand = Math.floor(locked[0]?.qty.toNumber() ?? 0);
            // B4 Đợt 2 (mục 13 changelog): available = onHand trừ phần đã giữ chỗ bởi phương án
            // khác (kể cả từ luồng chuyển kho) - KHÔNG dùng onHand trực tiếp nữa, nếu không 2
            // phương án cùng vật tư duyệt gần nhau sẽ lại cùng thấy tồn còn nguyên (đúng lỗ đã vá ở
            // dưới bằng FOR UPDATE, giờ tái hiện qua đường giữ chỗ nếu quên bước này).
            const available = await this.stockReservationsService.getAvailableQty(
              tx,
              warehouseId,
              line.materialId,
              onHand,
            );
            const totalBars = line.totalBars!;
            const consumeQty = Math.min(totalBars, available);
            const buyQty = totalBars - consumeQty;

            // actualStock vẫn là TỒN VẬT LÝ THẬT (onHand) - không đổi ý nghĩa field này sang
            // "khả dụng". Đây là số hiển thị cho người xem (audit "lúc duyệt kho có bao nhiêu cây
            // thật"); available chỉ dùng nội bộ để tính consumeQty/buyQty ở trên.
            items.push({ materialId: line.materialId, buyQty, actualStock: onHand });
            if (consumeQty > 0) {
              consumptions.push({ materialId: line.materialId, consumeQty, warehouseId });
            }
          }

          // Nếu tồn hiện có đã đủ dùng cho MỌI dòng (buyQty=0 khắp nơi) thì không có gì để mua -
          // tạo thẳng ở PURCHASED thay vì NEW, nếu không đề xuất sẽ kẹt vĩnh viễn ở PURCHASING: cờ
          // "mọi item đã nhận đủ -> PURCHASED" chỉ được kiểm tra bên trong receiveItem() (xem dưới),
          // nhưng receiveItem() không bao giờ được gọi khi buyQty=0 cho mọi dòng - đúng luồng đọc,
          // NhapKhoPage tự hiện "Đã nhận đủ" ngay (receivedQty 0 >= buyQty 0) nên không có nút xác
          // nhận nào để bấm (phát hiện qua e2e/golden-path.spec.ts khi tồn kho tích luỹ đủ qua nhiều
          // lần chạy demo, D.p7-zero-buyqty-stuck).
          const allCovered = items.every((it) => it.buyQty === 0);
          // warehouseCode cấp cả đề xuất giờ CHỈ mang tính tóm tắt/hiển thị (lấy theo dòng đầu tiên)
          // - nguồn xác thực thật để nhập hàng là PurchaseProposalItem.materialId -> Material.
          // warehouseId, xem PurchaseProposalsService.receiveItem(). Hiện luôn trùng 1 kho vì
          // cat_sat_iea chỉ tính vật tư sắt, nhưng KHÔNG còn là giả định cứng của code.
          const primaryWarehouseCode = warehouseByMaterialId.get(
            buyableLines[0].materialId,
          )!.warehouseCode;
          await tx.purchaseProposal.create({
            data: {
              cuttingProposalId: bigId,
              warehouseCode: primaryWarehouseCode,
              items: { create: items },
              ...(allCovered
                ? { status: PurchaseProposalStatus.PURCHASED, purchasedAt: new Date() }
                : {}),
            },
          });
        }

        // B4 Đợt 2 (mục 13 changelog 2026-08-15): approve() KHÔNG còn trừ tồn thật (StockLedger) -
        // chỉ GIỮ CHỖ. Tồn vật lý chỉ giảm khi SteelIssuesService.create() ghi nhận Phôi thực sự
        // lấy sắt (xem STEEL_ISSUE_RESERVATION_CUTOVER ở đó cho cách xử lý phương án đã duyệt
        // TRƯỚC mốc đổi này - những phương án đó đã bị trừ tồn theo cơ chế CŨ, không được trừ lần 2).
        // Việc đọc tồn - quyết định consumeQty - ghi giữ chỗ vẫn nằm trọn trong 1 khoá, 1 commit như
        // trước (lý do giữ FOR UPDATE ở trên không đổi: 2 phương án cùng vật tư duyệt gần nhau vẫn
        // phải xếp hàng, chỉ là phần "ăn" giờ là giữ chỗ thay vì trừ tồn thẳng).
        for (const { materialId, consumeQty, warehouseId } of consumptions) {
          await this.stockReservationsService.reserve(
            {
              warehouseId,
              materialId,
              qty: consumeQty,
              refType: StockReservationRefType.CUTTING_PROPOSAL,
              refId: bigId.toString(),
              createdById: actorUserId ?? undefined,
            },
            tx,
          );
        }

        return result;
      },
      // Mặc định 5s của Prisma là quá sát: FOR UPDATE có thể phải CHỜ transaction khác nhả khoá
      // (đúng ca ta vừa dựng ra), cộng thêm N bút toán + trigger stock_quant cho phương án gộp
      // nhiều loại sắt. Bản thân các câu lệnh chỉ tốn mili-giây, nới trần là để chờ khoá.
      { timeout: 15_000 },
    );

    return this.toResponseDto(updated);
  }

  /**
   * `buildJob` nhận vào dạng callback (không phải dữ liệu dựng sẵn) có chủ đích: dựng đầu vào cũng
   * là chỗ hay hỏng nhất (thiếu BomRevision, thiếu dòng định mức) và phải nằm TRONG try/catch này
   * để lỗi đó được ghi lại thành CuttingProposal FAILED có lý do, thay vì ném ra ngoài rồi mất dấu.
   */
  private async runSolverAndSave(
    proposalId: bigint,
    buildJob: () => Promise<SolverJob>,
    requestedById?: string,
  ): Promise<void> {
    let poNumber: string | undefined;
    try {
      const job = await buildJob();
      poNumber = job.label;
      const { bomRows, segmentSpecLookup } = job;
      const config = await this.prisma.systemConfig.findUniqueOrThrow({
        where: { id: SYSTEM_CONFIG_ID },
      });

      // Sếp cấp riêng ngưỡng hao hụt tối đa cho từng loại Sắt (Material.maxCuttingWastePercentage,
      // xem comment schema.prisma) - solver ĐÃ lặp riêng từng loại trong 1 lần gọi (api/views.py),
      // chỉ cần truyền thêm dict theo materialId để nó tự chọn đúng ngưỡng cho từng nhóm, KHÔNG
      // cần tách nhiều lần gọi (xem review trước đó: gộp/lấy trung bình nhiều ngưỡng khác nhau
      // trong 1 request duy nhất mới là vấn đề, còn để solver tự áp đúng ngưỡng theo từng vật tư
      // trong 1 request thì không). Vật tư chưa set dùng SystemConfig.solverMaxWastePercentage
      // làm mặc định - solver tự làm việc đó (xem docstring endpoint), ở đây chỉ cần bỏ qua
      // null/<=0 (0 gần như luôn vô nghiệm - bắt lấp đầy cây tới từng mm, xem
      // de_xuat_logic.py::generate_patterns) và không gửi dict rỗng để giữ request body giống
      // hệt trước khi có tính năng này cho trường hợp chưa ai đặt ngưỡng riêng.
      const distinctMaterialIds = [...new Set(bomRows.map((row) => BigInt(row.material)))];
      const materialsWithThreshold = await this.prisma.material.findMany({
        where: { id: { in: distinctMaterialIds } },
        select: { id: true, maxCuttingWastePercentage: true },
      });
      const maxWastePctByMaterial: Record<string, number> = {};
      for (const m of materialsWithThreshold) {
        const pct = m.maxCuttingWastePercentage?.toNumber();
        if (pct != null && pct > 0) {
          maxWastePctByMaterial[m.id.toString()] = pct;
        }
      }

      const baseRequestBody = {
        num_sets: job.numSets,
        bom: bomRows,
        // views.py đọc stock_lengths bằng str(...).replace(",", " ").split() - PHẢI gửi chuỗi
        // cách nhau bởi khoảng trắng, gửi mảng JSON sẽ bị solver parse sai (str([5850,6000]) ->
        // "[5850 6000]" -> phần tử đầu/cuối dính ký tự "[" "]" và bị loại bỏ, ra 0).
        stock_lengths: (config.solverStockLengths as number[]).join(' '),
        trim_start: config.solverTrimStartMm,
        blade_width: config.solverBladeWidthMm,
        max_waste_percentage: config.solverMaxWastePercentage,
        ...(Object.keys(maxWastePctByMaterial).length > 0
          ? { max_waste_percentage_by_material: maxWastePctByMaterial }
          : {}),
        max_surplus: config.solverMaxSurplus,
        min_length: config.solverMinLengthMm,
        max_length: config.solverMaxLengthMm,
        length_step: config.solverLengthStepMm,
        time_limit_seconds: config.solverTimeLimitSeconds,
        stop_on_first: false,
      };

      const baseUrl = this.configService.get('solver.baseUrl', { infer: true });
      const apiKey = this.configService.get('solver.apiKey', { infer: true });
      const timeoutSeconds = this.configService.get('solver.timeoutSeconds', { infer: true });

      // Ngân sách thời gian solver (`time_limit_seconds`) là CHO MỖI LOẠI SẮT, không phải cho cả
      // request - api/views.py truyền time_limit_sec vào optimize_one_material() BÊN TRONG vòng
      // lặp `for group in material_groups`. Ca xấu nhất của 1 request nhiều loại sắt (PI gộp) là
      // distinctMaterialIds.length × solverTimeLimitSeconds. Không kiểm trước thì khi vượt quá
      // timeout HTTP client, request bị ngắt NGANG CHỪNG (không phải solver kết luận vô nghiệm) -
      // proposal vẫn bị đánh FAILED nhưng lý do là lỗi mạng chung chung, không nói được vì sao.
      // Review 2026-08-18 phát hiện: mặc định code (SOLVER_TIMEOUT_SECONDS=300, xem
      // configuration.ts) không đủ cho phiếu gộp nhiều loại sắt nếu ai đó quên set env production.
      const worstCaseSeconds = distinctMaterialIds.length * config.solverTimeLimitSeconds;
      if (worstCaseSeconds > timeoutSeconds) {
        throw new Error(
          `Đợt tính có ${distinctMaterialIds.length} loại sắt × time_limit ` +
            `${config.solverTimeLimitSeconds}s/loại = tối đa ${worstCaseSeconds}s, vượt timeout ` +
            `HTTP client hiện tại (${timeoutSeconds}s). Solver giải TUẦN TỰ từng loại sắt nên ca ` +
            `xấu nhất sẽ bị ngắt giữa chừng. Tăng SOLVER_TIMEOUT_SECONDS hoặc giảm ` +
            `SystemConfig.solverTimeLimitSeconds rồi thử lại - không tự giảm số SKU gộp, đó là ` +
            `quyết định của KHSX/Sếp.`,
        );
      }

      const callSolver = (body: typeof baseRequestBody & { auto_scan: boolean }) =>
        this.externalApiService.post<SolverProposeResponse>(
          `${baseUrl}${SOLVER_PROPOSE_PATH}`,
          body,
          { headers: { Authorization: `Bearer ${apiKey}` } },
          timeoutSeconds * 1000,
        );

      // CHỈ chấm các stock_lengths cố định (hiện là 6000mm - cỡ duy nhất NCC bán). `auto_scan`
      // LUÔN false, không có nhánh gọi lần 2.
      //
      // Lịch sử: 2026-08-06 Sếp yêu cầu tự động gọi lại lần 2 với auto_scan bật (dò
      // solverMinLengthMm..MaxLengthMm bước solverLengthStepMm) khi có vật tư vượt ngưỡng, để tìm
      // "chiều dài đặt riêng". **Bỏ hẳn 2026-08-18** vì phát hiện đường đó không đi tới đâu được:
      //   - NCC chỉ bán cây 6000 (xem chính SystemConfig.solverStockLengths) - cỡ auto_scan tìm ra
      //     (5900/5600/5380mm...) không đặt mua được.
      //   - Chiều dài đó cũng KHÔNG chảy tới Mua hàng: PurchaseProposalItem chỉ có materialId +
      //     buyQty, Material.spec chỉ là tiết diện ("20x20"), không chỗ nào mang chiều dài. Người
      //     mua vẫn đặt cây 6000 như thường, nên % hao hụt solver báo (tính trên 5900) là con số
      //     không thật - đo trên dữ liệu 2026-08-18: 0,203% báo cáo vs 1,88% thực tế nếu mua 6000.
      //   - Nó còn che mất tín hiệu "SKU này cắt riêng không hiệu quả": phương án lẽ ra phải bị
      //     chặn tự duyệt để QLSX đi GỘP SKU (cách xử lý đúng, xem getBatchSuggestions) thì lại
      //     được auto_scan "cứu" bằng một cỡ cây ảo.
      // Bỏ đi thì solver và màn gợi ý gộp cùng chấm trên 6000mm - 2 con số khớp nhau trở lại.
      const requestBody: typeof baseRequestBody & { auto_scan: boolean } = {
        ...baseRequestBody,
        auto_scan: false,
      };
      const response = await callSolver(requestBody);

      await this.saveSuccess(proposalId, requestBody, response, segmentSpecLookup);

      // Sếp chốt (2026-08-15): KHÔNG cần QLSX bấm duyệt riêng nữa - tính xong là tự động duyệt
      // luôn (approve()), tự trừ tồn + tự tạo đề xuất mua hàng ngay, không chờ ai thao tác thêm.
      // Tách try/catch RIÊNG với solve/save ở trên: approve() lỗi (hiếm - vd thiếu kho ảo) không
      // được phép biến 1 lần TÍNH THÀNH CÔNG thành FAILED (saveFailure sẽ đè mất kết quả DRAFT
      // vừa lưu) - chỉ log + báo QLSX tự vào duyệt tay qua API khi rơi vào ca hiếm này.
      //
      // NHƯNG "không bắt người bấm duyệt" KHÁC "mọi kết quả solver đều dùng được ngay": trước khi
      // tự duyệt phải qua cổng autoApproveBlockReason() - xem docstring hàm đó.
      const blockReason = await this.autoApproveBlockReason(proposalId, response);
      let autoApproved = false;
      let approveError: string | undefined;
      if (blockReason) {
        this.logger.warn(`Không tự duyệt phương án cắt ${proposalId}: ${blockReason}`);
      } else {
        try {
          await this.approve(proposalId.toString(), requestedById ?? null);
          autoApproved = true;
        } catch (error) {
          approveError = (error as Error).message;
          this.logger.error(`Auto-duyệt phương án cắt ${proposalId} thất bại: ${approveError}`);
        }
      }

      // 3 nhánh riêng biệt, KHÔNG gộp "bị chặn" chung với "lỗi kỹ thuật": việc QLSX phải làm khác
      // hẳn nhau (chặn = xem lại phương án/gộp tổ hợp khác; lỗi = duyệt lại tay). Nội dung cũ báo
      // "đã tự trừ tồn kho và chuyển đề xuất mua hàng" cho MỌI ca thành công là sai sự thật khi
      // phương án không có dòng nào mua được.
      if (autoApproved) {
        await this.notifyProductionManagers(
          `Đề xuất cắt sắt cho ${poNumber} đã tính xong và tự động duyệt`,
          `Đã tự trừ tồn kho và chuyển đề xuất mua hàng (nếu thiếu vật tư) sang Mua hàng.`,
        );
      } else if (blockReason) {
        await this.notifyProductionManagers(
          `Đề xuất cắt sắt cho ${poNumber} đã tính xong - CẦN DUYỆT TAY`,
          `Hệ thống không tự duyệt vì ${blockReason}. Chưa trừ tồn kho, chưa tạo đề xuất mua hàng. ` +
            `Xem phương án tại lệnh sản xuất ${poNumber} rồi quyết định duyệt tay hay tính lại.`,
        );
      } else {
        await this.notifyProductionManagers(
          `Đề xuất cắt sắt cho ${poNumber} đã tính xong nhưng tự động duyệt thất bại`,
          `Lỗi: ${approveError ?? 'không rõ'}. Xem chi tiết phương án cắt tại lệnh sản xuất ` +
            `${poNumber} và duyệt lại thủ công.`,
        );
      }
    } catch (error) {
      await this.saveFailure(proposalId, error);
      await this.notifyProductionManagers(
        `Tính đề xuất cắt sắt thất bại${poNumber ? ` cho ${poNumber}` : ''}`,
        this.extractErrorMessage(error),
      );
    }
  }

  /**
   * Cổng chặn TỰ ĐỘNG duyệt (không chặn duyệt tay qua POST /cutting-proposals/:id/approve).
   * Trả lý do bằng tiếng Việt để bắn thẳng vào thông báo QLSX, hoặc null nếu được phép tự duyệt.
   *
   * Tồn tại vì auto-duyệt (Sếp chốt 2026-08-15) đã xoá mất bước QLSX ngồi nhìn bản DRAFT - mà
   * chính bước đó đang gánh 2 việc kiểm mà code chưa bao giờ tự làm:
   *
   * (a) Vật tư KHÔNG cắt được. approve() lọc buyableLines theo `feasible && totalBars > 0`, nên
   *     dòng infeasible bị bỏ khỏi đề xuất mua KHÔNG một lời cảnh báo. Ca hỗn hợp (4 vật tư ra, 1
   *     vật tư không) là tệ nhất: đề xuất mua trông vẫn bình thường, tới lúc Phôi ra xưởng mới lòi
   *     ra thiếu sắt. Ca toàn bộ infeasible còn tạo ra phương án APPROVED mà không có đề xuất mua
   *     nào cả. Từ 2026-08-18 (bỏ auto_scan, xem nơi gọi solver): infeasible ở đây nghĩa là không
   *     xếp nổi trong ngưỡng với cây 6000mm - hướng xử lý đúng là GỘP đợt cắt với SKU khác dùng
   *     chung loại sắt, cần người quyết định chứ không tự đi tìm cỡ cây khác nữa.
   *
   * (b) Nhu cầu này ĐÃ có phương án được duyệt trước đó. Nút "Tính lại" gửi Idempotency-Key mới
   *     mỗi lần bấm nên luôn sinh CuttingProposal MỚI; tự duyệt tiếp sẽ trừ tồn kho lần thứ hai
   *     (idempotencyKey của bút toán là `cutting-proposal:{id}:...` - khoá theo id phương án, id
   *     mới thì trừ lại từ đầu) và tạo PurchaseProposal trùng, trong khi phương án cũ chỉ bị đánh
   *     SUPERSEDED - trạng thái đó KHÔNG huỷ đề xuất mua cũ và KHÔNG hoàn lại tồn (grep: SUPERSEDED
   *     được ghi đúng 1 chỗ, không nơi nào đọc). Chặn ở đây để tiền thật không bị chi 2 lần; người
   *     thật vẫn duyệt tay được sau khi đã xử lý đề xuất mua cũ.
   *
   * (c) Vật tư CẮT ĐƯỢC nhưng VƯỢT ngưỡng hao hụt của chính nó (`over_threshold` /
   *     `any_over_threshold` trong response solver). Trước 2026-08-18 field này "thuần chẩn đoán,
   *     không kích hoạt hành động nào" - nghĩa là hệ thống ĐÃ VÀ ĐANG tự duyệt, tự trừ kho, tự đẩy
   *     đề xuất mua cho những phương án vượt ngưỡng, không một lời cảnh báo (phát hiện khi review
   *     lại luồng theo yêu cầu Sếp). Không được "cứu" ca này bằng cách nới ngưỡng cho qua - đó
   *     chính là việc auto_scan từng làm (che tín hiệu cần gộp bằng một con số dễ nhìn hơn, xem
   *     lý do bỏ auto_scan ở nơi gọi solver). Hướng xử lý đúng DUY NHẤT là gộp đợt cắt với SKU
   *     khác dùng chung loại sắt (xem getBatchSuggestions) - ngưỡng 1% là chính sách, không phải
   *     tham số để vặn khi thấy vướng.
   */
  private async autoApproveBlockReason(
    proposalId: bigint,
    response: SolverProposeResponse,
  ): Promise<string | null> {
    const infeasibleIds = response.purchase_plan
      .filter((line) => !line.feasible)
      .map((line) => line.material);
    if (infeasibleIds.length > 0) {
      // Đổi id -> mã vật tư: thông báo này QLSX đọc, "vật tư 12" không giúp được gì.
      const materials = await this.prisma.material.findMany({
        where: { id: { in: infeasibleIds.map((id) => BigInt(id)) } },
        select: { code: true },
      });
      const labels = materials.length > 0 ? materials.map((m) => m.code) : infeasibleIds;
      // Gợi ý hướng xử lý ngay trong thông báo: từ 2026-08-18 không còn auto_scan dò cỡ cây khác
      // nữa, nên cách duy nhất để hạ hao hụt là GỘP với SKU khác dùng chung loại sắt (thêm cỡ đoạn
      // để lấp đầy cây 6000) - xem getBatchSuggestions/màn "Gợi ý gộp đợt cắt".
      return (
        `vật tư ${labels.join(', ')} không cắt được trong ngưỡng hao hụt với cây 6000mm - ` +
        `thử gộp đợt cắt với SKU khác dùng chung loại sắt này`
      );
    }

    // (c) Xem docstring - vượt ngưỡng KHÔNG được tự duyệt, kể cả feasible=true. `over_threshold`
    // chỉ có mặt trên dòng feasible (xem type SolverProposeResponse), nên không trùng nhánh trên.
    const overThresholdIds = response.purchase_plan
      .filter((line) => line.feasible && line.over_threshold)
      .map((line) => line.material);
    if (overThresholdIds.length > 0) {
      const materials = await this.prisma.material.findMany({
        where: { id: { in: overThresholdIds.map((id) => BigInt(id)) } },
        select: { code: true },
      });
      const labels = materials.length > 0 ? materials.map((m) => m.code) : overThresholdIds;
      return (
        `vật tư ${labels.join(', ')} cắt được nhưng vượt ngưỡng hao hụt cho phép - ` +
        `thử gộp đợt cắt với SKU khác dùng chung loại sắt này (KHÔNG tự nới ngưỡng)`
      );
    }

    const proposal = await this.prisma.cuttingProposal.findUniqueOrThrow({
      where: { id: proposalId },
      select: { productionOrderId: true, productionInvoiceId: true },
    });
    const anchor = proposal.productionOrderId
      ? { productionOrderId: proposal.productionOrderId }
      : proposal.productionInvoiceId
        ? { productionInvoiceId: proposal.productionInvoiceId }
        : null;
    if (!anchor) {
      return 'phương án không neo vào lệnh sản xuất hay đợt gộp nào (dữ liệu hỏng)';
    }

    const priorApproved = await this.prisma.cuttingProposal.count({
      where: { ...anchor, id: { not: proposalId }, status: CuttingProposalStatus.APPROVED },
    });
    if (priorApproved > 0) {
      return 'nhu cầu này đã có phương án được duyệt trước đó (đã trừ tồn kho, đã đẩy đề xuất mua hàng) - duyệt tiếp sẽ trừ kho và mua trùng';
    }

    return null;
  }

  /** Báo QLSX khi 1 CuttingProposal tính xong (thành công hoặc thất bại) - im lặng, không chặn
   * gì cả; lỗi bắn thông báo (nếu có) chỉ log lại, không được làm hỏng luồng chính. */
  private async notifyProductionManagers(title: string, message: string): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: { title, message, audience: NotificationAudience.PRODUCTION_MANAGER },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create cutting-proposal notification: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 1 dòng bom[] / piece_bom row - nhánh "chi tiết" (bom_part/part_bom) chưa có dữ liệu (chưa
   * xây bên admin) nên chưa gộp vào đây; mở rộng khi có.
   */
  /**
   * Nhu cầu MỖI BỘ theo (bomRevision -> materialId -> chiều dài đoạn) cho NHIỀU bản định mức
   * trong ĐÚNG 2 truy vấn.
   *
   * CỐ Ý không dùng lại buildBomRows(): hàm đó nhận 1 bomRevisionId và trả shape của solver
   * (kèm tên mảnh + segmentSpecId). Sửa nó thành nhận mảng sẽ đổi `where` từ `{ bomRevisionId }`
   * sang `{ in: [...] }`, mà cutting-proposals.service.spec.ts assert nguyên văn where cũ - phá
   * test của đường solver đang chạy tốt để tiết kiệm 6 dòng query là đánh đổi tồi. Trùng lặp ở
   * đây là có chủ ý.
   *
   * Gộp truy vấn là BẮT BUỘC: gọi theo vòng lặp từng đơn sẽ thành N+1 query - đây là chỗ tốn duy
   * nhất của getBatchSuggestions (phần tính toán chỉ ~0,2ms/lần).
   */
  private async buildPerSetDemandByRevision(
    bomRevisionIds: bigint[],
  ): Promise<Map<bigint, Map<bigint, Map<number, number>>>> {
    const result = new Map<bigint, Map<bigint, Map<number, number>>>();
    if (bomRevisionIds.length === 0) return result;

    const [pieceBoms, bomPieces] = await Promise.all([
      this.prisma.pieceBom.findMany({
        where: { bomRevisionId: { in: bomRevisionIds } },
        include: { segmentSpec: true },
      }),
      this.prisma.bomPiece.findMany({ where: { bomRevisionId: { in: bomRevisionIds } } }),
    ]);

    const qtyPerUnitByKey = new Map(
      bomPieces.map((bp) => [`${bp.bomRevisionId}:${bp.pieceId}`, bp.qtyPerUnit]),
    );

    for (const row of pieceBoms) {
      const qtyPerUnit = qtyPerUnitByKey.get(`${row.bomRevisionId}:${row.pieceId}`) ?? 0;
      const qtyPerSet = qtyPerUnit * row.qtyPerPiece;
      // cutLengthMm là Decimal (2026-08-19, xem SegmentSpec) - PHẢI .toNumber() TRƯỚC khi dùng
      // làm khoá Map: 2 Decimal cùng giá trị không === nhau, dùng thẳng làm khoá sẽ gộp/tách
      // NHẦM các cỡ đoạn thay vì cộng dồn đúng 1 nhóm.
      const cutLengthMm = row.segmentSpec.cutLengthMm.toNumber();
      if (qtyPerSet <= 0 || cutLengthMm <= 0) continue;

      const byMaterial = result.get(row.bomRevisionId) ?? new Map<bigint, Map<number, number>>();
      const byCutLength = byMaterial.get(row.segmentSpec.materialId) ?? new Map<number, number>();
      // Cộng dồn: nhiều mảnh khác nhau có thể cùng dùng 1 (vật tư, chiều dài đoạn) - đúng cách
      // explode_bom của solver gom nhóm (de_xuat_logic.py: groups[key][cut_len] += demand).
      byCutLength.set(cutLengthMm, (byCutLength.get(cutLengthMm) ?? 0) + qtyPerSet);
      byMaterial.set(row.segmentSpec.materialId, byCutLength);
      result.set(row.bomRevisionId, byMaterial);
    }
    return result;
  }

  /**
   * Hạn dùng để xếp thứ tự gấp, theo thứ tự ưu tiên:
   *   1. `materialDeadline` của chính item - hạn VẬT TƯ phải sẵn sàng, sát nghĩa nhất với việc
   *      cắt sắt (cắt xong mới có phôi để làm).
   *   2. Mốc Khung cơ khí (FRAME) - công đoạn chứa Phôi.
   *   3. Hạn của cả phiếu sản xuất.
   * KHÔNG rơi tiếp về SalesOrderItem.deliveryDate: SalesOrderItem không có FK tới
   * ProductionInvoiceItem, chỉ khớp được qua mfgProductId mà 1 đơn có thể có nhiều dòng cùng sản
   * phẩm - khớp nhầm hạn còn tệ hơn không có hạn. null = xếp CUỐI, hiện "chưa có hạn".
   */
  private frameDeadlineOf(item: {
    materialDeadline: Date | null;
    stages: { stageType: ProdItemStageType; deadline: Date }[];
    productionInvoice: { deadline: Date | null };
  }): Date | null {
    const frame = item.stages.find((s) => s.stageType === ProdItemStageType.FRAME);
    return item.materialDeadline ?? frame?.deadline ?? item.productionInvoice.deadline ?? null;
  }

  private toBatchOrderDto(item: {
    id: bigint;
    quantity: number;
    prodApprovalStatus: ProdApprovalStatus | null;
    materialDeadline: Date | null;
    mfgProduct: { factoryCode: string; name: string | null };
    stages: { stageType: ProdItemStageType; deadline: Date }[];
    productionInvoice: { code: string; deadline: Date | null; salesOrder: { code: string } | null };
  }): CuttingBatchOrderDto {
    return new CuttingBatchOrderDto({
      productionInvoiceItemId: item.id.toString(),
      salesOrderCode: item.productionInvoice.salesOrder?.code ?? null,
      productionInvoiceCode: item.productionInvoice.code,
      mfgProductCode: item.mfgProduct.factoryCode,
      mfgProductName: item.mfgProduct.name,
      quantity: item.quantity,
      prodApprovalStatus: item.prodApprovalStatus,
      deadline: this.frameDeadlineOf(item),
    });
  }

  /** Chấm 1 mức gộp (n đơn đầu tiên) - trả null nếu không chiều dài cây nào cắt nổi. */
  private buildBatchLevel(
    members: {
      item: Parameters<CuttingProposalsService['toBatchOrderDto']>[0];
      demand: Map<number, number>;
    }[],
    stockLengthsMm: number[],
    trimMm: number,
    kerfMm: number,
    thresholdPct: number,
  ): CuttingBatchLevelDto | null {
    const merged = new Map<number, number>();
    for (const m of members) {
      for (const [cutLengthMm, qty] of m.demand) {
        merged.set(cutLengthMm, (merged.get(cutLengthMm) ?? 0) + qty);
      }
    }
    const cutSizesMm = [...merged.keys()].sort((a, b) => b - a);
    const best = bestWasteAcrossStockLengths(cutSizesMm, stockLengthsMm, trimMm, kerfMm);
    if (best === null) return null;

    const minBars = this.minBarsFor(merged, stockLengthsMm, trimMm, kerfMm);
    // Lợi ích THẬT = cùng từng ấy đơn, cắt RIÊNG tốn mấy cây so với cắt CHUNG tốn mấy cây.
    // KHÔNG so số cây mức này với số cây mức 1: mức sau gồm nhiều đơn hơn nên đương nhiên cần
    // nhiều cây hơn, so như vậy luôn ra số âm và vô nghĩa.
    const barsSeparate = members.reduce(
      (sum, m) => sum + this.minBarsFor(m.demand, stockLengthsMm, trimMm, kerfMm),
      0,
    );

    // Cả đợt cắt cùng một lúc, và không được trễ hạn của đơn gấp nhất -> đơn có hạn xa nhất bị
    // cắt sớm đúng bằng độ chênh. Chỉ tính khi có >= 2 đơn CÓ hạn.
    const deadlines = members
      .map((m) => this.frameDeadlineOf(m.item))
      .filter((d): d is Date => d !== null)
      .map((d) => d.getTime());
    const daysCutEarly =
      deadlines.length >= 2
        ? Math.round((Math.max(...deadlines) - Math.min(...deadlines)) / 86_400_000)
        : null;

    return new CuttingBatchLevelDto({
      orderCount: members.length,
      // Nhãn theo MÃ SKU (factoryCode), không theo mã đơn hàng: hệ thống vận hành theo SKU, và 2
      // SKU của cùng 1 đơn sẽ cho ra nhãn trùng nhau y hệt nếu lấy mã đơn.
      orderLabels: members.map((m) => m.item.mfgProduct.factoryCode),
      cutSizesMm,
      stockLengthMm: best.stockLengthMm,
      minWastePct: best.minWastePct,
      minWastePerBarMm: best.minWastePerBarMm,
      minBars,
      barsSeparate,
      barsSavedVsSeparate: barsSeparate - minBars,
      daysCutEarly,
      meetsThreshold: best.minWastePct <= thresholdPct,
    });
  }

  /**
   * Cận dưới số cây phải mua cho một tập nhu cầu (chiều dài đoạn -> số lượng).
   *
   * Dùng `bestUsed` (tổng sắt+lưỡi lớn nhất nhét vừa 1 cây) làm mẫu số chứ KHÔNG dùng `usable`:
   * không cây nào chở nổi quá bestUsed, nên `ceil(cần / bestUsed)` vừa là cận dưới HỢP LỆ vừa
   * CHẶT HƠN ràng buộc `ceil(cần / usable)` của solver (de_xuat_logic.py:383-386) - vốn giả định
   * lấp đầy hoàn hảo nên không phản ánh được phần phí do không lấp kín được cây.
   */
  private minBarsFor(
    demand: Map<number, number>,
    stockLengthsMm: number[],
    trimMm: number,
    kerfMm: number,
  ): number {
    const sizes = [...demand.keys()];
    const best = bestWasteAcrossStockLengths(sizes, stockLengthsMm, trimMm, kerfMm);
    if (best === null || best.bestUsedMm <= 0) return 0;
    let neededMm = 0;
    for (const [cutLengthMm, qty] of demand) neededMm += qty * (cutLengthMm + kerfMm);
    return Math.ceil(neededMm / best.bestUsedMm);
  }

  /** 1 lệnh SX cắt riêng: đúng 1 định mức, số bộ để solver tự nhân - hành vi có từ Phase 7. */
  private async buildOrderJob(productionOrderId: bigint): Promise<SolverJob> {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: productionOrderId },
      include: { productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } } },
    });
    const { bomRows, segmentSpecLookup } = await this.buildBomRows(order.bomRevisionId);
    // Nhãn hiện trong thông báo cho Sếp/QLSX ("Đề xuất cắt sắt cho ... đã tính xong") - ưu tiên mã
    // đơn Sales gốc (xem trao đổi 2026-08-18), fallback poNumber nội bộ khi SKU không gắn đơn nào.
    const label = order.productionInvoiceItem.salesOrder?.code ?? order.poNumber;
    return { label, numSets: order.quantity, bomRows, segmentSpecLookup };
  }

  /**
   * Cả một đợt gộp: nhiều sản phẩm, mỗi cái một định mức và một số lượng khác nhau.
   *
   * `num_sets` của solver là hệ số nhân DÙNG CHUNG cho toàn bộ bom[] nên không diễn tả được
   * "SKU A làm 10 bộ, SKU B làm 25 bộ". Cách duy nhất đúng là quy về NHU CẦU TUYỆT ĐỐI:
   * nhân sẵn số lượng vào từng dòng rồi gửi `num_sets = 1`.
   *
   *   qty tuyệt đối = qty_per_set (số mảnh/bộ) × qty_per_part (số đoạn/mảnh) × số bộ của lệnh SX
   *
   * Cách này đã chạy thật và đo được trên dữ liệu J55 + Ghế tình yêu trước khi viết plan.
   */
  private async buildInvoiceJob(productionInvoiceId: bigint): Promise<SolverJob> {
    const pi = await this.prisma.productionInvoice.findUniqueOrThrow({
      where: { id: productionInvoiceId },
      include: { items: { include: { productionOrder: true, mfgProduct: true } } },
    });

    const orders = pi.items
      .map((it) => ({ order: it.productionOrder, code: it.mfgProduct.factoryCode }))
      .filter((x): x is { order: NonNullable<typeof x.order>; code: string } => x.order !== null);
    if (orders.length === 0) {
      throw new NotFoundException(
        `Đợt gộp ${pi.code} chưa có lệnh sản xuất nào (SKU phải được duyệt trước khi tính phương án cắt)`,
      );
    }

    // Gom theo (materialId, cutLengthMm): 2 sản phẩm khác nhau dùng CÙNG cỡ đoạn của CÙNG loại sắt
    // thì với solver chỉ là một nhu cầu duy nhất - đây chính là chỗ gộp sinh ra lợi ích.
    const demand = new Map<string, SolverBomRow>();
    const segmentSpecLookup = new Map<string, bigint>();
    for (const { order, code } of orders) {
      const built = await this.buildBomRows(order.bomRevisionId);
      for (const [key, specId] of built.segmentSpecLookup) {
        segmentSpecLookup.set(key, specId);
      }
      for (const row of built.bomRows) {
        const key = `${row.material}:${row.cut_length}`;
        const absoluteQty = row.qty_per_set * row.qty_per_part * order.quantity;
        const existing = demand.get(key);
        if (existing) {
          existing.qty_per_part += absoluteQty;
        } else {
          demand.set(key, {
            // Tên gộp để đọc log/rawResponse còn biết đoạn này của sản phẩm nào.
            part: `${code}·${row.part}`,
            qty_per_set: 1,
            material: row.material,
            spec: '',
            cut_length: row.cut_length,
            qty_per_part: absoluteQty,
          });
        }
      }
    }

    return {
      label: pi.code,
      numSets: 1,
      bomRows: [...demand.values()],
      segmentSpecLookup,
    };
  }

  private async buildBomRows(
    bomRevisionId: bigint,
  ): Promise<{ bomRows: SolverBomRow[]; segmentSpecLookup: Map<string, bigint> }> {
    const [pieceBoms, bomPieces] = await Promise.all([
      this.prisma.pieceBom.findMany({
        where: { bomRevisionId },
        include: { piece: true, segmentSpec: true },
      }),
      this.prisma.bomPiece.findMany({ where: { bomRevisionId } }),
    ]);

    if (pieceBoms.length === 0) {
      throw new NotFoundException(
        `BomRevision ${bomRevisionId} không có dòng định mức mảnh nào để tính đề xuất`,
      );
    }

    const qtyPerUnitByPieceId = new Map(bomPieces.map((bp) => [bp.pieceId, bp.qtyPerUnit]));
    const segmentSpecLookup = new Map<string, bigint>();
    const bomRows: SolverBomRow[] = pieceBoms.map((row) => {
      // cutLengthMm là Decimal (2026-08-19, xem SegmentSpec) - .toNumber() TRƯỚC khi ghép khoá
      // Map, KHÔNG ghép thẳng Decimal vào template string: Decimal.toString() giữ nguyên số 0
      // ở cuối (vd "930.0"), trong khi phía tra cứu (dòng dưới, đọc segment.size từ JSON response
      // solver) luôn là number thường ("930", không ".0") - ghép sai định dạng làm 2 khoá
      // KHÔNG khớp nhau, tra cứu miss âm thầm (continue ở nhánh "shouldn't happen").
      const cutLengthMm = row.segmentSpec.cutLengthMm.toNumber();
      segmentSpecLookup.set(`${row.segmentSpec.materialId}:${cutLengthMm}`, row.segmentSpecId);
      return {
        part: row.piece.name,
        qty_per_set: qtyPerUnitByPieceId.get(row.pieceId) ?? 0,
        // material = materialId thô (KHÔNG kèm spec thật) - solver gom nhóm theo
        // `"{material} {normalize_spec(spec)}"` (xem cat_sat/de_xuat_logic.py::explode_bom).
        // Nếu gửi spec thật, response trả lại material="<id> <spec>" thay vì "<id>" và
        // BigInt(item.material) ở saveSuccess() sẽ throw - giữ spec rỗng để round-trip
        // đúng nguyên vẹn materialId.
        material: row.segmentSpec.materialId.toString(),
        spec: '',
        cut_length: cutLengthMm,
        qty_per_part: row.qtyPerPiece,
      };
    });

    return { bomRows, segmentSpecLookup };
  }

  private async saveSuccess(
    proposalId: bigint,
    requestBody: unknown,
    response: SolverProposeResponse,
    segmentSpecLookup: Map<string, bigint>,
  ): Promise<void> {
    // Suy 2 cờ tổng hợp TỪ response gốc trước khi lưu - lý do tồn tại xem comment schema.prisma
    // (hasInfeasibleLine/hasOverThreshold): để màn Cắt sắt lọc/đếm được BẰNG SQL khi poll định kỳ,
    // không phải kéo lines[] về rồi lọc ở code (xem changelog 2026-08-15 mục 15 - đợt 2 sẽ dùng).
    const hasInfeasibleLine = response.purchase_plan.some((item) => !item.feasible);
    const hasOverThreshold = response.purchase_plan.some(
      (item) => item.feasible && item.over_threshold === true,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.cuttingProposal.update({
        where: { id: proposalId },
        data: {
          status: CuttingProposalStatus.DRAFT,
          requestParams: requestBody as Prisma.InputJsonValue,
          rawResponse: response as unknown as Prisma.InputJsonValue,
          totalBarsAll: response.summary.total_bars_all,
          totalWasteMm: response.summary.total_waste_mm,
          wastePercentage: response.summary.waste_percentage,
          completedAt: new Date(),
          hasInfeasibleLine,
          hasOverThreshold,
        },
      });

      for (const item of response.purchase_plan) {
        const line = await tx.cuttingProposalLine.create({
          data: {
            cuttingProposalId: proposalId,
            materialId: BigInt(item.material),
            feasible: item.feasible,
            bestStockLengthMm: item.best_stock_length,
            totalBars: item.total_bars,
            totalWasteMm: item.total_waste_mm,
            wastePercentage: item.waste_percentage,
            mauNguyenMm: item.mau_nguyen_mm,
            lengthComparison: item.length_comparison as Prisma.InputJsonValue,
            // 5 field mới (2026-08-19) - lưu NGUYÊN VĂN những gì solver trả, không diễn giải lại
            // ở đây (xem lý do "luôn dùng bản solver" - changelog 2026-08-15 mục 15.5-(d)). Câu
            // tiếng Việt hiển thị cho người dùng sẽ dựng ở tầng response DTO/FE (đợt sau), không
            // phải ở đây.
            reason: item.reason,
            bestAchievable: (item.best_achievable ?? undefined) as
              Prisma.InputJsonValue | undefined,
            timedOut: item.timed_out,
            maxWastePctThreshold: item.max_waste_pct_threshold,
            overThreshold: item.over_threshold,
          },
        });

        for (const [index, pattern] of (item.cutting_patterns ?? []).entries()) {
          const createdPattern = await tx.cuttingProposalPattern.create({
            data: {
              lineId: line.id,
              patternIndex: pattern.pattern_id ?? index,
              barCount: pattern.bars,
              wastePerBarMm: pattern.waste_per_bar,
              mauNguyenMm: pattern.mau_nguyen_mm,
            },
          });

          for (const segment of pattern.pieces_breakdown ?? []) {
            const segmentSpecId = segmentSpecLookup.get(`${item.material}:${segment.size}`);
            if (!segmentSpecId) {
              continue; // shouldn't happen - solver only ever echoes sizes we sent it
            }
            await tx.cuttingProposalPatternSegment.create({
              data: { patternId: createdPattern.id, segmentSpecId, countPerBar: segment.count },
            });
          }
        }
      }
    });
  }

  private async saveFailure(proposalId: bigint, error: unknown): Promise<void> {
    await this.prisma.cuttingProposal.update({
      where: { id: proposalId },
      data: {
        status: CuttingProposalStatus.FAILED,
        errorMessage: this.extractErrorMessage(error),
        completedAt: new Date(),
      },
    });
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof ExternalApiHttpError) {
      const body = error.body as { message?: string; failing_materials?: string[] } | undefined;
      const failing = body?.failing_materials?.length
        ? ` (${body.failing_materials.join(', ')})`
        : '';
      return `${body?.message ?? error.message}${failing}`;
    }
    return error instanceof Error ? error.message : 'Unknown error';
  }

  /// Cửa sổ coi 1 bản DRAFT "vừa tính xong, đang chờ tự-duyệt" là CALCULATING thay vì NEEDS_ACTION
  /// - giữa saveSuccess() ghi DRAFT và approve() ghi APPROVED có 1 khoảng ngắn (transaction trừ
  /// kho + tạo đề xuất mua). Không có cửa sổ này, FE poll đúng lúc đó sẽ thấy "Cần xử lý" rồi 1-2s
  /// sau nhảy "Đạt" - xem changelog 2026-08-15 mục 15.6-5 (nháy trạng thái).
  private static readonly FINALIZING_WINDOW_MS = 60_000;

  /**
   * Dẫn xuất `displayStatus`/`displayReason` (list-level) từ `status` + 2 cờ tổng hợp đã lưu sẵn
   * lúc saveSuccess() - KHÔNG đọc lines[] (tốn 1 query nữa, và list response không load lines).
   * Xem CuttingProposalDisplayStatus (dto) cho định nghĩa từng nhánh.
   */
  private computeDisplayStatus(proposal: {
    status: CuttingProposalStatus;
    hasInfeasibleLine: boolean;
    hasOverThreshold: boolean;
    completedAt: Date | null;
    errorMessage: string | null;
    requestedAt: Date;
  }): { displayStatus: CuttingProposalDisplayStatus; displayReason: string | null } {
    if (proposal.status === CuttingProposalStatus.CALCULATING) {
      // Chống treo vĩnh viễn: đường DUY NHẤT kẹt CALCULATING mãi mãi là tiến trình BE chết giữa
      // lúc solve (fire-and-forget - không cron nào quét dọn, xem phantich/page.tsx cảnh báo cũ).
      // TTL neo vào chính cấu hình timeout HTTP client gọi solver (`solver.timeoutSeconds`) +
      // biên an toàn - đó CHÍNH XÁC là mốc mà không tiến trình BE nào còn có thể đang thật sự chờ
      // solver trả lời, nên không cần cron riêng: tính lại mỗi lần map response là đủ.
      const timeoutSeconds = this.configService.get('solver.timeoutSeconds', { infer: true });
      const ageMs = Date.now() - proposal.requestedAt.getTime();
      if (ageMs > (timeoutSeconds + 60) * 1000) {
        return {
          displayStatus: 'NEEDS_ACTION',
          displayReason:
            'Nghi treo - đã tính quá lâu (tiến trình có thể đã dừng giữa chừng). Bấm "Tính lại".',
        };
      }
      return { displayStatus: 'CALCULATING', displayReason: null };
    }
    if (proposal.status === CuttingProposalStatus.SUPERSEDED) {
      return { displayStatus: 'SUPERSEDED', displayReason: null };
    }
    if (proposal.status === CuttingProposalStatus.FAILED) {
      return {
        displayStatus: 'NEEDS_ACTION',
        displayReason: proposal.errorMessage ?? 'Lỗi kỹ thuật khi tính - xem chi tiết',
      };
    }
    if (proposal.status === CuttingProposalStatus.APPROVED) {
      return { displayStatus: 'OK', displayReason: null };
    }
    // status === DRAFT: đã tính xong, đang ở cổng autoApproveBlockReason() hoặc đã bị chặn.
    if (proposal.hasInfeasibleLine) {
      return {
        displayStatus: 'NEEDS_ACTION',
        displayReason: 'Có vật tư không cắt được trong ngưỡng hao hụt - xem chi tiết',
      };
    }
    if (proposal.hasOverThreshold) {
      return {
        displayStatus: 'NEEDS_ACTION',
        displayReason: 'Có vật tư cắt được nhưng vượt ngưỡng hao hụt - xem chi tiết',
      };
    }
    const ageMs = proposal.completedAt ? Date.now() - proposal.completedAt.getTime() : Infinity;
    if (ageMs < CuttingProposalsService.FINALIZING_WINDOW_MS) {
      return { displayStatus: 'CALCULATING', displayReason: null };
    }
    // Không infeasible, không over_threshold, đã hoàn tất quá lâu để còn là "đang tự-duyệt" ->
    // ca hiếm còn lại của autoApproveBlockReason(): nhu cầu đã có phương án APPROVED khác.
    return {
      displayStatus: 'NEEDS_ACTION',
      displayReason: 'Nhu cầu này đã có phương án khác được duyệt trước đó - xem chi tiết',
    };
  }

  /**
   * Câu tiếng Việt cho 1 dòng vật tư trong chi tiết phương án - null nếu dòng này không cần xử lý
   * (feasible & không vượt ngưỡng). Ưu tiên `timedOut` trước "vô nghiệm thật": 2 ca này KHÔNG được
   * gộp chung 1 câu (xem changelog 2026-08-15 mục 15.5-(b) - lý do tách bạch).
   */
  private lineDisplayReason(line: {
    feasible: boolean;
    timedOut: boolean | null;
    bestAchievable: unknown;
    reason: string | null;
    overThreshold: boolean | null;
    maxWastePctThreshold: unknown;
  }): string | null {
    if (!line.feasible) {
      if (line.timedOut) {
        return (
          'Chưa kết luận được - hết thời gian tính (solver chưa liệt kê xong các kiểu cắt). ' +
          'Bấm "Tính lại" hoặc tăng SystemConfig.solverTimeLimitSeconds.'
        );
      }
      const hint = line.bestAchievable as
        { length: number; waste_pct: number; bars: number } | null | undefined;
      if (hint) {
        return (
          `Không đạt ngưỡng hao hụt - tốt nhất đạt ${hint.waste_pct.toFixed(2)}% ` +
          `(${hint.length}mm × ${hint.bars} cây). Thử gộp đợt cắt với SKU khác dùng chung loại ` +
          `sắt này để lấp đầy cây hơn.`
        );
      }
      return line.reason ?? 'Không có cách cắt nào khả thi - xem lại thiết kế đoạn cắt.';
    }
    if (line.overThreshold) {
      const threshold = line.maxWastePctThreshold as number | { toNumber(): number } | null;
      const thresholdPct =
        threshold == null ? null : typeof threshold === 'number' ? threshold : threshold.toNumber();
      return (
        `Cắt được nhưng vượt ngưỡng hao hụt${thresholdPct != null ? ` (${thresholdPct}%)` : ''} - ` +
        `thử gộp đợt cắt với SKU khác dùng chung loại sắt này (KHÔNG tự nới ngưỡng).`
      );
    }
    return null;
  }

  private toResponseDto(proposal: CuttingProposalRow): CuttingProposalResponseDto {
    // 2 nhánh neo (xem comment model CuttingProposal): 1 lệnh SX cắt riêng, hoặc cả 1 PI gộp cắt
    // chung. Nhánh gộp không có sản phẩm "duy nhất" nào - hiện mã PI và liệt kê các SKU trong đó
    // thay vì cố nặn ra 1 cái tên (chọn đại 1 SKU sẽ khiến người đọc tưởng phương án chỉ cho SKU đó).
    const order = proposal.productionOrder;
    const pi = proposal.productionInvoice;
    const mergedSkus = pi?.items.map((it) => it.mfgProduct.factoryCode) ?? [];
    // Mã đơn Sales gốc - đây mới là mã "PO" người dùng cần thấy (poNumber nội bộ chỉ để hệ thống
    // tra cứu, xem trao đổi 2026-08-18). Nhánh gộp có thể trộn nhiều đơn Sales khác nhau - gộp
    // danh sách mã duy nhất, không có "1 mã đại diện" nào đúng cả.
    const salesOrderCode = order
      ? (order.productionInvoiceItem.salesOrder?.code ?? null)
      : (pi?.items ?? [])
          .map((it) => it.salesOrder?.code)
          .filter((c): c is string => !!c)
          .filter((c, i, arr) => arr.indexOf(c) === i)
          .join(', ') || null;
    const { displayStatus, displayReason } = this.computeDisplayStatus(proposal);
    return new CuttingProposalResponseDto({
      id: proposal.id.toString(),
      productionOrderId: proposal.productionOrderId?.toString() ?? null,
      productionInvoiceId: proposal.productionInvoiceId?.toString() ?? null,
      poNumber: order?.poNumber ?? pi?.code ?? '—',
      salesOrderCode,
      mfgProductCode: order?.mfgProduct.factoryCode ?? mergedSkus.join(', '),
      mfgProductName:
        order?.mfgProduct.name ?? (mergedSkus.length > 0 ? `${mergedSkus.length} SKU gộp` : null),
      status: proposal.status,
      displayStatus,
      displayReason,
      totalBarsAll: proposal.totalBarsAll,
      totalWasteMm: proposal.totalWasteMm ? Number(proposal.totalWasteMm) : null,
      wastePercentage: proposal.wastePercentage ? Number(proposal.wastePercentage) : null,
      errorMessage: proposal.errorMessage,
      requestedAt: proposal.requestedAt,
      completedAt: proposal.completedAt,
      approvedAt: proposal.approvedAt,
    });
  }

  private toDetailResponseDto(proposal: CuttingProposalDetail): CuttingProposalResponseDto {
    const dto = this.toResponseDto(proposal);
    dto.lines = proposal.lines.map((line) => ({
      materialId: line.materialId.toString(),
      materialCode: line.material.code,
      materialName: line.material.name,
      unit: line.material.unit,
      feasible: line.feasible,
      bestStockLengthMm: line.bestStockLengthMm,
      totalBars: line.totalBars,
      totalWasteMm: line.totalWasteMm ? Number(line.totalWasteMm) : null,
      wastePercentage: line.wastePercentage ? Number(line.wastePercentage) : null,
      mauNguyenMm: line.mauNguyenMm ? Number(line.mauNguyenMm) : null,
      lengthComparison: line.lengthComparison as
        { length: number; bars: number; wastePct: number }[] | null,
      reason: line.reason,
      bestAchievable: line.bestAchievable as {
        length: number;
        waste_pct: number;
        bars: number;
      } | null,
      timedOut: line.timedOut,
      maxWastePctThreshold: line.maxWastePctThreshold ? Number(line.maxWastePctThreshold) : null,
      overThreshold: line.overThreshold,
      displayReason: this.lineDisplayReason(line),
      patterns: line.patterns.map((pattern) => ({
        id: pattern.id.toString(),
        patternIndex: pattern.patternIndex,
        barCount: pattern.barCount,
        wastePerBarMm: pattern.wastePerBarMm ? Number(pattern.wastePerBarMm) : null,
        mauNguyenMm: pattern.mauNguyenMm ? Number(pattern.mauNguyenMm) : null,
        segments: pattern.segments.map((segment) => ({
          segmentSpecId: segment.segmentSpecId.toString(),
          cutLengthMm: Number(segment.segmentSpec.cutLengthMm),
          countPerBar: segment.countPerBar,
        })),
      })),
    }));
    return dto;
  }
}
