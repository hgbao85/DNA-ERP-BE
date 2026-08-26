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
import { recomputeProposalStatus } from './purchase-proposal-status.util';
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
  // Trực tiếp trên PurchaseProposal (2026-08-22, sourceType=PIECE_MATERIAL_YIELD) - KHÁC
  // cuttingProposal.productionInvoice ở trên (đó là PI gộp của phương án cắt sắt). Chỉ set khi
  // đề xuất không đi qua CuttingProposal nào cả, dùng làm fallback piCode/poNumber ở
  // toResponseDto() để Mua hàng vẫn biết đề xuất thuộc PI nào dù không có phương án cắt gốc.
  productionInvoice: { select: { code: true } },
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

  /**
   * Purchasing tiếp nhận đề xuất - bắt đầu báo giá CHO ĐÚNG PHẦN CỦA MÌNH (2026-08-25, "duyệt
   * riêng từng người mua hàng"): chỉ chuyển NEW -> QUOTING cho các dòng vật tư của actor (hoặc
   * chưa gán ai) - KHÔNG đụng tới dòng của đồng nghiệp khác trong cùng đề xuất gộp, khác hẳn hành
   * vi cũ (chuyển cả proposal 1 lượt). Boss/Admin (đã qua assertActorMayHandle không cần sở hữu
   * dòng nào) coi như tiếp nhận hộ được MỌI dòng NEW, cùng quyền hạn Boss/Admin đã có sẵn ở
   * assertActorMayQuoteItem().
   */
  async acknowledge(
    id: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertActorMayHandle(proposal, actorUserId, actorRoles);
    const isPrivileged = this.isPrivilegedActor(actorRoles);
    const myNewItems = proposal.items.filter(
      (item) =>
        item.status === PurchaseProposalStatus.NEW &&
        (isPrivileged || !item.material.buyerId || item.material.buyerId === actorUserId),
    );
    if (myNewItems.length === 0) {
      throw new BadRequestException(
        'Không có vật tư nào của bạn đang chờ tiếp nhận trong đề xuất này',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `purchase-proposal-mutate:${proposal.id}`);
      await tx.purchaseProposalItem.updateMany({
        where: { id: { in: myNewItems.map((i) => i.id) } },
        data: { status: PurchaseProposalStatus.QUOTING },
      });
      await recomputeProposalStatus(tx, proposal.id);
    });
    return this.findOne(id);
  }

  async addQuote(
    id: string,
    itemId: string,
    dto: CreateQuoteDto,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<PurchaseProposalItemResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertActorMayHandle(proposal, actorUserId, actorRoles);
    const bigItemId = parseBigIntId(itemId);
    const item = proposal.items.find((it) => it.id === bigItemId);
    if (!item) {
      throw new NotFoundException(`Item ${itemId} not found on purchase proposal ${id}`);
    }
    // Kiểm ở CẤP ITEM (không còn assertStatus(proposal, QUOTING) - status cấp proposal giờ chỉ là
    // rollup, xem purchase-proposal-status.util.ts).
    if (item.status !== PurchaseProposalStatus.QUOTING) {
      throw new ConflictException(
        `Vật tư ${item.material.code} đang ở trạng thái ${item.status} - chỉ QUOTING mới báo giá được (đã tiếp nhận chưa?)`,
      );
    }
    this.assertActorMayQuoteItem(item, actorUserId, actorRoles);

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

  /**
   * Gửi Sếp duyệt - CHỈ gửi phần vật tư của actor (hoặc chưa gán ai) đang QUOTING, bắt buộc mỗi
   * dòng đó có ít nhất 1 báo giá hợp lệ (đơn giá > 0). KHÔNG còn đợi đồng nghiệp khác trong cùng
   * đề xuất xong phần của họ (2026-08-25, "duyệt riêng từng người mua hàng") - trước đây soi TOÀN
   * BỘ proposal.items kể cả của người khác, 1 người báo giá xong không gửi được nếu người khác
   * trong cùng đề xuất chưa xong.
   */
  async submit(
    id: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertActorMayHandle(proposal, actorUserId, actorRoles);
    const isPrivileged = this.isPrivilegedActor(actorRoles);
    const myQuotingItems = proposal.items.filter(
      (item) =>
        item.status === PurchaseProposalStatus.QUOTING &&
        (isPrivileged || !item.material.buyerId || item.material.buyerId === actorUserId),
    );
    if (myQuotingItems.length === 0) {
      throw new BadRequestException('Không có vật tư nào của bạn đang chờ gửi trong đề xuất này');
    }

    const missing = myQuotingItems.filter(
      (item) => !item.quotes.some((q) => q.unitPrice != null && q.unitPrice.toNumber() > 0),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        'Mỗi vật tư cần ít nhất 1 báo giá NCC có đơn giá trước khi gửi Sếp duyệt',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `purchase-proposal-mutate:${proposal.id}`);
      await tx.purchaseProposalItem.updateMany({
        where: { id: { in: myQuotingItems.map((i) => i.id) } },
        data: { status: PurchaseProposalStatus.SUBMITTED, submittedAt: new Date() },
      });
      await recomputeProposalStatus(tx, proposal.id);
    });
    return this.findOne(id);
  }

  /**
   * Sếp duyệt - chọn đúng 1 báo giá/vật tư. Chỉ áp dụng cho các dòng có mặt trong
   * `dto.chosenQuoteIdByItemId` (2026-08-25, "duyệt riêng từng người mua hàng"): tập key trong dto
   * CHÍNH LÀ batch đang duyệt (những gì Sếp nhìn thấy trên màn "So sánh giá" lúc bấm Duyệt) - BE
   * KHÔNG tự dò lại `proposal.items` để tìm "mọi dòng SUBMITTED", tránh race nếu có người mua khác
   * vừa gửi thêm phần của họ đúng lúc Sếp đang xem màn hình (D.p8-approve-batch-race, phát hiện
   * lúc thiết kế tính năng này) - phần mới gửi đó sẽ xuất hiện thành 1 lượt chờ duyệt riêng, độc
   * lập, không làm hỏng/chặn lượt đang xử lý. Không còn `assertStatus(proposal, SUBMITTED)` -
   * trạng thái cấp proposal giờ chỉ là ROLLUP, mỗi dòng tự kiểm trạng thái riêng.
   */
  async approve(
    id: string,
    actorUserId: string,
    dto: ApprovePurchaseProposalDto,
  ): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findDetailOrThrow(id);

    const itemIdStrs = Object.keys(dto.chosenQuoteIdByItemId);
    if (itemIdStrs.length === 0) {
      throw new BadRequestException('Chưa chọn NCC cho vật tư nào');
    }

    const chosenQuoteIdByItem = new Map<bigint, bigint>();
    const targetItems: PurchaseProposalItemRow[] = [];
    for (const itemIdStr of itemIdStrs) {
      const bigItemId = parseBigIntId(itemIdStr);
      const item = proposal.items.find((it) => it.id === bigItemId);
      if (!item) {
        throw new BadRequestException(`Vật tư ${itemIdStr} không thuộc đề xuất ${id}`);
      }
      // Item đã bị xử lý (bởi lượt Duyệt/Từ chối khác) hoặc chưa từng được gửi - phân biệt rõ với
      // lỗi "thiếu NCC" bên dưới để FE biết cần tải lại trang thay vì tưởng người dùng bỏ sót.
      if (item.status !== PurchaseProposalStatus.SUBMITTED) {
        throw new ConflictException(
          `Vật tư ${item.material.code} đang ở trạng thái ${item.status} - đã được xử lý hoặc chưa tới lượt duyệt, tải lại trang để xem tình trạng mới nhất`,
        );
      }
      const chosen = dto.chosenQuoteIdByItemId[itemIdStr];
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
      targetItems.push(item);
    }

    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `purchase-proposal-mutate:${proposal.id}`);
      for (const item of targetItems) {
        await tx.purchaseProposalQuote.updateMany({
          where: { itemId: item.id },
          data: { isChosen: false },
        });
        await tx.purchaseProposalQuote.update({
          where: { id: chosenQuoteIdByItem.get(item.id) },
          data: { isChosen: true },
        });
        await tx.purchaseProposalItem.update({
          where: { id: item.id },
          data: {
            status: PurchaseProposalStatus.PURCHASING,
            approvedAt: new Date(),
            approvedById: actorUserId,
          },
        });
      }
      await recomputeProposalStatus(tx, proposal.id);
    });

    // Quyết định TIỀN của cả luồng: vật tư nào, mua của ai, giá bao nhiêu. Chuyển trạng thái
    // SUBMITTED -> PURCHASING đã được extension tự ghi cấp PROPOSAL (rollup), còn cấp ITEM
    // (nguồn sự thật) không nằm trong AUDITED_MODELS - bản thân quote cũng là bảng con, không
    // auto-audit - mà đó mới là thứ cần khi đối chiếu với NCC.
    await this.auditQuoteDecision({
      action: AuditAction.UPDATE,
      proposalId: proposal.id,
      newValue: {
        event: 'approve',
        chosen: targetItems.map((item) => {
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

  /**
   * Sếp từ chối. `dto.itemIds` tuỳ chọn (2026-08-25, "duyệt riêng từng người mua hàng") - Sếp gửi
   * kèm đúng batch đang xem trên màn hình lúc bấm Từ chối, cùng lý do chống race đã ghi ở
   * `approve()`; không gửi (tương thích ngược) thì áp dụng cho MỌI dòng đang SUBMITTED của đề
   * xuất.
   */
  async reject(id: string, dto: RejectPurchaseProposalDto): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findDetailOrThrow(id);

    const targetItems = dto.itemIds
      ? dto.itemIds.map((itemIdStr) => {
          const bigItemId = parseBigIntId(itemIdStr);
          const item = proposal.items.find((it) => it.id === bigItemId);
          if (!item) {
            throw new BadRequestException(`Vật tư ${itemIdStr} không thuộc đề xuất ${id}`);
          }
          if (item.status !== PurchaseProposalStatus.SUBMITTED) {
            throw new ConflictException(
              `Vật tư ${item.material.code} đang ở trạng thái ${item.status} - đã được xử lý hoặc chưa tới lượt duyệt, tải lại trang để xem tình trạng mới nhất`,
            );
          }
          return item;
        })
      : proposal.items.filter((item) => item.status === PurchaseProposalStatus.SUBMITTED);

    if (targetItems.length === 0) {
      throw new BadRequestException('Không có vật tư nào đang chờ duyệt để từ chối');
    }

    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `purchase-proposal-mutate:${proposal.id}`);
      await tx.purchaseProposalItem.updateMany({
        where: { id: { in: targetItems.map((i) => i.id) } },
        data: {
          status: PurchaseProposalStatus.REJECTED,
          rejectedAt: new Date(),
          rejectionReason: dto.rejectionReason,
        },
      });
      await recomputeProposalStatus(tx, proposal.id);
    });

    return this.findOne(id);
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
  /**
   * BUG FIX 2026-08-25: trước đây `deleteMany({ item: { proposalId } })` xoá TOÀN BỘ báo giá của
   * CẢ đề xuất, kể cả của đồng nghiệp khác đang PURCHASING (`isChosen=true` đã được Sếp duyệt) -
   * antique từ thời 1 đề xuất chỉ có 1 người mua. Giờ chỉ requote đúng phần vật tư của actor (hoặc
   * chưa gán ai) đang REJECTED, không đụng gì tới dòng khác.
   */
  async requote(
    id: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertActorMayHandle(proposal, actorUserId, actorRoles);
    const isPrivileged = this.isPrivilegedActor(actorRoles);
    const myRejectedItems = proposal.items.filter(
      (item) =>
        item.status === PurchaseProposalStatus.REJECTED &&
        (isPrivileged || !item.material.buyerId || item.material.buyerId === actorUserId),
    );
    if (myRejectedItems.length === 0) {
      throw new BadRequestException(
        'Không có vật tư nào của bạn bị từ chối để báo giá lại trong đề xuất này',
      );
    }

    // Chụp lại TRƯỚC khi xoá: deleteMany dưới đây là thao tác duy nhất trong cả luồng huỷ hẳn dữ
    // liệu giá đã từng gửi Sếp. Không có bản chụp này thì sau một vòng từ chối/báo giá lại, không
    // còn cách nào biết lần trước NCC nào chào bao nhiêu (D.c1-no-audit-on-money-path).
    const deletedQuotes = myRejectedItems.flatMap((item) =>
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
    const rejectedItemsSummary = myRejectedItems.map((item) => ({
      itemId: item.id.toString(),
      materialCode: item.material.code,
      rejectionReason: item.rejectionReason,
    }));

    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `purchase-proposal-mutate:${proposal.id}`);
      await tx.purchaseProposalQuote.deleteMany({
        where: { itemId: { in: myRejectedItems.map((i) => i.id) } },
      });
      await tx.purchaseProposalItem.updateMany({
        where: { id: { in: myRejectedItems.map((i) => i.id) } },
        data: {
          status: PurchaseProposalStatus.QUOTING,
          rejectedAt: null,
          rejectionReason: null,
        },
      });
      await recomputeProposalStatus(tx, proposal.id);
    });
    await this.auditQuoteDecision({
      action: AuditAction.DELETE,
      proposalId: proposal.id,
      oldValue: { event: 'requote', rejectedItems: rejectedItemsSummary, deletedQuotes },
    });
    return this.findOne(id);
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
    const bigItemId = parseBigIntId(itemId);
    const item = proposal.items.find((it) => it.id === bigItemId);
    if (!item) {
      throw new NotFoundException(`Item ${itemId} not found on purchase proposal ${id}`);
    }
    // Kiểm ở CẤP ITEM (2026-08-25, không còn assertStatus(proposal, PURCHASING) - status cấp
    // proposal giờ chỉ là rollup, có thể vẫn "quoting" nếu vật tư khác trong cùng đề xuất gộp chưa
    // được duyệt, trong khi ĐÚNG DÒNG này đã PURCHASING và nhận hàng được bình thường).
    if (item.status !== PurchaseProposalStatus.PURCHASING) {
      throw new ConflictException(
        `Vật tư ${item.material.code} đang ở trạng thái ${item.status} - chỉ PURCHASING (đã Sếp duyệt NCC) mới nhận hàng được`,
      );
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
    // B4 Đợt 3 (lỗ #3): cộng hàng về ĐÚNG dòng giữ chỗ (StockReservation, tạo ở
    // CuttingProposalsService.approve()) - CHỈ khi đúng vật tư SẮT của chính phương án cắt đó.
    // Từ 2026-08-25, 1 PurchaseProposal có thể GỘP cả sắt lẫn vật tư khác (VTTP/tiêu hao) của
    // cùng 1 PI vào chung 1 form (xem CuttingProposalsService.approve()) - proposal.
    // cuttingProposalId/sourceType giờ chỉ còn mô tả đề xuất, KHÔNG còn mô tả đúng nguồn của
    // TỪNG DÒNG nữa. Soi thẳng CuttingProposalLine (đúng cuttingProposalId + đúng materialId) để
    // biết dòng này có phải sắt của phương án đó không - sai chỗ này sẽ tạo StockReservation MỒ
    // CÔI cho vật tư không phải sắt (xem StockReservationsService.topUpFromReceipt: nếu chưa có
    // dòng giữ chỗ nào cho cặp refId/materialId, nó TỰ TẠO MỚI - ngầm giả định materialId truyền
    // vào luôn là sắt thuộc đúng phương án). Bất biến theo item, kiểm trước khi mở transaction an
    // toàn như check warehouseId ở trên.
    const cuttingProposalId = proposal.cuttingProposalId;
    const isSteelLineOfCuttingProposal =
      cuttingProposalId != null &&
      (await this.prisma.cuttingProposalLine.findFirst({
        where: { cuttingProposalId, materialId: item.materialId },
        select: { id: true },
      })) != null;

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
        // Khoá thêm ở mức CẢ PHIẾU (không chỉ dòng item) - recomputeProposalStatus() bên dưới phải
        // đọc status MỚI NHẤT của MỌI item khác trong phiếu, không chỉ dòng đang FOR UPDATE. Row
        // lock trên 1 item không ngăn được 2 request nhận hàng cho 2 item KHÁC nhau của cùng phiếu
        // chạy song song, mỗi bên đọc item còn lại theo snapshot cũ (Medium "allReceived tính từ
        // snapshot cũ") - phiếu kẹt PURCHASING vĩnh viễn dù cả 2 item vừa nhận đủ. Tên khoá dùng
        // CHUNG `purchase-proposal-mutate:` với mọi method ghi status khác (2026-08-25) - trước đó
        // dùng tên riêng `purchase-proposal-received:`, khác tên nghĩa là KHÔNG loại trừ lẫn nhau,
        // nhận hàng và duyệt/từ chối có thể chen ngang nhau khi cùng ghi status cùng lúc.
        await lockBusinessKey(tx, `purchase-proposal-mutate:${proposal.id}`);

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
          // về cho đơn này, dù sổ đã ghi "đã mua đủ, đã về hàng" - tái hiện đúng lỗ #3. CHỈ áp dụng
          // khi ĐÚNG DÒNG này là sắt của chính phương án cắt đó (xem check đầu hàm) - nhánh khác
          // (VTTP/tiêu hao, kể cả khi nằm CHUNG 1 đề xuất gộp với sắt) không có dòng giữ chỗ nào để
          // cộng vào, cứ để hàng về rơi vào tồn chung.
          if (isSteelLineOfCuttingProposal) {
            await this.stockReservationsService.topUpFromReceipt(tx, {
              refType: StockReservationRefType.CUTTING_PROPOSAL,
              refId: cuttingProposalId.toString(),
              materialId: item.materialId,
              warehouseId: materialWarehouseId,
              qty: incrementQty,
            });
          }
        }

        // Nhận đủ (>=buyQty) -> ĐÚNG DÒNG này đóng hồ sơ PURCHASED ngay, độc lập với item khác
        // trong cùng đề xuất (2026-08-25) - trước đây phải đợi TOÀN BỘ items của cả phiếu nhận đủ
        // mới đóng hồ sơ chung. recomputeProposalStatus() bên dưới tự suy ra rollup cấp proposal
        // (chỉ PURCHASED khi MỌI dòng đã PURCHASED, xem purchase-proposal-status.util.ts).
        const nowFullyReceived = nextReceivedQty >= buyQty;
        const saved = await tx.purchaseProposalItem.update({
          where: { id: item.id },
          data: {
            receivedQty: nextReceivedQty,
            receivedQtyPurchaseUnit: nextReceivedQtyPurchaseUnit,
            ...(nowFullyReceived
              ? { status: PurchaseProposalStatus.PURCHASED, purchasedAt: new Date() }
              : {}),
          },
          include: ITEM_INCLUDE,
        });
        await recomputeProposalStatus(tx, proposal.id);

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
  /** Boss/Admin điều phối chung - bỏ qua mọi ràng buộc theo `Material.buyerId` (cả cấp đề xuất lẫn
   *  cấp item), dùng chung ở assertActorMayHandle/assertActorMayQuoteItem và mọi method item-level
   *  mới (acknowledge/submit/requote, 2026-08-25). */
  private isPrivilegedActor(actorRoles: string[]): boolean {
    return actorRoles.includes(BUSINESS_ROLES.BOSS) || actorRoles.includes(DEFAULT_ROLES.ADMIN);
  }

  private assertActorMayHandle(
    proposal: { items: { material: { buyerId: string | null } }[] },
    actorUserId: string,
    actorRoles: string[],
  ): void {
    if (this.isPrivilegedActor(actorRoles)) {
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
   * Chặn báo giá vật tư KHÔNG phải của mình trong 1 đề xuất gộp nhiều người mua - ĐẢO quyết định
   * "Sếp chốt 2026-08-15" ở assertActorMayHandle() (chốt lại 2026-08-25): trước đây addQuote chỉ
   * soi ở CẤP ĐỀ XUẤT (sở hữu ≥1 dòng là báo giá được MỌI dòng), khiến 3 nhân viên mua hàng cùng
   * thấy/báo giá được y hệt nhau dù Material.buyerId đã gán rõ từng người - report thực tế
   * PI-2026-012 (2026-08-25). assertActorMayHandle() vẫn giữ nguyên (cổng VÀO đề xuất, cho phép
   * acknowledge/submit/requote ở cấp đề xuất - đó là hành động chuyển trạng thái chung, không phải
   * "định giá hộ vật tư người khác"), chỉ addQuote soi thêm xuống TỪNG item.
   */
  private assertActorMayQuoteItem(
    item: { material: { buyerId: string | null } },
    actorUserId: string,
    actorRoles: string[],
  ): void {
    if (this.isPrivilegedActor(actorRoles)) {
      return;
    }
    const buyerId = item.material.buyerId;
    if (buyerId && buyerId !== actorUserId) {
      throw new ForbiddenException(
        'Vật tư này đã được phân công cho nhân viên mua hàng khác - bạn không thể báo giá',
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
      poNumber: productionOrder?.poNumber ?? mergedPi?.code ?? row.productionInvoice?.code ?? '—',
      salesOrderCode,
      // `.productionInvoice!` - ProductionOrder chỉ sinh khi Sếp duyệt, item của nó luôn đã có PI
      // thật lúc đó (cùng bất biến ghi ở ProductionOrdersService.toResponseDto()).
      // row.productionInvoice (không qua cuttingProposal) - fallback cho sourceType=
      // PIECE_MATERIAL_YIELD (2026-08-22, xem PieceMaterialYieldPurchaseService): đề xuất này
      // không có phương án cắt gốc nhưng vẫn ghim thẳng productionInvoiceId, nếu không fallback
      // Mua hàng sẽ thấy piCode/poNumber trống trơn, không biết đề xuất thuộc PI nào.
      piCode:
        productionOrder?.productionInvoiceItem.productionInvoice!.code ??
        mergedPi?.code ??
        row.productionInvoice?.code ??
        '—',
      mfgProductCode:
        productionOrder?.mfgProduct.factoryCode ??
        (mergedPi?.items ?? []).map((it) => it.mfgProduct.factoryCode).join(', '),
      mfgProductName:
        productionOrder?.mfgProduct.name ??
        (mergedPi
          ? `${mergedPi.items.length} SKU gộp`
          : row.productionInvoice
            ? 'Vật tư thành phẩm'
            : null),
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
      stockLengthMm: item.stockLengthMm,
      receivedQty: item.receivedQty.toNumber(),
      receivedQtyPurchaseUnit: item.receivedQtyPurchaseUnit?.toNumber() ?? null,
      status: item.status,
      submittedAt: item.submittedAt,
      approvedAt: item.approvedAt,
      rejectedAt: item.rejectedAt,
      rejectionReason: item.rejectionReason,
      purchasedAt: item.purchasedAt,
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
