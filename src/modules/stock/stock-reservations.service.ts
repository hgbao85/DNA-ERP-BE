import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma, ReservationStatus, StockReservationRefType } from '../../generated/prisma/client';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { frameDeadlineOf } from '../../common/utils/frame-deadline.util';

export interface ReserveInput {
  warehouseId: bigint;
  materialId: bigint;
  qty: number;
  refType: StockReservationRefType;
  refId: string;
  /// PI thật của nguồn giữ chỗ - xem doc comment field cùng tên trên model StockReservation
  /// (L5, 2026-08-26). undefined khi nguồn không neo PI nào.
  productionInvoiceId?: bigint;
  note?: string;
  createdById?: string;
  /** Chiều dài cây (mm) của lần giữ chỗ này. Mặc định 0 khi không truyền. drainPool() có `stockLengthMm` (xuất sắt) chỉ rút dòng
   *  cùng chiều dài hoặc dòng chưa ghi chiều dài (0) - CS2 20/11: 1 lệnh có thể giữ cả cây lẻ kho Phôi lẫn cây chiều dài mua. */
  stockLengthMm?: number;
  /** CS2 (review Sang 21/11): true = khoá chống trùng có thêm chiều dài - cùng nguồn giữ được NHIỀU dòng cùng vật tư khác chiều dài
   *  (cây lẻ kho Phôi bên cạnh cây chiều dài mua). Bỏ trống = khoá dạng cũ (dòng cũ không đổi). */
  lengthKeyed?: boolean;
  /** Quy cách của hàng được giữ ('' / bỏ trống = không quy cách) - nệm. Khác quy cách = dòng giữ chỗ RIÊNG. */
  spec?: string;
}

/**
 * Giữ chỗ theo kho (rà soát 14/11 nhóm B, 16/11/2026): 4 loại dòng này TÍNH LẠI / CỘNG THÊM nhiều lần trên cùng refId nên
 * khoá có thêm đuôi `:wh:{warehouseId}` - cùng 1 lệnh có hàng ở 2 kho (sau đổi xưởng) thì có 2 dòng, mỗi kho 1 dòng. Dòng
 * CUTTING_PROPOSAL (sắt) mỗi lần duyệt đã có refId mới và chỉ đổi kho qua phiếu chuyển - giữ khoá cũ. Migration
 * 20261116120000 nối đuôi cho dòng cũ.
 */
const WAREHOUSE_KEYED_REF_TYPES: ReadonlySet<StockReservationRefType> = new Set([
  StockReservationRefType.CONSUMABLE_MATERIAL_PURCHASE,
  StockReservationRefType.PIECE_MATERIAL_YIELD_PURCHASE,
  StockReservationRefType.MATERIAL_YIELD_RECIPE_PURCHASE,
  StockReservationRefType.PRODUCTION_INVOICE,
]);

/** Khoá idempotency của giữ chỗ - quy cách rỗng GIỮ NGUYÊN dạng cũ (dòng cũ không đổi); có quy cách thì thêm đuôi
 *  để cùng (nguồn, vật tư) giữ được NHIỀU dòng, mỗi quy cách 1 dòng (nệm). 4 loại dòng ở WAREHOUSE_KEYED_REF_TYPES thêm
 *  đuôi kho. */
function reservationKey(
  refType: StockReservationRefType,
  refId: string,
  materialId: bigint,
  spec: string | undefined,
  warehouseId: bigint,
  /** CS2: chiều dài cây khi nguồn giữ nhiều chiều dài cùng vật tư (cây lẻ) - bỏ trống/0 = dạng cũ. */
  lengthMm?: number,
): string {
  const base = `${refType}:${refId}:material:${materialId}`;
  const s = spec?.trim();
  const withSpec = s ? `${base}:spec:${s}` : base;
  const withLen = lengthMm && lengthMm > 0 ? `${withSpec}:len:${lengthMm}` : withSpec;
  return WAREHOUSE_KEYED_REF_TYPES.has(refType) ? `${withLen}:wh:${warehouseId}` : withLen;
}

const WAREHOUSE_SUFFIX = /:wh:\d+$/;

/** Khoá của cùng dòng khi dòng sang kho khác (nhận phiếu chuyển). Khoá không có đuôi kho (sắt, dòng tách không khoá) giữ nguyên. */
export function reservationKeyAtWarehouse(key: string | null, warehouseId: bigint): string | null {
  if (!key || !WAREHOUSE_SUFFIX.test(key)) return key;
  return key.replace(WAREHOUSE_SUFFIX, `:wh:${warehouseId}`);
}

/** Kho gắn theo xưởng - hàng của lệnh nằm ở loại kho này của xưởng khác sẽ được chuyển sang bằng phiếu chuyển của lệnh. */
const WORKSHOP_BOUND_KINDS: readonly string[] = ['PHOI', 'HAN'];

interface PoolRow {
  id: bigint;
  refType: StockReservationRefType;
  refId: string;
  warehouseId: bigint;
  quantity: Prisma.Decimal;
  consumedQty: Prisma.Decimal;
  stockLengthMm: number;
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

    // Idempotent theo (refType, refId, materialId, quy cách[, chiều dài]) - 1 nguồn chỉ giữ chỗ đúng 1 dòng cho 1 (vật tư, quy
    // cách[, chiều dài]), gọi lại (retry mất mạng, double-click) trả về dòng đã tạo thay vì cộng dồn sai. CS2 (review Sang 21/11):
    // thiếu chiều dài thì lần giữ chỗ thứ 2 cùng vật tư (cây lẻ + cây mua) trả lại dòng của lần 1 - mất phần giữ.
    const idempotencyKey = reservationKey(
      input.refType,
      input.refId,
      input.materialId,
      input.spec,
      input.warehouseId,
      input.lengthKeyed ? input.stockLengthMm : undefined,
    );
    const existing = await db.stockReservation.findUnique({ where: { idempotencyKey } });
    if (existing) {
      // K2 (danh sách lỗi 16/11): dòng cùng khoá đã nhả (phương án bị thay / lệnh đã xong rồi duyệt lại) trước đây được trả về
      // như đang giữ - caller tưởng đã giữ chỗ nhưng getAvailableQty() không trừ dòng RELEASED, PI khác lấy mất hàng. Mở lại
      // (cùng cách reserveOrAdjust / creditPool), không bao giờ thấp hơn phần đã tiêu.
      if (existing.status === ReservationStatus.RELEASED) {
        const reopened = await db.stockReservation.update({
          where: { id: existing.id },
          data: {
            quantity: Math.max(input.qty, existing.consumedQty.toNumber()),
            status: ReservationStatus.ACTIVE,
            releasedAt: null,
          },
        });
        return { id: reopened.id, quantity: reopened.quantity };
      }
      return { id: existing.id, quantity: existing.quantity };
    }

    const created = await db.stockReservation.create({
      data: {
        warehouseId: input.warehouseId,
        materialId: input.materialId,
        quantity: input.qty,
        refType: input.refType,
        refId: input.refId,
        productionInvoiceId: input.productionInvoiceId,
        note: input.note,
        createdById: input.createdById,
        idempotencyKey,
        stockLengthMm: input.stockLengthMm ?? 0,
        spec: input.spec?.trim() ?? '',
      },
    });
    return { id: created.id, quantity: created.quantity };
  }

  /**
   * Tạo mới HOẶC cập nhật số lượng giữ chỗ cho 1 (refType, refId, materialId) ỔN ĐỊNH qua nhiều
   * lần gọi lại (2026-09-23, ConsumableMaterialPurchaseService/PieceMaterialYieldPurchaseService -
   * 2 nguồn này TÍNH LẠI NHIỀU LẦN trên CÙNG 1 refId, khác CUTTING_PROPOSAL mỗi lần approve() sinh
   * 1 cuttingProposalId MỚI nên `reserve()` (tạo 1 lần, không đổi) là đủ). KHÔNG BAO GIỜ đặt
   * quantity thấp hơn consumedQty đã tiêu (xưởng đã lấy đi thật, không "tiêu ít hơn 0" được nếu
   * nhu cầu tính lại giảm xuống) - qty truyền vào <= 0 là hợp lệ (nghĩa là "không giữ gì thêm"),
   * KHÁC `reserve()` (throw nếu qty<=0) vì hàm này còn dùng để đưa 1 dòng đã có VỀ 0.
   */
  async reserveOrAdjust(
    tx: PrismaTx,
    input: {
      warehouseId: bigint;
      materialId: bigint;
      qty: number;
      refType: StockReservationRefType;
      refId: string;
      productionInvoiceId?: bigint;
      spec?: string;
    },
  ): Promise<void> {
    // Khoá có kho (B1): mỗi kho 1 dòng. Rà soát 14/11 CK2: trước đây khoá không gồm kho, lần tính ở kho khác thì CHUYỂN dòng
    // sang kho mới dù hàng vẫn nằm ở kho cũ (sau đổi xưởng) - nay dòng ở kho cũ để nguyên (releaseOwnHoldsForRecompute quyết
    // định co hay tính "đang chuyển tới"), lần tính ghi dòng của kho đang tính.
    const idempotencyKey = reservationKey(
      input.refType,
      input.refId,
      input.materialId,
      input.spec,
      input.warehouseId,
    );
    const existing = await tx.stockReservation.findUnique({ where: { idempotencyKey } });
    if (!existing) {
      if (input.qty > 0) {
        await this.reserve(input, tx);
      }
      return;
    }
    const floor = existing.consumedQty.toNumber();
    const nextQty = Math.max(input.qty, floor);
    // Dòng cùng khoá đã nhả (PI xong rồi tính lại) mà lần này cần giữ thêm thì mở lại - không tạo trùng khoá được.
    const reactivate = existing.status === ReservationStatus.RELEASED && input.qty > floor;
    if (nextQty !== existing.quantity.toNumber() || reactivate) {
      await tx.stockReservation.update({
        where: { id: existing.id },
        data: {
          quantity: nextQty,
          ...(reactivate ? { status: ReservationStatus.ACTIVE, releasedAt: null } : {}),
        },
      });
    }
  }

  /**
   * Chuẩn bị TÍNH LẠI 1 nguồn mua ngoài sắt của 1 PI ở kho `warehouseId` (rà soát 14/11/2026 MH1; nhóm B 16/11). Đọc + khoá
   * FOR UPDATE mọi dòng giữ chỗ ACTIVE của CHÍNH PI cho (vật tư, quy cách): dòng của nguồn (refType/refId, mỗi kho 1 dòng) và
   * dòng "của cả lệnh" PRODUCTION_INVOICE (creditPool tạo khi hàng mua về). Theo kho của từng dòng:
   *  - ở ĐÚNG kho đang tính: co về phần đã tiêu - hàng đã nhận còn trong kho trở lại tồn khả dụng, caller giữ chỗ lại vào dòng
   *    của nguồn ở kho này (không co thì getAvailableQty() trừ nhầm phần của chính PI, lần tính sau mua thêm);
   *  - ở kho Phôi/Hàn CÙNG LOẠI của xưởng khác (lệnh vừa đổi xưởng, rà soát CK2): để nguyên - hàng thật nằm ở đó, sẽ sang kho
   *    này bằng phiếu chuyển của lệnh (WorkshopMoveService.getPlans). Phần còn giữ trả về `inTransitQty` để caller coi là
   *    "đã có" - không mua lại hàng đang nằm ở kho xưởng cũ;
   *  - dòng của nguồn ở kho khác còn lại (vd đóng gói đổi kho thành phẩm): không có phiếu nào chuyển sang - co về phần đã tiêu
   *    như trước (hàng ở kho đó trở lại tồn khả dụng của kho đó). Dòng "của cả lệnh" ở kho đó để nguyên như trước.
   *
   * `ownConsumedQty`: phần ĐÃ TIÊU (xưởng đã xuất cho PI) của mọi dòng trên, mọi kho - "đã có" khi trừ nhu cầu (nhu cầu là
   * tổng cả PI). `sourceConsumedQty`: phần đã tiêu của dòng nguồn Ở KHO ĐANG TÍNH - sàn khi giữ chỗ lại dòng đó. consumedQty
   * chỉ ghi được khi lúc xuất có giữ chỗ để rút (drainPoolBestEffort) - xuất không qua giữ chỗ thì không đếm được, lệch về
   * phía mua thêm như trước, không mua thiếu.
   *
   * Caller PHẢI khoá stock_quant FOR UPDATE TRƯỚC khi gọi (cùng thứ tự khoá với luồng xuất vật tư: stock_quant rồi mới tới
   * dòng giữ chỗ) - hàm này khoá FOR UPDATE các dòng giữ chỗ nó đọc rồi mới co, để không đè lên consumedQty vừa tăng.
   */
  async releaseOwnHoldsForRecompute(
    tx: PrismaTx,
    input: {
      refType: StockReservationRefType;
      refId: string;
      productionInvoiceId: bigint;
      materialId: bigint;
      warehouseId: bigint;
      spec?: string;
    },
  ): Promise<{ ownConsumedQty: number; sourceConsumedQty: number; inTransitQty: number }> {
    const spec = input.spec?.trim() ?? '';
    const rows = await tx.$queryRaw<
      {
        id: bigint;
        refType: string;
        refId: string;
        warehouseId: bigint;
        quantity: Prisma.Decimal;
        consumedQty: Prisma.Decimal;
      }[]
    >`
      SELECT "id", "refType"::text AS "refType", "refId", "warehouseId", "quantity", "consumedQty"
      FROM "stock_reservations"
      WHERE "productionInvoiceId" = ${input.productionInvoiceId}
        AND "materialId" = ${input.materialId}
        AND "spec" = ${spec}
        AND "status" = 'ACTIVE'
        AND (("refType"::text = ${input.refType} AND "refId" = ${input.refId})
             OR "refType"::text = ${StockReservationRefType.PRODUCTION_INVOICE})
      ORDER BY "id"
      FOR UPDATE
    `;
    const warehouses = await tx.warehouse.findMany({
      where: { id: { in: [...new Set([input.warehouseId, ...rows.map((r) => r.warehouseId)])] } },
      select: { id: true, kind: true, workshopId: true },
    });
    const whById = new Map(warehouses.map((w) => [w.id.toString(), w]));
    const here = whById.get(input.warehouseId.toString());
    const isInTransit = (warehouseId: bigint): boolean => {
      const w = whById.get(warehouseId.toString());
      return (
        !!w?.kind &&
        w.kind === here?.kind &&
        WORKSHOP_BOUND_KINDS.includes(w.kind) &&
        w.workshopId !== here.workshopId
      );
    };
    let ownConsumedQty = 0;
    let sourceConsumedQty = 0;
    let inTransitQty = 0;
    for (const r of rows) {
      const consumed = r.consumedQty.toNumber();
      ownConsumedQty += consumed;
      const isSource = r.refType === input.refType && r.refId === input.refId;
      const atHere = r.warehouseId === input.warehouseId;
      if (isSource && atHere) sourceConsumedQty += consumed;
      if (!atHere && isInTransit(r.warehouseId)) {
        inTransitQty += Math.max(0, r.quantity.toNumber() - consumed);
        continue;
      }
      if ((atHere || isSource) && r.quantity.toNumber() !== consumed) {
        await tx.stockReservation.update({ where: { id: r.id }, data: { quantity: consumed } });
      }
    }
    const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
    return {
      ownConsumedQty: round4(ownConsumedQty),
      sourceConsumedQty: round4(sourceConsumedQty),
      inTransitQty: round4(inTransitQty),
    };
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
    spec: string | undefined,
    /** Chỉ dòng ở kho này (giữ chỗ theo kho, nhóm B 16/11/2026). */
    warehouseId: bigint,
  ): Promise<PoolRow[]> {
    const rows = await tx.stockReservation.findMany({
      where: {
        productionInvoiceId,
        materialId,
        spec: spec ?? '',
        warehouseId,
        status: ReservationStatus.ACTIVE,
      },
      select: {
        id: true,
        refType: true,
        refId: true,
        warehouseId: true,
        quantity: true,
        consumedQty: true,
        stockLengthMm: true,
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
   * Hàng mua về "có chủ" (B4 Đợt 3, mục 13.4 lỗ #3 changelog, mở rộng thành pool ở L5 2026-08-26):
   * PurchaseProposalsService.receiveItem() gọi khi nhận hàng cho phần `buyQty` (phần approve()
   * KHÔNG giữ chỗ được vì lúc đó tồn chưa có) - cộng vào ĐÚNG pool của (PI, vật tư), KHÔNG còn cố
   * đoán 1 cuttingProposalId cụ thể (PurchaseProposal.cuttingProposalId bị GHI ĐÈ thành phương án
   * duyệt SAU CÙNG mỗi khi merge, xem CuttingProposalsService.approve() - nguồn cũ của lỗ #5).
   *
   * `tx` bắt buộc - caller (receiveItem) đã khoá dòng item liên quan FOR UPDATE trong cùng
   * transaction, khoá thêm ở đây (FOR UPDATE trên dòng giữ chỗ được chọn) để an toàn nếu sau này
   * có caller khác gọi hàm này mà không đi qua khoá đó.
   */
  async creditPool(
    tx: PrismaTx,
    input: {
      productionInvoiceId: bigint;
      materialId: bigint;
      warehouseId: bigint;
      qty: number;
      spec?: string;
      /** Chiều dài cây (mm) của hàng vừa về - chỉ dùng khi pool rỗng phải TẠO dòng mới, để dòng giữ chỗ
       *  nằm đúng ngăn chiều dài với tồn kho thật (getAvailableQty lọc theo ngăn này). Pool có sẵn dòng
       *  thì cộng vào dòng đó, giữ nguyên chiều dài đã chốt lúc duyệt. Mặc định 0. */
      stockLengthMm?: number;
    },
  ): Promise<void> {
    if (!(input.qty > 0)) {
      throw new BadRequestException('qty cộng thêm giữ chỗ phải lớn hơn 0');
    }
    // Rà soát 14/11 CK1 (nhóm B 16/11): chỉ cộng vào dòng của pool Ở ĐÚNG KHO NHẬN - trước đây cộng vào dòng đầu của pool bất
    // kể kho, lệnh vừa đổi xưởng nhận hàng ở kho mới thì giữ chỗ lại nằm ở kho cũ (không có hàng).
    const pool = await this.loadPool(
      tx,
      input.productionInvoiceId,
      input.materialId,
      input.spec?.trim(),
      input.warehouseId,
    );
    // MUA1 rà soát 18/11: hàng nhận về LUÔN cộng vào dòng "thuộc về cả PI" (PRODUCTION_INVOICE), KHÔNG cộng vào dòng của
    // phương án cắt (CUTTING_PROPOSAL). Trước đây cộng vào dòng ưu tiên đầu - thường là dòng phương án; KHSX "Tính lại" rồi
    // duyệt phương án mới thì releaseByRef nhả CẢ phần hàng vừa nhận -> phần đó vừa tính là tồn khả dụng vừa nằm trong "đã
    // ký" (receivedQty) -> mua thiếu sắt (vd thiếu 50 cây) hoặc báo "nhu cầu giảm" sai. Dòng PI không bị nhả khi thay phương
    // án; drainPool rút theo tổng pool nên dòng nào nhận credit không đổi số xuất được.
    const piRow = pool.find((r) => r.refType === StockReservationRefType.PRODUCTION_INVOICE);
    if (piRow) {
      await tx.$queryRaw`SELECT "id" FROM "stock_reservations" WHERE "id" = ${piRow.id} FOR UPDATE`;
      await tx.stockReservation.update({
        where: { id: piRow.id },
        data: { quantity: { increment: input.qty } },
      });
      return;
    }
    // Kho nhận chưa có dòng PI nào của lệnh (approve() chỉ giữ chỗ bằng dòng phương án, buyQty = 100% nhu cầu, phương án bị
    // huỷ, hoặc lệnh vừa đổi xưởng) - tạo 1 dòng "thuộc về cả PI" ở kho này (khoá có đuôi kho), cùng ngăn chiều dài với hàng
    // vừa về (hoặc với dòng phương án đã chốt lúc duyệt). Dòng cùng khoá đã nhả (PI xong rồi vẫn nhận tiếp) thì mở lại thay
    // vì tạo trùng khoá.
    {
      const idempotencyKey = reservationKey(
        StockReservationRefType.PRODUCTION_INVOICE,
        input.productionInvoiceId.toString(),
        input.materialId,
        input.spec,
        input.warehouseId,
      );
      const released = await tx.stockReservation.findUnique({ where: { idempotencyKey } });
      if (released) {
        await tx.stockReservation.update({
          where: { id: released.id },
          data: {
            quantity: released.consumedQty.toNumber() + input.qty,
            status: ReservationStatus.ACTIVE,
            releasedAt: null,
          },
        });
        return;
      }
      await tx.stockReservation.create({
        data: {
          warehouseId: input.warehouseId,
          materialId: input.materialId,
          productionInvoiceId: input.productionInvoiceId,
          quantity: input.qty,
          refType: StockReservationRefType.PRODUCTION_INVOICE,
          refId: input.productionInvoiceId.toString(),
          idempotencyKey,
          stockLengthMm: input.stockLengthMm ?? pool[0]?.stockLengthMm ?? 0,
          spec: input.spec?.trim() ?? '',
        },
      });
    }
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
   */
  async drainPool(
    tx: PrismaTx,
    input: {
      productionInvoiceId: bigint;
      materialId: bigint;
      qty: number;
      spec?: string;
      /** Kho đang trừ tồn - chỉ rút dòng ở kho này (rà soát 14/11 CK3, nhóm B 16/11). */
      warehouseId: bigint;
      /** CS2 (review Sang 21/11): chiều dài cây đang xuất (xuất sắt) - chỉ rút dòng cùng chiều dài hoặc dòng chưa ghi chiều dài (0).
       *  Rút theo tổng cả pool thì xuất cây chiều dài mua ăn mất phần giữ cây lẻ (cây lẻ còn trong kho nhưng hết giữ chỗ, lệnh
       *  khác giữ mất). Bỏ trống = rút cả pool như trước. */
      stockLengthMm?: number;
    },
  ): Promise<{ warehouseId: bigint }> {
    if (!(input.qty > 0)) {
      throw new BadRequestException('qty xuất phải lớn hơn 0');
    }
    const fullPool = await this.loadPool(
      tx,
      input.productionInvoiceId,
      input.materialId,
      input.spec?.trim(),
      input.warehouseId,
    );
    const len = input.stockLengthMm;
    const pool =
      len != null && len > 0
        ? fullPool.filter((r) => r.stockLengthMm === len || r.stockLengthMm === 0)
        : fullPool;
    if (pool.length === 0 && fullPool.length > 0) {
      throw new BadRequestException(
        `Lệnh không giữ chỗ cây dài ${len}mm cho vật tư ${input.materialId} - chỉ giữ cây ${[...new Set(fullPool.map((r) => r.stockLengthMm))].join(' / ')}mm, xuất đúng chiều dài phương án cắt`,
      );
    }
    if (pool.length === 0) {
      const elsewhere = await this.heldElsewhereMessage(tx, input);
      throw new ConflictException(
        elsewhere ??
          `Không tìm thấy giữ chỗ tồn kho cho vật tư ${input.materialId} của PI ${input.productionInvoiceId} - chưa từng giữ chỗ (tồn + hàng mua chưa đủ), hoặc mọi phương án cắt liên quan đã bị supersede/huỷ`,
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
      const elsewhere = await this.heldElsewhereMessage(tx, input);
      throw new BadRequestException(
        `Xuất ${input.qty} cây${len ? ` dài ${len}mm` : ''} vượt quá phần đã giữ chỗ còn lại (${totalRemaining} cây) cho vật tư ${input.materialId} của PI ${input.productionInvoiceId} - không đủ hứa` +
          (elsewhere ? `. ${elsewhere}` : ''),
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
    return { warehouseId: input.warehouseId };
  }

  /** Lệnh còn giữ hàng ở kho khác kho đang xuất (vd kho Phôi xưởng cũ sau đổi xưởng) - câu báo cho thủ kho; null nếu không có. */
  private async heldElsewhereMessage(
    tx: PrismaTx,
    input: { productionInvoiceId: bigint; materialId: bigint; spec?: string; warehouseId: bigint },
  ): Promise<string | null> {
    const rows = await tx.stockReservation.findMany({
      where: {
        productionInvoiceId: input.productionInvoiceId,
        materialId: input.materialId,
        spec: input.spec?.trim() ?? '',
        status: ReservationStatus.ACTIVE,
        warehouseId: { not: input.warehouseId },
      },
      select: {
        quantity: true,
        consumedQty: true,
        warehouse: { select: { code: true, name: true } },
      },
    });
    const byWarehouse = new Map<string, number>();
    for (const r of rows) {
      const left = r.quantity.toNumber() - r.consumedQty.toNumber();
      if (left <= 0) continue;
      const name = r.warehouse.name || r.warehouse.code;
      byWarehouse.set(name, (byWarehouse.get(name) ?? 0) + left);
    }
    if (byWarehouse.size === 0) return null;
    const list = [...byWarehouse].map(([name, qty]) => `${Math.round(qty * 1e4) / 1e4} ở ${name}`);
    return `Lệnh còn giữ ${list.join(', ')} - cần phiếu chuyển hàng của lệnh sang kho này trước khi xuất`;
  }

  /**
   * Bản BEST-EFFORT của drainPool() (2026-09-23) - dùng cho MaterialIssuesService/
   * MaterialYieldIssuesService.create(): 2 luồng đó xuất vật tư tiêu hao/vật tư thành phẩm dựa
   * TRỰC TIẾP vào tồn kho vật lý (getAvailableQty() qua stock_quant + WarehouseTransferReservation,
   * KHÔNG qua StockReservation pool) - vì trigger tạo giữ chỗ ở ConsumableMaterialPurchaseService/
   * PieceMaterialYieldPurchaseService là BEST-EFFORT (bọc try/catch, chỉ log lỗi - xem
   * ProductionInvoicesService.triggerPostApprovalProposals()), 1 PI hoàn toàn có thể chưa từng có
   * dòng giữ chỗ nào (tính lỗi/mất mạng) dù xưởng vẫn cần xuất vật tư bình thường. CHẶN CỨNG như
   * drainPool() ở đây sẽ khoá xưởng vĩnh viễn cho ĐÚNG những PI hiếm gặp lỗi đó - tệ hơn hẳn race
   * hiếm mà việc giữ chỗ định vá. Hàm này CHỈ để "trả nợ" giữ chỗ dần dần theo xuất thật (rút tối đa
   * pool đang có, KHÔNG BAO GIỜ throw, không chặn ghi sổ) - nếu pool rỗng/không đủ, phần vượt quá
   * coi như "không có gì để rút" (không lỗi, không consumedQty âm) - available cho các lượt TÍNH LẠI
   * đề xuất mua sau này sẽ tự đúng lại vì onHand (stock_quant) đã giảm thật rồi (kênh đúng-đắn để
   * biết "đã tiêu" là StockLedger, KHÔNG phải consumedQty của giữ chỗ - trường này chỉ là sổ sách
   * phụ để nhả giữ chỗ không tiêu tới, không phải nguồn sự thật tồn kho).
   */
  async drainPoolBestEffort(
    tx: PrismaTx,
    input: {
      productionInvoiceId: bigint;
      materialId: bigint;
      qty: number;
      spec?: string;
      /** Kho vừa trừ tồn - chỉ trả nợ giữ chỗ ở kho này (rà soát 14/11 XK6, nhóm B 16/11). */
      warehouseId: bigint;
    },
  ): Promise<void> {
    if (!(input.qty > 0)) return;
    const pool = await this.loadPool(
      tx,
      input.productionInvoiceId,
      input.materialId,
      input.spec?.trim(),
      input.warehouseId,
    );
    if (pool.length === 0) return;

    const lockedRows: { id: bigint; remaining: number }[] = [];
    for (const row of pool) {
      const [locked] = await tx.$queryRaw<
        { quantity: Prisma.Decimal; consumedQty: Prisma.Decimal }[]
      >`
        SELECT "quantity", "consumedQty" FROM "stock_reservations"
        WHERE "id" = ${row.id} FOR UPDATE
      `;
      lockedRows.push({
        id: row.id,
        remaining: locked.quantity.toNumber() - locked.consumedQty.toNumber(),
      });
    }

    let remainingToConsume = input.qty;
    for (const row of lockedRows) {
      if (remainingToConsume <= 0) break;
      if (row.remaining <= 0) continue;
      const take = Math.min(row.remaining, remainingToConsume);
      await tx.stockReservation.update({
        where: { id: row.id },
        data: { consumedQty: { increment: take } },
      });
      remainingToConsume -= take;
    }
    // remainingToConsume > 0 (pool không đủ) - cố ý bỏ qua, xem docstring.
  }

  /**
   * available = onHand (stock_quant, caller tự khoá FOR UPDATE và truyền vào - hàm này không đọc
   * lại để tránh đọc ngoài khoá của caller) trừ tổng phần CÒN GIỮ (quantity - consumedQty) của MỌI
   * giữ chỗ ACTIVE, cộng CẢ HAI bảng: StockReservation (cắt sắt) và WarehouseTransferReservation
   * (chuyển kho, bảng có TRƯỚC). Đây là ĐÚNG MỘT hàm được phép cộng 2 bảng - không nơi nào khác
   * được tự viết lại phép trừ này (xem lỗ #6, mục 13.4 changelog) - nếu không, cắt sắt và chuyển
   * kho sẽ giành nhau cùng lô hàng mà không ai phát hiện.
   *
   * `stockLengthMm` (2026-09-05) lọc ĐÚNG bucket chiều dài khi trừ StockReservation - `onHand` do
   * caller truyền vào đã tự khoá/lọc đúng bucket đó rồi (xem CuttingProposalsService.approve()),
   * nên phần trừ ở đây phải khớp, không trộn giữ chỗ của chiều dài KHÁC vào. KHÔNG lọc
   * WarehouseTransferReservation theo chiều dài - luồng chuyển kho chưa có input chiều dài (luôn
   * ghi 0), lọc riêng sẽ làm ẩn mất phần nó đang giữ và cho 2 luồng giành nhau cùng lô hàng vật lý.
   */
  async getAvailableQty(
    tx: PrismaTx | undefined,
    warehouseId: bigint,
    materialId: bigint,
    onHand: number,
    stockLengthMm?: number,
    /** PI đang XUẤT (2026-10-27) - các luồng xuất vật tư tiêu hao/đóng gói/vật tư thành phẩm/đan chỉ
     *  được bị chặn bởi giữ chỗ của PI KHÁC (hoặc giữ chỗ không neo PI nào), KHÔNG bị chặn bởi chính
     *  phần đã giữ cho PI này: hàng PI này vừa mua về (creditPool) nằm ở dòng giữ chỗ của CHÍNH nó, xuất
     *  cho chính nó phải được, còn PI khác thì phải bị chặn (không lấy mất hàng đã mua cho PI này).
     *  Thay cho excludeRefTypes cũ (loại cả CONSUMABLE_MATERIAL_PURCHASE/PIECE_MATERIAL_YIELD_PURCHASE
     *  của MỌI PI nên PI khác lấy mất hàng; còn PRODUCTION_INVOICE thì không loại nên chính PI bị chặn).
     *  Không truyền = trừ MỌI giữ chỗ (đề xuất mua/chuyển kho/duyệt phương án tính available của PI nào
     *  cũng phải thấy phần PI khác đã giữ). Tái hiện live-test 2026-09-23: 2 PI giữ chỗ cộng đúng bằng
     *  onHand - mỗi PI xuất phần của mình vẫn được vì phần của PI kia mới bị trừ. */
    ownProductionInvoiceId?: bigint,
    /** Quy cách của bucket đang tính available ('' / bỏ trống = không quy cách) - phải khớp đúng bucket của `onHand`. */
    spec?: string,
  ): Promise<number> {
    const reserved = await this.getReservedQty(
      tx,
      warehouseId,
      materialId,
      stockLengthMm,
      ownProductionInvoiceId,
      spec,
    );
    // Rà soát 14/11 XK5: làm tròn 4 số lẻ - trừ nhiều số thực ra lẻ sát dưới (0,3 - 0,1 = 0,19999999999999998) chặn oan khi so với
    // số xuất.
    return Math.max(0, Math.round((onHand - reserved) * 1e4) / 1e4 + 0);
  }

  /**
   * Tổng phần CÒN GIỮ của 1 ô tồn (kho, vật tư, chiều dài, quy cách) - cộng CẢ HAI bảng giữ chỗ. getAvailableQty() = onHand trừ số
   * này; tách riêng (K3 16/11) để "Sửa nhanh tồn kho" báo được tồn mới thấp hơn phần đang giữ bao nhiêu (getAvailableQty kẹp về 0
   * nên không cho biết thiếu bao nhiêu). Vẫn là ĐÚNG MỘT chỗ cộng 2 bảng - xem docstring getAvailableQty().
   */
  async getReservedQty(
    tx: PrismaTx | undefined,
    warehouseId: bigint,
    materialId: bigint,
    stockLengthMm?: number,
    ownProductionInvoiceId?: bigint,
    spec?: string,
  ): Promise<number> {
    const db = tx ?? this.prisma;
    const [stockReservations, transferReservations] = await Promise.all([
      db.stockReservation.findMany({
        where: {
          warehouseId,
          materialId,
          status: ReservationStatus.ACTIVE,
          stockLengthMm: stockLengthMm ?? 0,
          spec: spec?.trim() ?? '',
          ...(ownProductionInvoiceId !== undefined
            ? {
                OR: [
                  { productionInvoiceId: null },
                  { productionInvoiceId: { not: ownProductionInvoiceId } },
                ],
              }
            : {}),
        },
        select: { quantity: true, consumedQty: true },
      }),
      db.warehouseTransferReservation.findMany({
        where: {
          warehouseId,
          materialId,
          status: ReservationStatus.ACTIVE,
          spec: spec?.trim() ?? '',
        },
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
    return Math.round((reservedFromStock + reservedFromTransfer) * 1e4) / 1e4 + 0;
  }

  /**
   * K5 16/11 - getReservedQty() cho NHIỀU ô (kho, vật tư, quy cách, chiều dài cây) bằng 2 câu truy vấn, thay vì 2 câu mỗi ô
   * (GET /stock-quant gọi từng dòng = N+1). Không loại PI nào.
   *
   * 17/11/2026 (lỗi C3 "khả dụng sắt"): giữ chỗ cắt sắt (StockReservation) tách theo CHIỀU DÀI CÂY như getReservedQty() khi
   * caller truyền stockLengthMm - trước đây chỉ lấy ô 0 nên sắt giữ ở ô 6000 / 5450... không bao giờ bị trừ. Giữ chỗ chuyển kho
   * (WarehouseTransferReservation) không có chiều dài -> khoá riêng, trừ vào MỌI ô chiều dài (đúng getReservedQty()).
   * Đọc bằng reservedFor(map, kho, vật tư, quy cách, chiều dài).
   */
  async getReservedQtyMap(
    cells: Array<{ warehouseId: bigint; materialId: bigint }>,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (cells.length === 0) return out;
    const warehouseIds = [...new Set(cells.map((c) => c.warehouseId))];
    const materialIds = [...new Set(cells.map((c) => c.materialId))];
    const [stockReservations, transferReservations] = await Promise.all([
      this.prisma.stockReservation.findMany({
        where: {
          warehouseId: { in: warehouseIds },
          materialId: { in: materialIds },
          status: ReservationStatus.ACTIVE,
        },
        select: {
          warehouseId: true,
          materialId: true,
          spec: true,
          stockLengthMm: true,
          quantity: true,
          consumedQty: true,
        },
      }),
      this.prisma.warehouseTransferReservation.findMany({
        where: {
          warehouseId: { in: warehouseIds },
          materialId: { in: materialIds },
          status: ReservationStatus.ACTIVE,
        },
        select: { warehouseId: true, materialId: true, spec: true, quantity: true },
      }),
    ]);
    const add = (k: string, qty: number) => out.set(k, (out.get(k) ?? 0) + qty);
    for (const r of stockReservations) {
      add(
        StockReservationsService.reservedKey(r.warehouseId, r.materialId, r.spec, r.stockLengthMm),
        Math.max(0, r.quantity.toNumber() - r.consumedQty.toNumber()),
      );
    }
    for (const r of transferReservations) {
      if (r.materialId) {
        add(
          StockReservationsService.reservedKey(r.warehouseId, r.materialId, r.spec),
          r.quantity.toNumber(),
        );
      }
    }
    for (const [k, v] of out) out.set(k, Math.round(v * 1e4) / 1e4 + 0);
    return out;
  }

  /**
   * Khoá Map của getReservedQtyMap(). Có stockLengthMm = giữ chỗ cắt sắt của đúng ô chiều dài đó; KHÔNG truyền = giữ chỗ chuyển
   * kho (không có chiều dài, áp cho mọi ô).
   */
  static reservedKey(
    warehouseId: bigint,
    materialId: bigint,
    spec: string | null | undefined,
    stockLengthMm?: number,
  ): string {
    const base = `${warehouseId}:${materialId}:${spec?.trim() ?? ''}`;
    return stockLengthMm === undefined ? `${base}:chuyen-kho` : `${base}:${stockLengthMm}`;
  }

  /** Phần đang giữ của 1 dòng tồn (kho, vật tư, quy cách, chiều dài cây) từ map của getReservedQtyMap(): giữ chỗ cắt sắt cùng
   *  ô chiều dài + giữ chỗ chuyển kho (mọi ô) - cùng phép cộng của getReservedQty(). */
  static reservedFor(
    reserved: Map<string, number>,
    warehouseId: bigint,
    materialId: bigint,
    spec: string | null | undefined,
    stockLengthMm: number,
  ): number {
    const fromStock =
      reserved.get(
        StockReservationsService.reservedKey(warehouseId, materialId, spec, stockLengthMm),
      ) ?? 0;
    const fromTransfer =
      reserved.get(StockReservationsService.reservedKey(warehouseId, materialId, spec)) ?? 0;
    return Math.round((fromStock + fromTransfer) * 1e4) / 1e4 + 0;
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

  /**
   * 2026-10-28 - nhả phần giữ chỗ CÒN DƯ của 1 PI đã xong (mọi lệnh sản xuất đã "Kết thúc", xem
   * ProductionOrdersService.finishFloor). Phần dư luôn có thật: mua cộng % hao hụt, kho nhận vượt, xưởng
   * dùng ít hơn định mức - nếu không nhả, nó đứng tên PI đã xong mãi mãi và (từ khi các luồng xuất tính giữ
   * chỗ của PI KHÁC, xem getAvailableQty) chặn oan PI khác xuất phần tồn thật đó.
   *
   * Mọi refType (sắt lẫn vật tư tiêu hao), CHỈ dòng còn dư (quantity > consumedQty) - dòng đã tiêu hết vẫn
   * ACTIVE như quy ước ở drainPool() (RELEASED chỉ mang nghĩa "đã huỷ/nhả"). Không hoàn phần consumedQty
   * (hàng đã rời kho thật), giống releaseByRef(). Trả về số dòng đã nhả. Idempotent.
   *
   * Hệ quả cần biết: QLSX bấm "Bắt đầu" lại một lệnh đã Kết thúc thì PI đó KHÔNG còn được giữ chỗ phần đã
   * nhả (luồng xuất sắt chặn cứng "không tìm thấy giữ chỗ" cho tới khi phương án cắt được duyệt lại).
   */
  async releaseByProductionInvoice(tx: PrismaTx, productionInvoiceId: bigint): Promise<number> {
    const rows = await tx.stockReservation.findMany({
      where: { productionInvoiceId, status: ReservationStatus.ACTIVE },
      select: { id: true, quantity: true, consumedQty: true },
    });
    const ids = rows
      .filter((r) => r.quantity.toNumber() > r.consumedQty.toNumber())
      .map((r) => r.id);
    if (ids.length === 0) return 0;
    const { count } = await tx.stockReservation.updateMany({
      where: { id: { in: ids }, status: ReservationStatus.ACTIVE },
      data: { status: ReservationStatus.RELEASED, releasedAt: new Date() },
    });
    return count;
  }
}
