import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseProposalStatus, StockLedgerRefType } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { ApprovePurchaseProposalDto } from './dto/approve-purchase-proposal.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import {
  PurchaseProposalItemResponseDto,
  PurchaseProposalQuoteResponseDto,
  PurchaseProposalResponseDto,
} from './dto/purchase-proposal-response.dto';
import { ReceivePurchaseProposalItemDto } from './dto/receive-purchase-proposal-item.dto';
import { RejectPurchaseProposalDto } from './dto/reject-purchase-proposal.dto';

/// Kho ảo cố định (protected-warehouse-codes.constant.ts) - nguồn của bút toán "nhập hàng mua
/// về" khi Thủ kho xác nhận nhận hàng (xem receiveItem()).
const SUPPLIER_WAREHOUSE_CODE = 'SUPPLIER';

const LIST_INCLUDE = {
  cuttingProposal: {
    include: {
      productionOrder: { include: { mfgProduct: true } },
      // null khi phương án cắt neo vào 1 lệnh SX; có giá trị khi neo vào PI gộp - xem toResponseDto.
      productionInvoice: { include: { items: { include: { mfgProduct: true } } } },
    },
  },
} satisfies Prisma.PurchaseProposalInclude;

const ITEM_INCLUDE = {
  material: { include: { warehouse: true } },
  quotes: { include: { supplier: true } },
} satisfies Prisma.PurchaseProposalItemInclude;

const DETAIL_INCLUDE = {
  ...LIST_INCLUDE,
  items: { include: ITEM_INCLUDE },
} satisfies Prisma.PurchaseProposalInclude;

type PurchaseProposalRow = Prisma.PurchaseProposalGetPayload<{ include: typeof LIST_INCLUDE }>;
type PurchaseProposalDetail = Prisma.PurchaseProposalGetPayload<{ include: typeof DETAIL_INCLUDE }>;
type PurchaseProposalItemRow = Prisma.PurchaseProposalItemGetPayload<{
  include: typeof ITEM_INCLUDE;
}>;

/**
 * Mua hàng (Phase 8, rút gọn) - tiêu thụ PurchaseProposal do CuttingProposalsService.approve()
 * tự sinh (sourceType=CUTTING_PROPOSAL, không có endpoint tạo tay). State machine 1 chiều: NEW ->
 * QUOTING -> SUBMITTED -> PURCHASING -> PURCHASED, hoặc SUBMITTED -> REJECTED -> QUOTING (báo giá
 * lại). `actualStock`/`buyQty` đã đối chiếu tồn kho thật (StockQuant) ngay lúc tạo dòng - xem
 * CuttingProposalsService.approve(). Khi Thủ kho xác nhận nhận hàng (receiveItem), phần mới nhận
 * được ghi vào StockLedger (refType=PURCHASE) để cộng lại tồn kho vật lý.
 */
@Injectable()
export class PurchaseProposalsService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
  ) {}

  async findAll(query: PaginationQueryDto): Promise<Paginated<PurchaseProposalResponseDto>> {
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.purchaseProposal.findMany({ ...args, include: LIST_INCLUDE }),
        count: (args) => this.prisma.purchaseProposal.count(args),
      },
      query,
      undefined,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { createdAt: query.sortOrder },
    );
    return { data: result.data.map((p) => this.toResponseDto(p)), meta: result.meta };
  }

  async findOne(id: string): Promise<PurchaseProposalResponseDto> {
    return this.toDetailResponseDto(await this.findDetailOrThrow(id));
  }

  /** Purchasing tiếp nhận đề xuất - bắt đầu báo giá. */
  async acknowledge(id: string): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findRawOrThrow(id);
    this.assertStatus(proposal, PurchaseProposalStatus.NEW);
    const updated = await this.prisma.purchaseProposal.update({
      where: { id: proposal.id },
      data: { status: PurchaseProposalStatus.QUOTING },
      include: LIST_INCLUDE,
    });
    return this.toResponseDto(updated);
  }

  async addQuote(
    id: string,
    itemId: string,
    dto: CreateQuoteDto,
  ): Promise<PurchaseProposalItemResponseDto> {
    const proposal = await this.findRawOrThrow(id);
    this.assertStatus(proposal, PurchaseProposalStatus.QUOTING);
    const bigItemId = parseBigIntId(itemId);
    const item = await this.prisma.purchaseProposalItem.findFirst({
      where: { id: bigItemId, proposalId: proposal.id },
    });
    if (!item) {
      throw new NotFoundException(`Item ${itemId} not found on purchase proposal ${id}`);
    }

    await this.prisma.purchaseProposalQuote.create({
      data: {
        itemId: item.id,
        supplierId: dto.supplierId ? parseBigIntId(dto.supplierId) : undefined,
        supplierName: dto.supplierName,
        unitPrice: dto.unitPrice,
        expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
        note: dto.note,
      },
    });

    const updatedItem = await this.prisma.purchaseProposalItem.findUniqueOrThrow({
      where: { id: item.id },
      include: ITEM_INCLUDE,
    });
    return this.toItemResponseDto(updatedItem);
  }

  /** Gửi Sếp duyệt - bắt buộc mỗi vật tư có ít nhất 1 báo giá hợp lệ (đơn giá > 0). */
  async submit(id: string): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertStatus(proposal, PurchaseProposalStatus.QUOTING);

    const missing = proposal.items.filter(
      (item) => !item.quotes.some((q) => q.unitPrice != null && q.unitPrice.toNumber() > 0),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        'Mỗi vật tư cần ít nhất 1 báo giá NCC có đơn giá trước khi gửi Sếp duyệt',
      );
    }

    const updated = await this.prisma.purchaseProposal.update({
      where: { id: proposal.id },
      data: { status: PurchaseProposalStatus.SUBMITTED, submittedAt: new Date() },
      include: LIST_INCLUDE,
    });
    return this.toResponseDto(updated);
  }

  /** Sếp duyệt - chọn đúng 1 báo giá/vật tư. */
  async approve(
    id: string,
    actorUserId: string,
    dto: ApprovePurchaseProposalDto,
  ): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertStatus(proposal, PurchaseProposalStatus.SUBMITTED);

    const chosenQuoteIdByItem = new Map<bigint, bigint>();
    for (const item of proposal.items) {
      const chosen = dto.chosenQuoteIdByItemId[item.id.toString()];
      if (!chosen) {
        throw new BadRequestException(`Thiếu NCC được chọn cho vật tư ${item.material.code}`);
      }
      const chosenQuoteId = parseBigIntId(chosen);
      if (!item.quotes.some((q) => q.id === chosenQuoteId)) {
        throw new BadRequestException(`Báo giá ${chosen} không thuộc vật tư ${item.material.code}`);
      }
      chosenQuoteIdByItem.set(item.id, chosenQuoteId);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of proposal.items) {
        await tx.purchaseProposalQuote.updateMany({
          where: { itemId: item.id },
          data: { isChosen: false },
        });
        await tx.purchaseProposalQuote.update({
          where: { id: chosenQuoteIdByItem.get(item.id) },
          data: { isChosen: true },
        });
      }
      await tx.purchaseProposal.update({
        where: { id: proposal.id },
        data: {
          status: PurchaseProposalStatus.PURCHASING,
          approvedAt: new Date(),
          approvedById: actorUserId,
        },
      });
    });

    return this.findOne(id);
  }

  async reject(id: string, dto: RejectPurchaseProposalDto): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findRawOrThrow(id);
    this.assertStatus(proposal, PurchaseProposalStatus.SUBMITTED);
    const updated = await this.prisma.purchaseProposal.update({
      where: { id: proposal.id },
      data: {
        status: PurchaseProposalStatus.REJECTED,
        rejectedAt: new Date(),
        rejectionReason: dto.rejectionReason,
      },
      include: LIST_INCLUDE,
    });
    return this.toResponseDto(updated);
  }

  /**
   * Purchasing báo giá lại sau khi bị từ chối - XOÁ hết báo giá cũ trước khi mở lại QUOTING
   * (không giữ làm lịch sử nữa - đổi 2026-08-11, xem D.p3-requote-dedup). Lý do: addQuote() luôn
   * create() mới (không sửa/xoá), còn FE (LenhMuaNCCPage.handleSubmit) submit lại TOÀN BỘ form
   * mỗi lần gửi Sếp duyệt, kể cả dòng không đổi - giữ báo giá cũ khiến mỗi vòng từ chối/báo giá
   * lại nhân đôi các dòng chưa sửa trong bảng. FE đã tự seed sẵn giá trị cũ vào form TRƯỚC khi
   * gọi API này (handleRequote), nên người dùng vẫn thấy đúng số cũ để sửa tiếp - không mất gì
   * ở màn hình, chỉ dọn bản ghi DB thừa.
   */
  async requote(id: string): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findRawOrThrow(id);
    this.assertStatus(proposal, PurchaseProposalStatus.REJECTED);
    await this.prisma.purchaseProposalQuote.deleteMany({
      where: { item: { proposalId: proposal.id } },
    });
    const updated = await this.prisma.purchaseProposal.update({
      where: { id: proposal.id },
      data: { status: PurchaseProposalStatus.QUOTING },
      include: LIST_INCLUDE,
    });
    return this.toResponseDto(updated);
  }

  /** Thủ kho xác nhận nhận hàng - cộng dồn qua nhiều lần (hàng có thể về nhiều đợt). */
  async receiveItem(
    id: string,
    itemId: string,
    dto: ReceivePurchaseProposalItemDto,
    userId: string,
    idempotencyKey: string,
  ): Promise<PurchaseProposalItemResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertStatus(proposal, PurchaseProposalStatus.PURCHASING);
    const bigItemId = parseBigIntId(itemId);
    const item = proposal.items.find((it) => it.id === bigItemId);
    if (!item) {
      throw new NotFoundException(`Item ${itemId} not found on purchase proposal ${id}`);
    }

    const buyQty = item.buyQty.toNumber();
    const currentReceivedQty = item.receivedQty.toNumber();
    const nextReceivedQty = Math.min(buyQty, currentReceivedQty + dto.receivedQty);
    const incrementQty = nextReceivedQty - currentReceivedQty;
    const nextReceivedQtyPurchaseUnit = dto.receivedQtyPurchaseUnit
      ? (item.receivedQtyPurchaseUnit?.toNumber() ?? 0) + dto.receivedQtyPurchaseUnit
      : item.receivedQtyPurchaseUnit?.toNumber();

    // Kho nhận hàng = kho đã khai CHO ĐÚNG vật tư này (Material.warehouseId, xem Admin > Vật tư),
    // KHÔNG còn theo proposal.warehouseCode (1 kho chung cho cả đề xuất) - Sếp chốt 2026-08-15
    // mục 2: 1 đề xuất có thể gồm nhiều vật tư khác kho nhau, mỗi dòng phải về đúng kho riêng.
    if (!item.material.warehouseId) {
      throw new BadRequestException(
        `Vật tư ${item.material.code} chưa được cấu hình Kho - không thể nhập kho tự động, vào Admin > Vật tư để gán Kho trước`,
      );
    }

    // Bút toán "hàng mua về nhập kho" - post trước, ngoài transaction cập nhật receivedQty bên
    // dưới, đúng idiom WarehouseTransfersService.confirm() (idempotencyKey do client gửi, vì
    // 1 item có thể nhận nhiều đợt nên không có key tất định như warehouse-transfer).
    if (incrementQty > 0) {
      const supplierWarehouse = await this.prisma.warehouse.findUniqueOrThrow({
        where: { code: SUPPLIER_WAREHOUSE_CODE },
      });
      await this.stockLedgerService.postEntry({
        fromWarehouseId: supplierWarehouse.id,
        toWarehouseId: item.material.warehouseId,
        materialId: item.materialId,
        qty: incrementQty,
        refType: StockLedgerRefType.PURCHASE,
        refId: proposal.id.toString(),
        createdById: userId,
        idempotencyKey,
      });
    }

    const updatedItem = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.purchaseProposalItem.update({
        where: { id: item.id },
        data: {
          receivedQty: nextReceivedQty,
          receivedQtyPurchaseUnit: nextReceivedQtyPurchaseUnit,
        },
        include: ITEM_INCLUDE,
      });

      const allReceived = proposal.items.every((it) =>
        it.id === item.id
          ? nextReceivedQty >= buyQty
          : it.receivedQty.toNumber() >= it.buyQty.toNumber(),
      );
      if (allReceived) {
        await tx.purchaseProposal.update({
          where: { id: proposal.id },
          data: { status: PurchaseProposalStatus.PURCHASED, purchasedAt: new Date() },
        });
      }

      return saved;
    });

    return this.toItemResponseDto(updatedItem);
  }

  private async findRawOrThrow(id: string) {
    const bigId = parseBigIntId(id);
    const proposal = await this.prisma.purchaseProposal.findUnique({ where: { id: bigId } });
    if (!proposal) {
      throw new NotFoundException(`Purchase proposal ${id} not found`);
    }
    return proposal;
  }

  private async findDetailOrThrow(id: string): Promise<PurchaseProposalDetail> {
    const bigId = parseBigIntId(id);
    const proposal = await this.prisma.purchaseProposal.findUnique({
      where: { id: bigId },
      include: DETAIL_INCLUDE,
    });
    if (!proposal) {
      throw new NotFoundException(`Purchase proposal ${id} not found`);
    }
    return proposal;
  }

  private assertStatus(
    proposal: { status: PurchaseProposalStatus },
    expected: PurchaseProposalStatus,
  ): void {
    if (proposal.status !== expected) {
      throw new ConflictException(
        `Purchase proposal đang ở trạng thái ${proposal.status} - chỉ ${expected} mới thực hiện được thao tác này`,
      );
    }
  }

  private toResponseDto(row: PurchaseProposalRow): PurchaseProposalResponseDto {
    // productionOrder = null khi đề xuất đến từ phương án cắt CẤP NHÓM (PI gộp nhiều SKU) - nhóm
    // không có 1 lệnh SX đơn lẻ nào. Đây chính là ca "nhóm = đơn vị mua": 1 đề xuất mua duy nhất
    // cho cả đợt cắt chung, thay vì mỗi lệnh SX một đề xuất rồi Mua hàng phải báo giá nhiều lần.
    const productionOrder = row.cuttingProposal!.productionOrder;
    const mergedPi = row.cuttingProposal!.productionInvoice;
    return new PurchaseProposalResponseDto({
      id: row.id.toString(),
      cuttingProposalId: row.cuttingProposalId?.toString() ?? null,
      warehouseCode: row.warehouseCode,
      status: row.status,
      poNumber: productionOrder?.poNumber ?? mergedPi?.code ?? '—',
      mfgProductCode:
        productionOrder?.mfgProduct.factoryCode ??
        (mergedPi?.items ?? []).map((it) => it.mfgProduct.factoryCode).join(', '),
      mfgProductName:
        productionOrder?.mfgProduct.name ?? (mergedPi ? `${mergedPi.items.length} SKU gộp` : null),
      createdAt: row.createdAt,
      submittedAt: row.submittedAt,
      approvedAt: row.approvedAt,
      rejectedAt: row.rejectedAt,
      rejectionReason: row.rejectionReason,
      purchasedAt: row.purchasedAt,
    });
  }

  private toDetailResponseDto(row: PurchaseProposalDetail): PurchaseProposalResponseDto {
    const dto = this.toResponseDto(row);
    dto.items = row.items.map((item) => this.toItemResponseDto(item));
    return dto;
  }

  private toItemResponseDto(item: PurchaseProposalItemRow): PurchaseProposalItemResponseDto {
    return new PurchaseProposalItemResponseDto({
      id: item.id.toString(),
      materialId: item.materialId.toString(),
      materialCode: item.material.code,
      materialName: item.material.name,
      unit: item.material.unit,
      purchaseUnit: item.material.purchaseUnit ?? null,
      khoUnitFactor: item.material.khoUnitFactor?.toNumber() ?? null,
      // Kho nhận hàng THẬT của riêng dòng này (Material.warehouseId) - nguồn xác thực cho
      // receiveItem(), KHÔNG phải PurchaseProposalResponseDto.warehouseCode (nay chỉ tóm tắt).
      warehouseCode: item.material.warehouse?.code ?? null,
      actualStock: item.actualStock.toNumber(),
      buyQty: item.buyQty.toNumber(),
      receivedQty: item.receivedQty.toNumber(),
      receivedQtyPurchaseUnit: item.receivedQtyPurchaseUnit?.toNumber() ?? null,
      quotes: item.quotes.map(
        (q) =>
          new PurchaseProposalQuoteResponseDto({
            id: q.id.toString(),
            supplierId: q.supplierId?.toString() ?? null,
            supplierName: q.supplierName,
            unitPrice: q.unitPrice ? q.unitPrice.toNumber() : null,
            expectedDate: q.expectedDate,
            note: q.note,
            isChosen: q.isChosen,
          }),
      ),
    });
  }
}
