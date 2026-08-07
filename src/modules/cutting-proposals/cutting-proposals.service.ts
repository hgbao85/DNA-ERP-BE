import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import {
  CuttingProposalStatus,
  NotificationAudience,
  Prisma,
  StockLedgerRefType,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { ExternalApiHttpError, ExternalApiService } from '../external/external-api.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { CuttingProposalResponseDto } from './dto/cutting-proposal-response.dto';

const SOLVER_PROPOSE_PATH = '/api/v1/de_xuat/propose/';
const SYSTEM_CONFIG_ID = 1;
/// cat_sat_iea chỉ tính vật tư sắt - sắt luôn nhập/xuất tại đúng 1 kho vật lý này (xem
/// PROTECTED_WAREHOUSE_CODES). Phase 8 (Mua hàng) rút gọn hiện chỉ có nhóm vật tư này nên
/// hardcode thẳng, không cần suy hay tham số hoá.
const STEEL_WAREHOUSE_CODE = 'phoi-son-han';
/// Kho ảo cố định (protected-warehouse-codes.constant.ts) - điểm đến của bút toán "sắt xuất
/// dùng cho sản xuất" khi tự động trừ tồn lúc duyệt phương án cắt (xem approve()).
const PRODUCTION_WAREHOUSE_CODE = 'PRODUCTION';

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
    /// true nếu CÓ ÍT NHẤT 1 loại sắt vượt max_waste_percentage với các stock_lengths cố định
    /// đã chấm - dùng để quyết định có cần gọi lại với auto_scan bật hay không.
    any_over_threshold: boolean;
  };
  purchase_plan: Array<{
    material: string;
    feasible: boolean;
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

type CuttingProposalRow = Prisma.CuttingProposalGetPayload<object>;
type CuttingProposalDetail = Prisma.CuttingProposalGetPayload<{
  include: {
    lines: {
      include: { patterns: { include: { segments: { include: { segmentSpec: true } } } } };
    };
  };
}>;

/**
 * 1 lần gọi solver cat_sat_iea cho 1 ProductionOrder. Gọi tự động (fire-and-forget) ngay sau
 * khi ProductionOrder được tạo (xem ProductionInvoicesService.approveItem) - KHÔNG chặn
 * response, tạo ngay 1 dòng CALCULATING rồi cập nhật DRAFT/FAILED khi solver trả lời. Cũng
 * dùng lại cho nút "Tính lại" thủ công (có Idempotency-Key).
 */
@Injectable()
export class CuttingProposalsService {
  private readonly logger = new Logger(CuttingProposalsService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly externalApiService: ExternalApiService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly stockLedgerService: StockLedgerService,
  ) {}

  async requestForOrder(
    productionOrderId: bigint,
    options: { idempotencyKey?: string; requestedById?: string } = {},
  ): Promise<CuttingProposalResponseDto> {
    if (options.idempotencyKey) {
      const existing = await this.prisma.cuttingProposal.findUnique({
        where: { idempotencyKey: options.idempotencyKey },
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
    });

    void this.runSolverAndSave(proposal.id, productionOrderId).catch((error: unknown) => {
      this.logger.error(
        `Cutting proposal ${proposal.id} (production order ${productionOrderId}) failed: ${
          (error as Error).message
        }`,
      );
    });

    return this.toResponseDto(proposal);
  }

  async findAllForOrder(
    productionOrderId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<CuttingProposalResponseDto>> {
    const bigId = parseBigIntId(productionOrderId);
    const result = await paginate(
      {
        findMany: (args) => this.prisma.cuttingProposal.findMany(args),
        count: (args) => this.prisma.cuttingProposal.count(args),
      },
      query,
      { productionOrderId: bigId },
      { requestedAt: 'desc' as const },
    );
    return { data: result.data.map((p) => this.toResponseDto(p)), meta: result.meta };
  }

  async findOne(id: string): Promise<CuttingProposalResponseDto> {
    const bigId = parseBigIntId(id);
    const proposal = await this.prisma.cuttingProposal.findUnique({
      where: { id: bigId },
      include: {
        lines: {
          include: { patterns: { include: { segments: { include: { segmentSpec: true } } } } },
        },
      },
    });
    if (!proposal) {
      throw new NotFoundException(`Cutting proposal ${id} not found`);
    }
    return this.toDetailResponseDto(proposal);
  }

  /**
   * Duyệt phương án cắt cuối cùng - Phôi cắt theo pattern của bản này (7.2 doc gốc). Đồng thời
   * tự sinh 1 PurchaseProposal (Phase 8 - Mua hàng, rút gọn: chỉ vật tư sắt) cho các dòng khả
   * thi (feasible, totalBars > 0) - không có API tạo thủ công, Mua hàng chỉ tiêu thụ bản ghi
   * này. Theo yêu cầu Sếp (2026-08-07): "trừ tồn tự động, hiện qua mua hàng, không hiện ở kho"
   * - mỗi dòng chụp `actualStock` thật (stock_quant, có khoá FOR UPDATE chống 2 lần duyệt cùng
   * lúc đọc trùng số dư), `buyQty` chỉ còn là phần THIẾU (totalBars - actualStock đã dùng), và
   * phần tồn có sẵn được ghi nhận xuất dùng cho sản xuất ngay (STEEL_ISSUE, kho ảo PRODUCTION).
   */
  async approve(id: string, actorUserId: string): Promise<CuttingProposalResponseDto> {
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

    let steelWarehouseId: bigint | undefined;
    let productionWarehouseId: bigint | undefined;
    if (buyableLines.length > 0) {
      const [steelWarehouse, productionWarehouse] = await Promise.all([
        this.prisma.warehouse.findUniqueOrThrow({ where: { code: STEEL_WAREHOUSE_CODE } }),
        this.prisma.warehouse.findUniqueOrThrow({ where: { code: PRODUCTION_WAREHOUSE_CODE } }),
      ]);
      steelWarehouseId = steelWarehouse.id;
      productionWarehouseId = productionWarehouse.id;
    }

    const consumptions: { materialId: bigint; consumeQty: number }[] = [];

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.cuttingProposal.updateMany({
        where: {
          productionOrderId: proposal.productionOrderId,
          id: { not: bigId },
          status: { in: [CuttingProposalStatus.DRAFT, CuttingProposalStatus.APPROVED] },
        },
        data: { status: CuttingProposalStatus.SUPERSEDED },
      });
      const result = await tx.cuttingProposal.update({
        where: { id: bigId },
        data: {
          status: CuttingProposalStatus.APPROVED,
          approvedAt: new Date(),
          approvedById: actorUserId,
        },
      });

      if (buyableLines.length > 0) {
        const items: { materialId: bigint; buyQty: number; actualStock: number }[] = [];
        for (const line of buyableLines) {
          // Khoá dòng stock_quant liên quan trong lúc tính "tồn khả dụng" - chặn 2 phương án
          // cắt cùng vật tư được duyệt gần như đồng thời cùng đọc thấy 1 số dư (giống pattern
          // WarehouseTransfersService.createTransfer()).
          const locked = await tx.$queryRaw<{ qty: Prisma.Decimal }[]>`
            SELECT "qty" FROM "stock_quant"
            WHERE "warehouseId" = ${steelWarehouseId!} AND "materialId" = ${line.materialId}
            FOR UPDATE
          `;
          const actualStock = Math.floor(locked[0]?.qty.toNumber() ?? 0);
          const totalBars = line.totalBars!;
          const consumeQty = Math.min(totalBars, actualStock);
          const buyQty = totalBars - consumeQty;

          items.push({ materialId: line.materialId, buyQty, actualStock });
          if (consumeQty > 0) {
            consumptions.push({ materialId: line.materialId, consumeQty });
          }
        }

        await tx.purchaseProposal.create({
          data: {
            cuttingProposalId: bigId,
            warehouseCode: STEEL_WAREHOUSE_CODE,
            items: { create: items },
          },
        });
      }

      return result;
    });

    // Bút toán kho tách khỏi transaction ở trên (StockLedgerService dùng prisma riêng, không
    // nhận tx) - idempotencyKey theo (cuttingProposalId, materialId) khiến gọi lại an toàn nếu
    // bước này lỗi giữa chừng, đúng idiom WarehouseTransfersService.confirm().
    for (const { materialId, consumeQty } of consumptions) {
      await this.stockLedgerService.postEntry({
        fromWarehouseId: steelWarehouseId!,
        toWarehouseId: productionWarehouseId!,
        materialId,
        qty: consumeQty,
        refType: StockLedgerRefType.STEEL_ISSUE,
        refId: bigId.toString(),
        createdById: actorUserId,
        idempotencyKey: `cutting-proposal:${id}:steel-issue:${materialId}`,
      });
    }

    return this.toResponseDto(updated);
  }

  private async runSolverAndSave(proposalId: bigint, productionOrderId: bigint): Promise<void> {
    let poNumber: string | undefined;
    try {
      const order = await this.prisma.productionOrder.findUniqueOrThrow({
        where: { id: productionOrderId },
      });
      poNumber = order.poNumber;
      const config = await this.prisma.systemConfig.findUniqueOrThrow({
        where: { id: SYSTEM_CONFIG_ID },
      });
      const { bomRows, segmentSpecLookup } = await this.buildBomRows(order.bomRevisionId);

      const baseRequestBody = {
        num_sets: order.quantity,
        bom: bomRows,
        // views.py đọc stock_lengths bằng str(...).replace(",", " ").split() - PHẢI gửi chuỗi
        // cách nhau bởi khoảng trắng, gửi mảng JSON sẽ bị solver parse sai (str([5850,6000]) ->
        // "[5850 6000]" -> phần tử đầu/cuối dính ký tự "[" "]" và bị loại bỏ, ra 0).
        stock_lengths: (config.solverStockLengths as number[]).join(' '),
        trim_start: config.solverTrimStartMm,
        blade_width: config.solverBladeWidthMm,
        max_waste_percentage: config.solverMaxWastePercentage,
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
      const callSolver = (body: typeof baseRequestBody & { auto_scan: boolean }) =>
        this.externalApiService.post<SolverProposeResponse>(
          `${baseUrl}${SOLVER_PROPOSE_PATH}`,
          body,
          { headers: { Authorization: `Bearer ${apiKey}` } },
          timeoutSeconds * 1000,
        );

      // Lần 1: chỉ chấm các stock_lengths cố định (nhanh, KHÔNG vét cạn - đúng khuyến nghị của
      // chính solver "để người dùng chủ động bật, không tự chạy ngầm"). Theo yêu cầu Sếp
      // (2026-08-06): nếu có loại sắt nào không đạt max_waste_percentage với các chiều dài cố
      // định, tự động gọi lại LẦN 2 với auto_scan bật (dò dải solverMinLengthMm..MaxLengthMm,
      // bước solverLengthStepMm - mặc định 5000-6000mm bước 10mm) để tìm chiều dài đặt riêng.
      let requestBody: typeof baseRequestBody & { auto_scan: boolean } = {
        ...baseRequestBody,
        auto_scan: false,
      };
      let response = await callSolver(requestBody);

      if (response.summary.any_over_threshold) {
        requestBody = { ...baseRequestBody, auto_scan: true };
        response = await callSolver(requestBody);
      }

      await this.saveSuccess(proposalId, requestBody, response, segmentSpecLookup);
      await this.notifyProductionManagers(
        `Đề xuất cắt sắt cho ${poNumber} đã tính xong`,
        `Xem chi tiết phương án cắt tại lệnh sản xuất ${poNumber}.`,
      );
    } catch (error) {
      await this.saveFailure(proposalId, error);
      await this.notifyProductionManagers(
        `Tính đề xuất cắt sắt thất bại${poNumber ? ` cho ${poNumber}` : ''}`,
        this.extractErrorMessage(error),
      );
    }
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
      segmentSpecLookup.set(
        `${row.segmentSpec.materialId}:${row.segmentSpec.cutLengthMm}`,
        row.segmentSpecId,
      );
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
        cut_length: row.segmentSpec.cutLengthMm,
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

  private toResponseDto(proposal: CuttingProposalRow): CuttingProposalResponseDto {
    return new CuttingProposalResponseDto({
      id: proposal.id.toString(),
      productionOrderId: proposal.productionOrderId.toString(),
      status: proposal.status,
      totalBarsAll: proposal.totalBarsAll,
      totalWasteMm: proposal.totalWasteMm,
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
      feasible: line.feasible,
      bestStockLengthMm: line.bestStockLengthMm,
      totalBars: line.totalBars,
      totalWasteMm: line.totalWasteMm,
      wastePercentage: line.wastePercentage ? Number(line.wastePercentage) : null,
      mauNguyenMm: line.mauNguyenMm,
      lengthComparison: line.lengthComparison as
        { length: number; bars: number; wastePct: number }[] | null,
      patterns: line.patterns.map((pattern) => ({
        patternIndex: pattern.patternIndex,
        barCount: pattern.barCount,
        wastePerBarMm: pattern.wastePerBarMm,
        mauNguyenMm: pattern.mauNguyenMm,
        segments: pattern.segments.map((segment) => ({
          segmentSpecId: segment.segmentSpecId.toString(),
          cutLengthMm: segment.segmentSpec.cutLengthMm,
          countPerBar: segment.countPerBar,
        })),
      })),
    }));
    return dto;
  }
}
