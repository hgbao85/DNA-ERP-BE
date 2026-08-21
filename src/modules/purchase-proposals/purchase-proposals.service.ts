import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  AuditAction,
  Prisma,
  PrismaClient,
  ProdItemStageType,
  PurchaseProposalStatus,
  StockLedgerRefType,
  StockReservationRefType,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { writeAuditLog } from '../../prisma/extensions/audit-log.extension';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { ApprovePurchaseProposalDto } from './dto/approve-purchase-proposal.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import {
  PurchaseProposalItemResponseDto,
  PurchaseProposalQuoteResponseDto,
  PurchaseProposalResponseDto,
} from './dto/purchase-proposal-response.dto';
import { ListPurchaseProposalsQueryDto } from './dto/list-purchase-proposals-query.dto';
import { ReceivePurchaseProposalItemDto } from './dto/receive-purchase-proposal-item.dto';
import { RejectPurchaseProposalDto } from './dto/reject-purchase-proposal.dto';

/// Kho ảo cố định (protected-warehouse-codes.constant.ts) - nguồn của bút toán "nhập hàng mua
/// về" khi Thủ kho xác nhận nhận hàng (xem receiveItem()).
const SUPPLIER_WAREHOUSE_CODE = 'SUPPLIER';

// stages+productionInvoiceItem.productionInvoice ở cả 2 nhánh - phục vụ deadlineOf() (A3, xem
// dưới), cùng thứ tự ưu tiên đã dùng ở CuttingProposalsService.frameDeadlineOf/
// ProductionInvoicesService.frameDeadlineOf (materialDeadline -> mốc FRAME -> hạn cả phiếu).
const LIST_INCLUDE = {
  cuttingProposal: {
    include: {
      productionOrder: {
        include: {
          mfgProduct: true,
          productionInvoiceItem: {
            include: {
              stages: true,
              productionInvoice: { select: { deadline: true, code: true } },
              salesOrder: { select: { code: true } },
            },
          },
        },
      },
      // null khi phương án cắt neo vào 1 lệnh SX; có giá trị khi neo vào PI gộp - xem toResponseDto.
      productionInvoice: {
        include: {
          items: {
            include: { mfgProduct: true, stages: true, salesOrder: { select: { code: true } } },
          },
        },
      },
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
    private readonly stockReservationsService: StockReservationsService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /**
   * Ghi audit TAY cho các bảng con không nằm trong AUDITED_MODELS (PurchaseProposalQuote) - cùng
   * idiom ProductionInvoicesService.auditItemApprovalTransition(). Bản thân PurchaseProposal đã
   * được extension tự ghi mọi .update(), chỗ này chỉ bù phần quyết định về NCC/giá.
   */
  private async auditQuoteDecision(entry: {
    action: AuditAction;
    proposalId: bigint;
    oldValue?: unknown;
    newValue?: unknown;
  }): Promise<void> {
    // Cùng cast mà chính audit-log.extension.ts dùng - client đã extend không assignable về
    // PrismaClient thuần dù runtime là superset.
    const auditLogClient = this.prisma as unknown as Pick<PrismaClient, 'auditLog'>;
    await writeAuditLog(auditLogClient, this.cls, {
      action: entry.action,
      tableName: 'PurchaseProposalQuote',
      recordId: entry.proposalId.toString(),
      oldValue: entry.oldValue,
      newValue: entry.newValue,
    });
  }

  /**
   * Trả kèm `items` (DETAIL_INCLUDE, không phải LIST_INCLUDE) - trước 2026-08-15 (A5,
   * D.a5-n-plus-one) FE phải gọi thêm 1 `GET :id` cho MỖI dòng chỉ để lấy items (limit 100 -> tối
   * đa 101 request/lần tải danh sách), cộng thêm 1 lần `GET :id` nữa mỗi khi
   * submit/approve/receiveItem cần dịch materialId -> itemId thật (xem
   * services/purchasing-api.ts#getBeItemIdsByMaterialId). Có items sẵn trong list là đủ để bỏ cả
   * hai.
   */
  async findAll(
    query: ListPurchaseProposalsQueryDto,
  ): Promise<Paginated<PurchaseProposalResponseDto>> {
    // activeOnly loại PURCHASED (đóng hồ sơ) - dùng cho màn hàng đợi xử lý, để phiếu cũ còn hoạt
    // động (NEW/QUOTING/SUBMITTED/PURCHASING/REJECTED - REJECTED vẫn quay lại quy trình để requote)
    // không bị đẩy khỏi top-`limit` bởi phiếu PURCHASED tích luỹ vô hạn theo thời gian (audit
    // 2026-08-20, mục Medium "FE hard-code limit=100").
    const where: Prisma.PurchaseProposalWhereInput | undefined = query.activeOnly
      ? { status: { not: PurchaseProposalStatus.PURCHASED } }
      : undefined;
    const result = await paginate(
      {
        findMany: (args) =>
          this.prisma.purchaseProposal.findMany({ ...args, include: DETAIL_INCLUDE }),
        count: (args) => this.prisma.purchaseProposal.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { createdAt: query.sortOrder },
    );
    return { data: result.data.map((p) => this.toDetailResponseDto(p)), meta: result.meta };
  }

  async findOne(id: string): Promise<PurchaseProposalResponseDto> {
    return this.toDetailResponseDto(await this.findDetailOrThrow(id));
  }

  /** Purchasing tiếp nhận đề xuất - bắt đầu báo giá. */
  async acknowledge(
    id: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertStatus(proposal, PurchaseProposalStatus.NEW);
    this.assertActorMayHandle(proposal, actorUserId, actorRoles);
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
    actorUserId: string,
    actorRoles: string[],
  ): Promise<PurchaseProposalItemResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertStatus(proposal, PurchaseProposalStatus.QUOTING);
    this.assertActorMayHandle(proposal, actorUserId, actorRoles);
    const bigItemId = parseBigIntId(itemId);
    const item = proposal.items.find((it) => it.id === bigItemId);
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
  async submit(
    id: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertStatus(proposal, PurchaseProposalStatus.QUOTING);
    this.assertActorMayHandle(proposal, actorUserId, actorRoles);

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
      const chosenQuote = item.quotes.find((q) => q.id === chosenQuoteId);
      if (!chosenQuote) {
        throw new BadRequestException(`Báo giá ${chosen} không thuộc vật tư ${item.material.code}`);
      }
      // submit() chỉ đòi mỗi vật tư có ÍT NHẤT 1 báo giá có giá - không đòi cái được chọn phải là
      // cái đó. Vật tư có 2 báo giá (1 có giá, 1 để trống) thì bấm nhầm dòng trống là duyệt xong
      // một lệnh mua KHÔNG CÓ GIÁ: màn Theo dõi mua hàng hiện '—' ở cột Đơn giá và không ai biết
      // đã cam kết mua bao nhiêu tiền với NCC (D.c2-approve-without-price).
      if (chosenQuote.unitPrice == null || chosenQuote.unitPrice.toNumber() <= 0) {
        throw new BadRequestException(
          `Báo giá được chọn cho vật tư ${item.material.code} (NCC ${chosenQuote.supplierName}) chưa có đơn giá - không duyệt được lệnh mua không có giá`,
        );
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

    // Quyết định TIỀN của cả luồng: vật tư nào, mua của ai, giá bao nhiêu. Chuyển trạng thái
    // SUBMITTED -> PURCHASING đã được extension tự ghi, nhưng bản thân nó không nói giá nào được
    // chọn (quote là bảng con, không auto-audit) - mà đó mới là thứ cần khi đối chiếu với NCC.
    await this.auditQuoteDecision({
      action: AuditAction.UPDATE,
      proposalId: proposal.id,
      newValue: {
        event: 'approve',
        chosen: proposal.items.map((item) => {
          const chosenId = chosenQuoteIdByItem.get(item.id);
          const q = item.quotes.find((x) => x.id === chosenId);
          return {
            itemId: item.id.toString(),
            materialCode: item.material.code,
            quoteId: chosenId?.toString(),
            supplierName: q?.supplierName,
            supplierId: q?.supplierId?.toString() ?? null,
            unitPrice: q?.unitPrice?.toNumber() ?? null,
            buyQty: item.buyQty.toNumber(),
          };
        }),
      },
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
  async requote(
    id: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertStatus(proposal, PurchaseProposalStatus.REJECTED);
    this.assertActorMayHandle(proposal, actorUserId, actorRoles);

    // Chụp lại TRƯỚC khi xoá: deleteMany dưới đây là thao tác duy nhất trong cả luồng huỷ hẳn dữ
    // liệu giá đã từng gửi Sếp. Không có bản chụp này thì sau một vòng từ chối/báo giá lại, không
    // còn cách nào biết lần trước NCC nào chào bao nhiêu (D.c1-no-audit-on-money-path).
    const deletedQuotes = proposal.items.flatMap((item) =>
      item.quotes.map((q) => ({
        itemId: item.id.toString(),
        materialCode: item.material.code,
        quoteId: q.id.toString(),
        supplierName: q.supplierName,
        unitPrice: q.unitPrice?.toNumber() ?? null,
        expectedDate: q.expectedDate,
        isChosen: q.isChosen,
      })),
    );

    await this.prisma.purchaseProposalQuote.deleteMany({
      where: { item: { proposalId: proposal.id } },
    });
    await this.auditQuoteDecision({
      action: AuditAction.DELETE,
      proposalId: proposal.id,
      oldValue: { event: 'requote', rejectionReason: proposal.rejectionReason, deletedQuotes },
    });
    const updated = await this.prisma.purchaseProposal.update({
      where: { id: proposal.id },
      data: { status: PurchaseProposalStatus.QUOTING },
      include: LIST_INCLUDE,
    });
    return this.toResponseDto(updated);
  }

  /**
   * Thủ kho xác nhận nhận hàng - cộng dồn qua nhiều lần (hàng có thể về nhiều đợt).
   *
   * Trước 2026-08-15 (D.c3-receive-race-not-atomic, ghi chú "Lỗ 5" ở changelog): 2 lỗi chồng
   * nhau. (1) Read-modify-write không khoá dòng - `currentReceivedQty` đọc TRƯỚC transaction,
   * 2 lần nhận song song cùng đọc thấy số cũ, lần ghi sau đè mất lần trước trên sổ đề xuất dù
   * CẢ HAI đều đã post bút toán kho (mỗi lần 1 Idempotency-Key riêng nên không bị chặn trùng).
   * (2) Bút toán post NGOÀI transaction cập nhật `receivedQty` - chết giữa hai đoạn thì kho đã
   * cộng hàng mà đề xuất vẫn ghi chưa nhận, vĩnh viễn, không cơ chế nào phát hiện.
   *
   * Nay: khoá đúng dòng item (FOR UPDATE) rồi đọc lại receivedQty MỚI NHẤT bên trong cùng
   * transaction đang giữ khoá bút toán - lượt nhận thứ hai phải xếp hàng chờ lượt đầu commit
   * xong (khoá chỉ nhả khi cả bút toán lẫn receivedQty đã ghi), đúng idiom
   * CuttingProposalsService.approve() (Lỗ 5 gốc). `postEntry(tx)` nhận tx để bút toán và update
   * item nằm chung 1 transaction - không còn khoảng hở giữa hai đoạn.
   */
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
    // Kho nhận hàng = kho đã khai CHO ĐÚNG vật tư này (Material.warehouseId, xem Admin > Vật tư),
    // KHÔNG còn theo proposal.warehouseCode (1 kho chung cho cả đề xuất) - Sếp chốt 2026-08-15
    // mục 2. Bất biến theo item nên kiểm trước khi mở transaction là an toàn (không cần khoá).
    if (!item.material.warehouseId) {
      throw new BadRequestException(
        `Vật tư ${item.material.code} chưa được cấu hình Kho - không thể nhập kho tự động, vào Admin > Vật tư để gán Kho trước`,
      );
    }
    const materialWarehouseId = item.material.warehouseId;
    // B4 Đợt 3 (lỗ #3): cần cuttingProposalId gốc để cộng hàng về ĐÚNG dòng giữ chỗ - kiểm trước
    // khi mở transaction, cùng lý do bất biến như check warehouseId ở trên (không cần khoá, dữ
    // liệu hỏng thì hỏng từ trước, không phải race). Chỉ 1 nơi tạo PurchaseProposal
    // (CuttingProposalsService.approve()) và LUÔN set field này - thiếu nó là dữ liệu hỏng thật.
    if (!proposal.cuttingProposalId) {
      throw new BadRequestException(
        `Purchase proposal ${proposal.id} không có cuttingProposalId - không xác định được phương án cắt gốc để giữ chỗ hàng vừa về`,
      );
    }
    const cuttingProposalId = proposal.cuttingProposalId;

    // Dung sai đọc trước tx (business rule dùng chung, không phải state của riêng dòng item nên
    // không cần nằm trong khoá) - xem getOverReceiptTolerancePercent().
    const tolerancePercent = await this.getOverReceiptTolerancePercent();
    const buyQty = item.buyQty.toNumber();
    const maxAllowedQty = buyQty * (1 + tolerancePercent / 100);

    const supplierWarehouse = await this.prisma.warehouse.findUniqueOrThrow({
      where: { code: SUPPLIER_WAREHOUSE_CODE },
    });

    const updatedItem = await this.prisma.$transaction(
      async (tx) => {
        // Khoá dòng item rồi đọc lại receivedQty MỚI NHẤT - đây là điểm sửa chính của C3. Bỏ qua
        // giá trị `item.receivedQty` đọc ở findDetailOrThrow phía trên vì nó có thể đã cũ nếu 1
        // lượt nhận khác đang chạy song song.
        // Khoá thêm ở mức CẢ PHIẾU (không chỉ dòng item) - allReceived bên dưới phải đọc
        // receivedQty MỚI NHẤT của MỌI item khác trong phiếu, không chỉ dòng đang FOR UPDATE. Row
        // lock trên 1 item không ngăn được 2 request nhận hàng cho 2 item KHÁC nhau của cùng phiếu
        // chạy song song, mỗi bên đọc item còn lại theo snapshot cũ (Medium "allReceived tính từ
        // snapshot cũ") - phiếu kẹt PURCHASING vĩnh viễn dù cả 2 item vừa nhận đủ.
        await lockBusinessKey(tx, `purchase-proposal-received:${proposal.id}`);

        const [locked] = await tx.$queryRaw<
          { receivedQty: Prisma.Decimal; receivedQtyPurchaseUnit: Prisma.Decimal | null }[]
        >`
          SELECT "receivedQty", "receivedQtyPurchaseUnit" FROM "purchase_proposal_items"
          WHERE "id" = ${item.id} FOR UPDATE
        `;
        if (!locked) {
          throw new NotFoundException(`Item ${itemId} not found on purchase proposal ${id}`);
        }
        const currentReceivedQty = locked.receivedQty.toNumber();
        const nextReceivedQty = currentReceivedQty + dto.receivedQty;

        // Nhận THỪA: ghi đúng số thật nếu còn trong dung sai, chặn hẳn nếu vượt. Tuyệt đối không
        // cắt âm thầm về buyQty như trước (Math.min) - lựa chọn tệ nhất trong ba: hàng đã nằm
        // trong kho vật lý mà sổ không ghi, không cảnh báo, không log, sai lệch chỉ lộ ra lúc
        // kiểm kê cuối kỳ khi không còn truy ngược được nữa (D.b3-silent-over-receipt).
        if (nextReceivedQty > maxAllowedQty) {
          throw new BadRequestException(
            `Vật tư ${item.material.code}: nhận vượt số đặt mua. Đặt ${buyQty} ${item.material.unit}, ` +
              `đã nhận ${currentReceivedQty}, lần này nhập ${dto.receivedQty} -> tổng ${nextReceivedQty} ` +
              `vượt mức cho phép ${maxAllowedQty} (dung sai ${tolerancePercent}%). ` +
              `Kiểm tra lại số thực nhận, hoặc nhờ Admin nới dung sai ở Cấu hình hệ thống.`,
          );
        }

        const incrementQty = nextReceivedQty - currentReceivedQty;
        const nextReceivedQtyPurchaseUnit = dto.receivedQtyPurchaseUnit
          ? (locked.receivedQtyPurchaseUnit?.toNumber() ?? 0) + dto.receivedQtyPurchaseUnit
          : (locked.receivedQtyPurchaseUnit?.toNumber() ?? undefined);

        // Bút toán "hàng mua về nhập kho" - CÙNG transaction với update receivedQty bên dưới
        // (postEntry nhận tx), khoá chỉ nhả sau khi cả hai đã ghi xong.
        if (incrementQty > 0) {
          await this.stockLedgerService.postEntry(
            {
              fromWarehouseId: supplierWarehouse.id,
              toWarehouseId: materialWarehouseId,
              materialId: item.materialId,
              qty: incrementQty,
              refType: StockLedgerRefType.PURCHASE,
              refId: proposal.id.toString(),
              createdById: userId,
              idempotencyKey,
            },
            tx,
          );

          // B4 Đợt 3 (lỗ #3, mục 13.4 changelog): hàng vừa về phải "có chủ" ngay - cộng thẳng vào
          // đúng dòng giữ chỗ đã tạo lúc CuttingProposalsService.approve() (refType=
          // CUTTING_PROPOSAL, refId=cuttingProposalId gốc), KHÔNG để rơi vào tồn chung. Thiếu bước
          // này thì phương án cắt KHÁC được duyệt xen giữa có thể "giành" mất đúng số hàng vừa mua
          // về cho đơn này, dù sổ đã ghi "đã mua đủ, đã về hàng" - tái hiện đúng lỗ #3.
          await this.stockReservationsService.topUpFromReceipt(tx, {
            refType: StockReservationRefType.CUTTING_PROPOSAL,
            refId: cuttingProposalId.toString(),
            materialId: item.materialId,
            warehouseId: materialWarehouseId,
            qty: incrementQty,
          });
        }

        const saved = await tx.purchaseProposalItem.update({
          where: { id: item.id },
          data: {
            receivedQty: nextReceivedQty,
            receivedQtyPurchaseUnit: nextReceivedQtyPurchaseUnit,
          },
          include: ITEM_INCLUDE,
        });

        // Re-query TƯƠI trong transaction (không dùng snapshot proposal.items đọc trước khi mở
        // transaction) - đúng nguyên nhân của lỗi: 2 item nhận đồng thời mỗi bên tính allReceived
        // trên dữ liệu cũ của item còn lại. Advisory lock ở trên đảm bảo khi tới đây, mọi lượt nhận
        // khác của CÙNG phiếu đã commit xong nên fresh items phản ánh đúng trạng thái mới nhất.
        const freshItems = await tx.purchaseProposalItem.findMany({
          where: { proposalId: proposal.id },
          select: { id: true, receivedQty: true, buyQty: true },
        });
        const allReceived = freshItems.every((it) =>
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
      },
      { timeout: 15_000 },
    );

    return this.toItemResponseDto(updatedItem);
  }

  /**
   * Chặn Purchasing thao tác trên đề xuất của người khác - MIRROR ĐÚNG luật FE
   * (utils/purchasingRouting.ts#canPurchaserSeeProposal), không phát minh luật mới. Trước
   * 2026-08-15 (D.a4-purchaser-scope-not-enforced) việc "gán mua theo từng vật tư" chỉ lọc ở FE
   * (client-side): BE không có một dòng kiểm nào, nên bất kỳ tài khoản PURCHASER nào gọi thẳng
   * API cũng acknowledge/addQuote/submit/requote được đề xuất KHÔNG phải của mình - lọc ở FE là
   * tiện dụng, không phải kiểm soát.
   *
   * BOSS/ADMIN qua hết (điều phối chung). Còn lại: phải có ÍT NHẤT 1 dòng vật tư mà
   * `Material.buyerId` là null (chưa gán ai - không "mồ côi" cho tới khi có người nhận, đúng
   * nguyên tắc FE) hoặc chính là actor. KHÔNG đòi actor sở hữu MỌI dòng - đề xuất có thể gộp
   * nhiều vật tư của nhiều người mua khác nhau (Sếp chốt 2026-08-15, PurchaseProposalItem).
   */
  private assertActorMayHandle(
    proposal: { items: { material: { buyerId: string | null } }[] },
    actorUserId: string,
    actorRoles: string[],
  ): void {
    if (actorRoles.includes(BUSINESS_ROLES.BOSS) || actorRoles.includes(DEFAULT_ROLES.ADMIN)) {
      return;
    }
    const allowed = proposal.items.some((item) => {
      const buyerId = item.material.buyerId;
      return !buyerId || buyerId === actorUserId;
    });
    if (!allowed) {
      throw new ForbiddenException(
        'Bạn không được phân công mua vật tư nào trong đề xuất này - liên hệ Admin nếu cần hỗ trợ',
      );
    }
  }

  /**
   * Dung sai giao thừa (%) từ System Config - singleton id=1, cùng chỗ với tham số solver.
   * Config chưa seed -> 0 (không cho nhận thừa) chứ KHÔNG ném lỗi: thiếu cấu hình không phải lý
   * do chính đáng để chặn Thủ kho ghi nhận một lô hàng đã về đúng số.
   */
  private async getOverReceiptTolerancePercent(): Promise<number> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { id: 1 },
      select: { purchaseOverReceiptTolerancePercent: true },
    });
    return config?.purchaseOverReceiptTolerancePercent.toNumber() ?? 0;
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

  /**
   * Hạn dùng để Mua hàng xếp việc - CÙNG thứ tự ưu tiên với CuttingProposalsService.
   * frameDeadlineOf/ProductionInvoicesService.frameDeadlineOf (materialDeadline -> mốc Khung cơ
   * khí -> hạn cả phiếu). Cố ý nhân bản 3 dòng này thay vì export hàm private của 2 module kia -
   * cùng lý do đã ghi ở 2 chỗ đó: 3 module không phụ thuộc nhau theo chiều này, quy tắc đủ nhỏ để
   * trùng lặp rẻ hơn dựng thêm ràng buộc giữa các module (A3, D.a3-deadline-not-wired).
   */
  private frameDeadlineOf(item: {
    materialDeadline: Date | null;
    stages: { stageType: ProdItemStageType; deadline: Date }[];
    productionInvoice: { deadline: Date | null } | null;
  }): Date | null {
    const frame = item.stages.find((s) => s.stageType === ProdItemStageType.FRAME);
    return item.materialDeadline ?? frame?.deadline ?? item.productionInvoice?.deadline ?? null;
  }

  private toResponseDto(row: PurchaseProposalRow): PurchaseProposalResponseDto {
    // productionOrder = null khi đề xuất đến từ phương án cắt CẤP NHÓM (PI gộp nhiều SKU) - nhóm
    // không có 1 lệnh SX đơn lẻ nào. Đây chính là ca "nhóm = đơn vị mua": 1 đề xuất mua duy nhất
    // cho cả đợt cắt chung, thay vì mỗi lệnh SX một đề xuất rồi Mua hàng phải báo giá nhiều lần.
    //
    // row.cuttingProposal CÓ THỂ null (2026-08-19, phát hiện khi dọn dữ liệu test): FK
    // cuttingProposalId là ON DELETE SET NULL (xem comment schema.prisma), nên xóa CuttingProposal
    // gốc để lại PurchaseProposal mồ côi - vẫn là hồ sơ mua hàng THẬT (đã đặt/đã mua), chỉ mất dấu
    // vết ngược. Trước đây `!` giả định luôn có, crash 500 ngay khi gặp ca này lần đầu. Toàn bộ
    // phần còn lại của hàm đã tự xử lý productionOrder/mergedPi null sẵn (?., ?? '—') - chỉ cần
    // sửa đúng 2 dòng ép kiểu này.
    const productionOrder = row.cuttingProposal?.productionOrder ?? null;
    const mergedPi = row.cuttingProposal?.productionInvoice ?? null;

    // Nhánh lệnh SX đơn: 1-1 với đúng 1 ProductionInvoiceItem. Nhánh PI gộp: lấy hạn SỚM NHẤT
    // trong cả nhóm SKU - đơn nào gấp nhất trong đợt cắt chung thì Mua hàng phải ưu tiên đơn đó,
    // trễ đơn đó là trễ cả đợt.
    const deadline = productionOrder
      ? this.frameDeadlineOf({
          materialDeadline: productionOrder.productionInvoiceItem.materialDeadline,
          stages: productionOrder.productionInvoiceItem.stages,
          productionInvoice: productionOrder.productionInvoiceItem.productionInvoice,
        })
      : ((mergedPi?.items ?? [])
          .map((it) =>
            this.frameDeadlineOf({
              materialDeadline: it.materialDeadline,
              stages: it.stages,
              productionInvoice: { deadline: mergedPi!.deadline },
            }),
          )
          .filter((d): d is Date => d !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null);

    // Mã đơn hàng Sales gốc - đây mới là mã "PO" người dùng cần thấy (poNumber nội bộ giờ chỉ
    // còn phục vụ hệ thống, xem trao đổi 2026-08-18). Nhánh lệnh SX đơn: 1 SalesOrder duy nhất
    // (ProductionInvoiceItem.salesOrderId). Nhánh PI gộp: các SKU trong nhóm có thể thuộc NHIỀU
    // đơn Sales khác nhau - gộp danh sách mã duy nhất, không có "1 mã đại diện" nào đúng cả.
    // null khi SKU không gắn đơn Sales nào (tạo tay, xem PlanForm.customerName).
    const salesOrderCode = productionOrder
      ? (productionOrder.productionInvoiceItem.salesOrder?.code ?? null)
      : (mergedPi?.items ?? [])
          .map((it) => it.salesOrder?.code)
          .filter((c): c is string => !!c)
          .filter((c, i, arr) => arr.indexOf(c) === i)
          .join(', ') || null;

    return new PurchaseProposalResponseDto({
      id: row.id.toString(),
      cuttingProposalId: row.cuttingProposalId?.toString() ?? null,
      warehouseCode: row.warehouseCode,
      status: row.status,
      poNumber: productionOrder?.poNumber ?? mergedPi?.code ?? '—',
      salesOrderCode,
      // `.productionInvoice!` - ProductionOrder chỉ sinh khi Sếp duyệt, item của nó luôn đã có PI
      // thật lúc đó (cùng bất biến ghi ở ProductionOrdersService.toResponseDto()).
      piCode:
        productionOrder?.productionInvoiceItem.productionInvoice!.code ?? mergedPi?.code ?? '—',
      mfgProductCode:
        productionOrder?.mfgProduct.factoryCode ??
        (mergedPi?.items ?? []).map((it) => it.mfgProduct.factoryCode).join(', '),
      mfgProductName:
        productionOrder?.mfgProduct.name ?? (mergedPi ? `${mergedPi.items.length} SKU gộp` : null),
      deadline,
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
