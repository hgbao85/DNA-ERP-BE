import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, ReservationStatus, StockReservationRefType } from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { frameDeadlineOf } from '../../common/utils/frame-deadline.util';

export interface ReserveInput {
  warehouseId: bigint;
  materialId: bigint;
  /** Cỡ cây sắt (mm), mặc định 0 - xem kế hoạch "chiều dài cây sắt" 2026-08-29. */
  stockLengthMm?: number;
  qty: number;
  refType: StockReservationRefType;
  refId: string;
  /// PI thật của nguồn giữ chỗ - xem doc comment field cùng tên trên model StockReservation
  /// (L5, 2026-08-26). undefined khi nguồn không neo PI nào.
  productionInvoiceId?: bigint;
  note?: string;
  createdById?: string;
}

interface PoolRow {
  id: bigint;
  refType: StockReservationRefType;
  refId: string;
  warehouseId: bigint;
  quantity: Prisma.Decimal;
  consumedQty: Prisma.Decimal;
}

/**
 * Đặt giữ tồn kho ("đã hứa, chưa lấy đi") - tách khỏi StockLedger (đó là "đã lấy đi thật"). Xem
 * docs/changelog-2026-08-15-nhip-2-gop-sku-va-review-auto-duyet.md mục 13 (thiết kế B4).
 *
 * Trạng thái (2026-08-18): CuttingProposalsService.approve() gọi reserve() thay vì trừ tồn thật
 * (Đợt 2) - available qua getAvailableQty() giờ là nguồn thật quyết định consumeQty/buyQty.
 * SteelIssuesService.create() tiêu giữ chỗ (consumedQty += ...) khi Phôi thực xuất, mới là nơi
 * trừ tồn thật (StockLedger). CHƯA làm: release() khi CuttingProposal bị supersede/huỷ (Đợt 3,
 * lỗ #4) - giữ chỗ của phương án bị thay thế hiện vẫn nằm ACTIVE mãi.
 *
 * L5 (2026-08-26): 1 PI có thể có NHIỀU dòng giữ chỗ CUTTING_PROPOSAL cho CÙNG 1 vật tư - mỗi SKU
 * (approveItem riêng lẻ) tự tạo 1 dòng của riêng nó lúc duyệt (reserve(), KHÔNG đổi - vẫn 1
 * dòng/1 cuttingProposalId, tránh mọi rủi ro idempotency khi nhiều nguồn cùng ghi 1 dòng). Nhưng
 * "gộp vào ĐÚNG 1 PurchaseProposal/PI" (CuttingProposalsService.approve()) đã xoá mất ranh giới
 * SKU ở TẦNG MUA HÀNG (buyQty là 1 con số cộng dồn của cả PI, không tách lại được theo SKU) - nên
 * hàng mua về/Phôi xuất PHẢI thao tác trên CẢ POOL (mọi dòng CUTTING_PROPOSAL cùng
 * productionInvoiceId+materialId), không phải 1 dòng cố định như trước (bug cũ: credit luôn vào
 * dòng của SKU duyệt SAU CÙNG, dòng của SKU duyệt trước không bao giờ được cộng thêm - Phôi xuất
 * cho SKU đó tới đâu cũng báo thiếu dù hàng đã về kho). loadPool()/creditPool()/drainPool() thay
 * cho topUpFromReceipt() (đã gỡ) + phần lookup 1-dòng cũ trong SteelIssuesService.
 */
@Injectable()
export class StockReservationsService {
  private readonly logger = new Logger(StockReservationsService.name);

  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  /** Hậu tố `:len:N` CHỈ thêm khi khác 0 - mọi key cũ (mọi dữ liệu lịch sử, mọi vật tư không phân
   *  bucket) giữ nguyên TỪNG BYTE, không phá idempotency dữ liệu đã có (kế hoạch "chiều dài cây
   *  sắt" 2026-08-29, Bước 3). */
  private buildIdempotencyKey(
    refType: StockReservationRefType,
    refId: string,
    materialId: bigint,
    stockLengthMm: number,
  ): string {
    const base = `${refType}:${refId}:material:${materialId}`;
    return stockLengthMm === 0 ? base : `${base}:len:${stockLengthMm}`;
  }

  /**
   * `tx` bắt buộc khi caller đã khoá `stock_quant ... FOR UPDATE` trong cùng transaction (đúng
   * pattern StockLedgerService.postEntry `tx`) - nếu không, khoảng hở giữa lúc tính available và
   * lúc ghi giữ chỗ vẫn cho 2 caller cùng đọc một số dư.
   *
   * ⚠️ PHỤ THUỘC NGẦM vào luật L7 (CuttingProposalsService.findConflictingStockLengthReason()):
   * hàm này KHÔNG so khớp stockLengthMm giữa 2 lần gọi cùng idempotencyKey - nếu 1 (refType, refId,
   * materialId) chốt 2 cỡ cây khác nhau ở 2 thời điểm, lần gọi sau sẽ ÂM THẦM trả về dòng CŨ (bucket
   * cũ, không phải bucket lần gọi này) thay vì báo lỗi. AN TOÀN CHỈ VÌ L7 đảm bảo mỗi (PI, vật tư)
   * luôn đúng 1 cỡ cây xuyên suốt vòng đời của nó - KHÔNG được nới lỏng L7 mà không sửa lại hàm này
   * để phát hiện tham số lệch và ném lỗi thay vì resolve-or-return (kế hoạch "chiều dài cây sắt"
   * 2026-08-29, quyết định thiết kế #5).
   */
  async reserve(
    input: ReserveInput,
    tx?: PrismaTx,
  ): Promise<{ id: bigint; quantity: Prisma.Decimal }> {
    const db = tx ?? this.prisma;
    if (!(input.qty > 0)) {
      throw new BadRequestException('qty giữ chỗ phải lớn hơn 0');
    }
    const stockLengthMm = input.stockLengthMm ?? 0;

    // Idempotent theo (refType, refId, materialId[, stockLengthMm]) - 1 nguồn chỉ giữ chỗ đúng 1
    // dòng cho 1 vật tư (1 bucket), gọi lại (retry mất mạng, double-click) trả về dòng đã tạo thay
    // vì cộng dồn sai.
    const idempotencyKey = this.buildIdempotencyKey(
      input.refType,
      input.refId,
      input.materialId,
      stockLengthMm,
    );
    const existing = await db.stockReservation.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return { id: existing.id, quantity: existing.quantity };
    }

    const created = await db.stockReservation.create({
      data: {
        warehouseId: input.warehouseId,
        materialId: input.materialId,
        stockLengthMm,
        quantity: input.qty,
        refType: input.refType,
        refId: input.refId,
        productionInvoiceId: input.productionInvoiceId,
        note: input.note,
        createdById: input.createdById,
        idempotencyKey,
      },
    });
    return { id: created.id, quantity: created.quantity };
  }

  /**
   * Mọi dòng giữ chỗ ACTIVE của 1 (PI, vật tư) - "pool" mà creditPool()/drainPool() thao tác lên,
   * sắp theo hạn SKU sở hữu từng dòng TĂNG DẦN (SKU gấp nhất được ưu tiên trước, cả khi credit
   * lẫn khi drain - Sếp chốt 2026-08-26, L5). Chỉ dòng refType=CUTTING_PROPOSAL mới có 1 SKU cụ
   * thể để tính hạn; dòng PRODUCTION_INVOICE (fallback của creditPool khi pool rỗng) không neo
   * SKU nào - luôn xếp CUỐI (Infinity), và trong thực tế cũng luôn là dòng DUY NHẤT của pool đó
   * (nếu không thì đã có dòng CUTTING_PROPOSAL để credit trước rồi).
   *
   * 1 PI chỉ có NHIỀU dòng CUTTING_PROPOSAL cùng vật tư khi các SKU được duyệt RIÊNG LẺ
   * (approveItem, mỗi SKU 1 CuttingProposal neo productionOrderId) - phương án neo thẳng PI (đợt
   * gộp, approveBatch) luôn là dòng DUY NHẤT của pool nó thuộc về (2 luồng duyệt loại trừ nhau
   * qua khoá prodApprovalStatus=WAITING_BOSS, xem rà soát L2 2026-08-26) nên không cần tính hạn
   * cho ca đó.
   */
  private async loadPool(
    tx: PrismaTx,
    productionInvoiceId: bigint,
    materialId: bigint,
    stockLengthMm: number,
  ): Promise<PoolRow[]> {
    const rows = await tx.stockReservation.findMany({
      where: { productionInvoiceId, materialId, stockLengthMm, status: ReservationStatus.ACTIVE },
      select: {
        id: true,
        refType: true,
        refId: true,
        warehouseId: true,
        quantity: true,
        consumedQty: true,
      },
    });
    if (rows.length <= 1) return rows;

    const cuttingProposalIds = rows
      .filter((r) => r.refType === StockReservationRefType.CUTTING_PROPOSAL)
      .map((r) => BigInt(r.refId));
    const proposals =
      cuttingProposalIds.length > 0
        ? await tx.cuttingProposal.findMany({
            where: { id: { in: cuttingProposalIds }, productionOrderId: { not: null } },
            select: {
              id: true,
              productionOrder: {
                select: {
                  productionInvoiceItem: {
                    select: {
                      materialDeadline: true,
                      stages: { select: { stageType: true, deadline: true } },
                      productionInvoice: { select: { deadline: true } },
                    },
                  },
                },
              },
            },
          })
        : [];
    const deadlineByProposalId = new Map(
      proposals
        .filter(
          (p): p is typeof p & { productionOrder: NonNullable<(typeof p)['productionOrder']> } =>
            p.productionOrder != null,
        )
        .map((p) => [p.id.toString(), frameDeadlineOf(p.productionOrder.productionInvoiceItem)]),
    );
    const priorityOf = (r: PoolRow): number => {
      if (r.refType !== StockReservationRefType.CUTTING_PROPOSAL) return Number.POSITIVE_INFINITY;
      const deadline = deadlineByProposalId.get(r.refId);
      return deadline ? deadline.getTime() : Number.POSITIVE_INFINITY;
    };
    return [...rows].sort((a, b) => priorityOf(a) - priorityOf(b));
  }

  /**
   * Quyết định BUCKET THẬT cho pool (PI, vật tư) - caller chỉ "đề nghị" (preferredStockLengthMm),
   * hàm này chốt bucket thật dùng chung cho cả creditPool()/drainPool() (quyết định thiết kế #3,
   * kế hoạch "chiều dài cây sắt" 2026-08-29): có pool ở bucket đề nghị -> dùng nó; pool đề nghị
   * rỗng nhưng pool bucket 0 còn tồn tại (case PI dở dang bắc qua migration, giữ chỗ tạo TRƯỚC khi
   * phân bucket) -> dùng bucket 0 + log cảnh báo; cả hai rỗng -> trả nguyên bucket đề nghị kèm pool
   * rỗng, để caller tự quyết (creditPool tạo dòng mới, drainPool ném ConflictException).
   */
  private async resolvePoolBucket(
    tx: PrismaTx,
    productionInvoiceId: bigint,
    materialId: bigint,
    preferredStockLengthMm: number,
  ): Promise<{ stockLengthMm: number; pool: PoolRow[] }> {
    const preferredPool = await this.loadPool(
      tx,
      productionInvoiceId,
      materialId,
      preferredStockLengthMm,
    );
    if (preferredPool.length > 0) {
      return { stockLengthMm: preferredStockLengthMm, pool: preferredPool };
    }
    if (preferredStockLengthMm !== 0) {
      const fallbackPool = await this.loadPool(tx, productionInvoiceId, materialId, 0);
      if (fallbackPool.length > 0) {
        this.logger.warn(
          `Pool giữ chỗ bucket ${preferredStockLengthMm}mm rỗng cho PI ${productionInvoiceId} + vật tư ${materialId} - dùng tạm bucket 0 (dữ liệu giữ chỗ cũ trước khi phân bucket cỡ cây)`,
        );
        return { stockLengthMm: 0, pool: fallbackPool };
      }
    }
    return { stockLengthMm: preferredStockLengthMm, pool: [] };
  }

  /**
   * Hàng mua về "có chủ" (B4 Đợt 3, mục 13.4 lỗ #3 changelog, mở rộng thành pool ở L5 2026-08-26):
   * PurchaseProposalsService.receiveItem() gọi khi nhận hàng cho phần `buyQty` (phần approve()
   * KHÔNG giữ chỗ được vì lúc đó tồn chưa có) - cộng vào ĐÚNG pool của (PI, vật tư), KHÔNG còn cố
   * đoán 1 cuttingProposalId cụ thể (PurchaseProposal.cuttingProposalId bị GHI ĐÈ thành phương án
   * duyệt SAU CÙNG mỗi khi merge, xem CuttingProposalsService.approve() - nguồn cũ của lỗ #5).
   *
   * `tx` bắt buộc - caller (receiveItem) đã khoá dòng item liên quan FOR UPDATE trong cùng
   * transaction, khoá thêm ở đây (FOR UPDATE trên dòng giữ chỗ được chọn) để an toàn nếu sau này
   * có caller khác gọi hàm này mà không đi qua khoá đó.
   *
   * Trả về `stockLengthMm` THẬT đã dùng (có thể khác `preferredStockLengthMm`, xem
   * resolvePoolBucket) - caller PHẢI dùng giá trị trả về này (không phải giá trị đề nghị) để ghi
   * bút toán StockLedger tương ứng (kế hoạch "chiều dài cây sắt" 2026-08-29, quyết định #3).
   */
  async creditPool(
    tx: PrismaTx,
    input: {
      productionInvoiceId: bigint;
      materialId: bigint;
      warehouseId: bigint;
      qty: number;
      preferredStockLengthMm: number;
    },
  ): Promise<{ stockLengthMm: number }> {
    if (!(input.qty > 0)) {
      throw new BadRequestException('qty cộng thêm giữ chỗ phải lớn hơn 0');
    }
    const { stockLengthMm, pool } = await this.resolvePoolBucket(
      tx,
      input.productionInvoiceId,
      input.materialId,
      input.preferredStockLengthMm,
    );
    // Pool rỗng - approve() chưa từng giữ chỗ gì cho (PI, vật tư, bucket) này (buyQty = 100% nhu
    // cầu ngay từ đầu, mọi dòng nguồn có thể cũng đã bị releaseByRef() supersede/huỷ hết) - tạo 1
    // dòng "thuộc về cả PI" thay vì thuộc về 1 cuttingProposalId cụ thể (case hiếm, PI chắc chắn
    // còn sống vì receiveItem() chỉ chạy được khi PurchaseProposal đang PURCHASING).
    if (pool.length === 0) {
      await tx.stockReservation.create({
        data: {
          warehouseId: input.warehouseId,
          materialId: input.materialId,
          stockLengthMm,
          productionInvoiceId: input.productionInvoiceId,
          quantity: input.qty,
          refType: StockReservationRefType.PRODUCTION_INVOICE,
          refId: input.productionInvoiceId.toString(),
          idempotencyKey: this.buildIdempotencyKey(
            StockReservationRefType.PRODUCTION_INVOICE,
            input.productionInvoiceId.toString(),
            input.materialId,
            stockLengthMm,
          ),
        },
      });
      return { stockLengthMm };
    }
    // Credit vào dòng ưu tiên CAO NHẤT (hạn gần nhất, xem loadPool) - KHÔNG quan trọng dòng nào
    // cụ thể nhận credit vì drainPool() sau này rút theo TỔNG của cả pool, không theo từng dòng
    // riêng; chọn 1 quy tắc xác định (thay vì tuỳ tiện) chỉ để dễ audit/debug khi cần soi dữ liệu.
    const target = pool[0];
    await tx.$queryRaw`SELECT "id" FROM "stock_reservations" WHERE "id" = ${target.id} FOR UPDATE`;
    await tx.stockReservation.update({
      where: { id: target.id },
      data: { quantity: { increment: input.qty } },
    });
    return { stockLengthMm };
  }

  /**
   * Phôi thực xuất `qty` cây cho (PI, vật tư) - rút từ pool giữ chỗ theo thứ tự ưu tiên (SKU hạn
   * gần nhất trước, xem loadPool), có thể rút vắt qua NHIỀU dòng nếu dòng ưu tiên cao nhất không
   * đủ (L5, 2026-08-26 - thay cho lookup 1-dòng cố định cũ ở SteelIssuesService). Trả về
   * warehouseId để caller tự làm bút toán StockLedger (hàm này chỉ lo phần giữ chỗ, không đụng
   * StockLedgerService - tránh phụ thuộc chéo).
   *
   * KHOÁ TỪNG DÒNG rồi ĐỌC LẠI (FOR UPDATE trả thẳng quantity/consumedQty MỚI NHẤT) trước khi
   * quyết định `take` - KHÔNG dùng số đã đọc ở loadPool() (loadPool không khoá, chỉ dùng để biết
   * TẬP dòng nào thuộc pool và THỨ TỰ ưu tiên). Sai chỗ này là tự tạo lại đúng race mà bản gốc
   * (1 dòng, `SELECT...FOR UPDATE` khoá-và-đọc trong 1 bước) chưa từng có: 2 lượt xuất cùng
   * (PI, vật tư) chạy gần nhau đều tính `take` từ số CŨ, lượt xuất SAU commit sau có thể ghi
   * consumedQty vượt quá quantity thật của dòng đó dù guard tổng cả pool ở dưới cũng đã qua (guard
   * đó tính từ CÙNG 1 snapshot cũ, không cứu được). Khoá HẾT các dòng liên quan TRƯỚC khi tính
   * bất kỳ `take` nào thì lượt xuất thứ 2 phải xếp hàng chờ lượt đầu commit xong mới đọc được số
   * đã cập nhật - đúng idiom CuttingProposalsService.approve() dùng cho FOR UPDATE stock_quant.
   *
   * Trả về `stockLengthMm` THẬT đã rút (có thể khác `preferredStockLengthMm`, xem
   * resolvePoolBucket) CÙNG `warehouseId` - caller PHẢI dùng bucket trả về này để ghi bút toán
   * StockLedger tương ứng, KHÔNG dùng giá trị Phôi tự khai (kế hoạch "chiều dài cây sắt"
   * 2026-08-29, quyết định #3 - đây chính là chỗ chặn Phôi khai xuất sai cỡ so với pool giữ chỗ).
   */
  async drainPool(
    tx: PrismaTx,
    input: {
      productionInvoiceId: bigint;
      materialId: bigint;
      qty: number;
      preferredStockLengthMm: number;
    },
  ): Promise<{ warehouseId: bigint; stockLengthMm: number }> {
    if (!(input.qty > 0)) {
      throw new BadRequestException('qty xuất phải lớn hơn 0');
    }
    const { stockLengthMm, pool } = await this.resolvePoolBucket(
      tx,
      input.productionInvoiceId,
      input.materialId,
      input.preferredStockLengthMm,
    );
    if (pool.length === 0) {
      throw new ConflictException(
        `Không tìm thấy giữ chỗ tồn kho cho vật tư ${input.materialId} cỡ ${input.preferredStockLengthMm}mm của PI ${input.productionInvoiceId} - chưa từng giữ chỗ (tồn + hàng mua chưa đủ), hoặc mọi phương án cắt liên quan đã bị supersede/huỷ, hoặc khai sai cỡ cây so với phương án đã duyệt`,
      );
    }

    // Khoá TỪNG dòng theo ĐÚNG thứ tự ưu tiên của loadPool() (nhất quán giữa các lượt gọi đồng
    // thời - khoá lệch thứ tự là công thức deadlock kinh điển) rồi đọc lại quantity/consumedQty
    // MỚI NHẤT ngay trong câu FOR UPDATE - xem docstring.
    const lockedRows: { id: bigint; warehouseId: bigint; remaining: number }[] = [];
    for (const row of pool) {
      const [locked] = await tx.$queryRaw<
        { warehouseId: bigint; quantity: Prisma.Decimal; consumedQty: Prisma.Decimal }[]
      >`
        SELECT "warehouseId", "quantity", "consumedQty" FROM "stock_reservations"
        WHERE "id" = ${row.id} FOR UPDATE
      `;
      lockedRows.push({
        id: row.id,
        warehouseId: locked.warehouseId,
        remaining: locked.quantity.toNumber() - locked.consumedQty.toNumber(),
      });
    }

    const totalRemaining = lockedRows.reduce((sum, r) => sum + Math.max(0, r.remaining), 0);
    // Chặn xuất thừa - CHẶN CỨNG, KHÔNG dung sai (Sếp chốt 2026-08-18, mục 13.7 changelog, giữ
    // nguyên khi chuyển sang pool - tổng cả pool vẫn phải đủ, không riêng từng dòng).
    if (input.qty > totalRemaining) {
      throw new BadRequestException(
        `Xuất ${input.qty} cây vượt quá phần đã giữ chỗ còn lại (${totalRemaining} cây) cho vật tư ${input.materialId} của PI ${input.productionInvoiceId} - không đủ hứa`,
      );
    }
    let remainingToConsume = input.qty;
    for (const row of lockedRows) {
      if (remainingToConsume <= 0) break;
      if (row.remaining <= 0) continue;
      const take = Math.min(row.remaining, remainingToConsume);
      // RELEASED chỉ mang ĐÚNG 1 nghĩa: "đã huỷ/bị thay thế" (xem releaseByRef(), B4 Đợt 3b) -
      // KHÔNG dùng để đánh dấu "đã tiêu hết". Dòng tiêu hết vẫn ACTIVE (getAvailableQty() đã tự
      // trừ về 0 qua consumedQty, không cần đổi status).
      await tx.stockReservation.update({
        where: { id: row.id },
        data: { consumedQty: { increment: take } },
      });
      remainingToConsume -= take;
    }
    return { warehouseId: lockedRows[0].warehouseId, stockLengthMm };
  }

  /**
   * available = onHand (stock_quant, caller tự khoá FOR UPDATE và truyền vào - hàm này không đọc
   * lại để tránh đọc ngoài khoá của caller) trừ tổng phần CÒN GIỮ (quantity - consumedQty) của MỌI
   * giữ chỗ ACTIVE, cộng CẢ HAI bảng: StockReservation (cắt sắt) và WarehouseTransferReservation
   * (chuyển kho, bảng có TRƯỚC). Đây là ĐÚNG MỘT hàm được phép cộng 2 bảng - không nơi nào khác
   * được tự viết lại phép trừ này (xem lỗ #6, mục 13.4 changelog) - nếu không, cắt sắt và chuyển
   * kho sẽ giành nhau cùng lô hàng mà không ai phát hiện.
   */
  async getAvailableQty(
    tx: PrismaTx | undefined,
    warehouseId: bigint,
    materialId: bigint,
    stockLengthMm: number | 'ALL',
    onHand: number,
  ): Promise<number> {
    const db = tx ?? this.prisma;
    // 'ALL' = không lọc theo bucket - dùng cho vật tư vĩnh viễn không phân bucket (mọi vật tư
    // không phải sắt cây), KHÔNG BAO GIỜ dùng cho luồng sắt (kế hoạch "chiều dài cây sắt"
    // 2026-08-29, Bước 6).
    const bucketFilter = stockLengthMm === 'ALL' ? {} : { stockLengthMm };
    const [stockReservations, transferReservations] = await Promise.all([
      db.stockReservation.findMany({
        where: { warehouseId, materialId, status: ReservationStatus.ACTIVE, ...bucketFilter },
        select: { quantity: true, consumedQty: true },
      }),
      db.warehouseTransferReservation.findMany({
        where: { warehouseId, materialId, status: ReservationStatus.ACTIVE, ...bucketFilter },
        select: { quantity: true },
      }),
    ]);
    const reservedFromStock = stockReservations.reduce(
      (sum, r) => sum + Math.max(0, r.quantity.toNumber() - r.consumedQty.toNumber()),
      0,
    );
    const reservedFromTransfer = transferReservations.reduce(
      (sum, r) => sum + r.quantity.toNumber(),
      0,
    );
    return Math.max(0, onHand - reservedFromStock - reservedFromTransfer);
  }

  /**
   * B4 Đợt 3b (lỗ #4, mục 13.4 changelog) - giải phóng giữ chỗ khi nguồn sinh ra nó KHÔNG còn
   * hiệu lực (CuttingProposal bị supersede bởi 1 lượt duyệt khác cho cùng nhu cầu). RELEASED ở
   * đây mang ĐÚNG nghĩa "đã huỷ" - KHÁC "đã tiêu hết" (dòng tiêu hết vẫn ACTIVE, xem
   * SteelIssuesService.consumeReservationAndDeduct comment) - 2 khái niệm không được lẫn.
   *
   * Không hoàn phần `consumedQty` đã tiêu (sắt đã rời kho vật lý thật, không có gì để trả lại) -
   * chỉ nhả phần CHƯA lấy (`quantity - consumedQty`) khỏi công thức available, để phương án thay
   * thế (hoặc bất kỳ phương án nào khác) dùng lại đúng số tồn/hàng-đang-chờ-về đó ngay, không bị
   * "khoá ảo" vĩnh viễn bởi phương án đã chết.
   *
   * `tx` bắt buộc - gọi từ TRONG transaction supersede của caller (CuttingProposalsService.
   * approve()), PHẢI chạy TRƯỚC bước tính available của chính lượt duyệt đang chạy, nếu không lượt
   * duyệt mới sẽ không thấy được phần vừa nhả ra và báo thiếu/mua trùng oan.
   */
  async releaseByRef(
    tx: PrismaTx,
    input: { refType: StockReservationRefType; refId: string },
  ): Promise<void> {
    await tx.stockReservation.updateMany({
      where: { refType: input.refType, refId: input.refId, status: ReservationStatus.ACTIVE },
      data: { status: ReservationStatus.RELEASED, releasedAt: new Date() },
    });
  }
}
