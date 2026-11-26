import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingContainerStatus,
  BookingStatus,
  LocationMovementKind,
  Prisma,
} from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType, type PrismaTx } from '../../prisma/prisma.service';
import {
  addLocationStock,
  isUniqueViolation,
  isUniqueViolationAny,
  lockTriplesAndLocations,
  takeLocationStock,
} from './location-stock.tx';
import { VI_TRI_KHO_DISABLED_MESSAGE, isViTriKhoEnabled } from './vi-tri-kho.config';
import {
  labelOf,
  loadItems,
  mixWarningFor,
  resolveFgWarehouse,
  resolveLocationByToken,
} from './vi-tri-kho.read';
import {
  bookingLockKey,
  containerCloseProblems,
  suggestPicks,
  tripleText,
  type Triple,
} from './vi-tri-kho.util';
import type {
  CreateContainerDto,
  PickDto,
  UnpickDto,
  UpdateContainerDto,
} from './dto/vi-tri-kho.dto';

type Person = { firstName: string; lastName: string; username: string } | null;
const nameOf = (u: Person): string | null =>
  u ? `${u.lastName} ${u.firstName}`.trim() || u.username : null;
const PERSON = { select: { firstName: true, lastName: true, username: true } } as const;

const trimOrNull = (s: string | undefined | null): string | null => {
  const t = s?.trim();
  return t ? t.toUpperCase() : null;
};

const CONTAINER_INCLUDE = {
  lines: { where: { qty: { gt: 0 } }, orderBy: { id: 'asc' } },
  createdBy: PERSON,
  loadedBy: PERSON,
} satisfies Prisma.BookingContainerInclude;
type ContainerRow = Prisma.BookingContainerGetPayload<{ include: typeof CONTAINER_INCLUDE }>;

/**
 * Soạn hàng theo booking + load từng cont (25/11/2026 - docs THIET-KE-VI-TRI-KHO-LOAD-CONT, V5-V7, V9), bật bằng
 * VI_TRI_KHO_ENABLED. Thủ kho Thành phẩm của kho gom hàng (Booking.warehouseCode):
 *  - danh sách lấy hàng: mỗi dòng booking (bộ 3) -> các ô đang giữ đúng bộ 3 đó + số gợi ý lấy theo mã ô;
 *  - lấy hàng = quét ô -> trừ tồn ô, cộng hàng trong cont đang load (OPEN). Sai ô (khác ô của dòng đang làm) hoặc ô không có bộ 3
 *    này -> báo lỗi, không ghi gì. Trả từ cont về ô khi lấy nhầm (cont chưa đóng);
 *  - đóng cont: đủ số cont + seal + ≥ 1 ảnh + ≥ 1 dòng hàng (CHECK booking_containers_loaded_chk giữ ở DB);
 *  - xác nhận xuất vẫn là BookingShipmentsService.ship (đường cũ): bật công tắc thì số thực xuất phải đúng bằng hàng đã đóng cont và
 *    mọi cont phải đã đóng (assertShipMatchesContainers).
 * Khoá: booking -> bộ 3 -> ô (cùng thứ tự với cất / chuyển ô).
 */
@Injectable()
export class BookingLoadService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  private assertEnabled(): void {
    if (!isViTriKhoEnabled()) throw new BadRequestException(VI_TRI_KHO_DISABLED_MESSAGE);
  }

  /** V6: danh sách lấy hàng + các cont của booking. Tắt công tắc: { enabled: false }. */
  async pickList(bookingIdRaw: string, scope: string | null) {
    if (!isViTriKhoEnabled()) return { enabled: false as const };
    const bookingId = parseBigIntId(bookingIdRaw);
    const booking = await this.loadBooking(this.prisma, bookingId, scope);
    const wh = await resolveFgWarehouse(this.prisma, null, booking.warehouseCode!);
    const [containers, items, stocks] = await Promise.all([
      this.prisma.bookingContainer.findMany({
        where: { bookingId },
        include: CONTAINER_INCLUDE,
        orderBy: { id: 'asc' },
      }),
      loadItems(
        this.prisma,
        booking.lines.map((l) => l.productionInvoiceItemId),
      ),
      this.prisma.locationStock.findMany({
        where: {
          qty: { gt: 0 },
          location: { warehouseId: wh.id, isActive: true },
          productionInvoiceItemId: { in: booking.lines.map((l) => l.productionInvoiceItemId) },
        },
        select: {
          productionInvoiceItemId: true,
          mfgProductId: true,
          salesOrderItemId: true,
          qty: true,
          location: { select: { id: true, code: true } },
        },
      }),
    ]);
    const inCont = this.sumByLine(containers);
    const lines = booking.lines.map((l) => {
      const it = items.get(l.productionInvoiceItemId.toString())!;
      const loaded = inCont.get(l.id.toString()) ?? 0;
      const remainingQty = Math.max(0, l.qty - l.shippedQty - loaded);
      // V9: chỉ ô giữ ĐÚNG bộ 3 của dòng booking (cùng dòng SKU + cùng dòng đơn).
      const here = stocks
        .filter(
          (s) =>
            s.productionInvoiceItemId === l.productionInvoiceItemId &&
            s.mfgProductId === it.mfgProductId &&
            s.salesOrderItemId === l.salesOrderItemId,
        )
        .map((s) => ({ locationId: s.location.id.toString(), code: s.location.code, qty: s.qty }));
      const { rows, shortQty } = suggestPicks(remainingQty, here);
      return {
        lineId: l.id.toString(),
        ...labelOf(it),
        qty: l.qty,
        shippedQty: l.shippedQty,
        loadedQty: loaded,
        remainingQty,
        locations: rows,
        shortQty,
      };
    });
    return {
      enabled: true as const,
      booking: {
        id: booking.id.toString(),
        bookingNo: booking.bookingNo,
        status: booking.status,
        customerName: booking.customer.name,
        containerType: booking.containerType,
        containerQty: booking.containerQty,
        warehouseCode: wh.code,
        warehouseName: wh.name,
      },
      lines,
      containers: await this.toContainerDtos(containers),
    };
  }

  // ─── Cont ─────────────────────────────────────────────────────────────────────────────────

  async createContainer(
    bookingIdRaw: string,
    dto: CreateContainerDto,
    actorId: string,
    scope: string | null,
  ) {
    this.assertEnabled();
    const bookingId = parseBigIntId(bookingIdRaw);
    const id = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, bookingLockKey(bookingId));
      await this.loadBooking(tx, bookingId, scope, true);
      try {
        const c = await tx.bookingContainer.create({
          data: {
            bookingId,
            containerNo: trimOrNull(dto.containerNo),
            sealNo: trimOrNull(dto.sealNo),
            note: dto.note?.trim() || null,
            createdById: actorId,
          },
          select: { id: true },
        });
        return c.id;
      } catch (e) {
        if (isUniqueViolation(e))
          throw new ConflictException(`Số cont ${dto.containerNo} đã có ở booking này`);
        throw e;
      }
    });
    return this.containerDto(id);
  }

  /** Sửa cont đang load: số cont, seal, ảnh (thay cả danh sách), ghi chú. Cont đã đóng: mở lại trước. */
  async updateContainer(idRaw: string, dto: UpdateContainerDto, scope: string | null) {
    this.assertEnabled();
    const id = parseBigIntId(idRaw);
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lockContainer(tx, id, scope);
      if (c.status !== BookingContainerStatus.OPEN) {
        throw new ConflictException('Cont đã đóng - mở lại cont rồi mới sửa');
      }
      const data: Prisma.BookingContainerUpdateInput = {};
      if (dto.containerNo !== undefined) data.containerNo = trimOrNull(dto.containerNo);
      if (dto.sealNo !== undefined) data.sealNo = trimOrNull(dto.sealNo);
      if (dto.note !== undefined) data.note = dto.note.trim() || null;
      if (dto.photoUrls !== undefined)
        data.photoUrls = dto.photoUrls.map((u) => u.trim()).filter(Boolean);
      try {
        await tx.bookingContainer.update({ where: { id }, data });
      } catch (e) {
        if (isUniqueViolation(e))
          throw new ConflictException(`Số cont ${dto.containerNo} đã có ở booking này`);
        throw e;
      }
    });
    return this.containerDto(id);
  }

  /** Xoá cont tạo nhầm: chỉ khi chưa từng lấy hàng vào (không có vết). */
  async deleteContainer(idRaw: string, scope: string | null) {
    this.assertEnabled();
    const id = parseBigIntId(idRaw);
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lockContainer(tx, id, scope);
      if (c.status !== BookingContainerStatus.OPEN)
        throw new ConflictException('Cont đã đóng - không xoá được');
      const used = await tx.locationStockMovement.count({ where: { containerId: id } });
      if (used > 0) {
        throw new ConflictException(
          'Cont đã có lần lấy / trả hàng - giữ lại làm vết, không xoá được',
        );
      }
      await tx.bookingContainer.delete({ where: { id } });
    });
    return { id: idRaw, deleted: true };
  }

  /**
   * V7: đóng cont - đủ số cont, seal, ≥ 1 ảnh, ≥ 1 dòng hàng. Khoá booking + dòng cont (FOR UPDATE) nên không ai lấy thêm / trả bớt
   * giữa lúc kiểm và lúc đóng; đóng 2 lần: 409.
   */
  async closeContainer(idRaw: string, actorId: string, scope: string | null) {
    this.assertEnabled();
    const id = parseBigIntId(idRaw);
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lockContainer(tx, id, scope);
      if (c.status === BookingContainerStatus.LOADED)
        throw new ConflictException('Cont này đã đóng rồi');
      const sum = await tx.bookingContainerLine.aggregate({
        where: { containerId: id },
        _sum: { qty: true },
      });
      const problems = containerCloseProblems({
        containerNo: c.containerNo,
        sealNo: c.sealNo,
        photoUrls: c.photoUrls,
        totalQty: sum._sum.qty ?? 0,
      });
      if (problems.length > 0) {
        throw new BadRequestException(`Chưa đóng cont được: ${problems.join(', ')}`);
      }
      const { count } = await tx.bookingContainer.updateMany({
        where: { id, status: BookingContainerStatus.OPEN },
        data: { status: BookingContainerStatus.LOADED, loadedAt: new Date(), loadedById: actorId },
      });
      if (count === 0) throw new ConflictException('Cont này đã đóng rồi');
    });
    return this.containerDto(id);
  }

  /** Mở lại cont đã đóng (đóng nhầm / cần sửa) - chỉ khi booking chưa xuất. */
  async reopenContainer(idRaw: string, scope: string | null) {
    this.assertEnabled();
    const id = parseBigIntId(idRaw);
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lockContainer(tx, id, scope);
      if (c.status !== BookingContainerStatus.LOADED) throw new ConflictException('Cont đang mở');
      await tx.bookingContainer.update({
        where: { id },
        data: { status: BookingContainerStatus.OPEN, loadedAt: null, loadedById: null },
      });
    });
    return this.containerDto(id);
  }

  // ─── V6: lấy hàng / trả về ô ────────────────────────────────────────────────────────────────

  /**
   * V6: lấy `qty` bộ của 1 dòng booking ở ô vừa quét, cho vào cont đang load. Chặn:
   *  - sai vị trí: `expectedLocationId` (ô của dòng danh sách đang làm) khác ô vừa quét;
   *  - sai mã: ô vừa quét không giữ đúng bộ 3 SKU - LSX - PO của dòng booking (hoặc không đủ số);
   *  - vượt số còn phải lấy của dòng booking; cont đã đóng; ô khác kho gom hàng.
   * Idempotency-Key bắt buộc (gửi lại cùng khoá -> trả lần cũ).
   */
  async pick(
    bookingIdRaw: string,
    dto: PickDto,
    actorId: string,
    scope: string | null,
    idempotencyKey: string | undefined,
  ) {
    this.assertEnabled();
    if (!idempotencyKey) throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    const replay = await this.replay(idempotencyKey, actorId);
    if (replay) return replay;
    const bookingId = parseBigIntId(bookingIdRaw);
    const booking = await this.loadBooking(this.prisma, bookingId, scope, true);
    const wh = await resolveFgWarehouse(this.prisma, null, booking.warehouseCode!);
    const line = booking.lines.find((l) => l.id.toString() === dto.bookingLineId);
    if (!line)
      throw new BadRequestException(
        `Dòng ${dto.bookingLineId} không thuộc booking ${booking.bookingNo}`,
      );
    const loc = await resolveLocationByToken(this.prisma, dto.locationToken, {
      warehouseId: wh.id,
    });
    if (dto.expectedLocationId && loc.id.toString() !== dto.expectedLocationId) {
      const expected = await this.prisma.warehouseLocation.findUnique({
        where: { id: parseBigIntId(dto.expectedLocationId) },
        select: { code: true },
      });
      throw new BadRequestException(
        `Sai vị trí: dòng này lấy ở ô ${expected?.code ?? '?'}, bạn vừa quét ô ${loc.code} - quét lại đúng ô`,
      );
    }
    const items = await loadItems(this.prisma, [line.productionInvoiceItemId]);
    const item = items.get(line.productionInvoiceItemId.toString())!;
    const label = labelOf(item);
    const t: Triple = {
      productionInvoiceItemId: line.productionInvoiceItemId,
      mfgProductId: item.mfgProductId,
      salesOrderItemId: line.salesOrderItemId,
    };
    const containerId = parseBigIntId(dto.containerId);

    return this.runMovement(idempotencyKey, actorId, async (tx) => {
      await lockBusinessKey(tx, bookingLockKey(bookingId));
      await lockTriplesAndLocations(tx, [t.productionInvoiceItemId], [loc.id]);
      const live = await this.loadBooking(tx, bookingId, scope, true);
      const liveLine = live.lines.find((l) => l.id === line.id);
      if (!liveLine)
        throw new ConflictException('Dòng booking vừa bị Sales gỡ - tải lại danh sách');
      const cont = await this.lockContainer(tx, containerId, scope);
      if (cont.bookingId !== bookingId)
        throw new BadRequestException('Cont không thuộc booking này');
      if (cont.status !== BookingContainerStatus.OPEN) {
        throw new ConflictException('Cont đã đóng - mở lại hoặc chọn cont khác');
      }
      const loadedSum = await tx.bookingContainerLine.aggregate({
        where: { bookingLineId: line.id, container: { bookingId } },
        _sum: { qty: true },
      });
      const remaining = liveLine.qty - liveLine.shippedQty - (loadedSum._sum.qty ?? 0);
      if (dto.qty > remaining) {
        throw new BadRequestException(
          `${tripleText(label)}: booking chỉ còn phải lấy ${Math.max(0, remaining)} bộ - không lấy ${dto.qty} bộ`,
        );
      }
      await takeLocationStock(tx, loc.id, t, dto.qty, (have) =>
        have > 0
          ? `Ô ${loc.code} chỉ có ${have} bộ ${tripleText(label)} - không lấy được ${dto.qty} bộ`
          : `Sai mã: ô ${loc.code} không có hàng ${tripleText(label)} - kiểm lại ô / lệnh trước khi lấy`,
      );
      await tx.$executeRaw`
        INSERT INTO "booking_container_lines"
          ("containerId", "bookingLineId", "productionInvoiceItemId", "mfgProductId", "salesOrderItemId", "qty", "updatedAt")
        VALUES (${containerId}, ${line.id}, ${t.productionInvoiceItemId}, ${t.mfgProductId}, ${line.salesOrderItemId}, ${dto.qty}, now())
        ON CONFLICT ("containerId", "bookingLineId")
        DO UPDATE SET "qty" = "booking_container_lines"."qty" + EXCLUDED."qty", "updatedAt" = now()`;
      const m = await tx.locationStockMovement.create({
        data: {
          kind: LocationMovementKind.PICK,
          fromLocationId: loc.id,
          ...t,
          qty: dto.qty,
          bookingId,
          bookingLineId: line.id,
          containerId,
          actorId,
          idempotencyKey,
        },
        select: { id: true },
      });
      return { movementId: m.id, mixWarning: null };
    });
  }

  /** Trả hàng từ cont đang load về ô (quét tem ô). Nhắc trộn hàng như lúc cất. Idempotency-Key bắt buộc. */
  async unpick(
    containerIdRaw: string,
    dto: UnpickDto,
    actorId: string,
    scope: string | null,
    idempotencyKey: string | undefined,
  ) {
    this.assertEnabled();
    if (!idempotencyKey) throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    const replay = await this.replay(idempotencyKey, actorId);
    if (replay) return replay;
    const containerId = parseBigIntId(containerIdRaw);
    const head = await this.prisma.bookingContainer.findUnique({
      where: { id: containerId },
      select: { bookingId: true },
    });
    if (!head) throw new NotFoundException(`Không có cont ${containerIdRaw}`);
    const booking = await this.loadBooking(this.prisma, head.bookingId, scope, true);
    const wh = await resolveFgWarehouse(this.prisma, null, booking.warehouseCode!);
    const loc = await resolveLocationByToken(this.prisma, dto.locationToken, {
      warehouseId: wh.id,
    });
    const lineId = parseBigIntId(dto.bookingLineId);

    return this.runMovement(idempotencyKey, actorId, async (tx) => {
      await lockBusinessKey(tx, bookingLockKey(head.bookingId));
      const cl = await tx.bookingContainerLine.findUnique({
        where: { containerId_bookingLineId: { containerId, bookingLineId: lineId } },
      });
      if (!cl || cl.qty <= 0) throw new BadRequestException('Cont không có hàng của dòng này');
      const t: Triple = {
        productionInvoiceItemId: cl.productionInvoiceItemId,
        mfgProductId: cl.mfgProductId,
        salesOrderItemId: cl.salesOrderItemId,
      };
      await lockTriplesAndLocations(tx, [t.productionInvoiceItemId], [loc.id]);
      const cont = await this.lockContainer(tx, containerId, scope);
      if (cont.status !== BookingContainerStatus.OPEN) {
        throw new ConflictException('Cont đã đóng - mở lại cont rồi mới trả hàng về ô');
      }
      const liveLoc = await tx.warehouseLocation.findUnique({
        where: { id: loc.id },
        select: { isActive: true },
      });
      if (!liveLoc?.isActive)
        throw new ConflictException(`Ô ${loc.code} đang tắt - cất vào ô khác`);
      const n = await tx.bookingContainerLine.updateMany({
        where: { id: cl.id, qty: { gte: dto.qty } },
        data: { qty: { decrement: dto.qty } },
      });
      if (n.count !== 1) {
        throw new BadRequestException(
          `Cont chỉ có ${cl.qty} bộ của dòng này - không trả ${dto.qty} bộ`,
        );
      }
      // Dòng về 0: xoá (Sales gỡ được dòng booking sau khi trả hết).
      await tx.bookingContainerLine.deleteMany({ where: { id: cl.id, qty: 0 } });
      const mix = await mixWarningFor(tx, loc, t);
      await addLocationStock(tx, loc.id, t, dto.qty);
      const m = await tx.locationStockMovement.create({
        data: {
          kind: LocationMovementKind.UNPICK,
          toLocationId: loc.id,
          ...t,
          qty: dto.qty,
          bookingId: head.bookingId,
          bookingLineId: lineId,
          containerId,
          actorId,
          idempotencyKey,
        },
        select: { id: true },
      });
      return { movementId: m.id, mixWarning: mix };
    });
  }

  // ─── Phụ ───────────────────────────────────────────────────────────────────────────────

  private async loadBooking(
    db: Pick<PrismaTx, 'booking'>,
    id: bigint,
    scope: string | null,
    forWrite = false,
  ) {
    const b = await db.booking.findUnique({
      where: { id },
      include: { lines: { orderBy: { id: 'asc' } }, customer: { select: { name: true } } },
    });
    if (!b) throw new NotFoundException(`Không tìm thấy booking ${id}`);
    if (!b.warehouseCode)
      throw new BadRequestException(`Booking ${b.bookingNo} chưa có kho Thành phẩm gom hàng`);
    if (scope && scope !== b.warehouseCode) {
      throw new ForbiddenException(
        `Booking ${b.bookingNo} gom hàng ở kho '${b.warehouseCode}', bạn phụ trách kho '${scope}'`,
      );
    }
    if (forWrite && b.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(
        b.status === BookingStatus.SHIPPED
          ? `Booking ${b.bookingNo} đã xuất - không soạn / load thêm được`
          : `Booking ${b.bookingNo} chưa được Sales xác nhận (hoặc đã huỷ) - chưa soạn hàng được`,
      );
    }
    return b;
  }

  /** Khoá booking của cont (advisory) + dòng cont (FOR UPDATE); booking phải đang CONFIRMED. */
  private async lockContainer(tx: PrismaTx, id: bigint, scope: string | null) {
    const head = await tx.bookingContainer.findUnique({
      where: { id },
      select: { bookingId: true },
    });
    if (!head) throw new NotFoundException(`Không có cont ${id}`);
    await lockBusinessKey(tx, bookingLockKey(head.bookingId));
    await this.loadBooking(tx, head.bookingId, scope, true);
    await tx.$queryRaw`SELECT 1 FROM "booking_containers" WHERE "id" = ${id} FOR UPDATE`;
    return tx.bookingContainer.findUniqueOrThrow({ where: { id } });
  }

  private sumByLine(containers: { lines: { bookingLineId: bigint; qty: number }[] }[]) {
    const m = new Map<string, number>();
    for (const c of containers) {
      for (const l of c.lines) {
        const k = l.bookingLineId.toString();
        m.set(k, (m.get(k) ?? 0) + l.qty);
      }
    }
    return m;
  }

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

  private async containerDto(id: bigint) {
    const c = await this.prisma.bookingContainer.findUniqueOrThrow({
      where: { id },
      include: CONTAINER_INCLUDE,
    });
    return (await this.toContainerDtos([c]))[0];
  }

  private async toContainerDtos(rows: ContainerRow[]) {
    const items = await loadItems(
      this.prisma,
      rows.flatMap((r) => r.lines.map((l) => l.productionInvoiceItemId)),
    );
    return rows.map((c) => {
      const totalQty = c.lines.reduce((s, l) => s + l.qty, 0);
      return {
        id: c.id.toString(),
        bookingId: c.bookingId.toString(),
        containerNo: c.containerNo,
        sealNo: c.sealNo,
        photoUrls: c.photoUrls,
        status: c.status,
        note: c.note,
        createdByName: nameOf(c.createdBy),
        loadedAt: c.loadedAt,
        loadedByName: nameOf(c.loadedBy),
        totalQty,
        closeProblems:
          c.status === BookingContainerStatus.OPEN
            ? containerCloseProblems({
                containerNo: c.containerNo,
                sealNo: c.sealNo,
                photoUrls: c.photoUrls,
                totalQty,
              })
            : [],
        lines: c.lines.map((l) => ({
          bookingLineId: l.bookingLineId.toString(),
          qty: l.qty,
          ...labelOf(items.get(l.productionInvoiceItemId.toString())!),
        })),
      };
    });
  }
}
