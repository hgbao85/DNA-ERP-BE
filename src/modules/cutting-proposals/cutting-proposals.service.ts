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
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { recomputeProposalStatus } from '../purchase-proposals/purchase-proposal-status.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { ExternalApiHttpError, ExternalApiService } from '../external/external-api.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import {
  CuttingProposalDisplayStatus,
  CuttingProposalPieceSummaryResponseDto,
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
import { frameDeadlineOf } from '../../common/utils/frame-deadline.util';

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
    /// "fixed" = 1 trong các chiều dài chuẩn (SystemConfig.solverStockLengths) đạt ngưỡng.
    /// "scan" = KHÔNG chiều dài chuẩn nào đạt, solver tự dò (auto_scan) ra 1 chiều dài đặt riêng
    /// trong dải min_length..max_length. CHỈ có ở dòng feasible=true (api/views.py::"length_source",
    /// mặc định "fixed" nếu solver không gửi - de_xuat_logic.py luôn gửi field này khi feasible).
    length_source?: string;
    total_bars?: number;
    total_waste_mm?: number;
    waste_percentage?: number;
    /// Mẩu sắt còn nguyên (chưa cắt) từ cây cắt dở của loại sắt này - nhập kho, không phải hao hụt.
    mau_nguyen_mm?: number;
    /// So sánh hao hụt giữa các chiều dài chuẩn đã chấm - thuần hiển thị.
    length_comparison?: Array<{ length: number; bars: number; waste_pct: number }>;
    /// Nhu cầu vs thực cắt theo TỪNG cỡ đoạn (api/views.py gắn `item["pieces"]`). CHỈ có ở dòng
    /// feasible=true. `surplus` = produced - demand, không lưu lại (Sếp chốt 2026-08-25 bỏ cột
    /// Tồn kho khỏi bản in) - cần thì suy lại được. Trước 2026-08-25 field này bị bỏ qua hoàn
    /// toàn, "SL cần" không có chỗ nào lưu -> bản in thiếu hẳn bảng TỔNG KẾT.
    pieces?: Array<{ size: number; demand: number; produced: number; surplus?: number }>;
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
  /** Tên các mảnh dùng tới từng cỡ đoạn - CÙNG khoá `"{materialId}:{cutLengthMm}"` với
   *  segmentSpecLookup (xem buildBomRows để biết vì sao khoá phải dựng đúng kiểu đó). Chỉ để in
   *  ra bảng TỔNG KẾT cho thợ cắt biết đoạn này là mảnh gì, không tham gia tính toán. 1 cỡ đoạn
   *  có thể thuộc nhiều mảnh (và nhiều SKU khác nhau khi cắt gộp cả PI) nên là mảng. */
  segmentNames: Map<string, string[]>;
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
    options: {
      idempotencyKey?: string;
      requestedById?: string;
      /** Chạy SAU KHI phương án cắt tính xong (thành công/chặn/lỗi đều tính là "xong") - dùng để
       *  hoãn các đề xuất mua khác của CÙNG PI (VTTP/tiêu hao) tới khi đề xuất mua sắt đã hiển thị
       *  xong, thay vì bắn song song và làm Mua hàng thấy phiếu xuất hiện rải rác không đồng bộ
       *  (2026-08-24, xem ProductionInvoicesService.approveItem()). */
      onComplete?: () => void | Promise<void>;
    } = {},
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
      options.onComplete,
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
    options: {
      idempotencyKey?: string;
      requestedById?: string;
      onComplete?: () => void | Promise<void>;
    } = {},
  ): Promise<CuttingProposalResponseDto> {
    // L2 (2026-08-26): CHỈ PI gộp mới được lập kế hoạch cắt ở cấp cả cụm. PI thường lập kế hoạch
    // theo TỪNG SKU (requestForOrder, gọi từ approveItem) - cho đường này chạy trên PI thường sẽ
    // tạo phương án neo PI phủ chồng lên các phương án neo PO đã có, cùng nhu cầu bị lập kế hoạch
    // 2 lần (giữ chỗ tồn 2 lần + đề xuất mua trùng). Bất biến: mỗi SKU chỉ được phủ bởi ĐÚNG 1
    // phương án cắt đang hiệu lực - xem cổng đối xứng ở ProductionInvoicesService.approveItem().
    //
    // Kiểm ở service (không phải chỉ ở controller) vì đây là bất biến NGHIỆP VỤ: route thô
    // POST /production-invoices/:id/cutting-proposals gọi thẳng vào đây, và approveBatch() cũng
    // gọi vào đây - cả 2 đường phải cùng chịu một luật.
    const pi = await this.prisma.productionInvoice.findUnique({
      where: { id: productionInvoiceId },
      select: { code: true, isMerged: true },
    });
    if (!pi) {
      throw new NotFoundException(`Production invoice ${productionInvoiceId} not found`);
    }
    if (!pi.isMerged) {
      throw new ConflictException(
        `${pi.code} không phải đợt gộp - phương án cắt của PI thường tính theo TỪNG SKU khi Sếp duyệt SKU đó (xem requestForOrder), không tính chung cả phiếu`,
      );
    }

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
      options.onComplete,
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
    const kerfMm = config.solverBladeWidthMm.toNumber();

    const suggestions: CuttingBatchSuggestionDto[] = [];
    for (const material of materials) {
      const entries = byMaterial.get(material.id);
      if (!entries) continue;
      const thresholdPct =
        material.maxCuttingWastePercentage?.toNumber() ??
        config.solverMaxWastePercentage.toNumber();

      // Xếp theo hạn gần nhất trước; KHÔNG có hạn thì xuống cuối (không được để dữ liệu thiếu
      // đẩy 1 đơn lên làm mốc neo "gấp nhất").
      const sorted = [...entries].sort((a, b) => {
        const da = frameDeadlineOf(a.item);
        const db = frameDeadlineOf(b.item);
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
    const kerfMm = config.solverBladeWidthMm.toNumber();
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
        salesOrderCode: item.salesOrder?.code ?? null,
        productionInvoiceCode: item.productionInvoice?.code ?? null,
        deadline: frameDeadlineOf(item),
        prodApprovalStatus: item.prodApprovalStatus,
        rejectReason: item.rejectReason,
        hasActiveBom: !itemsWithoutBom.has(item.id),
        materials: mats
          .map(({ materialId, demand }) => {
            const material = materialById.get(materialId);
            if (!material) return null;
            const thresholdPct =
              material.maxCuttingWastePercentage?.toNumber() ??
              config.solverMaxWastePercentage.toNumber();
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
    const kerfMm = config.solverBladeWidthMm.toNumber();

    const lines: CuttingBatchPreviewLineDto[] = [];
    for (const material of materials) {
      const members = (byMaterial.get(material.id) ?? []).filter((e) => selectedIds.has(e.item.id));
      if (members.length === 0) continue;
      const thresholdPct =
        material.maxCuttingWastePercentage?.toNumber() ??
        config.solverMaxWastePercentage.toNumber();
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
      .map((i) => frameDeadlineOf(i))
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
        AND: [
          {
            // "Sếp chưa duyệt" = chưa APPROVED. PHẢI viết dạng OR có nhánh null: item vừa sinh từ
            // đơn hàng mang prodApprovalStatus = null (KHSX chưa gửi QLSX) và `notIn` của SQL
            // KHÔNG khớp NULL, dùng notIn sẽ loại mất đúng nhóm đơn mới nhất - tức nhóm cần gộp
            // nhất.
            //
            // REJECTED nằm trong danh sách có chủ đích: Sếp từ chối một đợt gộp thì các SKU trong
            // đó phải QUAY LẠI đây để KHSX gộp tổ hợp khác (yêu cầu Sếp 2026-08-14) - thiếu nhánh
            // này thì SKU bị từ chối biến mất khỏi hệ thống, không ai gộp lại được.
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
          },
          {
            // Chỉ hiện SKU thực sự CHƯA được gom vào PI nào (2026-08-20 - PI không còn tự sinh
            // lúc Sales tạo PO). Trước đây (tới 2026-08-24) còn hiện lại cả SKU đã "cắt riêng"
            // (đang nằm trong 1 PI thường, isMerged=false) để KHSX đổi ý gộp - bỏ vì gây nhầm lẫn
            // (SKU hiện đồng thời ở cả đây lẫn "Lệnh sản xuất mới") và khi gộp đi nơi khác sẽ để
            // lại PI cắt riêng cũ trống rỗng không ai dọn. Muốn đổi ý sau khi đã cắt riêng thì
            // Sếp từ chối SKU đó trước (rejectItem - tự trả về NULL + xoá PI cũ, xem
            // production-invoices.service.ts) rồi mới gộp lại được ở đây.
            productionInvoiceId: null,
          },
        ],
      },
      include: {
        mfgProduct: true,
        salesOrder: true,
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

    // Tính 1 LẦN, dùng lại cả cho cổng chặn L7 dưới đây LẪN bước gộp PurchaseProposal trong
    // transaction (xem resolveTargetProductionInvoiceId) - tránh 2 câu SELECT giống hệt nhau.
    const targetProductionInvoiceId = await this.resolveTargetProductionInvoiceId(proposal);

    // L7 (2026-08-26): chặn CẢ đường duyệt thủ công này - autoApproveBlockReason() chỉ đứng gác
    // nhánh tự-duyệt (xem docstring hàm đó), không phải constraint DB. Không lặp lại logic, gọi
    // thẳng cùng 1 hàm để 2 đường luôn nhất quán 1 quy tắc duy nhất.
    const lengthConflictReason = await this.findConflictingStockLengthReason(
      bigId,
      targetProductionInvoiceId,
    );
    if (lengthConflictReason) {
      throw new ConflictException(`Không duyệt được phương án cắt ${id}: ${lengthConflictReason}`);
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

        // L2 mức 2 (2026-08-27): chốt quyền phủ các SKU trước khi ghi bất cứ gì có hệ quả tiền bạc
        // (giữ chỗ tồn / đề xuất mua). Chạy SAU bước supersede ở trên - "Tính lại" phải được phép
        // chuyển chủ từ phương án vừa bị đánh SUPERSEDED. Xem doc comment model CuttingPlanCoverage.
        await this.claimCuttingPlanCoverage(tx, bigId, proposal);

        const result = await tx.cuttingProposal.update({
          where: { id: bigId },
          data: {
            status: CuttingProposalStatus.APPROVED,
            approvedAt: new Date(),
            approvedById: actorUserId,
          },
          include: LIST_INCLUDE,
        });

        const consumptions: {
          materialId: bigint;
          consumeQty: number;
          warehouseId: bigint;
          stockLengthMm: number;
        }[] = [];

        if (buyableLines.length > 0) {
          const items: {
            materialId: bigint;
            buyQty: number;
            actualStock: number;
            stockLengthMm: number | null;
          }[] = [];
          // Khoá theo THỨ TỰ (materialId, stockLengthMm) tăng dần, không theo thứ tự dòng trong
          // phương án: 2 phương án gộp chạm cùng vật tư+bucket theo thứ tự ngược nhau sẽ khoá chéo
          // và deadlock. Thứ tự khoá nhất quán toàn hệ thống là cách chuẩn để loại hẳn ca đó (kế
          // hoạch "chiều dài cây sắt" 2026-08-29, Bước 4: thêm stockLengthMm vào khoá thứ tự).
          const orderedLines = [...buyableLines].sort((a, b) => {
            if (a.materialId !== b.materialId) return a.materialId < b.materialId ? -1 : 1;
            const aLen = a.bestStockLengthMm ?? 0;
            const bLen = b.bestStockLengthMm ?? 0;
            return aLen - bLen;
          });
          for (const line of orderedLines) {
            const { warehouseId } = warehouseByMaterialId.get(line.materialId)!;
            const stockLengthMm = line.bestStockLengthMm ?? 0;
            // Khoá advisory THEO BUCKET trước FOR UPDATE - bucket mới toanh (cỡ cây chưa từng
            // nhập) chưa có dòng stock_quant nào để FOR UPDATE khoá, nên 2 lượt duyệt song song
            // cùng bucket mới đều thấy onHand=0 mà không chờ nhau nếu thiếu khoá này (kế hoạch
            // "chiều dài cây sắt" 2026-08-29, Bước 4 - trước fix này rủi ro gần như không xảy ra vì
            // bucket 0 hầu như luôn có sẵn dòng). Namespace riêng `stock-bucket:` - KHÔNG trùng
            // `purchase-proposal-mutate:` mà receiveItem() dùng, vì đây là 2 thao tác trên 2 dữ
            // liệu khác nhau ở 2 thời điểm khác nhau, không có tình huống nào cần loại trừ lẫn nhau.
            await lockBusinessKey(
              tx,
              `stock-bucket:${warehouseId}:${line.materialId}:${stockLengthMm}`,
            );
            // Khoá dòng stock_quant liên quan trong lúc tính "tồn khả dụng" - chặn 2 phương án
            // cắt cùng vật tư được duyệt gần như đồng thời cùng đọc thấy 1 số dư (giống pattern
            // WarehouseTransfersService.createTransfer()). Khoá này CHỈ có tác dụng vì bút toán
            // trừ kho nằm trong cùng transaction ở dưới - trigger trg_sync_stock_quant cập nhật
            // stock_quant lúc INSERT stock_ledger, nên nếu bút toán ra ngoài transaction thì khoá
            // đã nhả trước khi số dư kịp đổi và lượt duyệt kế tiếp vẫn đọc thấy số cũ.
            const locked = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
            SELECT "qty" FROM "stock_quant"
            WHERE "warehouseId" = ${warehouseId} AND "materialId" = ${line.materialId}
              AND "stockLengthMm" = ${stockLengthMm}
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
              stockLengthMm,
              onHand,
            );
            const totalBars = line.totalBars!;
            const consumeQty = Math.min(totalBars, available);
            const buyQty = totalBars - consumeQty;

            // actualStock vẫn là TỒN VẬT LÝ THẬT (onHand) - không đổi ý nghĩa field này sang
            // "khả dụng". Đây là số hiển thị cho người xem (audit "lúc duyệt kho có bao nhiêu cây
            // thật"); available chỉ dùng nội bộ để tính consumeQty/buyQty ở trên.
            //
            // stockLengthMm copy NGUYÊN VĂN từ chính dòng phương án - Mua hàng PHẢI biết đặt cây
            // dài bao nhiêu (2026-08-26, sau khi mở lại auto_scan: có thể ra chiều dài đặt riêng
            // khác 6000mm, xem lengthSource trên CuttingProposalLine để phân biệt fixed/scan).
            items.push({
              materialId: line.materialId,
              buyQty,
              actualStock: onHand,
              stockLengthMm: line.bestStockLengthMm,
            });
            // L1 (2026-08-26): chốt phần đóng góp của CHÍNH dòng này để bước gộp bên dưới tính lại
            // TOÀN PHẦN được (Σ buyBars của mọi phương án còn hiệu lực) thay vì đoán cộng-hay-thay.
            // Ghi trong CÙNG transaction với giữ chỗ tồn ở dưới: buyBars và consumeQty là 2 nửa của
            // cùng một phép chia `totalBars`, lệch nhau nghĩa là sổ sách mâu thuẫn.
            await tx.cuttingProposalLine.update({
              where: { id: line.id },
              data: { buyBars: buyQty },
            });
            if (consumeQty > 0) {
              consumptions.push({
                materialId: line.materialId,
                consumeQty,
                warehouseId,
                stockLengthMm,
              });
            }
          }

          // Nếu tồn hiện có đã đủ (buyQty=0) cho 1 dòng thì không có gì để mua dòng đó - tạo/set
          // thẳng item.status=PURCHASED thay vì NEW ngay từ đầu (không đợi receiveItem()), nếu
          // không dòng đó sẽ kẹt vĩnh viễn ở NEW chờ báo giá vô ích: NhapKhoPage tự hiện "Đã nhận
          // đủ" ngay (receivedQty 0 >= buyQty 0) nên không có nút xác nhận nào để bấm mà tự
          // receiveItem() lên PURCHASED được (phát hiện qua e2e/golden-path.spec.ts khi tồn kho
          // tích luỹ đủ qua nhiều lần chạy demo, D.p7-zero-buyqty-stuck).
          // warehouseCode cấp cả đề xuất giờ CHỈ mang tính tóm tắt/hiển thị (lấy theo dòng đầu tiên)
          // - nguồn xác thực thật để nhập hàng là PurchaseProposalItem.materialId -> Material.
          // warehouseId, xem PurchaseProposalsService.receiveItem(). Hiện luôn trùng 1 kho vì
          // cat_sat_iea chỉ tính vật tư sắt, nhưng KHÔNG còn là giả định cứng của code.
          const primaryWarehouseCode = warehouseByMaterialId.get(
            buyableLines[0].materialId,
          )!.warehouseCode;

          // Gộp vào ĐÚNG 1 PurchaseProposal/PI (2026-08-25, chốt lại yêu cầu thực tế "Sếp/PM"):
          // chờ đề xuất sắt xong rồi mới tính VTTP/tiêu hao (đã có sẵn từ 2026-08-24, xem
          // ProductionInvoicesService onComplete) - giờ đi xa hơn, để cả 3 nguồn CÙNG GHI vào 1
          // bản ghi PurchaseProposal duy nhất thay vì mỗi nguồn tự tạo riêng, Mua hàng chỉ thấy
          // ĐÚNG 1 form cho cả PI. Khoá theo PI (không phải theo CuttingProposal) để 3 nguồn không
          // cùng lúc miss-tìm rồi cùng tạo trùng (race, xem ConsumableMaterialPurchaseService/
          // PieceMaterialYieldPurchaseService dùng CHUNG khoá này).
          //
          // targetProductionInvoiceId đã tính SẴN ở ngoài transaction (dùng chung với cổng chặn
          // L7 phía trên) - không query lại productionOrder ở đây nữa.
          if (targetProductionInvoiceId) {
            await lockBusinessKey(tx, `purchase-proposal-merge:${targetProductionInvoiceId}`);
          }

          // Tìm đề xuất "còn mở" (mọi trạng thái trừ PURCHASED) chứ không chỉ NEW (2026-08-25,
          // sửa cùng lúc với chuyển state machine xuống cấp item) - với item-level status, rollup
          // của proposal rời NEW ngay khi có 1 dòng bất kỳ được acknowledge/báo giá, SỚM hơn hẳn
          // trước đây (đúng mục tiêu "duyệt riêng từng người") - nếu vẫn lọc cứng theo NEW, VTTP/
          // tiêu hao sẽ không tìm thấy đề xuất sắt vừa tạo nữa ngay khi có người bắt đầu xử lý nó,
          // tự tạo đề xuất THỨ 2 tách rời, phá đúng cơ chế "1 PI = 1 form" (bug tiềm ẩn phát hiện
          // qua rà soát code khi thiết kế tính năng duyệt riêng, chưa từng biểu hiện ra ngoài vì
          // trước đây chưa ai kịp acknowledge trước khi cả 3 nguồn tính xong trong cùng 1 lượt).
          const existingProposal = targetProductionInvoiceId
            ? await tx.purchaseProposal.findFirst({
                where: {
                  productionInvoiceId: targetProductionInvoiceId,
                  status: { not: PurchaseProposalStatus.PURCHASED },
                },
                include: { items: true },
              })
            : null;

          // L1 (2026-08-26): NHU CẦU RÒNG - tính lại TOÀN PHẦN thay vì sửa buyQty tại chỗ.
          // Xem computeNetRequirementByMaterial() cho công thức + lý do. null khi phương án không
          // neo PI nào (dữ liệu hỏng) - lúc đó không có "cả PI" để cộng, rơi về đúng số của chính
          // lượt duyệt này như hành vi cũ.
          const netByMaterial = targetProductionInvoiceId
            ? await this.computeNetRequirementByMaterial(
                tx,
                targetProductionInvoiceId,
                items.map((it) => it.materialId),
              )
            : null;
          const plannedQtyOf = (materialId: bigint, fallback: number) =>
            netByMaterial?.get(materialId)?.planned ?? fallback;

          if (existingProposal) {
            // Đề xuất chung đã có sẵn (do VTTP/tiêu hao tạo trước, hoặc từ 1 lượt "Tính lại" cắt
            // sắt trước đó chưa bị Mua hàng xử lý) - ghi đúng các dòng sắt vào đó, không tạo bản ghi
            // mới. cuttingProposalId luôn trỏ về phương án cắt MỚI NHẤT vừa duyệt (ghi đè phương án
            // cũ nếu có - phương án cũ đã bị đánh SUPERSEDED ở trên rồi).
            for (const it of items) {
              const planned = plannedQtyOf(it.materialId, it.buyQty);
              // Tách bạch ĐƠN KẾ HOẠCH (dòng NEW, chưa ai động vào - được phép ghi đè tự do) với
              // ĐƠN ĐÃ CHỐT (QUOTING trở đi - người mua đang báo giá/đã đặt tiền, TUYỆT ĐỐI không
              // sửa). `planned` đã trừ sẵn phần đã chốt (xem computeNetRequirementByMaterial), nên
              // ở đây chỉ còn việc ghi nó vào đúng dòng kế hoạch. Mỗi vật tư tối đa 1 dòng NEW.
              const plannedLine = existingProposal.items.find(
                (x) => x.materialId === it.materialId && x.status === PurchaseProposalStatus.NEW,
              );
              const anyLine = existingProposal.items.find((x) => x.materialId === it.materialId);

              // L3 (2026-08-26): stockLengthMm PHẢI đi kèm mọi đường ghi - thiếu thì dòng sắt của
              // SKU thứ 2 trở đi mất cỡ cây và Mua hàng đặt nhầm về 6000mm mặc định. An toàn ghi
              // thẳng it.stockLengthMm vì approve() đã chặn từ trước (findConflictingStockLengthReason,
              // L7) mọi ca 2 SKU cùng loại sắt chốt 2 cỡ cây khác nhau.
              if (plannedLine) {
                const isCovered = planned === 0;
                await tx.purchaseProposalItem.update({
                  where: { id: plannedLine.id },
                  data: {
                    buyQty: planned,
                    actualStock: it.actualStock,
                    stockLengthMm: it.stockLengthMm,
                    ...(isCovered
                      ? { status: PurchaseProposalStatus.PURCHASED, purchasedAt: new Date() }
                      : {}),
                  },
                });
              } else if (!anyLine) {
                // Vật tư này chưa có dòng nào trong đề xuất - tạo mới. planned=0 vẫn tạo dòng (đóng
                // hồ sơ luôn) để Mua hàng THẤY được là vật tư này đã xét và không phải mua gì, thay
                // vì biến mất khỏi form không dấu vết. Đặt PURCHASED ngay thay vì NEW: dòng buyQty=0
                // để NEW sẽ kẹt vĩnh viễn chờ báo giá vô ích - NhapKhoPage tự hiện "Đã nhận đủ"
                // (receivedQty 0 >= buyQty 0) nên không có nút nào bấm để đẩy nó lên PURCHASED
                // (D.p7-zero-buyqty-stuck, phát hiện qua e2e/golden-path.spec.ts).
                const isCovered = planned === 0;
                await tx.purchaseProposalItem.create({
                  data: {
                    proposalId: existingProposal.id,
                    materialId: it.materialId,
                    buyQty: planned,
                    actualStock: it.actualStock,
                    stockLengthMm: it.stockLengthMm,
                    status: isCovered
                      ? PurchaseProposalStatus.PURCHASED
                      : PurchaseProposalStatus.NEW,
                    purchasedAt: isCovered ? new Date() : undefined,
                  },
                });
              } else if (planned > 0) {
                // Vật tư đã có dòng nhưng TẤT CẢ đều đã chốt (PURCHASED/QUOTING/...) mà vẫn còn
                // thiếu - tách dòng kế hoạch MỚI cho đúng phần thiếu, đi lại từ đầu quy trình báo
                // giá. KHÔNG âm thầm sửa số trên dòng đã chốt (2026-08-26, lỗ #6: ghi đè buyQty của
                // dòng PURCHASED làm phần thiếu biến mất khỏi hàng đợi vĩnh viễn vì activeOnly lọc
                // bỏ PURCHASED).
                await tx.purchaseProposalItem.create({
                  data: {
                    proposalId: existingProposal.id,
                    materialId: it.materialId,
                    buyQty: planned,
                    actualStock: it.actualStock,
                    stockLengthMm: it.stockLengthMm,
                    status: PurchaseProposalStatus.NEW,
                  },
                });
              }
              // planned === 0 và đã có dòng chốt phủ đủ -> không cần làm gì.
            }
            await tx.purchaseProposal.update({
              where: { id: existingProposal.id },
              data: { cuttingProposalId: bigId },
            });
            await recomputeProposalStatus(tx, existingProposal.id);
          } else {
            const created = await tx.purchaseProposal.create({
              data: {
                cuttingProposalId: bigId,
                productionInvoiceId: targetProductionInvoiceId ?? undefined,
                warehouseCode: primaryWarehouseCode,
                items: {
                  create: items.map((it) => {
                    // Chưa có đề xuất "còn mở" nào, NHƯNG có thể đã có đề xuất ĐÃ ĐÓNG (PURCHASED)
                    // của cùng PI mua trước đó - `planned` đã trừ phần đó (netting soi MỌI đề xuất
                    // của PI, không chỉ đề xuất đang mở), nếu không sẽ mua lại lần 2 đúng số đã mua.
                    const planned = plannedQtyOf(it.materialId, it.buyQty);
                    const isCovered = planned === 0;
                    return {
                      ...it,
                      buyQty: planned,
                      status: isCovered
                        ? PurchaseProposalStatus.PURCHASED
                        : PurchaseProposalStatus.NEW,
                      purchasedAt: isCovered ? new Date() : undefined,
                    };
                  }),
                },
              },
            });
            await recomputeProposalStatus(tx, created.id);
          }
        }

        // B4 Đợt 2 (mục 13 changelog 2026-08-15): approve() KHÔNG còn trừ tồn thật (StockLedger) -
        // chỉ GIỮ CHỖ. Tồn vật lý chỉ giảm khi SteelIssuesService.create() ghi nhận Phôi thực sự
        // lấy sắt (xem STEEL_ISSUE_RESERVATION_CUTOVER ở đó cho cách xử lý phương án đã duyệt
        // TRƯỚC mốc đổi này - những phương án đó đã bị trừ tồn theo cơ chế CŨ, không được trừ lần 2).
        // Việc đọc tồn - quyết định consumeQty - ghi giữ chỗ vẫn nằm trọn trong 1 khoá, 1 commit như
        // trước (lý do giữ FOR UPDATE ở trên không đổi: 2 phương án cùng vật tư duyệt gần nhau vẫn
        // phải xếp hàng, chỉ là phần "ăn" giờ là giữ chỗ thay vì trừ tồn thẳng).
        for (const { materialId, consumeQty, warehouseId, stockLengthMm } of consumptions) {
          await this.stockReservationsService.reserve(
            {
              warehouseId,
              materialId,
              stockLengthMm,
              qty: consumeQty,
              refType: StockReservationRefType.CUTTING_PROPOSAL,
              refId: bigId.toString(),
              // L5 (2026-08-26): gắn PI thật lên dòng giữ chỗ - StockReservationsService dùng để
              // gộp dòng này vào đúng "pool" khi credit (hàng mua về)/drain (Phôi xuất), xem
              // loadPool(). undefined khi phương án không neo PI nào (dữ liệu hỏng, ca cực hiếm).
              productionInvoiceId: targetProductionInvoiceId ?? undefined,
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
    onComplete?: () => void | Promise<void>,
  ): Promise<void> {
    let poNumber: string | undefined;
    try {
      const job = await buildJob();
      poNumber = job.label;
      const { bomRows, segmentSpecLookup, segmentNames } = job;
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
        blade_width: config.solverBladeWidthMm.toNumber(),
        max_waste_percentage: config.solverMaxWastePercentage.toNumber(),
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
      //
      // 2026-08-26 (mở lại auto_scan): công thức này KHÔNG tính phần vét cạn - 1 loại sắt cần
      // scan gọi optimize_material() LẶP LẠI cho từng chiều dài trong dải min/max_length (mặc
      // định ~100 lần), mỗi lần vẫn giới hạn bởi CÙNG time_limit_seconds đó. Trần lý thuyết thật
      // sự cao hơn nhiều lần công thức dưới, nhưng KHÔNG nâng multiplier lên (100×) vì CP-SAT cho
      // bài toán nhỏ cỡ này hầu như luôn giải xong trong mili-giây tới vài giây - nâng multiplier
      // sẽ chặn nhầm mọi đợt gộp bình thường trước khi kịp thử. Đo thật 2026-08-26 (3 loại sắt, 1
      // loại phải vét cạn 101 chiều dài): 47s, timeoutSeconds mặc định 1700s vẫn dư nhiều. Rủi ro
      // còn lại là ca CP-SAT thật sự bế tắc ở MỌI chiều dài (hiếm, thường do ngưỡng % đặt sai) -
      // khi đó request bị timeoutSeconds cắt ngang, lỗi báo ra sẽ là lỗi mạng chung chung như đã
      // mô tả ở trên, không phải điều mới do đổi này gây ra (case đó vốn đã tệ y hệt trước đây).
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

      // auto_scan LUÔN true - MỘT LẦN GỌI DUY NHẤT, không có nhánh retry lần 2 (khác hẳn cơ chế
      // "gọi lại" đã bỏ 2026-08-18 mô tả bên dưới): solver TỰ quyết fixed-hay-scan bên trong 1
      // request (de_xuat_logic.py::optimize_one_material) - chiều dài chuẩn nào đạt ngưỡng thì
      // CHỐT LUÔN, chỉ khi KHÔNG chiều dài chuẩn nào đạt mới vét cạn dải min/max_length. Tức là
      // bật auto_scan không hề đụng tới các dòng đã đạt sẵn trên 6000mm (đã đo thật: 2 dòng feasible
      // trên 6000mm ra CÙNG SỐ hệt như auto_scan=false, xem changelog 2026-08-26).
      //
      // Lịch sử: 2026-08-06 Sếp bật tính năng này (khi đó cài bằng 1 request GỌI LẦN 2 riêng, xem
      // đoạn "Bỏ hẳn 2026-08-18" cũ). Bỏ 2026-08-18 vì 2 lý do:
      //   (a) "Che tín hiệu cần gộp SKU" - PHẦN NÀY VẪN ĐÚNG nhưng Sếp chốt lại 2026-08-26: chỉ
      //       chấp nhận đánh đổi này cho ca THẬT SỰ không gộp được (1 SKU đứng riêng, hoặc gộp
      //       xong vẫn trượt ngưỡng) - những ca đó đằng nào QLSX cũng không còn đường gộp nào khác,
      //       không có tín hiệu gì để mất.
      //   (b) "Chiều dài KHÔNG chảy tới Mua hàng, % hao hụt hiện không thật" - ĐÃ VÁ 2026-08-26:
      //       PurchaseProposalItem.stockLengthMm giờ copy thẳng từ bestStockLengthMm lúc approve()
      //       (xem dưới), CuttingProposalLine.lengthSource ghi rõ "scan" để không ai đọc nhầm
      //       5900mm là cây chuẩn. Câu hỏi "NCC có bán được cây lẻ không" là quyết định thương mại
      //       của Sếp/Purchasing, không phải giới hạn kỹ thuật của hệ thống nữa.
      const requestBody: typeof baseRequestBody & { auto_scan: boolean } = {
        ...baseRequestBody,
        auto_scan: true,
      };
      const response = await callSolver(requestBody);

      await this.saveSuccess(proposalId, requestBody, response, segmentSpecLookup, segmentNames);

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
    } finally {
      // Chạy dù thành công/chặn/lỗi - "xong" ở đây nghĩa là đề xuất mua sắt (nếu có) đã hiển thị
      // ổn định, không phải "tính ra kết quả tốt". Tách try/catch riêng, best-effort như mọi
      // trigger khác trong luồng này - lỗi ở đây không được phép che mất kết quả cắt sắt vừa lưu.
      if (onComplete) {
        try {
          await onComplete();
        } catch (error) {
          this.logger.error(
            `onComplete sau cutting proposal ${proposalId} thất bại: ${(error as Error).message}`,
          );
        }
      }
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

    const targetProductionInvoiceId = await this.resolveTargetProductionInvoiceId(proposal);
    return this.findConflictingStockLengthReason(proposalId, targetProductionInvoiceId);
  }

  /**
   * PI thật của 1 phương án cắt - trực tiếp (neo PI, đợt gộp) hoặc suy qua PO thành viên (neo PO,
   * SKU cắt riêng). Tách riêng khỏi findConflictingStockLengthReason() (L7) vì approve() CŨNG cần
   * đúng giá trị này cho bước gộp PurchaseProposal (xem "Gộp vào ĐÚNG 1 PurchaseProposal/PI") -
   * gọi 1 LẦN DUY NHẤT rồi dùng lại (closure) thay vì mỗi nơi tự query lại `productionOrder`
   * (rẻ nhưng thừa, và với PO đã có Mua hàng gán nhiều dòng thì 2 câu SELECT giống hệt nhau chạy
   * 2 lần trong CÙNG 1 request là dấu hiệu thiết kế sai, không phải hiệu năng).
   */
  private async resolveTargetProductionInvoiceId(proposal: {
    productionOrderId: bigint | null;
    productionInvoiceId: bigint | null;
  }): Promise<bigint | null> {
    if (proposal.productionInvoiceId) return proposal.productionInvoiceId;
    if (!proposal.productionOrderId) return null;
    const order = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: proposal.productionOrderId },
      select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
    });
    return order.productionInvoiceItem.productionInvoiceId;
  }

  /**
   * L2 mức 2 (2026-08-27) - chốt quyền phủ: đánh dấu phương án `cuttingProposalId` là kế hoạch cắt
   * DUY NHẤT đang hiệu lực của từng SKU nó phủ. Xem doc comment model CuttingPlanCoverage cho lý do
   * tồn tại (ép bất biến ở tầng DB thay vì chỉ tin cổng chặn ở service).
   *
   * Phương án neo PO phủ ĐÚNG 1 SKU; phương án neo PI (đợt gộp) phủ MỌI SKU thành viên. Không neo
   * vào đâu = dữ liệu hỏng (không sinh ra được qua requestForOrder/requestForInvoice) - bỏ qua,
   * cùng cách xử lý với bước supersede ở approve().
   *
   * 3 ca khi SKU đã có chủ:
   *   1. Chủ cũ CHÍNH LÀ phương án này  -> gọi lại (retry/idempotent), không có gì để làm.
   *   2. Chủ cũ đã chết (SUPERSEDED/...) -> CHUYỂN CHỦ hợp lệ, đây là đường đi của "Tính lại".
   *   3. Chủ cũ còn APPROVED             -> PHỦ CHỒNG, chặn. Đây đúng là ca mà 2 cổng ở service
   *      (approveItem/requestForInvoice, chặn theo isMerged) lẽ ra đã lọc - tới được đây nghĩa là
   *      có đường nào đó đi vòng qua chúng, phải nổ to chứ không im lặng ghi đè.
   */
  private async claimCuttingPlanCoverage(
    tx: PrismaTx,
    cuttingProposalId: bigint,
    proposal: { productionOrderId: bigint | null; productionInvoiceId: bigint | null },
  ): Promise<void> {
    const coveredOrderIds = proposal.productionOrderId
      ? [proposal.productionOrderId]
      : proposal.productionInvoiceId
        ? (
            await tx.productionOrder.findMany({
              where: {
                productionInvoiceItem: { productionInvoiceId: proposal.productionInvoiceId },
              },
              select: { id: true },
            })
          ).map((o) => o.id)
        : [];
    if (coveredOrderIds.length === 0) return;

    for (const productionOrderId of coveredOrderIds) {
      // Khoá dòng phủ hiện có rồi đọc lại trong cùng câu - đọc-rồi-ghi không khoá sẽ cho 2 lượt
      // duyệt đồng thời cùng thấy "chủ cũ đã chết" và cùng chuyển chủ. Dòng CHƯA tồn tại thì
      // FOR UPDATE không khoá được gì, nhưng lúc đó chính PRIMARY KEY chặn: 2 lượt cùng INSERT thì
      // 1 lượt ăn lỗi trùng khoá - đúng hành vi mong muốn (nổ, không âm thầm đè).
      const [existing] = await tx.$queryRaw<{ cuttingProposalId: bigint }[]>`
        SELECT "cuttingProposalId" FROM "cutting_plan_coverage"
        WHERE "productionOrderId" = ${productionOrderId} FOR UPDATE
      `;

      if (existing) {
        if (existing.cuttingProposalId === cuttingProposalId) continue; // ca 1
        const owner = await tx.cuttingProposal.findUnique({
          where: { id: existing.cuttingProposalId },
          select: { status: true },
        });
        if (owner?.status === CuttingProposalStatus.APPROVED) {
          // ca 3
          const order = await tx.productionOrder.findUnique({
            where: { id: productionOrderId },
            select: { poNumber: true },
          });
          throw new ConflictException(
            `Lệnh sản xuất ${order?.poNumber ?? productionOrderId} đã được phương án cắt ` +
              `${existing.cuttingProposalId} (đang hiệu lực) lập kế hoạch rồi - duyệt tiếp sẽ lập kế ` +
              `hoạch 2 lần cho cùng một nhu cầu (giữ chỗ tồn 2 lần, mua trùng). Xử lý phương án cũ trước.`,
          );
        }
        // ca 2 - chuyển chủ
        await tx.cuttingPlanCoverage.update({
          where: { productionOrderId },
          data: { cuttingProposalId, assignedAt: new Date() },
        });
        continue;
      }

      await tx.cuttingPlanCoverage.create({
        data: { productionOrderId, cuttingProposalId },
      });
    }
  }

  /**
   * L1 (2026-08-26) - NHU CẦU MUA RÒNG của 1 PI cho từng vật tư, theo đúng công thức netting của
   * MRP:
   *
   *     Nhu cầu gộp  = Σ buyBars của MỌI dòng phương án cắt còn HIỆU LỰC (APPROVED) của PI này
   *     Nguồn đã có  = Σ phần đã CHỐT của mọi dòng đề xuất mua thuộc PI này
   *     Nhu cầu ròng = max(0, gộp − đã có)      ← số ghi vào dòng kế hoạch (NEW)
   *
   * VÌ SAO PHẢI TÍNH LẠI TOÀN PHẦN thay vì sửa `buyQty` tại chỗ: từ khi "gộp 1 PI = 1 form"
   * (2026-08-25), `PurchaseProposalItem.buyQty` là TỔNG nhu cầu của nhiều SKU dùng chung 1 loại
   * sắt. Code cũ sửa tổng đó tại chỗ và phải ĐOÁN nên cộng dồn hay thay thế
   * (`isRecomputeOfSameAnchor`, đã gỡ) - quy tắc ấy chỉ đúng khi dòng mới có 1 nguồn đóng góp; từ
   * nguồn thứ 2 trở đi nó sai CẢ HAI CHIỀU: "Tính lại" SKU A sau khi SKU B đã ghi thì hoặc XOÁ MẤT
   * nhu cầu của B (nhánh thay thế), hoặc ĐẾM 2 LẦN nhu cầu của chính A (nhánh cộng dồn). Tính lại
   * từ nguồn gốc thì không còn gì để đoán: chạy lại bao nhiêu lần cũng ra một số (idempotent - yêu
   * cầu bắt buộc của mọi lần chạy MRP), và luôn truy được "35 cây gồm 20 của A + 15 của B".
   *
   * "ĐÃ CHỐT" = mọi dòng KHÁC trạng thái NEW. Đây là ranh giới planned-order / firmed-order kinh
   * điển: dòng NEW chưa ai động vào nên được phép ghi đè tự do, còn từ QUOTING trở đi người mua đã
   * đi lấy báo giá / Sếp đã duyệt NCC / tiền đã đi - sửa số dưới chân họ là sai. Nên phần đã chốt
   * được coi là NGUỒN CUNG ĐÃ CÓ và chỉ phần chênh mới thành đơn kế hoạch mới.
   *   - PURCHASED dùng `receivedQty` (hàng đã thật sự về kho, có thể lệch buyQty trong dung sai)
   *   - các trạng thái chốt khác dùng `buyQty` (đã đặt, đang trên đường về)
   *
   * Soi MỌI đề xuất mua của PI (không chỉ đề xuất đang mở): 1 đề xuất đã đóng hoàn toàn
   * (PURCHASED) vẫn là hàng đã mua thật, bỏ qua nó sẽ mua lại lần 2 đúng số đã mua khi PI phát sinh
   * SKU mới.
   */
  private async computeNetRequirementByMaterial(
    tx: PrismaTx,
    productionInvoiceId: bigint,
    materialIds: bigint[],
  ): Promise<Map<bigint, { gross: number; firmed: number; planned: number }>> {
    const result = new Map<bigint, { gross: number; firmed: number; planned: number }>();
    if (materialIds.length === 0) return result;
    const uniqueMaterialIds = [...new Set(materialIds)];

    const [lines, purchaseItems] = await Promise.all([
      // Cùng điều kiện "phủ đúng PI này" đã dùng ở findConflictingStockLengthReason/
      // SteelIssuesService - phương án neo thẳng PI (đợt gộp) HOẶC neo PO thành viên (SKU cắt
      // riêng). Chỉ APPROVED: DRAFT chưa được duyệt nên chưa phải nhu cầu thật, SUPERSEDED đã bị
      // thay thế (và giữ chỗ của nó đã được releaseByRef() nhả ra rồi).
      tx.cuttingProposalLine.findMany({
        where: {
          materialId: { in: uniqueMaterialIds },
          feasible: true,
          cuttingProposal: {
            status: CuttingProposalStatus.APPROVED,
            OR: [
              { productionInvoiceId },
              { productionOrder: { productionInvoiceItem: { productionInvoiceId } } },
            ],
          },
        },
        select: { materialId: true, buyBars: true },
      }),
      tx.purchaseProposalItem.findMany({
        where: {
          materialId: { in: uniqueMaterialIds },
          proposal: { productionInvoiceId },
        },
        select: { materialId: true, status: true, buyQty: true, receivedQty: true },
      }),
    ]);

    // buyBars = null nghĩa là CHƯA CHẠY `npm run backfill:buy-bars` (phương án duyệt trước
    // 2026-08-27, lúc đó cột chưa tồn tại). CHẶN CỨNG thay vì cộng 0:
    //
    // Cộng 0 sẽ làm nhu cầu gộp tính THIẾU đúng phần của phương án cũ, và lượt duyệt SKU tiếp theo
    // ghi đè dòng kế hoạch bằng con số hụt đó - tái sinh chính lỗi L1 mà netting sinh ra để diệt,
    // lần này qua đường dữ liệu. Sai ÂM THẦM, bằng tiền thật, không ai phát hiện cho tới lúc Phôi
    // ra xưởng thiếu sắt.
    //
    // Chặn ở đây đổi lỗi-tiền-bạc-âm-thầm thành lỗi-vận-hành-nhìn-thấy-được: không duyệt được
    // phương án cắt cho PI liên quan cho tới khi chạy backfill, kèm thông báo nói thẳng phải làm gì.
    // Sau khi backfill xong thì nhánh này không bao giờ chạy tới nữa (approve() luôn ghi buyBars).
    const missingBuyBars = lines.filter((l) => l.buyBars === null);
    if (missingBuyBars.length > 0) {
      throw new ConflictException(
        `Không tính được nhu cầu mua cho PI ${productionInvoiceId}: ${missingBuyBars.length} dòng ` +
          `phương án cắt chưa có buyBars (vật tư ${[...new Set(missingBuyBars.map((l) => l.materialId.toString()))].join(', ')}). ` +
          `Đây là dữ liệu duyệt TRƯỚC 2026-08-27 - chạy "npm run backfill:buy-bars" rồi thử lại. ` +
          `KHÔNG duyệt tiếp khi chưa backfill: nhu cầu của phương án cũ sẽ bị tính thiếu và ghi đè ` +
          `mất số đã có trên đề xuất mua.`,
      );
    }

    for (const materialId of uniqueMaterialIds) {
      const gross = lines
        .filter((l) => l.materialId === materialId)
        .reduce((sum, l) => sum + (l.buyBars ?? 0), 0);
      const firmed = purchaseItems
        .filter((p) => p.materialId === materialId && p.status !== PurchaseProposalStatus.NEW)
        .reduce(
          (sum, p) =>
            sum +
            (p.status === PurchaseProposalStatus.PURCHASED
              ? p.receivedQty.toNumber()
              : p.buyQty.toNumber()),
          0,
        );
      const planned = Math.max(0, gross - firmed);
      // Nhu cầu tụt xuống dưới phần ĐÃ CHỐT (vd định mức/số lượng SKU bị sửa giảm sau khi Mua hàng
      // đã đặt) - KHÔNG tự sửa dòng đã chốt (tiền đã đi), cũng KHÔNG im lặng bỏ qua. Đây đúng là
      // "exception message" của MRP: hệ thống không tự quyết được, phải để người xử lý.
      if (gross < firmed) {
        this.logger.warn(
          `PI ${productionInvoiceId} vật tư ${materialId}: nhu cầu còn ${gross} cây nhưng đã chốt mua ${firmed} cây ` +
            `- dư ${firmed - gross} cây. KHÔNG tự sửa dòng đã chốt (báo giá/đơn đã đi), Mua hàng cần xem lại.`,
        );
      }
      result.set(materialId, { gross, firmed, planned });
    }
    return result;
  }

  /**
   * L7 (2026-08-26, rà soát sau khi mở lại auto_scan): cùng 1 loại sắt trong CÙNG 1 PI phải mua
   * chung ĐÚNG 1 cỡ cây - solver chạy RIÊNG cho từng SKU (requestForOrder gọi 1 lần/PO), nên 2 SKU
   * dùng chung loại sắt hoàn toàn có thể ra 2 "chiều dài tối ưu" khác nhau (vd Ghế A ra 5900mm,
   * Bàn B ra 6200mm) mà KHÔNG có bước nào đối chiếu hai kết quả với nhau. Không chặn ở đây thì
   * bước gộp PurchaseProposalItem bên dưới (approve()) gộp 2 nhu cầu thành 1 dòng và ÂM THẦM giữ
   * chiều dài của SKU duyệt TRƯỚC - SKU sau bị đặt sai cỡ cây, hao hụt thật cao hơn hẳn số solver
   * đã báo cho chính SKU đó (xem changelog rà soát 2026-08-26).
   *
   * KHÔNG cần tính năng "gộp đợt cắt" nào để bấm tới đây: 1 PI có ≥2 SKU dùng chung 1 loại sắt,
   * duyệt riêng từng cái - thao tác hoàn toàn bình thường - là đủ điều kiện.
   *
   * Gọi từ CẢ autoApproveBlockReason() (chặn SỚM ngay khi tự-duyệt, hiện lý do rõ trên displayReason)
   * LẪN approve() (chặn cả đường thủ công POST .../approve - cổng autoApproveBlockReason() KHÔNG
   * bảo vệ đường đó, xem docstring hàm này).
   *
   * ⚠️ KHÔNG được nới lỏng luật "1 PI + 1 vật tư luôn chỉ chốt đúng 1 cỡ cây" ở hàm này mà không
   * sửa lại StockReservationsService.reserve() để phát hiện tham số stockLengthMm lệch giữa 2 lần
   * gọi cùng idempotencyKey và ném lỗi thay vì resolve-or-return - reserve() PHỤ THUỘC NGẦM vào
   * luật này (kế hoạch "chiều dài cây sắt" 2026-08-29, quyết định thiết kế #5). Trước plan đó phá
   * luật chỉ gây nhầm cỡ hiển thị; sau plan đó phá luật khiến 1 phiếu giữ chỗ bị âm thầm từ chối
   * (trả về dòng cũ, không báo lỗi) thay vì tạo đúng dòng mới ở bucket khác.
   */
  private async findConflictingStockLengthReason(
    proposalId: bigint,
    targetProductionInvoiceId: bigint | null,
  ): Promise<string | null> {
    // Không neo PI nào - không có "SKU khác cùng đợt" nào để đối chiếu.
    if (!targetProductionInvoiceId) return null;

    const myLines = await this.prisma.cuttingProposalLine.findMany({
      where: { cuttingProposalId: proposalId, bestStockLengthMm: { not: null } },
      select: { materialId: true, bestStockLengthMm: true },
    });
    if (myLines.length === 0) return null;

    // Đối chiếu với CuttingProposalLine (KHÔNG phải PurchaseProposalItem) của mọi phương án KHÁC
    // còn APPROVED, neo vào CÙNG PI (trực tiếp hoặc qua PO thành viên) - đây là nguồn xác thực
    // duy nhất cho "SKU khác trong cùng PI đã chốt cây bao nhiêu". PurchaseProposalItem không dùng
    // được: dòng đó bị ghi đè khi "Tính lại" supersede, không còn giữ lịch sử từng SKU.
    const siblingLines = await this.prisma.cuttingProposalLine.findMany({
      where: {
        materialId: { in: [...new Set(myLines.map((l) => l.materialId))] },
        bestStockLengthMm: { not: null },
        cuttingProposalId: { not: proposalId },
        cuttingProposal: {
          status: CuttingProposalStatus.APPROVED,
          OR: [
            { productionInvoiceId: targetProductionInvoiceId },
            {
              productionOrder: {
                productionInvoiceItem: { productionInvoiceId: targetProductionInvoiceId },
              },
            },
          ],
        },
      },
      select: { materialId: true, bestStockLengthMm: true },
    });
    if (siblingLines.length === 0) return null;

    const conflictMaterialIds = new Set(
      myLines
        .filter((mine) =>
          siblingLines.some(
            (s) =>
              s.materialId === mine.materialId && s.bestStockLengthMm !== mine.bestStockLengthMm,
          ),
        )
        .map((l) => l.materialId),
    );
    if (conflictMaterialIds.size === 0) return null;

    const materials = await this.prisma.material.findMany({
      where: { id: { in: [...conflictMaterialIds] } },
      select: { code: true },
    });
    const labels =
      materials.length > 0
        ? materials.map((m) => m.code)
        : [...conflictMaterialIds].map((id) => id.toString());
    return (
      `vật tư ${labels.join(', ')} đã được SKU khác trong cùng đợt sản xuất này chốt cây dài ` +
      `khác - phải gộp đợt cắt các SKU dùng chung loại sắt này lại với nhau (KHÔNG được mua 2 cỡ ` +
      `cây cho cùng 1 loại sắt trong 1 đợt sản xuất)`
    );
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

  /** `salesOrder` đọc trực tiếp ở CẤP ITEM, không suy qua `productionInvoice.salesOrder` - item
   *  chưa được gom (`productionInvoice: null`) vẫn phải hiện đúng PO gốc của nó. */
  private toBatchOrderDto(item: {
    id: bigint;
    quantity: number;
    prodApprovalStatus: ProdApprovalStatus | null;
    materialDeadline: Date | null;
    mfgProduct: { factoryCode: string; name: string | null };
    salesOrder: { code: string } | null;
    stages: { stageType: ProdItemStageType; deadline: Date }[];
    productionInvoice: { code: string; deadline: Date | null } | null;
  }): CuttingBatchOrderDto {
    return new CuttingBatchOrderDto({
      productionInvoiceItemId: item.id.toString(),
      salesOrderCode: item.salesOrder?.code ?? null,
      productionInvoiceCode: item.productionInvoice?.code ?? null,
      mfgProductCode: item.mfgProduct.factoryCode,
      mfgProductName: item.mfgProduct.name,
      quantity: item.quantity,
      prodApprovalStatus: item.prodApprovalStatus,
      deadline: frameDeadlineOf(item),
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
      .map((m) => frameDeadlineOf(m.item))
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
    const { bomRows, segmentSpecLookup, segmentNames } = await this.buildBomRows(
      order.bomRevisionId,
    );
    // Nhãn hiện trong thông báo cho Sếp/QLSX ("Đề xuất cắt sắt cho ... đã tính xong") - ưu tiên mã
    // đơn Sales gốc (xem trao đổi 2026-08-18), fallback poNumber nội bộ khi SKU không gắn đơn nào.
    const label = order.productionInvoiceItem.salesOrder?.code ?? order.poNumber;
    return { label, numSets: order.quantity, bomRows, segmentSpecLookup, segmentNames };
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
    const segmentNames = new Map<string, string[]>();
    for (const { order, code } of orders) {
      const built = await this.buildBomRows(order.bomRevisionId);
      for (const [key, specId] of built.segmentSpecLookup) {
        segmentSpecLookup.set(key, specId);
      }
      // Gộp tên mảnh qua CÁC SKU: cùng 1 cỡ đoạn của cùng loại sắt có thể là "chân bàn" của SKU
      // này và "chân ghế" của SKU kia - bản in phải hiện đủ cả hai thì thợ mới biết đoạn cắt ra
      // đi về đâu.
      for (const [key, names] of built.segmentNames) {
        const merged = segmentNames.get(key);
        if (merged) {
          for (const n of names) if (!merged.includes(n)) merged.push(n);
        } else {
          segmentNames.set(key, [...names]);
        }
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
      segmentNames,
    };
  }

  private async buildBomRows(bomRevisionId: bigint): Promise<{
    bomRows: SolverBomRow[];
    segmentSpecLookup: Map<string, bigint>;
    segmentNames: Map<string, string[]>;
  }> {
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
    const segmentNames = new Map<string, string[]>();
    const bomRows: SolverBomRow[] = pieceBoms.map((row) => {
      // cutLengthMm là Decimal (2026-08-19, xem SegmentSpec) - .toNumber() TRƯỚC khi ghép khoá
      // Map, KHÔNG ghép thẳng Decimal vào template string: Decimal.toString() giữ nguyên số 0
      // ở cuối (vd "930.0"), trong khi phía tra cứu (dòng dưới, đọc segment.size từ JSON response
      // solver) luôn là number thường ("930", không ".0") - ghép sai định dạng làm 2 khoá
      // KHÔNG khớp nhau, tra cứu miss âm thầm (continue ở nhánh "shouldn't happen").
      const cutLengthMm = row.segmentSpec.cutLengthMm.toNumber();
      const key = `${row.segmentSpec.materialId}:${cutLengthMm}`;
      segmentSpecLookup.set(key, row.segmentSpecId);
      // Tên mảnh cho bảng TỔNG KẾT khi in (2026-08-25) - đọc ngay từ `piece` đã include sẵn ở
      // query trên, KHÔNG thêm truy vấn nào. Khử trùng vì 2 dòng PieceBom khác nhau của CÙNG một
      // mảnh vẫn có thể trỏ về cùng cỡ đoạn.
      const names = segmentNames.get(key);
      if (names) {
        if (!names.includes(row.piece.name)) names.push(row.piece.name);
      } else {
        segmentNames.set(key, [row.piece.name]);
      }
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

    return { bomRows, segmentSpecLookup, segmentNames };
  }

  /**
   * Tổng kết theo cỡ đoạn cho bản in "TỔNG KẾT CẮT" (layout MC Laser) - xem
   * CuttingProposalLine.pieceSummary trong schema.prisma.
   *
   * Trả `undefined` khi solver không gửi `pieces` (dòng infeasible) để Prisma bỏ qua cột. Sort
   * `size` GIẢM DẦN cho khớp thứ tự cột của bảng cắt chi tiết ở FE (buildCuttingGuideTable sắp
   * cỡ dài trước - thợ cắt cỡ dài trước để phần đuôi còn lại đủ cho cỡ ngắn), để 2 bảng trong
   * cùng một tờ giấy đọc cùng một chiều.
   */
  private buildPieceSummary(
    item: SolverProposeResponse['purchase_plan'][number],
    segmentNames: Map<string, string[]>,
  ): Prisma.InputJsonValue | undefined {
    if (!item.pieces?.length) return undefined;
    return [...item.pieces]
      .sort((a, b) => b.size - a.size)
      .map((p) => ({
        size: p.size,
        demand: p.demand,
        produced: p.produced,
        // Khoá tra cứu dựng y hệt segmentSpecLookup ở dòng lưu pattern bên dưới - `item.material`
        // là materialId thô, `p.size` là number thường từ JSON (xem buildBomRows để biết vì sao
        // KHÔNG được ghép thẳng Decimal vào đây).
        names: segmentNames.get(`${item.material}:${p.size}`) ?? [],
      }));
  }

  private async saveSuccess(
    proposalId: bigint,
    requestBody: unknown,
    response: SolverProposeResponse,
    segmentSpecLookup: Map<string, bigint>,
    segmentNames: Map<string, string[]>,
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
            // "fixed" | "scan" - null với dòng infeasible (solver không gửi length_source khi
            // feasible=false), xem doc comment schema.prisma.
            lengthSource: item.length_source ?? null,
            totalBars: item.total_bars,
            totalWasteMm: item.total_waste_mm,
            wastePercentage: item.waste_percentage,
            mauNguyenMm: item.mau_nguyen_mm,
            lengthComparison: item.length_comparison as Prisma.InputJsonValue,
            // Bảng TỔNG KẾT khi in hướng dẫn cắt (2026-08-25) - ghép `pieces[]` của solver với
            // tên mảnh dựng từ chính bomRevision vừa gửi đi. undefined (không phải null) khi
            // solver không trả pieces: dòng infeasible - để Prisma bỏ qua cột thay vì ghi JSON
            // null, phân biệt được "không có dữ liệu" với "đã tính, rỗng".
            pieceSummary: this.buildPieceSummary(item, segmentNames),
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
      lengthSource: line.lengthSource as 'fixed' | 'scan' | null,
      totalBars: line.totalBars,
      totalWasteMm: line.totalWasteMm ? Number(line.totalWasteMm) : null,
      wastePercentage: line.wastePercentage ? Number(line.wastePercentage) : null,
      mauNguyenMm: line.mauNguyenMm ? Number(line.mauNguyenMm) : null,
      lengthComparison: line.lengthComparison as
        { length: number; bars: number; wastePct: number }[] | null,
      pieceSummary: line.pieceSummary as CuttingProposalPieceSummaryResponseDto[] | null,
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
