import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CancelledGoodsKind,
  CancelledGoodsReceiveStatus,
  ProductionOrderCancelStatus,
  ProductionOrderStatus,
} from '../../../generated/prisma/client';
import { lockBusinessKey } from '../../../common/utils/advisory-lock.util';
import { loadLenhDisplayCodes } from '../../../common/utils/lenh-code.util';
import { parseBigIntId } from '../../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../../prisma/prisma.service';
import { RealtimeService } from '../../../realtime/realtime.service';
import { TransferCancelledGoodsDto, WovenInTransitDto } from './order-cancellation.dto';
import { WovenStockService, tpWarehouseOf } from '../../woven-stock/woven-stock.service';

/** 1 dòng SKU đang chạy nhận được hàng của SKU đã huỷ. */
export interface GoodsTargetDto {
  itemId: string;
  lenhCode: string;
  orderCode: string | null;
  customerName: string | null;
  quantity: number;
  packedQty: number;
  /** Cùng màu dây (điều kiện cho cả 2 loại). */
  sameWire: boolean;
  /** Cùng vải nệm (thêm điều kiện cho hàng đã đóng gói). */
  sameCushion: boolean;
}

export interface CancelledGoodsRowDto {
  requestId: string;
  lenhCode: string;
  factoryCode: string;
  sourceItemId: string;
  wireName: string | null;
  cushionName: string | null;
  /** Hàng đã đóng gói còn chuyển được (bộ) = đã đóng - đã giao - đã chuyển. */
  packedAvailable: number;
  /** Kho thành phẩm của lệnh bị huỷ - nơi khung đan thành tồn (Q6 câu 3a). */
  warehouseCode: string;
  warehouseName: string;
  /** Khung đã đan còn tồn ở kho thành phẩm, theo mảnh (tự cấp cho lệnh sau cùng mảnh + màu dây - Q6 câu 1b). */
  woven: { pieceId: string; pieceCode: string; pieceName: string; available: number }[];
  targets: GoodsTargetDto[];
  transfers: {
    id: string;
    kind: CancelledGoodsKind;
    qty: number;
    pieceName: string | null;
    targetLenhCode: string;
    createdAt: Date;
  }[];
}

const nullableEq = (a: bigint | null, b: bigint | null) => (a ?? null) === (b ?? null);

/**
 * Huỷ lệnh đợt 2 - Q5 / Q6 (anh Nhân 24/11/2026). Q5: hàng đã đóng gói của SKU đã huỷ chuyển được sang đơn của khách khác, điều kiện
 * cùng sản phẩm + màu dây + vải nệm. Q6: khung đã đan (đã nhận về từ điểm đan) nhập kho thành phẩm - ở đây là chuyển sang 1 SKU đang
 * chạy cùng sản phẩm + màu dây để dùng tiếp (đích coi như đã nhận đan thêm, Chuyền kiểm làm tiếp). KHSX bấm, có dấu vết.
 */
@Injectable()
export class CancelledGoodsService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly realtime: RealtimeService,
    private readonly wovenStock: WovenStockService,
  ) {}

  /** Đề nghị huỷ đã duyệt có hàng đã đóng gói / khung đã đan còn chuyển được. */
  async list(): Promise<CancelledGoodsRowDto[]> {
    const reqs = await this.prisma.productionOrderCancelRequest.findMany({
      where: { status: ProductionOrderCancelStatus.APPROVED },
      select: { id: true },
      orderBy: { id: 'desc' },
      take: 200,
    });
    const out: CancelledGoodsRowDto[] = [];
    for (const r of reqs) {
      const row = await this.buildRow(this.prisma, r.id);
      if (row.packedAvailable > 0 || row.woven.length > 0 || row.transfers.length > 0)
        out.push(row);
    }
    return out;
  }

  private async loadSource(db: PrismaTx, requestId: bigint) {
    const req = await db.productionOrderCancelRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        productionOrder: {
          select: {
            id: true,
            productionInvoiceItem: {
              select: {
                id: true,
                productionInvoiceId: true,
                mfgProductId: true,
                wireMaterialId: true,
                cushionMaterialId: true,
                warehouseCode: true,
                mfgProduct: { select: { factoryCode: true } },
                wireMaterial: { select: { name: true } },
                cushionMaterial: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!req) throw new NotFoundException(`Không tìm thấy đề nghị huỷ ${requestId}`);
    return req;
  }

  /** Số còn chuyển được của nguồn: đã đóng gói (bộ); khung đã đan còn tồn theo mảnh (WovenStockService). */
  private async availability(db: PrismaTx, itemId: bigint) {
    const [packed, shipped, stock, transfers] = await Promise.all([
      db.packagingRecord.aggregate({
        where: { productionInvoiceItemId: itemId },
        _sum: { boxesPacked: true },
      }),
      db.bookingLine.aggregate({
        where: { productionInvoiceItemId: itemId },
        _sum: { shippedQty: true },
      }),
      this.wovenStock.loadStock(db),
      db.cancelledGoodsTransfer.findMany({
        where: { sourceItemId: itemId, kind: CancelledGoodsKind.PACKED },
        select: { kind: true, pieceId: true, qty: true },
      }),
    ]);
    const outPacked = transfers
      .filter((t) => t.kind === CancelledGoodsKind.PACKED)
      .reduce((s, t) => s + t.qty, 0);
    const packedAvailable = Math.max(
      0,
      (packed._sum.boxesPacked ?? 0) - (shipped._sum.shippedQty ?? 0) - outPacked,
    );
    const wovenByPiece = new Map<string, number>();
    for (const b of stock) {
      for (const s of b.sources) {
        if (s.sourceItemId !== itemId) continue;
        const k = b.pieceId.toString();
        wovenByPiece.set(k, (wovenByPiece.get(k) ?? 0) + s.qty);
      }
    }
    return { packedAvailable, wovenByPiece };
  }

  private async buildRow(db: PrismaTx, requestId: bigint): Promise<CancelledGoodsRowDto> {
    const req = await this.loadSource(db, requestId);
    const item = req.productionOrder.productionInvoiceItem;
    const { packedAvailable, wovenByPiece } = await this.availability(db, item.id);
    const wovenIds = [...wovenByPiece.entries()].filter(([, q]) => q > 0).map(([k]) => BigInt(k));
    const [pieces, targetRows, transfers] = await Promise.all([
      wovenIds.length
        ? db.piece.findMany({
            where: { id: { in: wovenIds } },
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve([]),
      db.productionInvoiceItem.findMany({
        where: {
          id: { not: item.id },
          mfgProductId: item.mfgProductId,
          cancelledAt: null,
          productionOrder: {
            is: {
              status: { not: ProductionOrderStatus.CANCELLED },
              floorStage: { not: 'FINISHED' },
            },
          },
        },
        select: {
          id: true,
          quantity: true,
          productionInvoiceId: true,
          wireMaterialId: true,
          cushionMaterialId: true,
          salesOrder: { select: { orderCode: true, customer: { select: { name: true } } } },
        },
        orderBy: { id: 'asc' },
        take: 50,
      }),
      db.cancelledGoodsTransfer.findMany({
        where: { cancelRequestId: requestId },
        select: {
          id: true,
          kind: true,
          qty: true,
          pieceId: true,
          targetItemId: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
      }),
    ]);
    const targetIds = targetRows.map((t) => t.id);
    const transferTargetIds = transfers.map((t) => t.targetItemId);
    const [packedSums, codeItems] = await Promise.all([
      targetIds.length
        ? db.packagingRecord.groupBy({
            by: ['productionInvoiceItemId'],
            where: { productionInvoiceItemId: { in: targetIds } },
            _sum: { boxesPacked: true },
          })
        : Promise.resolve([]),
      db.productionInvoiceItem.findMany({
        where: { id: { in: [...targetIds, ...transferTargetIds, item.id] } },
        select: { id: true, productionInvoiceId: true, lsxCode: true },
      }),
    ]);
    const piIds = [
      ...new Set(codeItems.map((c) => c.productionInvoiceId).filter((x): x is bigint => x != null)),
    ];
    const piCodes = await loadLenhDisplayCodes(this.prisma, piIds);
    const lenhOfItem = new Map(
      codeItems.map((c) => [
        c.id.toString(),
        c.lsxCode ??
          (c.productionInvoiceId != null ? piCodes.get(c.productionInvoiceId.toString()) : null) ??
          `#${c.id}`,
      ]),
    );
    const packedByItem = new Map(
      packedSums.map((p) => [p.productionInvoiceItemId.toString(), p._sum.boxesPacked ?? 0]),
    );
    const wc = tpWarehouseOf(item.warehouseCode);
    const wh = await db.warehouse.findUnique({ where: { code: wc }, select: { name: true } });
    const pieceById = new Map(pieces.map((p) => [p.id.toString(), p]));
    const allPieceIds = transfers.map((t) => t.pieceId).filter((x): x is bigint => x != null);
    const transferPieces = allPieceIds.length
      ? await db.piece.findMany({
          where: { id: { in: allPieceIds } },
          select: { id: true, name: true },
        })
      : [];
    const transferPieceName = new Map(transferPieces.map((p) => [p.id.toString(), p.name]));

    return {
      requestId: req.id.toString(),
      lenhCode: lenhOfItem.get(item.id.toString()) ?? `#${item.id}`,
      factoryCode: item.mfgProduct.factoryCode,
      sourceItemId: item.id.toString(),
      wireName: item.wireMaterial?.name ?? null,
      cushionName: item.cushionMaterial?.name ?? null,
      warehouseCode: wc,
      warehouseName: wh?.name ?? wc,
      packedAvailable,
      woven: wovenIds
        .map((id) => {
          const p = pieceById.get(id.toString());
          return {
            pieceId: id.toString(),
            pieceCode: p?.code ?? '',
            pieceName: p?.name ?? `Mảnh #${id}`,
            available: wovenByPiece.get(id.toString()) ?? 0,
          };
        })
        .sort((a, b) => a.pieceCode.localeCompare(b.pieceCode)),
      targets: targetRows.map((t) => ({
        itemId: t.id.toString(),
        lenhCode: lenhOfItem.get(t.id.toString()) ?? `#${t.id}`,
        orderCode: t.salesOrder?.orderCode ?? null,
        customerName: t.salesOrder?.customer?.name ?? null,
        quantity: t.quantity,
        packedQty: packedByItem.get(t.id.toString()) ?? 0,
        sameWire: nullableEq(t.wireMaterialId, item.wireMaterialId),
        sameCushion: nullableEq(t.cushionMaterialId, item.cushionMaterialId),
      })),
      transfers: transfers.map((t) => ({
        id: t.id.toString(),
        kind: t.kind,
        qty: t.qty,
        pieceName: t.pieceId != null ? (transferPieceName.get(t.pieceId.toString()) ?? null) : null,
        targetLenhCode: lenhOfItem.get(t.targetItemId.toString()) ?? `#${t.targetItemId}`,
        createdAt: t.createdAt,
      })),
    };
  }

  /** KHSX chuyển hàng của SKU đã huỷ sang 1 dòng SKU đang chạy. */
  async transfer(
    actorId: string,
    requestId: string,
    dto: TransferCancelledGoodsDto,
  ): Promise<CancelledGoodsRowDto> {
    const id = parseBigIntId(requestId);
    const targetItemId = parseBigIntId(dto.targetItemId);
    // Q6 câu 1b (anh Nhân 26/11/2026): khung đã đan không chuyển tay nữa - thành tồn khung đan kho thành phẩm, lệnh sau cùng mảnh +
    // màu dây tự lấy (WovenStockService).
    if (dto.kind === CancelledGoodsKind.WOVEN) {
      throw new BadRequestException(
        'Khung đã đan của SKU huỷ đã vào tồn khung đan kho thành phẩm - lệnh sau cùng mảnh + màu dây tự lấy, không chuyển tay',
      );
    }
    const head = await this.loadSource(this.prisma, id);
    if (head.status !== ProductionOrderCancelStatus.APPROVED) {
      throw new ConflictException('Chỉ chuyển hàng của SKU Sếp đã duyệt huỷ');
    }
    const src = head.productionOrder.productionInvoiceItem;

    await this.prisma.$transaction(async (tx) => {
      // Khoá nguồn rồi khoá đích (cùng khoá với tổ đóng gói / chuyền kiểm của đích) - 2 lần chuyển cùng lúc không vượt số còn.
      await lockBusinessKey(tx, `cancelled-goods:${src.id}`);
      await lockBusinessKey(tx, `packaging:${targetItemId}`);

      const target = await tx.productionInvoiceItem.findUnique({
        where: { id: targetItemId },
        select: {
          id: true,
          cancelledAt: true,
          mfgProductId: true,
          wireMaterialId: true,
          cushionMaterialId: true,
          productionOrder: {
            select: {
              id: true,
              status: true,
              floorStage: true,
              quantity: true,
              bomRevisionId: true,
            },
          },
        },
      });
      if (!target || target.id === src.id)
        throw new NotFoundException('Không tìm thấy dòng SKU nhận hàng');
      const order = target.productionOrder;
      if (target.cancelledAt || !order || order.status === ProductionOrderStatus.CANCELLED) {
        throw new ConflictException('Dòng SKU nhận phải là lệnh đang chạy (đã duyệt, chưa huỷ)');
      }
      if (order.floorStage === 'FINISHED') throw new ConflictException('Lệnh nhận đã Kết thúc');
      if (target.mfgProductId !== src.mfgProductId)
        throw new BadRequestException('Khác sản phẩm - không chuyển được');
      if (!nullableEq(target.wireMaterialId, src.wireMaterialId)) {
        throw new BadRequestException('Khác màu dây - không chuyển được');
      }
      if (!nullableEq(target.cushionMaterialId, src.cushionMaterialId)) {
        throw new BadRequestException('Khác vải nệm - không chuyển hàng đã đóng gói được');
      }

      const { packedAvailable } = await this.availability(tx, src.id);
      if (dto.qty > packedAvailable) {
        throw new BadRequestException(`Chỉ còn ${packedAvailable} bộ đã đóng gói chuyển được`);
      }
      const packed = await tx.packagingRecord.aggregate({
        where: { productionInvoiceItemId: target.id },
        _sum: { boxesPacked: true },
      });
      const soFar = packed._sum.boxesPacked ?? 0;
      if (soFar + dto.qty > order.quantity) {
        throw new BadRequestException(
          `Dòng nhận cần ${order.quantity} bộ, đã đóng ${soFar} - nhận thêm tối đa ${Math.max(0, order.quantity - soFar)} bộ`,
        );
      }
      const row = await tx.cancelledGoodsTransfer.create({
        data: {
          cancelRequestId: id,
          kind: dto.kind,
          sourceItemId: src.id,
          targetItemId: target.id,
          qty: dto.qty,
          note: dto.note?.trim() || null,
          createdById: actorId,
        },
      });
      await tx.packagingRecord.create({
        data: {
          productionInvoiceItemId: target.id,
          boxesPacked: dto.qty,
          note: `Chuyển từ SKU đã huỷ (đề nghị ${id})`,
          packedById: actorId,
          transferId: row.id,
        },
      });
    });
    this.realtime.publishEntityChanged({
      entity: 'PRODUCTION_ORDER',
      entityId: head.productionOrder.id,
      action: 'UPDATED',
      actorId,
    });
    return this.buildRow(this.prisma, id);
  }

  // ─── Nhân 26/11 câu 1: khung đan lấy khác kho thành phẩm - thủ kho nơi nhận xác nhận ─────────────────────────────────────

  /** Khung đan đang chuyển giữa 2 kho thành phẩm (lấy tồn khác kho), chờ thủ kho nơi nhận xác nhận. Phạm vi kho của người xem. */
  async listWovenInTransit(warehouseScope: string | null): Promise<WovenInTransitDto[]> {
    const rows = await this.prisma.cancelledGoodsTransfer.findMany({
      where: {
        kind: CancelledGoodsKind.WOVEN,
        receiveStatus: CancelledGoodsReceiveStatus.PENDING,
        ...(warehouseScope ? { toWarehouseCode: warehouseScope } : {}),
      },
      orderBy: { id: 'asc' },
      take: 200,
      select: {
        id: true,
        qty: true,
        pieceId: true,
        targetItemId: true,
        sourceItemId: true,
        fromWarehouseCode: true,
        toWarehouseCode: true,
        createdAt: true,
      },
    });
    if (rows.length === 0) return [];
    const itemIds = [...new Set(rows.flatMap((r) => [r.targetItemId, r.sourceItemId]))];
    const [items, pieces, warehouses] = await Promise.all([
      this.prisma.productionInvoiceItem.findMany({
        where: { id: { in: itemIds } },
        select: {
          id: true,
          productionInvoiceId: true,
          lsxCode: true,
          mfgProduct: { select: { factoryCode: true } },
          productionOrder: { select: { status: true } },
        },
      }),
      this.prisma.piece.findMany({
        where: {
          id: {
            in: [...new Set(rows.map((r) => r.pieceId).filter((p): p is bigint => p != null))],
          },
        },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.warehouse.findMany({
        where: {
          code: {
            in: [...new Set(rows.flatMap((r) => [r.fromWarehouseCode, r.toWarehouseCode]))].filter(
              (c): c is string => !!c,
            ),
          },
        },
        select: { code: true, name: true },
      }),
    ]);
    const itemById = new Map(items.map((i) => [i.id.toString(), i]));
    const pieceById = new Map(pieces.map((p) => [p.id.toString(), p]));
    const whName = new Map(warehouses.map((w) => [w.code, w.name]));
    const lenh = await loadLenhDisplayCodes(
      this.prisma,
      items.map((i) => i.productionInvoiceId).filter((x): x is bigint => x != null),
    );
    const lenhOf = (id: bigint) => {
      const it = itemById.get(id.toString());
      return (
        (it?.productionInvoiceId != null ? lenh.get(it.productionInvoiceId.toString()) : null) ??
        it?.lsxCode ??
        ''
      );
    };
    return rows.map((r) => {
      const piece = r.pieceId != null ? pieceById.get(r.pieceId.toString()) : undefined;
      return {
        id: r.id.toString(),
        qty: r.qty,
        pieceCode: piece?.code ?? '',
        pieceName: piece?.name ?? '',
        targetLenhCode: lenhOf(r.targetItemId),
        targetFactoryCode: itemById.get(r.targetItemId.toString())?.mfgProduct.factoryCode ?? '',
        sourceLenhCode: lenhOf(r.sourceItemId),
        sourceFactoryCode: itemById.get(r.sourceItemId.toString())?.mfgProduct.factoryCode ?? '',
        fromWarehouseName: whName.get(r.fromWarehouseCode ?? '') ?? r.fromWarehouseCode ?? '',
        toWarehouseName: whName.get(r.toWarehouseCode ?? '') ?? r.toWarehouseCode ?? '',
        createdAt: r.createdAt.toISOString(),
        targetCancelled:
          itemById.get(r.targetItemId.toString())?.productionOrder?.status ===
          ProductionOrderStatus.CANCELLED,
      };
    });
  }

  /**
   * Thủ kho thành phẩm nơi nhận xác nhận số khung thực nhận (nhận > 0 thì bắt buộc ảnh phiếu chuyển đã ký, cùng luật phiếu CK).
   * Dòng chỉ còn đúng số thực nhận; phần không nhận về lại tồn kho nguồn (nhận 0 = bỏ dòng) rồi cấp tồn lại. Lệnh nhận đã huỷ
   * trong lúc khung đang chuyển (Nhân 27/11 cách 2): phần nhận thành tồn của lệnh đó ở kho này.
   */
  async confirmWovenReceived(
    actorId: string,
    transferId: string,
    signedSlipUrls: string[],
    warehouseScope: string | null,
    receivedQty?: number,
  ): Promise<WovenInTransitDto[]> {
    const id = parseBigIntId(transferId);
    const urls = (signedSlipUrls ?? []).map((u) => u.trim()).filter(Boolean);
    if (receivedQty != null && (!Number.isInteger(receivedQty) || receivedQty < 0)) {
      throw new BadRequestException('Số khung thực nhận phải là số nguyên ≥ 0');
    }
    if (urls.length === 0 && receivedQty !== 0) {
      throw new BadRequestException('Phải tải lên ít nhất 1 ảnh phiếu chuyển đã ký');
    }
    const done = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `woven-receive:${id}`);
      const row = await tx.cancelledGoodsTransfer.findUnique({
        where: { id },
        select: {
          receiveStatus: true,
          toWarehouseCode: true,
          targetItemId: true,
          pieceId: true,
          qty: true,
        },
      });
      if (!row) throw new NotFoundException(`Không tìm thấy dòng chuyển khung ${transferId}`);
      if (row.receiveStatus !== CancelledGoodsReceiveStatus.PENDING) {
        throw new ConflictException(
          'Dòng chuyển khung này không còn chờ nhận (đã nhận rồi hoặc không cần chuyển)',
        );
      }
      if (warehouseScope && warehouseScope !== row.toWarehouseCode) {
        throw new ForbiddenException('Bạn chỉ xác nhận được khung chuyển về kho mình phụ trách');
      }
      const got = receivedQty ?? row.qty;
      if (got > row.qty) {
        throw new BadRequestException(
          `Số khung thực nhận (${got}) không được vượt số đang chuyển (${row.qty})`,
        );
      }
      if (got === 0) {
        await tx.cancelledGoodsTransfer.delete({ where: { id } });
      } else {
        await tx.cancelledGoodsTransfer.update({
          where: { id },
          data: {
            qty: got,
            receiveStatus: CancelledGoodsReceiveStatus.RECEIVED,
            receivedById: actorId,
            receivedAt: new Date(),
            signedSlipUrls: urls,
          },
        });
      }
      const order = await tx.productionOrder.findFirst({
        where: { productionInvoiceItemId: row.targetItemId },
        select: { id: true, status: true },
      });
      return { order, pieceId: row.pieceId, short: got < row.qty };
    });
    // Phần không nhận về lại kho nguồn; lệnh nhận đã huỷ thì phần nhận thành tồn kho này - cả hai cần cấp tồn lại.
    if (done.short || done.order?.status === ProductionOrderStatus.CANCELLED) {
      await this.wovenStock.allocateAll(
        actorId,
        done.pieceId != null ? { pieceId: done.pieceId } : {},
      );
    }
    if (done.order) {
      this.realtime.publishEntityChanged({
        entity: 'PRODUCTION_ORDER',
        entityId: done.order.id,
        action: 'UPDATED',
        actorId,
      });
    }
    return this.listWovenInTransit(warehouseScope);
  }
}
