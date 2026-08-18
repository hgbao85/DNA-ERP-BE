import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  ReservationStatus,
  StockReservationRefType,
} from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';

export interface ReserveInput {
  warehouseId: bigint;
  materialId: bigint;
  qty: number;
  refType: StockReservationRefType;
  refId: string;
  note?: string;
  createdById?: string;
}

/**
 * Đặt giữ tồn kho ("đã hứa, chưa lấy đi") - tách khỏi StockLedger (đó là "đã lấy đi thật"). Xem
 * docs/changelog-2026-08-15-nhip-2-gop-sku-va-review-auto-duyet.md mục 13 (thiết kế B4).
 *
 * Trạng thái (2026-08-18): CuttingProposalsService.approve() gọi reserve() thay vì trừ tồn thật
 * (Đợt 2) - available qua getAvailableQty() giờ là nguồn thật quyết định consumeQty/buyQty.
 * SteelIssuesService.create() tiêu giữ chỗ (consumedQty += ...) khi Phôi thực xuất, mới là nơi
 * trừ tồn thật (StockLedger). PurchaseProposalsService.receiveItem() gọi topUpFromReceipt() khi
 * hàng mua về, cộng thẳng vào ĐÚNG dòng giữ chỗ gốc (Đợt 3, lỗ #3) - không tạo dòng riêng, để
 * SteelIssue chỉ cần đọc 1 dòng/1 vật tư/1 phương án. CHƯA làm: release() khi CuttingProposal bị
 * supersede/huỷ (Đợt 3, lỗ #4) - giữ chỗ của phương án bị thay thế hiện vẫn nằm ACTIVE mãi.
 */
@Injectable()
export class StockReservationsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  /**
   * `tx` bắt buộc khi caller đã khoá `stock_quant ... FOR UPDATE` trong cùng transaction (đúng
   * pattern StockLedgerService.postEntry `tx`) - nếu không, khoảng hở giữa lúc tính available và
   * lúc ghi giữ chỗ vẫn cho 2 caller cùng đọc một số dư.
   */
  async reserve(
    input: ReserveInput,
    tx?: PrismaTx,
  ): Promise<{ id: bigint; quantity: Prisma.Decimal }> {
    const db = tx ?? this.prisma;
    if (!(input.qty > 0)) {
      throw new BadRequestException('qty giữ chỗ phải lớn hơn 0');
    }

    // Idempotent theo (refType, refId, materialId) - 1 nguồn chỉ giữ chỗ đúng 1 dòng cho 1 vật tư,
    // gọi lại (retry mất mạng, double-click) trả về dòng đã tạo thay vì cộng dồn sai.
    const idempotencyKey = `${input.refType}:${input.refId}:material:${input.materialId}`;
    const existing = await db.stockReservation.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return { id: existing.id, quantity: existing.quantity };
    }

    const created = await db.stockReservation.create({
      data: {
        warehouseId: input.warehouseId,
        materialId: input.materialId,
        quantity: input.qty,
        refType: input.refType,
        refId: input.refId,
        note: input.note,
        createdById: input.createdById,
        idempotencyKey,
      },
    });
    return { id: created.id, quantity: created.quantity };
  }

  /**
   * B4 Đợt 3 (mục 13.4 lỗ #3 changelog) - hàng mua về "có chủ": khi PurchaseProposalsService.
   * receiveItem() nhận hàng cho phần `buyQty` (phần approve() KHÔNG giữ chỗ được vì lúc đó tồn
   * chưa có), cộng thẳng số vừa về vào ĐÚNG dòng giữ chỗ (refType=CUTTING_PROPOSAL) đã tạo lúc
   * duyệt - KHÔNG tạo dòng giữ chỗ riêng. Gộp về 1 dòng/1 vật tư/1 phương án để
   * SteelIssuesService chỉ cần đọc đúng 1 con số "còn giữ bao nhiêu", không phải cộng nhiều nguồn.
   *
   * `tx` bắt buộc - caller (receiveItem) đã khoá dòng item liên quan FOR UPDATE trong cùng
   * transaction, khoá thêm ở đây (FOR UPDATE trên chính dòng giữ chỗ) để an toàn nếu sau này có
   * caller khác gọi hàm này mà không đi qua khoá đó.
   */
  async topUpFromReceipt(
    tx: PrismaTx,
    input: {
      refType: StockReservationRefType;
      refId: string;
      materialId: bigint;
      warehouseId: bigint;
      qty: number;
    },
  ): Promise<void> {
    if (!(input.qty > 0)) {
      throw new BadRequestException('qty cộng thêm giữ chỗ phải lớn hơn 0');
    }
    // Đọc CẢ status (không lọc ACTIVE ngay trong WHERE) - phải phân biệt 3 ca khác nhau, không
    // chỉ "có/không có":
    //   1. Có dòng, ACTIVE      -> vẫn còn nhu cầu thật, cộng thêm vào (case bình thường).
    //   2. Có dòng, RELEASED    -> phương án gốc ĐÃ CHẾT (supersede/huỷ, Đợt 3b) TRONG LÚC hàng
    //      đang trên đường về - không được tạo giữ chỗ MỚI dính vào 1 phương án đã chết (sẽ tái
    //      tạo đúng lỗ #4 vừa vá, chỉ đổi hướng: giữ chỗ mồ côi từ hàng mua thay vì từ duyệt) ->
    //      BỎ QUA, hàng đã cộng vào stock_quant qua postEntry() ở receiveItem() rồi, coi như tồn
    //      chung tự do (thường chính là phương án đã thay thế nó sẽ dùng được ngay).
    //   3. Không có dòng nào    -> approve() không giữ chỗ gì (consumeQty=0, mua 100% nhu cầu) nên
    //      reserve() chưa từng chạy - tạo mới (case hiếm, phương án chắc chắn còn sống vì
    //      receiveItem() chỉ chạy được khi PurchaseProposal đang PURCHASING).
    const [existing] = await tx.$queryRaw<{ id: bigint; status: string }[]>`
      SELECT "id", "status" FROM "stock_reservations"
      WHERE "refType" = ${input.refType} AND "refId" = ${input.refId}
        AND "materialId" = ${input.materialId}
      FOR UPDATE
    `;
    if (existing?.status === 'RELEASED') {
      return;
    }
    if (existing) {
      await tx.stockReservation.update({
        where: { id: existing.id },
        data: { quantity: { increment: input.qty } },
      });
      return;
    }
    await tx.stockReservation.create({
      data: {
        warehouseId: input.warehouseId,
        materialId: input.materialId,
        quantity: input.qty,
        refType: input.refType,
        refId: input.refId,
        idempotencyKey: `${input.refType}:${input.refId}:material:${input.materialId}`,
      },
    });
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
    onHand: number,
  ): Promise<number> {
    const db = tx ?? this.prisma;
    const [stockReservations, transferReservations] = await Promise.all([
      db.stockReservation.findMany({
        where: { warehouseId, materialId, status: ReservationStatus.ACTIVE },
        select: { quantity: true, consumedQty: true },
      }),
      db.warehouseTransferReservation.findMany({
        where: { warehouseId, materialId, status: ReservationStatus.ACTIVE },
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
