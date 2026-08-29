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
import { BossApprovePurchaseProposalDto } from './dto/boss-approve-purchase-proposal.dto';
import {
  PurchaseProposalItemResponseDto,
  PurchaseProposalQuoteResponseDto,
  PurchaseProposalResponseDto,
} from './dto/purchase-proposal-response.dto';
import { ListPurchaseProposalsQueryDto } from './dto/list-purchase-proposals-query.dto';
import { ReceivePurchaseProposalItemDto } from './dto/receive-purchase-proposal-item.dto';

/// Kho ảo cố định (protected-warehouse-codes.constant.ts) - nguồn của bút toán "nhập hàng mua
/// về" khi Thủ kho xác nhận nhận hàng (xem receiveItem()).
const SUPPLIER_WAREHOUSE_CODE = 'SUPPLIER';

/// Mọi trạng thái ĐỨNG TRƯỚC PURCHASING - tập item mà bossApprove() được phép đẩy đi tiếp.
/// QUOTING/SUBMITTED/REJECTED là tàn dư của luồng báo giá cũ (gỡ 2026-08-27) và KHÔNG còn sinh
/// mới, nhưng phải nằm trong danh sách này: production còn 36 dòng kẹt ở đó lúc cắt luồng, và màn
/// duyệt của Sếp đã bị gỡ nên bossApprove() là đường ra duy nhất của chúng.
const PENDING_APPROVAL_STATUSES: PurchaseProposalStatus[] = [
  PurchaseProposalStatus.NEW,
  PurchaseProposalStatus.QUOTING,
  PurchaseProposalStatus.SUBMITTED,
  PurchaseProposalStatus.REJECTED,
];

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
 * tự sinh (sourceType=CUTTING_PROPOSAL, không có endpoint tạo tay). `actualStock`/`buyQty` đã đối
 * chiếu tồn kho thật (StockQuant) ngay lúc tạo dòng - xem CuttingProposalsService.approve().
 *
 * State machine (2026-08-27, "Sếp duyệt ngoài hệ thống"):
 *
 *     NEW --bossApprove()--> PURCHASING --receiveItem()--> PURCHASED
 *
 * Trước đó là NEW -> QUOTING -> SUBMITTED -> PURCHASING -> PURCHASED (+ nhánh SUBMITTED ->
 * REJECTED -> QUOTING): Mua hàng nhập báo giá nhiều NCC, Sếp mở màn "So sánh giá" chọn NCC rồi
 * duyệt. Sếp chốt bỏ hẳn - so sánh giá nay làm trên phiếu Excel in ra và KÝ TAY, phần mềm chỉ lưu
 * file đã ký (`PurchaseProposalItem.approvalFileUrl`). Đã gỡ theo: acknowledge/addQuote/submit/
 * approve/reject/requote + 3 DTO tương ứng.
 *
 * CÒN LẠI CÓ CHỦ ĐÍCH: bảng PurchaseProposalQuote + 32 báo giá cũ + `ITEM_INCLUDE.quotes` giữ
 * nguyên để tra cứu lịch sử 25 đơn đã mua theo luồng cũ - chỉ không còn ĐƯỜNG GHI nào. Enum
 * PurchaseProposalStatus cũng giữ đủ QUOTING/SUBMITTED/REJECTED vì production còn dữ liệu ở đó.
 *
 * Khi Thủ kho xác nhận nhận hàng (receiveItem), phần mới nhận được ghi vào StockLedger
 * (refType=PURCHASE) để cộng lại tồn kho vật lý.
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
   * Ghi audit TAY cho PurchaseProposalItem - bảng con này cố ý không nằm trong AUDITED_MODELS, và
   * quan trọng hơn: mọi chuyển trạng thái item ở service này đều đi qua `updateMany`, mà
   * `updateMany` KHÔNG được extension audit tự ghi (xem audit-log.extension.ts). Không ghi tay ở
   * đây thì quyết định "đẩy lô hàng sang mua" không để lại dấu vết nào.
   *
   * Cùng idiom ProductionInvoicesService.auditItemApprovalTransition().
   */
  private async auditProposalDecision(entry: {
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
      tableName: 'PurchaseProposalItem',
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
   * Mua hàng xác nhận "Sếp đã duyệt" - đẩy phần vật tư CỦA MÌNH thẳng sang PURCHASING, kèm file
   * phiếu Sếp đã ký tay (2026-08-27).
   *
   * Thay cho cả chuỗi acknowledge -> addQuote -> submit -> Sếp approve đã gỡ: việc so sánh giá và
   * phê duyệt nay diễn ra NGOÀI phần mềm (phiếu Excel in ra, Sếp ký tay). Phần mềm chỉ giữ lại
   * BẰNG CHỨNG (`approvalFileUrl`) và mở đường cho Kho nhận hàng. Giá/NCC cố ý không lưu - chúng
   * nằm trong file.
   *
   * NHẬN CẢ 4 TRẠNG THÁI TRƯỚC PURCHASING (NEW/QUOTING/SUBMITTED/REJECTED) - CÓ CHỦ ĐÍCH, đừng
   * "dọn" lại còn mỗi NEW: lúc cắt sang luồng mới, production còn 36 dòng nằm ở QUOTING/SUBMITTED
   * (đã bấm Tiếp nhận, hoặc đã gửi Sếp theo luồng cũ). Màn duyệt của Sếp đã gỡ nên đây là ĐƯỜNG
   * SỐNG DUY NHẤT của chúng - siết lại theo NEW là treo vĩnh viễn 36 dòng hàng thật.
   *
   * Quyền: PURCHASE_PROPOSAL:UPDATE (nhân viên mua hàng), KHÔNG phải APPROVE. Tức trong phần mềm
   * người mua tự bấm duyệt - chốt chặn thật chuyển hẳn sang chữ ký trên giấy + file lưu lại. Đây
   * là hệ quả CỐ Ý của việc bỏ bước duyệt trong hệ thống (Sếp chốt), không phải sót phân quyền.
   */
  async bossApprove(
    id: string,
    actorUserId: string,
    actorRoles: string[],
    dto: BossApprovePurchaseProposalDto,
  ): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertActorMayHandle(proposal, actorUserId, actorRoles);
    const isPrivileged = this.isPrivilegedActor(actorRoles);
    const myPendingItems = proposal.items.filter(
      (item) =>
        PENDING_APPROVAL_STATUSES.includes(item.status) &&
        (isPrivileged || !item.material.buyerId || item.material.buyerId === actorUserId),
    );
    if (myPendingItems.length === 0) {
      throw new BadRequestException('Không có vật tư nào của bạn đang chờ duyệt trong đề xuất này');
    }

    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `purchase-proposal-mutate:${proposal.id}`);
      // Re-check status BÊN TRONG transaction (D.p12-item-status-race, 2026-08-26): myPendingItems
      // lọc từ snapshot đọc NGOÀI transaction, có thể đã bị thao tác khác đổi trạng thái giữa lúc
      // đọc và lúc khoá kịp giữ. Điều kiện status trong where + so khớp count là chốt chặn cuối.
      const { count } = await tx.purchaseProposalItem.updateMany({
        where: {
          id: { in: myPendingItems.map((i) => i.id) },
          status: { in: PENDING_APPROVAL_STATUSES },
        },
        data: {
          status: PurchaseProposalStatus.PURCHASING,
          approvedAt: new Date(),
          approvedById: actorUserId,
          approvalFileUrl: dto.approvalFileUrl,
        },
      });
      if (count !== myPendingItems.length) {
        throw new ConflictException(
          'Một số vật tư vừa bị thay đổi trạng thái bởi thao tác khác - tải lại trang để xem tình trạng mới nhất',
        );
      }
      await recomputeProposalStatus(tx, proposal.id);
    });

    // BẮT BUỘC ghi tay: mọi chuyển trạng thái item đều qua updateMany, mà updateMany KHÔNG được
    // extension audit tự ghi (audit-log.extension.ts). Thiếu dòng này thì không còn dấu vết nào
    // về việc AI đã đẩy lô hàng này sang mua - phần đó trước đây do approve() của Sếp ghi.
    await this.auditProposalDecision({
      action: AuditAction.UPDATE,
      proposalId: proposal.id,
      newValue: {
        event: 'boss-approve',
        approvalFileUrl: dto.approvalFileUrl,
        items: myPendingItems.map((item) => ({
          itemId: item.id.toString(),
          materialCode: item.material.code,
          buyQty: item.buyQty.toNumber(),
          previousStatus: item.status,
        })),
      },
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
    warehouseScope: string | null,
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
    // Đây là chỗ ghi kho DUY NHẤT trong hệ thống từng thiếu kiểm scope (mọi chỗ ghi kho khác đều
    // gọi assertWarehouseScope trước khi ghi) - kho đích ở trên xác định thẳng từ
    // Material.warehouseId, không khớp gì với phạm vi của người gọi. Thủ kho chỉ được UI cho vào
    // 1 kho vẫn gọi thẳng API nhận hộ hàng cho kho khác được nếu không chặn ở đây.
    if (!item.material.warehouse) {
      throw new NotFoundException(`Kho của vật tư ${item.material.code} không tồn tại`);
    }
    this.assertWarehouseScope(warehouseScope, item.material.warehouse.code, 'nhận hàng vào kho');
    // B4 Đợt 3 (lỗ #3) / L5 (2026-08-26, mở rộng thành pool): cộng hàng về ĐÚNG pool giữ chỗ
    // (StockReservation, tạo ở CuttingProposalsService.approve()) - CHỈ khi đúng vật tư SẮT của
    // CuttingProposal thuộc CÙNG PI với đề xuất mua này. KHÔNG còn soi theo
    // proposal.cuttingProposalId (bị GHI ĐÈ thành phương án duyệt SAU CÙNG mỗi khi merge - nguồn
    // của lỗ #5: hàng mua về cho SKU A bị cộng nhầm vào giữ chỗ của SKU B) - soi thẳng
    // proposal.productionInvoiceId (KHÔNG đổi sau khi tạo, xem PurchaseProposal.productionInvoiceId)
    // rồi tìm CuttingProposalLine của BẤT KỲ phương án nào (trực tiếp neo PI hoặc qua PO thành
    // viên) có cùng vật tư - sai chỗ này sẽ tạo StockReservation MỒ CÔI cho vật tư không phải sắt
    // (xem StockReservationsService.creditPool: pool rỗng thì TỰ TẠO MỚI - ngầm giả định
    // materialId truyền vào luôn là sắt thuộc PI này). Bất biến theo item, kiểm trước khi mở
    // transaction an toàn như check warehouseId ở trên.
    const targetProductionInvoiceId = proposal.productionInvoiceId;
    const isSteelLineOfThisPI =
      targetProductionInvoiceId != null &&
      (await this.prisma.cuttingProposalLine.findFirst({
        where: {
          materialId: item.materialId,
          cuttingProposal: {
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

        // Đọc kèm "status" và tái kiểm NGAY SAU KHI khoá dòng (đính chính 2026-08-29, audit độc
        // lập 28/08 mục Trung bình) - trước đây chỉ kiểm `item.status` trên snapshot đọc TRƯỚC
        // transaction (dòng ~310), không tái kiểm bên trong FOR UPDATE. 2 lượt nhận hàng gần đồng
        // thời cho cùng dòng: lượt đầu đóng PURCHASED xong, lượt sau (đang chờ khoá) vẫn tính tiếp
        // trên `receivedQty` MỚI (đúng, nhờ FOR UPDATE) nhưng không hề biết dòng đã đóng hồ sơ -
        // chỉ bị chặn bởi ngưỡng dung sai chứ không phải bởi trạng thái, vi phạm state machine đã
        // công bố (PURCHASED không còn nhận thêm được).
        const [locked] = await tx.$queryRaw<
          {
            receivedQty: Prisma.Decimal;
            receivedQtyPurchaseUnit: Prisma.Decimal | null;
            status: PurchaseProposalStatus;
          }[]
        >`
          SELECT "receivedQty", "receivedQtyPurchaseUnit", "status" FROM "purchase_proposal_items"
          WHERE "id" = ${item.id} FOR UPDATE
        `;
        if (!locked) {
          throw new NotFoundException(`Item ${itemId} not found on purchase proposal ${id}`);
        }
        if (locked.status !== PurchaseProposalStatus.PURCHASING) {
          throw new ConflictException(
            `Vật tư ${item.material.code} đã bị 1 request khác xử lý trong lúc nhận hàng (đang ở trạng thái ${locked.status}, không còn PURCHASING) - không ghi đè`,
          );
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
          // dto.stockLengthMm: thủ kho thực đo hàng NCC giao khác cỡ so với đề xuất (hiếm).
          // item.stockLengthMm: số ĐÃ CHỐT lúc duyệt phương án cắt (bình thường). 0: vật tư không
          // phân bucket. Đây chỉ là ĐỀ NGHỊ - bucket THẬT do creditPool()/pool giữ chỗ quyết định
          // (nguyên tắc D3, kế hoạch "chiều dài cây sắt" 2026-08-29, Bước 4).
          const preferredStockLengthMm = dto.stockLengthMm ?? item.stockLengthMm ?? 0;

          // B4 Đợt 3 (lỗ #3) / L5 (2026-08-26): hàng vừa về phải "có chủ" ngay - cộng thẳng vào
          // pool giữ chỗ của (PI, vật tư) này, KHÔNG để rơi vào tồn chung. Thiếu bước này thì
          // phương án cắt KHÁC được duyệt xen giữa có thể "giành" mất đúng số hàng vừa mua về cho
          // đơn này, dù sổ đã ghi "đã mua đủ, đã về hàng" (lỗ #3) - hoặc hàng bị cộng vào giữ chỗ
          // của SKU KHÁC trong cùng PI thay vì SKU thật sự thiếu (lỗ #5). CHỈ áp dụng khi ĐÚNG
          // DÒNG này là sắt của phương án cắt nào đó thuộc PI này (xem check đầu hàm) - nhánh khác
          // (VTTP/tiêu hao, kể cả khi nằm CHUNG 1 đề xuất gộp với sắt) không có pool nào để cộng
          // vào, cứ để hàng về rơi vào tồn chung.
          //
          // Gọi creditPool() TRƯỚC postEntry() (đảo thứ tự so với bản gốc) - bucket của bút toán
          // StockLedger PHẢI theo bucket THẬT mà pool quyết định (có thể khác preferredStockLengthMm
          // nếu rơi vào nhánh fallback bucket-0, xem resolvePoolBucket), không phải đoán trước. Đảo
          // thứ tự an toàn vì cả 2 đã nằm trong cùng transaction đã khoá
          // `purchase-proposal-mutate:` + FOR UPDATE dòng item ở trên.
          let stockLengthMm = preferredStockLengthMm;
          if (isSteelLineOfThisPI && targetProductionInvoiceId != null) {
            ({ stockLengthMm } = await this.stockReservationsService.creditPool(tx, {
              productionInvoiceId: targetProductionInvoiceId,
              materialId: item.materialId,
              warehouseId: materialWarehouseId,
              qty: incrementQty,
              preferredStockLengthMm,
            }));
          }

          await this.stockLedgerService.postEntry(
            {
              fromWarehouseId: supplierWarehouse.id,
              toWarehouseId: materialWarehouseId,
              materialId: item.materialId,
              stockLengthMm,
              qty: incrementQty,
              refType: StockLedgerRefType.PURCHASE,
              refId: proposal.id.toString(),
              createdById: userId,
              idempotencyKey,
            },
            tx,
          );
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

  /** Boss/Admin điều phối chung - bỏ qua mọi ràng buộc theo `Material.buyerId` (cả cấp đề xuất lẫn
   *  cấp item), dùng chung ở assertActorMayHandle() và bossApprove(). */
  private isPrivilegedActor(actorRoles: string[]): boolean {
    return actorRoles.includes(BUSINESS_ROLES.BOSS) || actorRoles.includes(DEFAULT_ROLES.ADMIN);
  }

  /**
   * Chặn Purchasing thao tác trên đề xuất của người khác - MIRROR ĐÚNG luật FE
   * (utils/purchasingRouting.ts#canPurchaserSeeProposal), không phát minh luật mới. Trước
   * 2026-08-15 (D.a4-purchaser-scope-not-enforced) việc "gán mua theo từng vật tư" chỉ lọc ở FE
   * (client-side): BE không có một dòng kiểm nào, nên bất kỳ tài khoản PURCHASER nào gọi thẳng API
   * cũng thao tác được trên đề xuất KHÔNG phải của mình - lọc ở FE là tiện dụng, không phải kiểm
   * soát.
   *
   * BOSS/ADMIN qua hết (điều phối chung). Còn lại: phải có ÍT NHẤT 1 dòng vật tư mà
   * `Material.buyerId` là null (chưa gán ai - không "mồ côi" cho tới khi có người nhận, đúng
   * nguyên tắc FE) hoặc chính là actor. KHÔNG đòi actor sở hữu MỌI dòng - đề xuất có thể gộp
   * nhiều vật tư của nhiều người mua khác nhau (Sếp chốt 2026-08-15, PurchaseProposalItem).
   *
   * Đây là cổng VÀO ĐỀ XUẤT. Việc lọc xuống ĐÚNG PHẦN CỦA ACTOR nằm trong chính bossApprove().
   */
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

  /** null = tổng kho (BOSS/ADMIN), thấy mọi kho - không có gì để chặn. */
  private assertWarehouseScope(
    warehouseScope: string | null,
    requiredCode: string,
    actionLabel: string,
  ): void {
    if (warehouseScope && warehouseScope !== requiredCode) {
      throw new ForbiddenException(
        `Caller bị giới hạn ở kho '${warehouseScope}', không được ${actionLabel} '${requiredCode}'`,
      );
    }
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
      approvalFileUrl: item.approvalFileUrl,
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
