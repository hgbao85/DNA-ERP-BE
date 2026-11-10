import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  AuditAction,
  Prisma,
  PrismaClient,
  ProdItemStageType,
  ProductionOrderFloorStage,
  PurchaseProposalStatus,
  StockLedgerRefType,
} from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { MATERIAL_GROUP_SYSTEM_KEYS } from '../../common/constants/material-group-system-keys.constant';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import {
  PurchaseDeadlineItem,
  purchaseDeadlineOf,
  purchaseGroupOf,
} from '../../common/utils/frame-deadline.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { writeAuditLog } from '../../prisma/extensions/audit-log.extension';
import { CloudinaryService } from '../uploads/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { recomputeProposalStatus } from './purchase-proposal-status.util';
import { BossApprovePurchaseProposalDto } from './dto/boss-approve-purchase-proposal.dto';
import {
  PurchaseProposalItemResponseDto,
  PurchaseProposalQuoteResponseDto,
  PurchaseProposalResponseDto,
  PurchaseReceiptLogResponseDto,
} from './dto/purchase-proposal-response.dto';
import { ListPurchaseProposalsQueryDto } from './dto/list-purchase-proposals-query.dto';
import { UpdateApprovalFileDto } from './dto/update-approval-file.dto';
import { UpdateOrderQtyDto } from './dto/update-order-qty.dto';
import { effectiveOrderQty, receiptQtyForPool } from './purchase-order-qty.util';
import { supplierOrderCode } from './supplier-order-code.util';
import { loadLenhDisplayCodes } from '../../common/utils/lenh-code.util';

/// Kho ảo cố định (protected-warehouse-codes.constant.ts) - nguồn của bút toán "nhập hàng mua
/// về" khi Thủ kho xác nhận nhận hàng (xem receiveItem()).
export const SUPPLIER_WAREHOUSE_CODE = 'SUPPLIER';

/// Mọi trạng thái ĐỨNG TRƯỚC PURCHASING - tập item mà bossApprove() được phép đẩy đi tiếp.
/// QUOTING/SUBMITTED/REJECTED là tàn dư của luồng báo giá cũ (gỡ 2026-08-27) và KHÔNG còn sinh
/// mới, nhưng phải nằm trong danh sách này: production còn 36 dòng kẹt ở đó lúc cắt luồng, và màn
/// duyệt của Sếp đã bị gỡ nên bossApprove() là đường ra duy nhất của chúng.
/// Export (2026-09-29, Phase 4 "việc chờ tôi" mục 6.3) - WorkQueueService đếm đúng tập item này
/// cho badge "Theo dõi mua hàng" của Mua hàng, tránh định nghĩa lại NEW/QUOTING lệch nguồn (xem
/// research trước khi code: bảng plan gốc mục 6.3 ghi "NEW/QUOTING" là SAI/THIẾU so với luồng thật).
export const PENDING_APPROVAL_STATUSES: PurchaseProposalStatus[] = [
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
              salesOrder: { select: { orderCode: true } },
            },
          },
        },
      },
      // null khi phương án cắt neo vào 1 lệnh SX; có giá trị khi neo vào PI gộp - xem toResponseDto.
      productionInvoice: {
        include: {
          items: {
            include: {
              mfgProduct: true,
              stages: true,
              salesOrder: { select: { orderCode: true } },
              // deadlineScope: SKU đã Kết thúc không còn quyết định hạn vật tư chung (như Bảng mốc).
              productionOrder: { select: { floorStage: true } },
            },
          },
        },
      },
    },
  },
  // Trực tiếp trên PurchaseProposal (2026-08-22, sourceType=PIECE_MATERIAL_YIELD/
  // CONSUMABLE_MATERIAL) - KHÁC cuttingProposal.productionInvoice ở trên (đó là PI gộp của
  // phương án cắt sắt). Chỉ set khi đề xuất không đi qua CuttingProposal nào cả, dùng làm
  // fallback piCode/poNumber/salesOrderCode/mfgProductCode ở toResponseDto() để Mua hàng vẫn
  // biết đề xuất thuộc PO/PI/SKU nào dù không có phương án cắt gốc - cùng shape với
  // cuttingProposal.productionInvoice.items ở trên (trước đây chỉ select `code`, khiến
  // salesOrderCode/mfgProductCode luôn trống rỗng cho 2 sourceType này dù piCode vẫn hiện đúng).
  productionInvoice: {
    select: {
      code: true,
      deadline: true,
      items: {
        include: {
          mfgProduct: true,
          stages: true,
          salesOrder: { select: { orderCode: true } },
          productionOrder: { select: { floorStage: true } },
        },
      },
    },
  },
} satisfies Prisma.PurchaseProposalInclude;

const ITEM_INCLUDE = {
  material: { include: { warehouse: true, materialGroup: { select: { systemKey: true } } } },
  supplierOrder: { include: { supplier: true } },
  quotes: { include: { supplier: true } },
  receiptLogs: {
    include: {
      receivedBy: true,
      receipt: {
        select: {
          receivedQty: true,
          allocationAdjusted: true,
          overQty: true,
          overReason: true,
          overFileUrls: true,
          supplierSlipUrls: true,
          approvalFileUrls: true,
          receiptSlipUrls: true,
          weighSlipUrls: true,
        },
      },
    },
    orderBy: { receivedAt: 'desc' },
  },
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

/** 1 dòng mua trong 1 lần nhận hàng (Đợt 5d) - xem PurchaseProposalsService.loadReceiveLines(). */
export interface ReceiveLine {
  proposal: PurchaseProposalDetail;
  item: PurchaseProposalItemRow;
  /** Hạn cần vật tư của dòng (cùng hạn màn Mua hàng hiện). */
  deadline: Date | null;
  /** Lúc Giám đốc duyệt lệnh - xếp thứ tự khi trùng hạn (bản v8 8.1). */
  approvedAt: Date | null;
  lenhCode: string;
  warehouseId: bigint;
  warehouseCode: string;
}

/** 1 dòng SKU mà đề xuất phục vụ - đủ trường để tính hạn từng dòng mua (`itemDeadlineOf`). */
type DeadlineScopeItem = PurchaseDeadlineItem & {
  wireMaterialId: string | null;
  cushionMaterialId: string | null;
  /** Lệnh SX của dòng đã Kết thúc. */
  finished: boolean;
};

function pickDeadlineFields(it: {
  materialDeadline: Date | null;
  finishedMaterialDeadline: Date | null;
  stages: { stageType: ProdItemStageType; deadline: Date }[];
  wireMaterialId: bigint | null;
  cushionMaterialId: bigint | null;
}): Omit<DeadlineScopeItem, 'productionInvoice' | 'finished'> {
  return {
    materialDeadline: it.materialDeadline,
    finishedMaterialDeadline: it.finishedMaterialDeadline ?? null,
    stages: it.stages ?? [],
    wireMaterialId: it.wireMaterialId != null ? String(it.wireMaterialId) : null,
    cushionMaterialId: it.cushionMaterialId != null ? String(it.cushionMaterialId) : null,
  };
}

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
  private readonly logger = new Logger(PurchaseProposalsService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedgerService: StockLedgerService,
    private readonly stockReservationsService: StockReservationsService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Phát realtime SAU KHI transaction đã commit (xem RealtimeService). */
  private publishProposalChanged(
    proposalId: bigint,
    action: 'APPROVED' | 'RECEIVED',
    actorId: string | null,
  ): void {
    this.realtime.publishEntityChanged({
      entity: 'PURCHASE_PROPOSAL',
      entityId: proposalId,
      action,
      actorId,
    });
  }

  // ─── Notification (Phase 3a, mục 7.4 changelog 2026-09-25/26) ──────────────────────────────
  // Best-effort NGOÀI transaction - cùng lý do đã ghi ở SkusService.notifySku()/
  // ProductionInvoicesService.notifyPi() (mục 14/15.2/16.2).
  private async notifyPurchaseProposal(
    type:
      | 'PURCHASE_PROPOSAL_APPROVED'
      | 'PURCHASE_PROPOSAL_READY_TO_RECEIVE'
      | 'PURCHASE_PROPOSAL_ITEM_RECEIVED'
      | 'PURCHASE_PROPOSAL_PURCHASED',
    proposalId: bigint,
    params: {
      piCode: string;
      count: number;
      materialCode?: string;
      qty?: number;
      unit?: string;
      warehouseCode?: string;
      warehouseCodes?: string[];
    },
    actorUserId?: string,
  ): Promise<void> {
    try {
      await this.notifications.emit(type, {
        entityId: proposalId.toString(),
        actorId: actorUserId,
        // N-3 (báo cáo 07/10): mỗi người mua duyệt phần vật tư của mình đều phát 1 thông báo y hệt cho QLSX -> gộp
        // theo đề xuất (cùng cơ chế dedupe của PURCHASE_PROPOSAL_CREATED); message không nêu số vật tư vì số này
        // chỉ là phần của người duyệt sau cùng, không phải tổng.
        ...(type === 'PURCHASE_PROPOSAL_APPROVED' || type === 'PURCHASE_PROPOSAL_READY_TO_RECEIVE'
          ? { dedupeKey: `${type}:${proposalId}` }
          : {}),
        params: { ...params },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create purchase-proposal notification (${type}, proposal ${proposalId}): ${(error as Error).message}`,
      );
    }
  }

  /** Đề xuất đã PURCHASED (nhận đủ) -> "hàng mua sắp về" của thủ kho hết giá trị. */
  private async resolveReadyToReceive(proposalId: bigint): Promise<void> {
    try {
      await this.notifications.resolve({
        entityType: 'PURCHASE_PROPOSAL',
        entityId: proposalId.toString(),
        types: ['PURCHASE_PROPOSAL_READY_TO_RECEIVE'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to resolve PURCHASE_PROPOSAL_READY_TO_RECEIVE (proposal ${proposalId}): ${(error as Error).message}`,
      );
    }
  }

  private async resolvePurchaseProposalCreated(proposalId: bigint): Promise<void> {
    try {
      await this.notifications.resolve({
        entityType: 'PURCHASE_PROPOSAL',
        entityId: proposalId.toString(),
        types: ['PURCHASE_PROPOSAL_CREATED'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to resolve PURCHASE_PROPOSAL_CREATED (proposal ${proposalId}): ${(error as Error).message}`,
      );
    }
  }

  /** `piCode` dùng chung nhiều nơi trong service này (bossApprove/receiveItem) - lấy qua đúng
   *  đường `toResponseDto()` đã dùng (cuttingProposal->productionOrder->PI, fallback
   *  row.productionInvoice) thay vì tự dựng lại logic resolve khác đi. */
  private async resolvePiCodeFor(proposalId: bigint): Promise<string> {
    // Truyền MÃ PI thật: link focus=PI_CODE:... cần mã PI; NotificationsService tự đổi sang số LSX khi hiển thị (07/11).
    const dto = await this.findOne(proposalId.toString()).catch(() => null);
    return dto?.piCode ?? `#${proposalId}`;
  }

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
    const dtos = result.data.map((p) => this.toDetailResponseDto(p));
    await this.attachLenhCodes(result.data, dtos);
    return { data: dtos, meta: result.meta };
  }

  async findOne(id: string): Promise<PurchaseProposalResponseDto> {
    const row = await this.findDetailOrThrow(id);
    const dto = this.toDetailResponseDto(row);
    await this.attachLenhCodes([row], [dto]);
    return dto;
  }

  /**
   * Mã lệnh hiển thị (số LSX nhà máy, lệnh gộp nối " + ", lệnh cũ chưa có LSX thì mã PI) - hàm chung
   * của người A (common/utils/lenh-code.util.ts, điểm ghép ①), 1 lần đọc cho cả danh sách. Đề xuất
   * không ghim PI nào (dữ liệu rất cũ) giữ nguyên piCode.
   */
  private async attachLenhCodes(
    rows: { productionInvoiceId: bigint | null }[],
    dtos: PurchaseProposalResponseDto[],
  ): Promise<void> {
    const codes = await loadLenhDisplayCodes(
      this.prisma,
      rows.map((r) => r.productionInvoiceId).filter((id): id is bigint => id != null),
    );
    rows.forEach((row, i) => {
      const code =
        row.productionInvoiceId != null ? codes.get(row.productionInvoiceId.toString()) : undefined;
      dtos[i].lenhCode = code ?? dtos[i].piCode;
    });
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
    // 2026-11-04 (bản v8 mục 4.10): duyệt THEO ĐƠN ĐẶT HÀNG NCC - SupplierOrdersService.approve()
    // truyền đúng các dòng của 1 đơn, chỉ các dòng đó chuyển PURCHASING. Không truyền = mọi dòng
    // chờ duyệt của actor (hành vi cũ; route theo cả đề xuất đã gỡ khỏi controller).
    onlyItemIds?: bigint[],
  ): Promise<PurchaseProposalResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    this.assertActorMayHandle(proposal, actorUserId, actorRoles);
    const isPrivileged = this.isPrivilegedActor(actorRoles);
    const myPendingItems = proposal.items.filter(
      (item) =>
        PENDING_APPROVAL_STATUSES.includes(item.status) &&
        (!onlyItemIds || onlyItemIds.includes(item.id)) &&
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
          orderQty: item.orderQty?.toNumber() ?? null,
          previousStatus: item.status,
        })),
      },
    });

    // Còn vật tư khác (người mua khác phụ trách) của CÙNG đề xuất chưa duyệt thì KHÔNG đóng
    // PURCHASE_PROPOSAL_CREATED - "n vật tư cần mua" của Mua hàng phải phản ánh đúng phần còn lại.
    const stillPending = await this.prisma.purchaseProposalItem.count({
      where: { proposalId: proposal.id, status: { in: PENDING_APPROVAL_STATUSES } },
    });
    if (stillPending === 0) {
      await this.resolvePurchaseProposalCreated(proposal.id);
    }
    const result = await this.findOne(id);
    await this.notifyPurchaseProposal(
      'PURCHASE_PROPOSAL_APPROVED',
      proposal.id,
      { piCode: result.piCode, count: myPendingItems.length },
      actorUserId,
    );
    const warehouseCodes = [
      ...new Set(
        myPendingItems
          .map((item) => item.receiveWarehouseCode ?? item.material.warehouse?.code)
          .filter((code): code is string => !!code),
      ),
    ];
    if (warehouseCodes.length > 0) {
      await this.notifyPurchaseProposal(
        'PURCHASE_PROPOSAL_READY_TO_RECEIVE',
        proposal.id,
        { piCode: result.piCode, count: myPendingItems.length, warehouseCodes },
        actorUserId,
      );
    }
    this.publishProposalChanged(proposal.id, 'APPROVED', actorUserId);

    return result;
  }

  /**
   * THAY hoặc XÓA HẲN `approvalFileUrl` khi lỡ upload nhầm file - 2026-09-11, sửa lại lần 2 cùng
   * ngày (ban đầu chỉ cho thay, không cho xóa vì đọc doc comment schema "BẰNG CHỨNG DUY NHẤT" -
   * nhưng RÀ LẠI: `receiveItem()` bên dưới KHÔNG hề đọc `approvalFileUrl` (chỉ dựa vào
   * `item.status`), nên field này thuần là bằng chứng lịch sử, xóa không phá luồng nghiệp vụ nào).
   * Chỉ đụng đúng `approvalFileUrl` của 1 item - không đổi status/approvedAt/approvedById (item vẫn
   * giữ nguyên trạng thái, chỉ đổi bằng chứng đính kèm). KHÔNG nằm trong AUDITED_MODELS nên ghi tay
   * qua `auditProposalDecision()` (đã dùng lại ở bossApprove() phía trên). Không rõ file cũ là
   * 'image' hay 'raw' (Cloudinary) - `deleteByUrl()` best-effort, gọi cả 2 loại là an toàn
   * (Cloudinary trả "not found" im lặng cho loại sai, không throw).
   *
   * 2026-09-11 lần 3 (theo Sếp Trương Văn Nhân: "cho người nhập được sửa luôn"): mở thêm cho
   * CHÍNH người đã duyệt/đính kèm file này (`item.approvedById === actorUserId`), không chỉ
   * ADMIN/BOSS (`isPrivilegedActor()` sẵn có) - route bỏ `@RequireRole(ADMIN)`, check chuyển vào
   * service vì cần đọc dữ liệu record.
   */
  async updateApprovalFile(
    id: string,
    itemId: string,
    dto: UpdateApprovalFileDto,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<PurchaseProposalItemResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    const bigItemId = parseBigIntId(itemId);
    const item = proposal.items.find((it) => it.id === bigItemId);
    if (!item) {
      throw new NotFoundException(`Không tìm thấy dòng ${itemId} trong đề xuất mua ${id}`);
    }
    if (item.approvedById !== actorUserId && !this.isPrivilegedActor(actorRoles)) {
      throw new ForbiddenException('Chỉ người đã duyệt file này hoặc Admin/Sếp mới sửa được');
    }
    const oldUrl = item.approvalFileUrl;
    // undefined (field bị bỏ qua trong body) coi như "xóa hẳn" - .update() phải luôn nhận 1 giá
    // trị tường minh (null/string), khác Prisma vốn coi undefined = "đừng đụng field này".
    const newUrl = dto.approvalFileUrl ?? null;

    const updated = await this.prisma.purchaseProposalItem.update({
      where: { id: bigItemId },
      data: { approvalFileUrl: newUrl },
      include: ITEM_INCLUDE,
    });

    await this.auditProposalDecision({
      action: AuditAction.UPDATE,
      proposalId: proposal.id,
      oldValue: { itemId: itemId, approvalFileUrl: oldUrl },
      newValue: { itemId: itemId, approvalFileUrl: newUrl },
    });

    if (oldUrl && oldUrl !== newUrl) {
      await this.cloudinaryService.deleteByUrl(oldUrl, 'raw');
      await this.cloudinaryService.deleteByUrl(oldUrl, 'image');
    }

    return this.toItemResponseDto(updated);
  }

  /**
   * Người mua chốt "số mua" cho 1 dòng (2026-11-04, YC7 mục 7.2 - bản yêu cầu v8): được TĂNG so
   * với "cần mua" (buyQty) cho tròn số tối thiểu NCC bán, không được giảm dưới. Không có bước duyệt
   * trong phần mềm - Giám đốc duyệt bằng chữ ký trên phiếu đề xuất (phiếu in số cần, số mua, dòng
   * "Mua dư → nhập tồn"), nên số này KHOÁ khi dòng đã qua "Sếp đã duyệt" (đã tải phiếu ký): muốn
   * đổi phải in phiếu "THAY PHIẾU" và ký lại (V4-2, làm ở bước đơn mua gộp).
   *
   * Quyền: đúng người mua phụ trách vật tư (Material.buyerId, hoặc vật tư chưa gán ai) hoặc
   * Admin/Sếp - cùng luật lọc của bossApprove(). Áp cho mọi loại vật tư kể cả sắt (số cây thêm là
   * mua dư, nhập tồn; bảng cắt của Phôi không đổi), sắt chỉ nhận số cây nguyên.
   */
  async updateOrderQty(
    id: string,
    itemId: string,
    dto: UpdateOrderQtyDto,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<PurchaseProposalItemResponseDto> {
    const proposal = await this.findDetailOrThrow(id);
    const bigItemId = parseBigIntId(itemId);
    const item = proposal.items.find((it) => it.id === bigItemId);
    if (!item) {
      throw new NotFoundException(`Không tìm thấy dòng ${itemId} trong đề xuất mua ${id}`);
    }
    const buyerId = item.material.buyerId;
    if (!this.isPrivilegedActor(actorRoles) && buyerId && buyerId !== actorUserId) {
      throw new ForbiddenException(
        'Vật tư này do người mua khác phụ trách - không sửa số mua được',
      );
    }
    if (!PENDING_APPROVAL_STATUSES.includes(item.status)) {
      throw new ConflictException(
        `Vật tư ${item.material.code} đã có phiếu Giám đốc ký - số mua đã khoá, muốn đổi phải làm phiếu thay thế`,
      );
    }

    const buyQty = item.buyQty.toNumber();
    const requested = dto.orderQty ?? null;
    if (requested !== null && requested < buyQty) {
      throw new BadRequestException(
        `Số mua (${requested}) không được nhỏ hơn số cần mua (${buyQty}) - muốn mua ít hơn thì sửa nhu cầu (định mức hoặc số lượng lệnh)`,
      );
    }
    if (requested !== null && item.stockLengthMm != null && !Number.isInteger(requested)) {
      throw new BadRequestException('Sắt mua theo cây - số mua phải là số nguyên');
    }
    // Bằng đúng số cần mua = không có mua dư, lưu null để lượt tính lại đề xuất sau đó (đổi buyQty)
    // không để lại 1 con số chốt cũ vô nghĩa.
    const newOrderQty = requested !== null && requested > buyQty ? requested : null;
    const oldOrderQty = item.orderQty?.toNumber() ?? null;

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `purchase-proposal-mutate:${proposal.id}`);
      // Tái kiểm trạng thái trong khoá - bossApprove() có thể vừa chạy xong giữa lúc đọc và lúc khoá.
      const { count } = await tx.purchaseProposalItem.updateMany({
        where: { id: item.id, status: { in: PENDING_APPROVAL_STATUSES } },
        data: { orderQty: newOrderQty },
      });
      if (count !== 1) {
        throw new ConflictException(
          'Dòng này vừa được duyệt bởi thao tác khác - số mua đã khoá, tải lại trang để xem tình trạng mới nhất',
        );
      }
      return tx.purchaseProposalItem.findUniqueOrThrow({
        where: { id: item.id },
        include: ITEM_INCLUDE,
      });
    });

    // updateMany không được extension audit tự ghi - ghi tay như bossApprove().
    await this.auditProposalDecision({
      action: AuditAction.UPDATE,
      proposalId: proposal.id,
      oldValue: { itemId, materialCode: item.material.code, buyQty, orderQty: oldOrderQty },
      newValue: { itemId, materialCode: item.material.code, buyQty, orderQty: newOrderQty },
    });
    this.realtime.publishEntityChanged({
      entity: 'PURCHASE_PROPOSAL',
      entityId: proposal.id,
      action: 'UPDATED',
      actorId: actorUserId,
    });

    return this.toItemResponseDto(updated);
  }

  /**
   * Đọc các dòng mua cho 1 lần nhận hàng (Đợt 5d, 2026-11-05 - thay `receiveItem()` nhận từng dòng): kèm hạn cần vật tư
   * (cùng `itemDeadlineOf` với Mua hàng/Bảng mốc), lúc Giám đốc duyệt lệnh (xếp thứ tự khi trùng hạn, bản v8 8.1), mã
   * lệnh hiển thị và kho nhận thật của từng dòng. Đọc NGOÀI transaction - receivedQty/status được đọc lại sau khi khoá
   * trong `applyItemReceipt()`, mọi trường còn lại bất biến theo dòng.
   */
  async loadReceiveLines(itemIds: bigint[]): Promise<ReceiveLine[]> {
    const wanted = new Set(itemIds.map(String));
    const proposals = await this.prisma.purchaseProposal.findMany({
      where: { items: { some: { id: { in: itemIds } } } },
      include: DETAIL_INCLUDE,
    });
    const pairs: {
      proposal: PurchaseProposalDetail;
      item: PurchaseProposalItemRow;
      deadline: Date | null;
    }[] = [];
    for (const proposal of proposals) {
      const scope = this.deadlineScope(proposal);
      for (const item of proposal.items) {
        if (!wanted.has(item.id.toString())) continue;
        pairs.push({ proposal, item, deadline: this.itemDeadlineOf(item, scope).deadline });
      }
    }
    const missing = [...wanted].filter((id) => !pairs.some((p) => p.item.id.toString() === id));
    if (missing.length > 0) {
      throw new NotFoundException(`Không tìm thấy dòng mua ${missing.join(', ')}`);
    }

    const piIds = [
      ...new Set(
        pairs.map((p) => p.proposal.productionInvoiceId).filter((id): id is bigint => id != null),
      ),
    ];
    const decisions =
      piIds.length > 0
        ? await this.prisma.productionInvoiceItem.findMany({
            where: { productionInvoiceId: { in: piIds }, prodApprovalStatus: 'APPROVED' },
            select: { productionInvoiceId: true, decidedAt: true },
          })
        : [];
    const approvedAtByPi = new Map<string, Date>();
    for (const d of decisions) {
      if (!d.decidedAt) continue;
      const key = d.productionInvoiceId?.toString();
      if (!key) continue;
      const cur = approvedAtByPi.get(key);
      if (!cur || d.decidedAt < cur) approvedAtByPi.set(key, d.decidedAt);
    }
    const codes = await loadLenhDisplayCodes(this.prisma, piIds);

    const lines: ReceiveLine[] = [];
    for (const { proposal, item, deadline } of pairs) {
      const target = await this.resolveReceiveWarehouse(item);
      const piId = proposal.productionInvoiceId?.toString();
      const base = this.toResponseDto(proposal);
      lines.push({
        proposal,
        item,
        deadline,
        approvedAt: piId ? (approvedAtByPi.get(piId) ?? null) : null,
        lenhCode: (piId ? codes.get(piId) : undefined) ?? base.piCode,
        warehouseId: target.id,
        warehouseCode: target.code,
      });
    }
    return lines;
  }

  /**
   * Kho nhận hàng = kho đã khai CHO ĐÚNG vật tư này (Material.warehouseId, xem Admin > Vật tư), KHÔNG theo
   * proposal.warehouseCode (Sếp chốt 2026-08-15 mục 2) - TRỪ vật tư đóng gói có `item.receiveWarehouseCode` (kho thành
   * phẩm QLSX đã chọn cho PI, 2026-09-04).
   */
  private async resolveReceiveWarehouse(
    item: PurchaseProposalItemRow,
  ): Promise<{ id: bigint; code: string }> {
    if (item.receiveWarehouseCode) {
      const overrideWarehouse = await this.prisma.warehouse.findUnique({
        where: { code: item.receiveWarehouseCode },
      });
      if (!overrideWarehouse) {
        throw new BadRequestException(
          `Kho thành phẩm "${item.receiveWarehouseCode}" (QLSX đã chọn cho PI) không còn tồn tại - báo Admin kiểm tra lại`,
        );
      }
      return { id: overrideWarehouse.id, code: overrideWarehouse.code };
    }
    if (!item.material.warehouseId || !item.material.warehouse) {
      throw new BadRequestException(
        `Vật tư ${item.material.code} chưa được cấu hình Kho - không thể nhập kho tự động, vào Admin > Vật tư để gán Kho trước`,
      );
    }
    return { id: item.material.warehouseId, code: item.material.warehouse.code };
  }

  /**
   * Ghi PHẦN CHIA của 1 lần nhận hàng vào 1 dòng mua - gọi trong transaction của PurchaseReceiptsService.receive() (đơn
   * gộp nhiều lệnh nhập 1 lần = 1 transaction, gọi hàm này cho từng lệnh có phần chia > 0).
   *
   * Giữ nguyên các chốt của `receiveItem()` cũ:
   *  - Khoá `purchase-proposal-mutate:<id>` (chung mọi method ghi status) + FOR UPDATE dòng rồi đọc lại receivedQty/status
   *    MỚI NHẤT (C3 - 2 lần nhận song song không đè nhau; dòng vừa bị đóng/từ chối thì Conflict, không cộng tiếp).
   *  - Bút toán kho, lịch sử nhận, cộng giữ chỗ, cập nhật dòng - CÙNG 1 transaction.
   *  - Cộng bằng Prisma.Decimal (audit 09/09/2026 - không tích luỹ sai số nhị phân).
   *  - Chỉ phần còn thiếu so với "cần mua" (buyQty) vào giữ chỗ của PI; mua dư / giao vượt về tồn chưa giữ (v8 7.4, 4.12).
   *  - Đóng dòng (PURCHASED) khi nhận đủ SỐ MUA (orderQty), không phải số cần mua.
   */
  async applyItemReceipt(
    tx: PrismaTx,
    input: {
      line: ReceiveLine;
      /** Phần chia cho dòng này, theo đơn vị kho. */
      qty: number;
      /** Ô1/Ô2 của cả lần nhận - lịch sử dòng ghi phần Ô2 tương ứng với phần chia (qty / tổng). */
      unitRateQty: number;
      supplierUnitShare: number;
      receiptId: bigint;
      supplierWarehouseId: bigint;
      userId: string;
      idempotencyKey: string;
    },
  ): Promise<PurchaseProposalItemRow> {
    const { line, qty } = input;
    const { proposal, item } = line;
    await lockBusinessKey(tx, `purchase-proposal-mutate:${proposal.id}`);
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
      throw new NotFoundException(`Không tìm thấy dòng mua ${item.id}`);
    }
    if (locked.status !== PurchaseProposalStatus.PURCHASING) {
      throw new ConflictException(
        `Vật tư ${item.material.code} của lệnh ${line.lenhCode} đã bị 1 thao tác khác xử lý trong lúc nhận hàng ` +
          `(đang ở trạng thái ${locked.status}, không còn chờ nhận) - tải lại màn hình rồi nhập lại`,
      );
    }
    const buyQty = item.buyQty.toNumber();
    const orderQty = effectiveOrderQty(buyQty, item.orderQty?.toNumber());
    const nextReceivedQtyDecimal = locked.receivedQty.plus(qty);
    const nextReceivedQtyPurchaseUnit = (
      locked.receivedQtyPurchaseUnit ?? new Prisma.Decimal(0)
    ).plus(input.supplierUnitShare);

    if (qty > 0) await this.postItemReceipt(tx, input, buyQty, locked.receivedQty.toNumber());
    const nowFullyReceived = nextReceivedQtyDecimal.toNumber() >= orderQty;
    const saved = await tx.purchaseProposalItem.update({
      where: { id: item.id },
      data: {
        receivedQty: nextReceivedQtyDecimal,
        receivedQtyPurchaseUnit: nextReceivedQtyPurchaseUnit,
        ...(nowFullyReceived
          ? { status: PurchaseProposalStatus.PURCHASED, purchasedAt: new Date() }
          : {}),
      },
      include: ITEM_INCLUDE,
    });
    await recomputeProposalStatus(tx, proposal.id);
    return saved;
  }

  /** Bút toán kho + lịch sử nhận + cộng giữ chỗ cho phần chia `qty` > 0 (trong transaction của applyItemReceipt). */
  private async postItemReceipt(
    tx: PrismaTx,
    input: {
      line: ReceiveLine;
      qty: number;
      unitRateQty: number;
      supplierUnitShare: number;
      receiptId: bigint;
      supplierWarehouseId: bigint;
      userId: string;
      idempotencyKey: string;
    },
    buyQty: number,
    receivedBefore: number,
  ): Promise<void> {
    const { line, qty } = input;
    const { proposal, item } = line;
    await this.stockLedgerService.postEntry(
      {
        fromWarehouseId: input.supplierWarehouseId,
        toWarehouseId: line.warehouseId,
        materialId: item.materialId,
        qty,
        refType: StockLedgerRefType.PURCHASE,
        refId: proposal.id.toString(),
        createdById: input.userId,
        // 1 lần nhận có thể ghi nhiều bút toán (1/lệnh) - khoá chống trùng riêng từng dòng.
        idempotencyKey: `${input.idempotencyKey}:${item.id}`,
        // Chiều dài cây đã chốt lúc duyệt phương án cắt (sửa 2026-09-05) / quy cách riêng của dòng mua (nệm).
        stockLengthMm: item.stockLengthMm ?? 0,
        spec: item.spec ?? '',
      },
      tx,
    );
    await tx.purchaseReceiptLog.create({
      data: {
        itemId: item.id,
        receiptId: input.receiptId,
        unitRateQty: input.unitRateQty,
        supplierUnitQty: input.supplierUnitShare,
        receivedQty: qty,
        receivedById: input.userId,
      },
    });
    // Hàng vừa về "có chủ" ngay - cộng thẳng vào pool giữ chỗ của (PI, vật tư) (B4 Đợt 3 / L5 / đính chính 2026-09-23).
    const poolQty = receiptQtyForPool(buyQty, receivedBefore, qty);
    if (proposal.productionInvoiceId != null && poolQty > 0) {
      await this.stockReservationsService.creditPool(tx, {
        productionInvoiceId: proposal.productionInvoiceId,
        materialId: item.materialId,
        warehouseId: line.warehouseId,
        qty: poolQty,
        spec: item.spec ?? '',
        stockLengthMm: item.stockLengthMm ?? 0,
      });
    }
  }

  /** Thông báo + realtime sau khi 1 lần nhận hàng đã commit (best-effort, ngoài transaction). */
  async afterItemReceipt(
    line: ReceiveLine,
    qty: number,
    saved: PurchaseProposalItemRow,
    userId: string,
  ): Promise<void> {
    const { proposal, item } = line;
    const piCode = await this.resolvePiCodeFor(proposal.id);
    await this.notifyPurchaseProposal(
      'PURCHASE_PROPOSAL_ITEM_RECEIVED',
      proposal.id,
      {
        piCode,
        count: 1,
        materialCode: item.material.code,
        qty,
        unit: item.material.unit,
        warehouseCode: line.warehouseCode,
      },
      userId,
    );
    if (saved.status === PurchaseProposalStatus.PURCHASED) {
      const refreshed = await this.prisma.purchaseProposal.findUnique({
        where: { id: proposal.id },
        select: { status: true },
      });
      if (refreshed?.status === PurchaseProposalStatus.PURCHASED) {
        await this.resolveReadyToReceive(proposal.id);
        await this.notifyPurchaseProposal(
          'PURCHASE_PROPOSAL_PURCHASED',
          proposal.id,
          { piCode, count: proposal.items.length },
          userId,
        );
      }
    }
    this.publishProposalChanged(proposal.id, 'RECEIVED', userId);
  }

  /** Dòng đã đổi sau 1 lần nhận - trả cho FE (cùng mapping với danh sách). */
  itemResponse(
    saved: PurchaseProposalItemRow,
    deadline: Date | null,
  ): PurchaseProposalItemResponseDto {
    return this.toItemResponseDto(saved, deadline);
  }

  /** Boss/Admin điều phối chung - bỏ qua mọi ràng buộc theo `Material.buyerId` (cả cấp đề xuất lẫn
   *  cấp item), dùng chung ở assertActorMayHandle() và bossApprove(). */
  private isPrivilegedActor(actorRoles: string[]): boolean {
    return actorRoles.includes(BUSINESS_ROLES.BOSS) || actorRoles.includes(DEFAULT_ROLES.ADMIN);
  }

  /** null = tổng kho (BOSS/ADMIN) - thấy mọi kho, không có gì để chặn. Khác null: phải khớp ĐÚNG
   *  kho vật lý đích của lần nhận hàng này - cùng idiom MaterialIssuesService/
   *  WarehouseTransfersService.assertWarehouseScope(). */
  private assertWarehouseScope(warehouseScope: string | null, targetWarehouseCode: string): void {
    if (warehouseScope && warehouseScope !== targetWarehouseCode) {
      throw new ForbiddenException(
        `Bạn bị giới hạn ở kho '${warehouseScope}', không được nhận hàng vào kho '${targetWarehouseCode}'`,
      );
    }
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

  private async findDetailOrThrow(id: string): Promise<PurchaseProposalDetail> {
    const bigId = parseBigIntId(id);
    const proposal = await this.prisma.purchaseProposal.findUnique({
      where: { id: bigId },
      include: DETAIL_INCLUDE,
    });
    if (!proposal) {
      throw new NotFoundException(`Không tìm thấy đề xuất mua ${id}`);
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
    // (ProductionInvoiceItem.salesOrderId). Nhánh PI gộp/PI trực tiếp (sourceType=
    // PIECE_MATERIAL_YIELD/CONSUMABLE_MATERIAL, xem comment LIST_INCLUDE.productionInvoice):
    // các SKU trong PI có thể thuộc NHIỀU đơn Sales khác nhau - gộp danh sách mã duy nhất, không
    // có "1 mã đại diện" nào đúng cả. null khi SKU không gắn đơn Sales nào (tạo tay, xem
    // PlanForm.customerName).
    const piItemsForFallback = mergedPi?.items ?? row.productionInvoice?.items ?? [];
    const salesOrderCode = productionOrder
      ? (productionOrder.productionInvoiceItem.salesOrder?.orderCode ?? null)
      : piItemsForFallback
          .map((it) => it.salesOrder?.orderCode)
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
        piItemsForFallback.map((it) => it.mfgProduct.factoryCode).join(', '),
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
    const scope = this.deadlineScope(row);
    const lines = row.items.map((item) => this.itemDeadlineOf(item, scope));
    dto.items = row.items.map((item, i) => this.toItemResponseDto(item, lines[i].deadline));
    // Hạn cấp đề xuất = dòng gấp nhất, bỏ dòng chỉ thuộc SKU đã Kết thúc (dây/nệm riêng của nó - test thật vòng 3: kéo hạn đầu
    // đề xuất và đầu "Nhập kho" về hạn cũ của SKU đã xong). Đề xuất tự tính theo PI trước đây luôn "chưa có hạn" (phần D của
    // mục 32.5); đề xuất sắt giữ nguyên giá trị cũ (cùng chuỗi frameDeadlineOf).
    const live = lines.filter((l) => !l.finishedOnly);
    const earliest = (live.length > 0 ? live : lines)
      .map((l) => l.deadline)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (earliest) dto.deadline = earliest;
    return dto;
  }

  /** Các dòng SKU mà đề xuất phục vụ: 1 lệnh SX, PI gộp của phương án cắt, hoặc PI trực tiếp (đề xuất tự tính theo PI). */
  private deadlineScope(row: PurchaseProposalDetail): DeadlineScopeItem[] {
    const order = row.cuttingProposal?.productionOrder;
    if (order) {
      const it = order.productionInvoiceItem;
      return [
        { ...pickDeadlineFields(it), productionInvoice: it.productionInvoice, finished: false },
      ];
    }
    const pi = row.cuttingProposal?.productionInvoice ?? row.productionInvoice;
    if (!pi) return [];
    // `?? []` như các chỗ fallback khác trong toResponseDto (dữ liệu cũ / mock thiếu items).
    const items = pi.items ?? [];
    const approved = items.filter((it) => it.prodApprovalStatus === 'APPROVED');
    return (approved.length > 0 ? approved : items).map((it) => ({
      ...pickDeadlineFields(it),
      productionInvoice: { deadline: pi.deadline },
      finished: it.productionOrder?.floorStage === ProductionOrderFloorStage.FINISHED,
    }));
  }

  /**
   * Hạn riêng 1 dòng mua - cùng `purchaseDeadlineOf` với Bảng mốc. Dây/nệm là lựa chọn RIÊNG của SKU (như `scopePurchasingRows`
   * FE / Bảng mốc): chỉ tính hạn các SKU đã chọn nó; vật tư chung thì SKU gấp nhất CÒN CHẠY quyết định (SKU đã Kết thúc không
   * có trên Bảng mốc - tính nó thì màn mua ghi trễ trong khi Bảng mốc ghi còn hạn, review 32.27 N3).
   */
  private itemDeadlineOf(
    item: PurchaseProposalItemRow,
    scope: DeadlineScopeItem[],
  ): { deadline: Date | null; finishedOnly: boolean } {
    const materialId = String(item.materialId);
    const owners = scope.filter(
      (s) => s.wireMaterialId === materialId || s.cushionMaterialId === materialId,
    );
    const pool = owners.length > 0 ? owners : scope;
    const running = pool.filter((s) => !s.finished);
    const group = purchaseGroupOf(item.material.detailKind);
    const deadline =
      (running.length > 0 ? running : pool)
        .map((s) => purchaseDeadlineOf(s, group))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return { deadline, finishedOnly: pool.length > 0 && running.length === 0 };
  }

  private toItemResponseDto(
    item: PurchaseProposalItemRow,
    deadline: Date | null = null,
  ): PurchaseProposalItemResponseDto {
    return new PurchaseProposalItemResponseDto({
      id: item.id.toString(),
      materialId: item.materialId.toString(),
      materialCode: item.material.code,
      materialName: item.material.name,
      // Nệm: quy cách riêng của dòng mua (theo SKU, PurchaseProposalItem.spec) thay cho Material.spec.
      materialSpec: item.spec ?? item.material.spec ?? null,
      unit: item.material.unit,
      purchaseWastePercentage: item.material.purchaseWastePercentage?.toNumber() ?? null,
      // Đợt 5d: nhận sắt bắt buộc thêm ảnh phiếu cân xe (bản v8 4.6).
      isSteel: item.material.materialGroup?.systemKey === MATERIAL_GROUP_SYSTEM_KEYS.STEEL_BAR,
      // Kho nhận hàng THẬT của riêng dòng này - ưu tiên item.receiveWarehouseCode (vật tư đóng
      // gói, ghi đè về kho thành phẩm QLSX đã chọn, 2026-09-04), rơi về Material.warehouseId nếu
      // không có override. Nguồn xác thực cho receiveItem(), KHÔNG phải
      // PurchaseProposalResponseDto.warehouseCode cấp đề xuất (nay chỉ tóm tắt).
      warehouseCode: item.receiveWarehouseCode ?? item.material.warehouse?.code ?? null,
      actualStock: item.actualStock.toNumber(),
      buyQty: item.buyQty.toNumber(),
      orderQty: item.orderQty?.toNumber() ?? null,
      purchaseQty: effectiveOrderQty(item.buyQty.toNumber(), item.orderQty?.toNumber()),
      supplierOrderId: item.supplierOrderId?.toString() ?? null,
      supplierOrderCode: item.supplierOrder
        ? supplierOrderCode(item.supplierOrder.seq, item.supplierOrder.year)
        : null,
      supplierOrderStatus: item.supplierOrder?.status ?? null,
      supplierOrderApprovalFileUrl: item.supplierOrder?.approvalFileUrl ?? null,
      supplierName: item.supplierOrder?.supplier.name ?? null,
      stockLengthMm: item.stockLengthMm,
      deadline,
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
      receiptLogs: item.receiptLogs.map(
        (r) =>
          new PurchaseReceiptLogResponseDto({
            id: r.id.toString(),
            unitRateQty: r.unitRateQty.toNumber(),
            supplierUnitQty: r.supplierUnitQty.toNumber(),
            receivedQty: r.receivedQty.toNumber(),
            receiptFileUrl: r.receiptFileUrl,
            receivedByName: r.receivedBy
              ? `${r.receivedBy.firstName} ${r.receivedBy.lastName}`.trim()
              : null,
            receivedAt: r.receivedAt,
            receiptId: r.receiptId?.toString() ?? null,
            receiptTotalQty: r.receipt?.receivedQty.toNumber() ?? null,
            allocationAdjusted: r.receipt?.allocationAdjusted ?? false,
            supplierSlipUrls: r.receipt?.supplierSlipUrls ?? [],
            approvalFileUrls: r.receipt?.approvalFileUrls ?? [],
            receiptSlipUrls: r.receipt?.receiptSlipUrls ?? [],
            weighSlipUrls: r.receipt?.weighSlipUrls ?? [],
            overQty: r.receipt?.overQty.toNumber() ?? 0,
            overReason: r.receipt?.overReason ?? null,
            overFileUrls: r.receipt?.overFileUrls ?? [],
          }),
      ),
    });
  }
}
