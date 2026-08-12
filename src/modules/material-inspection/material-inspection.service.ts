import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InspectionKhoStatus, Prisma } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { SkusService } from '../skus/skus.service';
import { CreateMaterialInspectionRequestDto } from './dto/create-material-inspection-request.dto';
import {
  InspectionKhoResultItemResponseDto,
  InspectionKhoResultResponseDto,
} from './dto/inspection-kho-result-response.dto';
import { MaterialInspectionRequestResponseDto } from './dto/material-inspection-request-response.dto';
import { SubmitInspectionKhoDto } from './dto/submit-inspection-kho.dto';

/// 3 kho vật lý cố định (PROTECTED_WAREHOUSE_CODES) - đúng "3 kho" InspectionContext mock chia
/// theo inspKhoKey (phoiSonHan/vatTuTP/thanhPham), xem InboundWarehouseApp.tsx.
const PHOI_SON_HAN = 'phoi-son-han';
const VAT_TU_TP = 'vat-tu-tp';
const THANH_PHAM = 'thanh-pham';
const KHO_WAREHOUSE_CODES = [PHOI_SON_HAN, VAT_TU_TP, THANH_PHAM] as const;

// ─── Shape của Sku.manhData/detailQuota (SkuResponseDto khai báo `unknown` - JSON tái dựng thật
// từ BOM ở SkusService.reconstructQuotaBatch(), không export type riêng). Chỉ khai đúng field
// module này cần đọc, không phải toàn bộ shape. ─────────────────────────────────────────────

interface SkuPieceMaterialLine {
  materialId: string;
  materialName: string;
  materialUnit: string;
  qtyPerPiece: number;
}
interface SkuPiece {
  qtyPerUnit: number;
  steel: SkuPieceMaterialLine[];
  wire: SkuPieceMaterialLine[];
  nail: SkuPieceMaterialLine[];
  rivet: SkuPieceMaterialLine[];
  plasticButton: SkuPieceMaterialLine[];
}
interface SkuManhData {
  pieces: SkuPiece[];
}
interface SkuMaterialLine {
  materialId: string;
  materialName: string;
  materialUnit: string;
  qtyPerUnit: number;
}
interface SkuDetailQuota {
  daySon: SkuMaterialLine[];
  vatTuPhuKien: SkuMaterialLine[];
  baoBiDongGoi: SkuMaterialLine[];
}

interface DraftKhoItem {
  materialId: bigint;
  materialName: string;
  materialUnit: string;
  required: number;
}

const REQUEST_INCLUDE = {
  productionOrder: { include: { mfgProduct: true, productionInvoiceItem: true } },
  khoResults: { include: { items: true, purchaseProposal: true } },
} satisfies Prisma.MaterialInspectionRequestInclude;

type RequestRow = Prisma.MaterialInspectionRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;
type KhoResultRow = RequestRow['khoResults'][number];
type KhoResultItemRow = KhoResultRow['items'][number];

/**
 * Kiểm tra vật tư trước sản xuất (M2, Phase 10, 2026-08-12) - thay InspectionContext.requests/
 * SEED_REQUESTS (mock). Neo vào PlanForm(origin='PRODUCTION_CONFIRM') - đã tự tạo sẵn khi Sếp
 * duyệt PI item (xem ProductionInvoicesService.approveItem() -> SkusService.
 * ensureProductionConfirmPlanForm()), doc-comment PlanForm.origin đã dành riêng cho domain này.
 * Danh sách vật tư/kho dựng từ Sku.manhData/detailQuota (đã tái dựng thật từ BOM ở SkusService)
 * - KHÔNG đọc lại BOM riêng. actualStock LUÔN lấy từ StockQuant thật lúc submitKho (không nhận
 * client-typed number), trừ dòng hiếm không có materialId (nhập tay qua overrides). Đề xuất
 * mua thủ công từ kho thiếu vật tư nằm ở PurchaseProposalsService.createFromInspection() -
 * module này chỉ tạo/theo dõi request, không tự tạo PurchaseProposal.
 */
@Injectable()
export class MaterialInspectionService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly skusService: SkusService,
  ) {}

  /** Find-or-create theo planFormId - idempotent tự nhiên, không cần Idempotency-Key header. */
  async create(
    dto: CreateMaterialInspectionRequestDto,
    actorUserId: string,
  ): Promise<MaterialInspectionRequestResponseDto> {
    const planFormBigId = parseBigIntId(dto.planFormId);

    const existing = await this.prisma.materialInspectionRequest.findUnique({
      where: { planFormId: planFormBigId },
      include: REQUEST_INCLUDE,
    });
    if (existing) {
      return this.toResponseDto(existing);
    }

    const planForm = await this.prisma.planForm.findUnique({ where: { id: planFormBigId } });
    if (!planForm) {
      throw new NotFoundException(`PlanForm ${dto.planFormId} not found`);
    }
    if (planForm.origin !== 'PRODUCTION_CONFIRM' || !planForm.productionInvoiceId) {
      throw new BadRequestException(
        `PlanForm ${dto.planFormId} không phải bản ghi PRODUCTION_CONFIRM - Kiểm tra vật tư chỉ ` +
          `áp dụng cho SKU đã được Sếp duyệt sản xuất`,
      );
    }

    const productionOrder = await this.prisma.productionOrder.findFirst({
      where: {
        mfgProductId: planForm.mfgProductId,
        productionInvoiceItem: { productionInvoiceId: planForm.productionInvoiceId },
      },
      orderBy: { id: 'desc' },
    });
    if (!productionOrder) {
      throw new ConflictException(
        `SKU ${dto.planFormId} chưa có ProductionOrder (chưa được Sếp duyệt) - chưa thể tạo Lệnh ` +
          `kiểm tra vật tư`,
      );
    }

    const sku = await this.skusService.findOne(dto.planFormId);
    const manhData = sku.manhData as SkuManhData | null;
    const detailQuota = sku.detailQuota as SkuDetailQuota | null;
    if (!manhData || !detailQuota) {
      throw new ConflictException(
        `SKU ${dto.planFormId} chưa có định mức (BOM) - chưa thể kiểm tra vật tư`,
      );
    }

    const itemsByKho = this.buildKhoItems(manhData, detailQuota, productionOrder.quantity);

    const created = await this.prisma.materialInspectionRequest.create({
      data: {
        planFormId: planFormBigId,
        productionOrderId: productionOrder.id,
        createdById: actorUserId,
        khoResults: {
          create: KHO_WAREHOUSE_CODES.map((warehouseCode) => ({
            warehouseCode,
            items: {
              create: itemsByKho[warehouseCode].map((line) => ({
                materialId: line.materialId,
                materialName: line.materialName,
                materialUnit: line.materialUnit,
                required: line.required,
              })),
            },
          })),
        },
      },
      include: REQUEST_INCLUDE,
    });

    return this.toResponseDto(created);
  }

  async findAll(
    query: PaginationQueryDto,
  ): Promise<Paginated<MaterialInspectionRequestResponseDto>> {
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.materialInspectionRequest.findMany({ ...args, include: REQUEST_INCLUDE }),
        count: (args) => this.prisma.materialInspectionRequest.count(args),
      },
      query,
      undefined,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { createdAt: query.sortOrder },
    );
    return { data: result.data.map((r) => this.toResponseDto(r)), meta: result.meta };
  }

  async findOne(id: string): Promise<MaterialInspectionRequestResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  /** Kho staff xác nhận tồn - actualStock đọc thật từ StockQuant, không nhận số client tự gõ. */
  async submitKho(
    id: string,
    warehouseCode: string,
    dto: SubmitInspectionKhoDto,
    actorUserId: string,
    callerWarehouseScope: string | null,
  ): Promise<MaterialInspectionRequestResponseDto> {
    this.assertKnownWarehouseCode(warehouseCode);
    this.assertWarehouseScope(callerWarehouseScope, warehouseCode);

    const request = await this.findOneOrThrow(id);
    const khoResult = request.khoResults.find((k) => k.warehouseCode === warehouseCode);
    if (!khoResult) {
      throw new NotFoundException(`Kho '${warehouseCode}' không thuộc request ${id}`);
    }
    if (khoResult.status !== InspectionKhoStatus.PENDING) {
      throw new ConflictException(
        `Kho '${warehouseCode}' của request ${id} đang ở trạng thái ${khoResult.status} - chỉ ` +
          `PENDING mới xác nhận được`,
      );
    }

    const warehouse = await this.prisma.warehouse.findUniqueOrThrow({
      where: { code: warehouseCode },
    });
    const materialIds = khoResult.items
      .map((it) => it.materialId)
      .filter((mid): mid is bigint => mid !== null);
    const quants = materialIds.length
      ? await this.prisma.stockQuant.findMany({
          where: { warehouseId: warehouse.id, materialId: { in: materialIds } },
        })
      : [];
    const qtyByMaterialId = new Map(
      quants.map((q) => [q.materialId!.toString(), q.qty.toNumber()]),
    );
    const overrideByItemId = new Map((dto.overrides ?? []).map((o) => [o.itemId, o.actualStock]));

    await this.prisma.$transaction(async (tx) => {
      for (const item of khoResult.items) {
        const actualStock = this.resolveActualStock(item, qtyByMaterialId, overrideByItemId);
        await tx.inspectionKhoResultItem.update({ where: { id: item.id }, data: { actualStock } });
      }
      await tx.inspectionKhoResult.update({
        where: { id: khoResult.id },
        data: {
          status: InspectionKhoStatus.SUBMITTED,
          submittedAt: new Date(),
          submittedById: actorUserId,
        },
      });
    });

    return this.findOne(id);
  }

  /** Chặn nếu chưa đủ 3 kho SUBMITTED - đúng tinh thần "kiểm tra vật tư TRƯỚC sản xuất". */
  async startProduction(id: string): Promise<MaterialInspectionRequestResponseDto> {
    const request = await this.findOneOrThrow(id);
    if (request.productionStarted) {
      return this.toResponseDto(request);
    }

    const notSubmitted = request.khoResults.filter(
      (k) => k.status !== InspectionKhoStatus.SUBMITTED,
    );
    if (notSubmitted.length > 0) {
      throw new ConflictException(
        `Request ${id} còn ${notSubmitted.length} kho chưa xác nhận ` +
          `(${notSubmitted.map((k) => k.warehouseCode).join(', ')}) - chưa thể bắt đầu sản xuất`,
      );
    }

    const updated = await this.prisma.materialInspectionRequest.update({
      where: { id: request.id },
      data: { productionStarted: true, productionStartedAt: new Date() },
      include: REQUEST_INCLUDE,
    });
    return this.toResponseDto(updated);
  }

  // ─── Dựng danh sách vật tư/kho từ Sku.manhData/detailQuota (mirror buildKhoItems FE) ───────

  private buildKhoItems(
    manhData: SkuManhData,
    detailQuota: SkuDetailQuota,
    orderQuantity: number,
  ): Record<string, DraftKhoItem[]> {
    const pieceLine = (piece: SkuPiece, line: SkuPieceMaterialLine): DraftKhoItem => ({
      materialId: parseBigIntId(line.materialId),
      materialName: line.materialName,
      materialUnit: line.materialUnit,
      required: line.qtyPerPiece * piece.qtyPerUnit * orderQuantity,
    });
    const flatLine = (line: SkuMaterialLine): DraftKhoItem => ({
      materialId: parseBigIntId(line.materialId),
      materialName: line.materialName,
      materialUnit: line.materialUnit,
      required: line.qtyPerUnit * orderQuantity,
    });

    const steelLines = manhData.pieces.flatMap((p) => p.steel.map((l) => pieceLine(p, l)));
    const vatTuTpPieceLines = manhData.pieces.flatMap((p) =>
      [...p.wire, ...p.nail, ...p.rivet, ...p.plasticButton].map((l) => pieceLine(p, l)),
    );

    return {
      [PHOI_SON_HAN]: [...steelLines, ...detailQuota.daySon.map(flatLine)],
      [VAT_TU_TP]: [...vatTuTpPieceLines, ...detailQuota.vatTuPhuKien.map(flatLine)],
      [THANH_PHAM]: detailQuota.baoBiDongGoi.map(flatLine),
    };
  }

  /** materialId có giá trị -> LUÔN lấy StockQuant thật, từ chối override đè lên. Ngược lại bắt
   *  buộc override (dòng hiếm không map được vật tư thật). */
  private resolveActualStock(
    item: KhoResultItemRow,
    qtyByMaterialId: Map<string, number>,
    overrideByItemId: Map<string, number>,
  ): number {
    const hasOverride = overrideByItemId.has(item.id.toString());
    if (item.materialId !== null) {
      if (hasOverride) {
        throw new BadRequestException(
          `Dòng '${item.materialName}' đã gắn vật tư thật - tồn kho lấy từ StockQuant, không nhận override`,
        );
      }
      return qtyByMaterialId.get(item.materialId.toString()) ?? 0;
    }
    const override = overrideByItemId.get(item.id.toString());
    if (override === undefined) {
      throw new BadRequestException(
        `Dòng '${item.materialName}' chưa gắn vật tư thật - bắt buộc nhập tồn tay qua overrides`,
      );
    }
    return override;
  }

  private assertKnownWarehouseCode(warehouseCode: string): void {
    if (!(KHO_WAREHOUSE_CODES as readonly string[]).includes(warehouseCode)) {
      throw new BadRequestException(
        `warehouseCode '${warehouseCode}' không hợp lệ - chỉ chấp nhận ${KHO_WAREHOUSE_CODES.join(', ')}`,
      );
    }
  }

  /** null = tổng kho (BOSS/ADMIN) - không có gì để chặn, cùng idiom MaterialIssuesService/
   *  SteelIssuesService.assertWarehouseScope(). */
  private assertWarehouseScope(warehouseScope: string | null, warehouseCode: string): void {
    if (warehouseScope && warehouseScope !== warehouseCode) {
      throw new ForbiddenException(
        `Caller bị giới hạn ở kho '${warehouseScope}', không được xác nhận kiểm tra vật tư cho kho '${warehouseCode}'`,
      );
    }
  }

  private async findOneOrThrow(id: string): Promise<RequestRow> {
    const bigId = parseBigIntId(id);
    const request = await this.prisma.materialInspectionRequest.findUnique({
      where: { id: bigId },
      include: REQUEST_INCLUDE,
    });
    if (!request) {
      throw new NotFoundException(`Material inspection request ${id} not found`);
    }
    return request;
  }

  private toResponseDto(row: RequestRow): MaterialInspectionRequestResponseDto {
    return new MaterialInspectionRequestResponseDto({
      id: row.id.toString(),
      planFormId: row.planFormId.toString(),
      poNumber: row.productionOrder.poNumber,
      mfgProductCode: row.productionOrder.mfgProduct.factoryCode,
      mfgProductName: row.productionOrder.mfgProduct.name,
      deliveryDeadline: row.productionOrder.productionInvoiceItem.deliveryDeadline,
      productionStarted: row.productionStarted,
      productionStartedAt: row.productionStartedAt,
      createdAt: row.createdAt,
      khoResults: row.khoResults.map((k) => this.toKhoResultResponseDto(k)),
    });
  }

  private toKhoResultResponseDto(kho: KhoResultRow): InspectionKhoResultResponseDto {
    return new InspectionKhoResultResponseDto({
      warehouseCode: kho.warehouseCode,
      status: kho.status,
      submittedAt: kho.submittedAt,
      submittedById: kho.submittedById,
      proposalCreated: kho.purchaseProposal !== null,
      purchaseProposalId: kho.purchaseProposal?.id.toString() ?? null,
      items: kho.items.map((it) => this.toItemResponseDto(it)),
    });
  }

  private toItemResponseDto(item: KhoResultItemRow): InspectionKhoResultItemResponseDto {
    const required = item.required.toNumber();
    const actualStock = item.actualStock?.toNumber() ?? null;
    return new InspectionKhoResultItemResponseDto({
      id: item.id.toString(),
      materialId: item.materialId?.toString() ?? null,
      materialName: item.materialName,
      materialUnit: item.materialUnit,
      required,
      actualStock,
      shortage: Math.max(0, required - (actualStock ?? 0)),
    });
  }
}
