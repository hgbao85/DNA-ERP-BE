import * as crypto from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  LocationMovementKind,
  MfgRole,
  Prisma,
  WorkstationKind,
} from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType, type PrismaTx } from '../../prisma/prisma.service';
import {
  addLocationStock,
  isUniqueViolationAny,
  lockTriplesAndLocations,
  takeLocationStock,
} from './location-stock.tx';
import { VI_TRI_KHO_DISABLED_MESSAGE, isViTriKhoEnabled } from './vi-tri-kho.config';
import {
  labelOf,
  loadItemOrThrow,
  loadItems,
  mixWarningFor,
  resolveFgWarehouse,
  resolveLocationByToken,
  tripleOf,
  type FgWarehouse,
  type ItemRow,
  type LocationRow,
} from './vi-tri-kho.read';
import {
  buildBulkLocations,
  buildLocation,
  compareLocationCode,
  tripleText,
  type LocationParts,
  type Triple,
} from './vi-tri-kho.util';
import type {
  BulkCreateLocationsDto,
  CreateLocationDto,
  ListMovementsQueryDto,
  MoveStockDto,
  PutawayDto,
} from './dto/vi-tri-kho.dto';

const newLocationToken = (): string => crypto.randomBytes(18).toString('base64url');

type Person = { firstName: string; lastName: string; username: string } | null;
const nameOf = (u: Person): string | null =>
  u ? `${u.lastName} ${u.firstName}`.trim() || u.username : null;

const KIND_LABEL: Record<LocationMovementKind, string> = {
  PUTAWAY: 'Cất vào ô',
  PUTAWAY_CANCEL: 'Huỷ báo đóng gói',
  MOVE: 'Chuyển ô',
  PICK: 'Lấy cho booking',
  UNPICK: 'Trả từ cont về ô',
};

/**
 * Vị trí kho Thành phẩm (25/11/2026 - docs THIET-KE-VI-TRI-KHO-LOAD-CONT, V1-V4, V9), bật bằng VI_TRI_KHO_ENABLED:
 *  - V1 khai ô (1 ô / hàng loạt), tắt ô (chỉ khi trống), tem QR `<origin>/floor?loc=<qrToken>`;
 *  - V2 cất khi công nhân đóng gói báo (putawayFromPackingInTx - CkDgQrService gọi trong transaction ghi đóng gói);
 *  - V3 nhắc khi cất vào ô đã có bộ 3 khác (không chặn); V9 mọi dòng theo bộ 3 SKU - LSX - PO;
 *  - V4 tồn thùng theo bộ 3 (chỉ phần còn lại) + còn phải đóng + ô đang giữ; xem theo ô; chuyển ô; lịch sử.
 * Soạn hàng / cont: BookingLoadService.
 */
@Injectable()
export class ViTriKhoService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  getConfig() {
    return { enabled: isViTriKhoEnabled() };
  }

  private assertEnabled(): void {
    if (!isViTriKhoEnabled()) throw new BadRequestException(VI_TRI_KHO_DISABLED_MESSAGE);
  }

  // ─── V1: khai ô ──────────────────────────────────────────────────────────────────────────

  /** Ô của kho + hàng đang nằm ở từng ô (xem theo ô). Tắt công tắc: { enabled: false }. */
  async listLocations(scope: string | null, warehouseCode?: string) {
    if (!isViTriKhoEnabled()) return { enabled: false as const };
    const wh = await resolveFgWarehouse(this.prisma, scope, warehouseCode);
    const locs = await this.prisma.warehouseLocation.findMany({
      where: { warehouseId: wh.id },
      select: {
        id: true,
        code: true,
        zone: true,
        aisle: true,
        slot: true,
        qrToken: true,
        isActive: true,
        stocks: {
          where: { qty: { gt: 0 } },
          select: { productionInvoiceItemId: true, qty: true },
        },
      },
    });
    locs.sort((a, b) => compareLocationCode(a.code, b.code));
    const items = await loadItems(
      this.prisma,
      locs.flatMap((l) => l.stocks.map((s) => s.productionInvoiceItemId)),
    );
    return {
      enabled: true as const,
      warehouse: this.toWarehouse(wh),
      locations: locs.map((l) => ({
        id: l.id.toString(),
        code: l.code,
        zone: l.zone,
        aisle: l.aisle,
        slot: l.slot,
        qrToken: l.qrToken,
        isActive: l.isActive,
        totalQty: l.stocks.reduce((s, x) => s + x.qty, 0),
        lines: l.stocks.map((s) => ({
          ...labelOf(items.get(s.productionInvoiceItemId.toString())!),
          qty: s.qty,
        })),
      })),
    };
  }

  async createLocation(dto: CreateLocationDto, scope: string | null) {
    this.assertEnabled();
    const parts = buildLocation(dto);
    if (typeof parts === 'string') throw new BadRequestException(parts);
    const wh = await resolveFgWarehouse(this.prisma, scope, dto.warehouseCode);
    const { created, skipped } = await this.insertLocations(wh, [parts]);
    if (created.length === 0) {
      throw new ConflictException(`Ô ${skipped[0]} đã có ở ${wh.name}`);
    }
    return created[0];
  }

  /** V1: khai hàng loạt - ô đã có thì bỏ qua (trả danh sách bỏ qua), không lỗi cả lô. */
  async bulkCreate(dto: BulkCreateLocationsDto, scope: string | null) {
    this.assertEnabled();
    const parts = buildBulkLocations(dto);
    if (typeof parts === 'string') throw new BadRequestException(parts);
    const wh = await resolveFgWarehouse(this.prisma, scope, dto.warehouseCode);
    return this.insertLocations(wh, parts);
  }

  private async insertLocations(wh: FgWarehouse, parts: LocationParts[]) {
    const existing = await this.prisma.warehouseLocation.findMany({
      where: { warehouseId: wh.id, code: { in: parts.map((p) => p.code) } },
      select: { code: true },
    });
    const have = new Set(existing.map((e) => e.code));
    const fresh = parts.filter((p) => !have.has(p.code));
    if (fresh.length > 0) {
      await this.prisma.warehouseLocation.createMany({
        data: fresh.map((p) => ({ ...p, warehouseId: wh.id, qrToken: newLocationToken() })),
        // 2 người khai trùng cùng lúc: dòng sau bỏ qua (unique kho + mã), không lỗi.
        skipDuplicates: true,
      });
    }
    const rows = await this.prisma.warehouseLocation.findMany({
      where: { warehouseId: wh.id, code: { in: fresh.map((p) => p.code) } },
      select: {
        id: true,
        code: true,
        zone: true,
        aisle: true,
        slot: true,
        qrToken: true,
        isActive: true,
      },
    });
    rows.sort((a, b) => compareLocationCode(a.code, b.code));
    return {
      warehouse: this.toWarehouse(wh),
      created: rows.map((r) => ({ ...r, id: r.id.toString(), totalQty: 0, lines: [] })),
      skipped: parts.filter((p) => have.has(p.code)).map((p) => p.code),
    };
  }

  /** Bật / tắt ô. Tắt chỉ khi ô trống (hàng còn nằm đó thì chuyển đi trước). */
  async setActive(idRaw: string, isActive: boolean, scope: string | null) {
    this.assertEnabled();
    const id = parseBigIntId(idRaw);
    return this.prisma.$transaction(async (tx) => {
      const loc = await tx.warehouseLocation.findUnique({
        where: { id },
        select: { id: true, code: true, warehouse: { select: { code: true } } },
      });
      if (!loc) throw new NotFoundException(`Không có ô ${idRaw}`);
      if (scope && loc.warehouse.code !== scope) {
        throw new ForbiddenException(`Ô ${loc.code} thuộc kho khác`);
      }
      await lockTriplesAndLocations(tx, [], [loc.id]);
      if (!isActive) {
        const left = await tx.locationStock.aggregate({
          where: { locationId: id },
          _sum: { qty: true },
        });
        if ((left._sum.qty ?? 0) > 0) {
          throw new ConflictException(
            `Ô ${loc.code} còn ${left._sum.qty} bộ - chuyển hết sang ô khác rồi mới tắt`,
          );
        }
      }
      const r = await tx.warehouseLocation.update({
        where: { id },
        data: { isActive },
        select: { id: true, code: true, isActive: true },
      });
      return { id: r.id.toString(), code: r.code, isActive: r.isActive };
    });
  }

  /** Thủ kho quét tem ô: ô + hàng đang ở ô. */
  async lookupByToken(token: string, scope: string | null) {
    if (!isViTriKhoEnabled()) return { enabled: false as const };
    const loc = await resolveLocationByToken(this.prisma, token, { allowInactive: true });
    if (scope && loc.warehouse.code !== scope) {
      throw new ForbiddenException(`Ô ${loc.code} thuộc ${loc.warehouse.name}`);
    }
    return { enabled: true as const, location: await this.locationDto(loc) };
  }

  /**
   * V2/V3: công nhân đóng gói quét tem ô ở màn /floor. `ws` (tem khu đóng gói đang báo) cho thì ô phải cùng kho Thành phẩm;
   * `itemId` cho thì kèm lời nhắc trộn hàng nếu ô đang có bộ 3 khác.
   */
  async floorScan(token: string, user: AuthenticatedUser, ws?: string, itemIdRaw?: string) {
    if (!isViTriKhoEnabled()) return { enabled: false as const };
    if (user.mfgRole !== MfgRole.DONG_GOI) {
      throw new ForbiddenException('Tem vị trí kho dành cho tổ Đóng gói và thủ kho Thành phẩm');
    }
    let warehouseId: bigint | undefined;
    if (ws) {
      const station = await this.prisma.workstation.findUnique({
        where: { qrToken: ws },
        select: { kind: true, warehouseId: true },
      });
      if (station?.kind === WorkstationKind.PACKING && station.warehouseId != null) {
        warehouseId = station.warehouseId;
      }
    }
    const loc = await resolveLocationByToken(this.prisma, token, { warehouseId });
    let mix: string | null = null;
    if (itemIdRaw) {
      const item = await loadItemOrThrow(this.prisma, parseBigIntId(itemIdRaw));
      mix = await mixWarningFor(this.prisma, loc, tripleOf(item));
    }
    return { enabled: true as const, location: await this.locationDto(loc), mixWarning: mix };
  }

  // ─── V2: cất khi báo đóng gói (gọi trong transaction của CkDgQrService) ──────────────────────

  /** Kiểm ô trước transaction: còn dùng, đúng kho Thành phẩm của khu đóng gói. */
  async assertPackingLocation(locationIdRaw: string, warehouseId: bigint | null) {
    const id = parseBigIntId(locationIdRaw);
    const loc = await this.prisma.warehouseLocation.findUnique({
      where: { id },
      select: { id: true, code: true, isActive: true, warehouseId: true },
    });
    if (!loc) throw new NotFoundException('Không có ô này - quét lại tem vị trí');
    if (!loc.isActive) throw new ConflictException(`Ô ${loc.code} đang tắt - cất vào ô khác`);
    if (warehouseId != null && loc.warehouseId !== warehouseId) {
      throw new ConflictException(
        `Ô ${loc.code} không thuộc kho Thành phẩm của khu đóng gói - quét tem ô của đúng kho`,
      );
    }
    return { id: loc.id, code: loc.code };
  }

  /**
   * Cộng số vừa đóng vào ô, ghi vết PUTAWAY - CÙNG transaction ghi PackagingRecord + PackingReport (đã giữ khoá đóng gói của SKU).
   * Trả lời nhắc trộn hàng (V3) đọc trước khi cộng.
   */
  async putawayFromPackingInTx(
    tx: PrismaTx,
    p: {
      location: { id: bigint; code: string };
      item: { id: bigint; mfgProductId: bigint; salesOrderItemId: bigint | null };
      qty: number;
      packingReportId: bigint;
      actorId: string;
    },
  ): Promise<string | null> {
    const t = tripleOf(p.item);
    await lockTriplesAndLocations(tx, [p.item.id], [p.location.id]);
    // Ô có thể vừa bị tắt sau bước kiểm ngoài transaction.
    const live = await tx.warehouseLocation.findUnique({
      where: { id: p.location.id },
      select: { isActive: true },
    });
    if (!live?.isActive)
      throw new ConflictException(`Ô ${p.location.code} vừa bị tắt - cất vào ô khác`);
    const mix = await mixWarningFor(tx, p.location, t);
    await addLocationStock(tx, p.location.id, t, p.qty);
    await tx.locationStockMovement.create({
      data: {
        kind: LocationMovementKind.PUTAWAY,
        toLocationId: p.location.id,
        ...this.tripleData(t),
        qty: p.qty,
        packingReportId: p.packingReportId,
        actorId: p.actorId,
      },
    });
    return mix;
  }

  /** D4 + vị trí kho: huỷ lần báo đóng gói đã cất vào ô -> lấy đúng số đó ra khỏi ô (hàng đã chuyển / lấy đi thì 409). */
  async cancelPutawayInTx(
    tx: PrismaTx,
    p: {
      locationId: bigint;
      item: { id: bigint; mfgProductId: bigint; salesOrderItemId: bigint | null };
      qty: number;
      packingReportId: bigint;
      actorId: string;
    },
  ): Promise<void> {
    const t = tripleOf(p.item);
    await lockTriplesAndLocations(tx, [p.item.id], [p.locationId]);
    const loc = await tx.warehouseLocation.findUniqueOrThrow({
      where: { id: p.locationId },
      select: { code: true },
    });
    await takeLocationStock(
      tx,
      p.locationId,
      t,
      p.qty,
      (have) =>
        `Ô ${loc.code} chỉ còn ${have} bộ của lần báo này (đã chuyển ô hoặc đã lấy cho booking) - chuyển về ô ${loc.code} đủ ${p.qty} bộ rồi mới huỷ`,
    );
    await tx.locationStockMovement.create({
      data: {
        kind: LocationMovementKind.PUTAWAY_CANCEL,
        fromLocationId: p.locationId,
        ...this.tripleData(t),
        qty: p.qty,
        packingReportId: p.packingReportId,
        actorId: p.actorId,
      },
    });
  }

  /**
   * Huỷ lần báo đóng gói CŨ (báo lúc chưa bật công tắc, chưa gắn ô - `locationId` rỗng): thủ kho có thể đã cất hàng đó vào ô bằng
   * "cất hàng chưa có ô". Sau khi xoá PackagingRecord (cùng transaction, đã giữ khoá packaging của SKU), số đã đóng còn lại không
   * được nhỏ hơn số đang ở ô + số đã ra khỏi ô (vào cont / đã xuất) - nếu nhỏ hơn thì 409, rollback cả lần huỷ. Công tắc tắt: không làm gì.
   * Thứ tự khoá chung: packaging (người gọi đã giữ) -> bộ 3.
   */
  async assertCancelKeepsBinStockInTx(tx: PrismaTx, item: { id: bigint }): Promise<void> {
    if (!isViTriKhoEnabled()) return;
    await lockTriplesAndLocations(tx, [item.id], []);
    const f = (await this.loadFlows(tx, [item.id])).get(item.id.toString());
    const packed = f?.packed ?? 0;
    const inBins = f?.inLocationsAll ?? 0;
    const outflow = f?.outflow ?? 0;
    if (packed >= inBins + outflow) return;
    if (inBins > 0) {
      const rows = await tx.locationStock.findMany({
        where: { productionInvoiceItemId: item.id, qty: { gt: 0 } },
        select: { location: { select: { code: true } } },
      });
      const codes = [...new Set(rows.map((r) => r.location.code))].join(', ');
      throw new ConflictException(
        `Hàng của lần báo này đã cất vào ô ${codes}. Lấy hàng ra khỏi ô trước rồi mới huỷ.`,
      );
    }
    throw new ConflictException(
      'Hàng của lần báo này đã lấy vào cont / đã xuất. Gỡ hàng khỏi cont (hoặc xử lý phiếu xuất) trước rồi mới huỷ.',
    );
  }

  // ─── V4: tồn thùng theo bộ 3, chuyển ô, cất hàng chưa có ô, lịch sử ─────────────────────────────

  /**
   * V4 "Tồn kho thùng" của 1 kho Thành phẩm: mỗi bộ 3 (lệnh · SKU · PO) + dòng tổng. CHỈ phần còn lại (không có cột đã xuất):
   *  - inStockQty   = đang nằm ở ô của kho này (kèm danh sách ô);
   *  - loadingQty   = đã lấy vào cont của booking chưa xuất;
   *  - unplacedQty  = đã đóng gói nhưng chưa cất ô (đóng trước khi bật / nhập tay) = đã đóng − ở ô − đã vào cont − đã xuất ngoài cont;
   *  - toPackQty    = còn phải đóng = số lượng lệnh − đã đóng.
   * Bộ 3 hiện khi còn bất kỳ số nào trong 4 số trên.
   */
  async stockByTriple(scope: string | null, warehouseCode?: string) {
    if (!isViTriKhoEnabled()) return { enabled: false as const };
    const wh = await resolveFgWarehouse(this.prisma, scope, warehouseCode);
    const stocks = await this.prisma.locationStock.findMany({
      where: { qty: { gt: 0 }, location: { warehouseId: wh.id } },
      select: {
        productionInvoiceItemId: true,
        qty: true,
        location: { select: { id: true, code: true } },
      },
    });
    // Dòng SKU của kho này (QLSX chọn kho) còn lệnh SX chưa huỷ.
    const scoped = await this.prisma.productionInvoiceItem.findMany({
      where: {
        warehouseCode: wh.code,
        cancelledAt: null,
        productionOrder: { is: { status: { not: 'CANCELLED' } } },
      },
      select: { id: true },
      take: 1000,
      orderBy: { id: 'desc' },
    });
    const ids = [
      ...new Set([
        ...stocks.map((s) => s.productionInvoiceItemId.toString()),
        ...scoped.map((s) => s.id.toString()),
      ]),
    ].map((x) => BigInt(x));
    const [items, flows] = await Promise.all([
      loadItems(this.prisma, ids),
      this.loadFlows(this.prisma, ids),
    ]);
    const byItem = new Map<
      string,
      { qty: number; locations: { id: string; code: string; qty: number }[] }
    >();
    for (const s of stocks) {
      const k = s.productionInvoiceItemId.toString();
      const e = byItem.get(k) ?? { qty: 0, locations: [] };
      e.qty += s.qty;
      e.locations.push({ id: s.location.id.toString(), code: s.location.code, qty: s.qty });
      byItem.set(k, e);
    }
    const rows = ids
      .map((id) => {
        const k = id.toString();
        const it = items.get(k);
        if (!it) return null;
        const f = flows.get(k) ?? { packed: 0, inLocationsAll: 0, loading: 0, outflow: 0 };
        const here = byItem.get(k) ?? { qty: 0, locations: [] };
        const label = labelOf(it);
        const row = {
          ...label,
          inStockQty: here.qty,
          locations: here.locations.sort((a, b) => compareLocationCode(a.code, b.code)),
          loadingQty: f.loading,
          unplacedQty: Math.max(0, f.packed - f.inLocationsAll - f.outflow),
          toPackQty: Math.max(0, label.orderQty - f.packed),
        };
        return row.inStockQty + row.loadingQty + row.unplacedQty + row.toPackQty > 0 ? row : null;
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort(
        (a, b) =>
          a.lenhCode.localeCompare(b.lenhCode, 'en', { numeric: true }) ||
          a.sku.localeCompare(b.sku),
      );
    const total = rows.reduce(
      (s, r) => ({
        inStockQty: s.inStockQty + r.inStockQty,
        loadingQty: s.loadingQty + r.loadingQty,
        unplacedQty: s.unplacedQty + r.unplacedQty,
        toPackQty: s.toPackQty + r.toPackQty,
      }),
      { inStockQty: 0, loadingQty: 0, unplacedQty: 0, toPackQty: 0 },
    );
    return { enabled: true as const, warehouse: this.toWarehouse(wh), rows, total };
  }

  /**
   * Số theo dòng SKU (mọi kho): đã đóng, đang ở ô, đã vào cont của booking chưa xuất (loading), đã ra khỏi ô (vào cont của booking
   * chưa huỷ + đã xuất của booking xuất không qua cont - trước khi bật).
   */
  private async loadFlows(
    db: Pick<
      PrismaTx,
      'packagingRecord' | 'locationStock' | 'bookingContainerLine' | 'bookingLine'
    >,
    ids: bigint[],
  ) {
    const out = new Map<
      string,
      { packed: number; inLocationsAll: number; loading: number; outflow: number }
    >();
    if (ids.length === 0) return out;
    const [packed, inLoc, contLines, legacyShipped] = await Promise.all([
      db.packagingRecord.groupBy({
        by: ['productionInvoiceItemId'],
        where: { productionInvoiceItemId: { in: ids } },
        _sum: { boxesPacked: true },
      }),
      db.locationStock.groupBy({
        by: ['productionInvoiceItemId'],
        where: { productionInvoiceItemId: { in: ids } },
        _sum: { qty: true },
      }),
      db.bookingContainerLine.findMany({
        where: {
          productionInvoiceItemId: { in: ids },
          container: { booking: { status: { not: BookingStatus.CANCELLED } } },
        },
        select: {
          productionInvoiceItemId: true,
          qty: true,
          container: { select: { booking: { select: { status: true } } } },
        },
      }),
      db.bookingLine.groupBy({
        by: ['productionInvoiceItemId'],
        where: {
          productionInvoiceItemId: { in: ids },
          booking: { status: BookingStatus.SHIPPED, containers: { none: {} } },
        },
        _sum: { shippedQty: true },
      }),
    ]);
    const get = (k: string) => {
      let e = out.get(k);
      if (!e) {
        e = { packed: 0, inLocationsAll: 0, loading: 0, outflow: 0 };
        out.set(k, e);
      }
      return e;
    };
    for (const r of packed)
      get(r.productionInvoiceItemId.toString()).packed = r._sum.boxesPacked ?? 0;
    for (const r of inLoc)
      get(r.productionInvoiceItemId.toString()).inLocationsAll = r._sum.qty ?? 0;
    for (const r of contLines) {
      const e = get(r.productionInvoiceItemId.toString());
      e.outflow += r.qty;
      if (r.container.booking.status !== BookingStatus.SHIPPED) e.loading += r.qty;
    }
    for (const r of legacyShipped)
      get(r.productionInvoiceItemId.toString()).outflow += r._sum.shippedQty ?? 0;
    return out;
  }

  /** V4: chuyển ô (quét ô đi -> ô đến). Cùng kho. Nhắc trộn hàng ở ô đến. Idempotency-Key bắt buộc. */
  async move(
    dto: MoveStockDto,
    actorId: string,
    scope: string | null,
    idempotencyKey: string | undefined,
  ) {
    this.assertEnabled();
    if (!idempotencyKey) throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    const replay = await this.replay(idempotencyKey, actorId);
    if (replay) return replay;
    const from = await resolveLocationByToken(this.prisma, dto.fromToken, { allowInactive: true });
    const to = await resolveLocationByToken(this.prisma, dto.toToken);
    if (from.id === to.id) throw new BadRequestException('Ô đi và ô đến trùng nhau - quét ô khác');
    if (from.warehouseId !== to.warehouseId) {
      throw new BadRequestException(
        `Ô ${from.code} và ô ${to.code} khác kho - chuyển kho Thành phẩm dùng phiếu chuyển kho`,
      );
    }
    this.assertLocationScope(from, scope);
    const item = await loadItemOrThrow(this.prisma, parseBigIntId(dto.itemId));
    const t = tripleOf(item);
    return this.runMovement(idempotencyKey, actorId, async (tx) => {
      await lockTriplesAndLocations(tx, [item.id], [from.id, to.id]);
      await this.assertActive(tx, to);
      await takeLocationStock(
        tx,
        from.id,
        t,
        dto.qty,
        (have) =>
          `Ô ${from.code} chỉ có ${have} bộ ${tripleText(labelOf(item))} - không chuyển được ${dto.qty} bộ`,
      );
      const mix = await mixWarningFor(tx, to, t);
      await addLocationStock(tx, to.id, t, dto.qty);
      const m = await tx.locationStockMovement.create({
        data: {
          kind: LocationMovementKind.MOVE,
          fromLocationId: from.id,
          toLocationId: to.id,
          ...this.tripleData(t),
          qty: dto.qty,
          actorId,
          note: dto.note?.trim() || null,
          idempotencyKey,
        },
        select: { id: true },
      });
      return { movementId: m.id, mixWarning: mix };
    });
  }

  /**
   * Thủ kho cất hàng ĐÃ đóng gói nhưng chưa có ô (đóng trước khi bật công tắc / nhập tay) - không vượt số "chưa cất ô".
   * Idempotency-Key bắt buộc.
   */
  async putaway(
    dto: PutawayDto,
    actorId: string,
    scope: string | null,
    idempotencyKey: string | undefined,
  ) {
    this.assertEnabled();
    if (!idempotencyKey) throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    const replay = await this.replay(idempotencyKey, actorId);
    if (replay) return replay;
    const to = await resolveLocationByToken(this.prisma, dto.locationToken);
    this.assertLocationScope(to, scope);
    const item = await loadItemOrThrow(this.prisma, parseBigIntId(dto.itemId));
    const t = tripleOf(item);
    return this.runMovement(idempotencyKey, actorId, async (tx) => {
      await lockTriplesAndLocations(tx, [item.id], [to.id]);
      await this.assertActive(tx, to);
      const f = (await this.loadFlows(tx, [item.id])).get(item.id.toString());
      const unplaced = Math.max(0, (f?.packed ?? 0) - (f?.inLocationsAll ?? 0) - (f?.outflow ?? 0));
      if (dto.qty > unplaced) {
        throw new BadRequestException(
          `${tripleText(labelOf(item))}: chỉ còn ${unplaced} bộ đã đóng gói chưa cất ô - không cất ${dto.qty} bộ`,
        );
      }
      const mix = await mixWarningFor(tx, to, t);
      await addLocationStock(tx, to.id, t, dto.qty);
      const m = await tx.locationStockMovement.create({
        data: {
          kind: LocationMovementKind.PUTAWAY,
          toLocationId: to.id,
          ...this.tripleData(t),
          qty: dto.qty,
          actorId,
          note: 'Thủ kho cất hàng đã đóng gói chưa có ô',
          idempotencyKey,
        },
        select: { id: true },
      });
      return { movementId: m.id, mixWarning: mix };
    });
  }

  /** Lịch sử dịch chuyển của kho (lọc theo ô / dòng SKU), 300 dòng mới nhất. */
  async movements(query: ListMovementsQueryDto, scope: string | null) {
    if (!isViTriKhoEnabled()) return { enabled: false as const };
    const wh = await resolveFgWarehouse(this.prisma, scope, query.warehouseCode);
    const locationId = query.locationId ? parseBigIntId(query.locationId) : undefined;
    const where: Prisma.LocationStockMovementWhereInput = {
      AND: [
        { OR: [{ fromLocation: { warehouseId: wh.id } }, { toLocation: { warehouseId: wh.id } }] },
        ...(locationId
          ? [{ OR: [{ fromLocationId: locationId }, { toLocationId: locationId }] }]
          : []),
        ...(query.itemId ? [{ productionInvoiceItemId: parseBigIntId(query.itemId) }] : []),
      ],
    };
    const rows = await this.prisma.locationStockMovement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        id: true,
        kind: true,
        qty: true,
        note: true,
        createdAt: true,
        productionInvoiceItemId: true,
        fromLocation: { select: { code: true } },
        toLocation: { select: { code: true } },
        booking: { select: { bookingNo: true } },
        container: { select: { containerNo: true } },
        actor: { select: { firstName: true, lastName: true, username: true } },
      },
    });
    const items = await loadItems(
      this.prisma,
      rows.map((r) => r.productionInvoiceItemId),
    );
    return {
      enabled: true as const,
      warehouse: this.toWarehouse(wh),
      movements: rows.map((r) => ({
        id: r.id.toString(),
        kind: r.kind,
        kindLabel: KIND_LABEL[r.kind],
        qty: r.qty,
        note: r.note,
        createdAt: r.createdAt,
        fromCode: r.fromLocation?.code ?? null,
        toCode: r.toLocation?.code ?? null,
        bookingNo: r.booking?.bookingNo ?? null,
        containerNo: r.container?.containerNo ?? null,
        actorName: nameOf(r.actor),
        ...labelOf(items.get(r.productionInvoiceItemId.toString())!),
      })),
    };
  }

  // ─── Phụ ───────────────────────────────────────────────────────────────────────────────

  private tripleData(t: Triple) {
    return {
      productionInvoiceItemId: t.productionInvoiceItemId,
      mfgProductId: t.mfgProductId,
      salesOrderItemId: t.salesOrderItemId,
    };
  }

  private assertLocationScope(loc: LocationRow, scope: string | null) {
    if (scope && loc.warehouse.code !== scope) {
      throw new ForbiddenException(
        `Ô ${loc.code} thuộc ${loc.warehouse.name} - bạn đang làm kho ${scope}`,
      );
    }
  }

  private async assertActive(tx: PrismaTx, loc: { id: bigint; code: string }) {
    const live = await tx.warehouseLocation.findUnique({
      where: { id: loc.id },
      select: { isActive: true },
    });
    if (!live?.isActive) throw new ConflictException(`Ô ${loc.code} đang tắt - cất vào ô khác`);
  }

  /** Ghi 1 dịch chuyển có Idempotency-Key: 2 lần gửi cùng khoá song song -> lần thua trả kết quả lần thắng. */
  private async runMovement(
    idempotencyKey: string,
    actorId: string,
    fn: (tx: PrismaTx) => Promise<{ movementId: bigint; mixWarning: string | null }>,
  ) {
    try {
      const r = await this.prisma.$transaction(fn, { timeout: 20_000 });
      return { replay: false, movementId: r.movementId.toString(), mixWarning: r.mixWarning };
    } catch (e) {
      if (isUniqueViolationAny(e)) {
        const again = await this.replay(idempotencyKey, actorId);
        if (again) return again;
      }
      throw e;
    }
  }

  private async replay(idempotencyKey: string, actorId: string) {
    const m = await this.prisma.locationStockMovement.findUnique({
      where: { idempotencyKey },
      select: { id: true, actorId: true },
    });
    if (!m) return null;
    if (m.actorId !== actorId) {
      throw new ConflictException('Khoá gửi lại (Idempotency-Key) đã được dùng cho lần khác');
    }
    return { replay: true, movementId: m.id.toString(), mixWarning: null };
  }

  private async locationDto(loc: LocationRow) {
    const stocks = await this.prisma.locationStock.findMany({
      where: { locationId: loc.id, qty: { gt: 0 } },
      select: { productionInvoiceItemId: true, qty: true },
    });
    const items = await loadItems(
      this.prisma,
      stocks.map((s) => s.productionInvoiceItemId),
    );
    return {
      id: loc.id.toString(),
      code: loc.code,
      isActive: loc.isActive,
      warehouseCode: loc.warehouse.code,
      warehouseName: loc.warehouse.name,
      totalQty: stocks.reduce((s, x) => s + x.qty, 0),
      lines: stocks.map((s) => ({
        ...labelOf(items.get(s.productionInvoiceItemId.toString()) as ItemRow),
        qty: s.qty,
      })),
    };
  }

  private toWarehouse(wh: FgWarehouse) {
    return { id: wh.id.toString(), code: wh.code, name: wh.name };
  }
}
