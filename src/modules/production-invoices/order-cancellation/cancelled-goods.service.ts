import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CancelledGoodsKind,
  ProductionOrderCancelStatus,
  ProductionOrderStatus,
} from '../../../generated/prisma/client';
import { lockBusinessKey } from '../../../common/utils/advisory-lock.util';
import { loadLenhDisplayCodes } from '../../../common/utils/lenh-code.util';
import { parseBigIntId } from '../../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../../prisma/prisma.service';
import { RealtimeService } from '../../../realtime/realtime.service';
import { TransferCancelledGoodsDto } from './order-cancellation.dto';

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
  /** Khung đã đan đã nhận về còn chuyển được, theo mảnh. */
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

  /** Số còn chuyển được của nguồn: đã đóng gói (bộ) và khung đã đan theo mảnh. */
  private async availability(db: PrismaTx, orderId: bigint, itemId: bigint) {
    const [packed, shipped, receipts, transfers] = await Promise.all([
      db.packagingRecord.aggregate({
        where: { productionInvoiceItemId: itemId },
        _sum: { boxesPacked: true },
      }),
      db.bookingLine.aggregate({
        where: { productionInvoiceItemId: itemId },
        _sum: { shippedQty: true },
      }),
      db.weavingReceipt.groupBy({
        by: ['pieceId'],
        where: { productionOrderId: orderId },
        _sum: { qty: true },
      }),
      db.cancelledGoodsTransfer.findMany({
        where: { sourceItemId: itemId },
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
    for (const r of receipts) wovenByPiece.set(r.pieceId.toString(), r._sum.qty ?? 0);
    for (const t of transfers) {
      if (t.kind !== CancelledGoodsKind.WOVEN || t.pieceId == null) continue;
      const k = t.pieceId.toString();
      wovenByPiece.set(k, (wovenByPiece.get(k) ?? 0) - t.qty);
    }
    return { packedAvailable, wovenByPiece };
  }

  private async buildRow(db: PrismaTx, requestId: bigint): Promise<CancelledGoodsRowDto> {
    const req = await this.loadSource(db, requestId);
    const item = req.productionOrder.productionInvoiceItem;
    const { packedAvailable, wovenByPiece } = await this.availability(
      db,
      req.productionOrder.id,
      item.id,
    );
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
    const pieceId = dto.pieceId ? parseBigIntId(dto.pieceId) : null;
    if (dto.kind === CancelledGoodsKind.WOVEN && pieceId == null) {
      throw new BadRequestException('Chuyển khung đã đan phải chọn mảnh');
    }
    const head = await this.loadSource(this.prisma, id);
    if (head.status !== ProductionOrderCancelStatus.APPROVED) {
      throw new ConflictException('Chỉ chuyển hàng của SKU Sếp đã duyệt huỷ');
    }
    const src = head.productionOrder.productionInvoiceItem;

    await this.prisma.$transaction(async (tx) => {
      // Khoá nguồn rồi khoá đích (cùng khoá với tổ đóng gói / chuyền kiểm của đích) - 2 lần chuyển cùng lúc không vượt số còn.
      await lockBusinessKey(tx, `cancelled-goods:${src.id}`);
      if (dto.kind === CancelledGoodsKind.PACKED)
        await lockBusinessKey(tx, `packaging:${targetItemId}`);
      else await lockBusinessKey(tx, `transfer-check:${targetItemId}:${pieceId}`);

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
      if (
        dto.kind === CancelledGoodsKind.PACKED &&
        !nullableEq(target.cushionMaterialId, src.cushionMaterialId)
      ) {
        throw new BadRequestException('Khác vải nệm - không chuyển hàng đã đóng gói được');
      }

      const { packedAvailable, wovenByPiece } = await this.availability(
        tx,
        head.productionOrder.id,
        src.id,
      );
      if (dto.kind === CancelledGoodsKind.PACKED) {
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
        return;
      }

      // WOVEN
      const available = wovenByPiece.get(pieceId!.toString()) ?? 0;
      if (dto.qty > available)
        throw new BadRequestException(
          `Chỉ còn ${Math.max(0, available)} khung mảnh này chuyển được`,
        );
      const bomPiece = await tx.bomPiece.findFirst({
        where: { bomRevisionId: order.bomRevisionId, pieceId: pieceId! },
        select: { qtyPerUnit: true, isWoven: true },
      });
      if (!bomPiece?.isWoven)
        throw new BadRequestException('Mảnh này không phải khung đan trong định mức của SKU nhận');
      const need = bomPiece.qtyPerUnit * order.quantity;
      const [received, inSoFar] = await Promise.all([
        tx.weavingReceipt.aggregate({
          where: { productionOrderId: order.id, pieceId: pieceId! },
          _sum: { qty: true },
        }),
        tx.cancelledGoodsTransfer.aggregate({
          where: { targetItemId: target.id, pieceId: pieceId!, kind: CancelledGoodsKind.WOVEN },
          _sum: { qty: true },
        }),
      ]);
      const have = (received._sum.qty ?? 0) + (inSoFar._sum.qty ?? 0);
      if (have + dto.qty > need) {
        throw new BadRequestException(
          `Dòng nhận cần ${need} khung mảnh này, đã có ${have} - nhận thêm tối đa ${Math.max(0, need - have)}`,
        );
      }
      await tx.cancelledGoodsTransfer.create({
        data: {
          cancelRequestId: id,
          kind: dto.kind,
          sourceItemId: src.id,
          targetItemId: target.id,
          pieceId,
          qty: dto.qty,
          note: dto.note?.trim() || null,
          createdById: actorId,
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
}
