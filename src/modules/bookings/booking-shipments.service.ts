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
import { AuditAction, BookingStatus } from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { auditEvent } from '../../common/utils/audit-event.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { allocateSlipCode } from '../issue-slips/slip-code.util';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingsService } from './bookings.service';
import { BookingResponseDto } from './dto/booking-response.dto';
import { ShipBookingDto } from './dto/ship-booking.dto';

const SHIP_SLIP_KIND = 'XK';
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const ddmmyyyy = (d: Date | string | null | undefined): string => {
  if (!d) return '-';
  const x =
    typeof d === 'string'
      ? new Date(`${d.slice(0, 10)}T00:00:00Z`)
      : new Date(d.getTime() + VN_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(x.getUTCDate())}/${p(x.getUTCMonth() + 1)}/${x.getUTCFullYear()}`;
};

/**
 * Người B – Đợt 10b (YC5 5.5–5.8): kho thành phẩm xuất hàng theo booking. Booking Sales đã xác nhận (CONFIRMED) gom về 1 kho thành
 * phẩm (`Booking.warehouseCode`); thủ kho kho đó in phiếu xuất XK, người nhận ký, tải ảnh, nhập số THỰC XUẤT từng dòng rồi xác
 * nhận -> cộng "đã xuất" cho dòng booking + dòng đơn hàng (SalesOrderItem.shippedQty - nguồn `orderShippedQtyOf`), booking SHIPPED.
 *
 * - Không xuất vượt số còn của dòng booking, cũng không vượt "hàng sẵn" (đã đóng gói − đã xuất của dòng đơn, 5.8).
 * - Thực xuất ít hơn số đã xếp: booking vẫn đóng, phần chưa xuất quay về "còn lại" của đơn (booking SHIPPED không còn giữ chỗ).
 * - Tồn thành phẩm không có sổ kho riêng: "tồn" = đã đóng gói − đã xuất, nên cộng đã xuất CHÍNH LÀ trừ tồn.
 * - Thay nút "Xuất giao" cũ (5.7) - route ship từng dòng đơn đã gỡ.
 */
@Injectable()
export class BookingShipmentsService {
  private readonly logger = new Logger(BookingShipmentsService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly bookings: BookingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** Booking đã xác nhận cần đóng cont ở kho của thủ kho (tổng kho: mọi kho). */
  async listToShip(scope: string | null): Promise<BookingResponseDto[]> {
    const rows = await this.bookings.findAll({ status: BookingStatus.CONFIRMED });
    return scope ? rows.filter((b) => b.warehouseCode === scope) : rows;
  }

  /** Giữ số phiếu XK để in trước khi xác nhận (in lại giữ số cũ). Cùng bộ đếm XK với phiếu xuất vật tư. */
  async reserveSlipCode(userId: string, reuse?: string): Promise<{ code: string }> {
    if (reuse) {
      const old = await this.prisma.reservedSlipCode.findUnique({ where: { code: reuse } });
      if (old && old.kind === SHIP_SLIP_KIND && !old.usedAt && old.createdById === userId) {
        return { code: old.code };
      }
    }
    const code = await this.prisma.$transaction(async (tx) => {
      const c = await allocateSlipCode(tx, SHIP_SLIP_KIND);
      await tx.reservedSlipCode.create({
        data: { code: c, kind: SHIP_SLIP_KIND, createdById: userId },
      });
      return c;
    });
    return { code };
  }

  async ship(
    idRaw: string,
    dto: ShipBookingDto,
    userId: string,
    scope: string | null,
    idempotencyKey: string,
  ): Promise<BookingResponseDto> {
    const id = parseBigIntId(idRaw);
    const done = await this.prisma.booking.findUnique({ where: { shipKey: idempotencyKey } });
    if (done) return this.bookings.findOne(done.id.toString());

    const urls = dto.signedSlipUrls.map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) {
      throw new BadRequestException('Tải ảnh phiếu xuất đã ký trước khi xác nhận xuất');
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        await lockBusinessKey(tx, `booking:${id.toString()}`);
        const booking = await tx.booking.findUnique({
          where: { id },
          include: {
            customer: { select: { name: true } },
            lines: {
              include: {
                productionInvoiceItem: {
                  select: { mfgProduct: { select: { factoryCode: true } } },
                },
              },
            },
          },
        });
        if (!booking) throw new NotFoundException(`Không tìm thấy booking ${idRaw}`);
        if (booking.status === BookingStatus.SHIPPED) {
          throw new ConflictException(`Booking ${booking.bookingNo} đã xác nhận xuất rồi`);
        }
        if (booking.status !== BookingStatus.CONFIRMED) {
          throw new ConflictException(
            `Booking ${booking.bookingNo} chưa được Sales xác nhận (hoặc đã huỷ) - chưa xuất được`,
          );
        }
        if (!booking.warehouseCode) {
          throw new BadRequestException(
            `Booking ${booking.bookingNo} chưa có kho thành phẩm gom hàng`,
          );
        }
        if (scope && scope !== booking.warehouseCode) {
          throw new ForbiddenException(
            `Booking ${booking.bookingNo} gom hàng ở kho '${booking.warehouseCode}', bạn phụ trách kho '${scope}'`,
          );
        }

        const want = new Map<string, number>();
        for (const l of dto.lines) {
          if (!booking.lines.some((x) => x.id.toString() === l.lineId)) {
            throw new BadRequestException(
              `Dòng ${l.lineId} không thuộc booking ${booking.bookingNo}`,
            );
          }
          want.set(l.lineId, (want.get(l.lineId) ?? 0) + l.qty);
        }
        const plan = booking.lines
          .map((l) => ({ line: l, qty: want.get(l.id.toString()) ?? 0 }))
          .filter((x) => x.qty > 0);
        if (plan.length === 0) throw new BadRequestException('Nhập số thực xuất ít nhất 1 dòng');

        // Khoá dòng đơn theo thứ tự id (2 booking cùng dòng đơn xuất gần nhau không khoá chéo) rồi kiểm "hàng sẵn".
        const soiIds = [...new Set(plan.map((x) => x.line.salesOrderItemId))].sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0,
        );
        const soiRows = await tx.$queryRaw<{ id: bigint; totalQty: number; shippedQty: number }[]>`
          SELECT "id", "totalQty", "shippedQty" FROM "sales_order_items"
          WHERE "id" = ANY(${soiIds}::bigint[]) ORDER BY "id" FOR UPDATE`;
        const soiById = new Map(soiRows.map((r) => [r.id.toString(), r]));
        const packedRows = await tx.packagingRecord.groupBy({
          by: ['productionInvoiceItemId'],
          where: {
            productionInvoiceItemId: { in: plan.map((x) => x.line.productionInvoiceItemId) },
          },
          _sum: { boxesPacked: true },
        });
        const packedByPii = new Map(
          packedRows.map((r) => [r.productionInvoiceItemId.toString(), r._sum.boxesPacked ?? 0]),
        );
        const shipBySoi = new Map<string, number>();
        for (const { line, qty } of plan) {
          const sku = line.productionInvoiceItem.mfgProduct.factoryCode;
          const remain = line.qty - line.shippedQty;
          if (qty > remain) {
            throw new BadRequestException(
              `SKU ${sku}: xuất ${qty} bộ vượt số còn của booking (${remain} bộ)`,
            );
          }
          const soiKey = line.salesOrderItemId.toString();
          shipBySoi.set(soiKey, (shipBySoi.get(soiKey) ?? 0) + qty);
          const soi = soiById.get(soiKey)!;
          const ready =
            (packedByPii.get(line.productionInvoiceItemId.toString()) ?? 0) -
            Number(soi.shippedQty);
          if ((shipBySoi.get(soiKey) ?? 0) > ready) {
            throw new ConflictException(
              `SKU ${sku}: chỉ còn ${Math.max(0, ready)} bộ đã đóng gói chưa xuất - không xuất được ${shipBySoi.get(soiKey)} bộ`,
            );
          }
        }

        const slip = await tx.reservedSlipCode.updateMany({
          where: { code: dto.slipCode, kind: SHIP_SLIP_KIND, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (slip.count !== 1) {
          throw new BadRequestException(
            `Số phiếu ${dto.slipCode} không hợp lệ hoặc đã dùng - bấm "In phiếu xuất" để lấy số`,
          );
        }

        for (const { line, qty } of plan) {
          await tx.bookingLine.update({
            where: { id: line.id },
            data: { shippedQty: { increment: qty } },
          });
        }
        for (const [soiKey, qty] of shipBySoi) {
          const n = await tx.$executeRaw`
            UPDATE "sales_order_items" SET "shippedQty" = "shippedQty" + ${qty}
            WHERE "id" = ${BigInt(soiKey)} AND "shippedQty" + ${qty} <= "totalQty"`;
          if (n !== 1) {
            throw new ConflictException(`Dòng đơn ${soiKey}: xuất vượt số lượng đơn hàng`);
          }
        }
        await tx.booking.update({
          where: { id },
          data: {
            status: BookingStatus.SHIPPED,
            shippedAt: new Date(),
            shippedById: userId,
            shipSlipCode: dto.slipCode,
            shipSlipUrls: urls,
            shipKey: idempotencyKey,
          },
        });

        const soiOrders = await tx.salesOrderItem.findMany({
          where: { id: { in: soiIds } },
          select: { salesOrderId: true },
        });
        return {
          booking,
          shippedQty: plan.reduce((s, x) => s + x.qty, 0),
          bookedQty: booking.lines.reduce((s, l) => s + (l.qty - l.shippedQty), 0),
          lines: plan.map((x) => ({ lineId: x.line.id.toString(), qty: x.qty })),
          salesOrderIds: [...new Set(soiOrders.map((s) => s.salesOrderId.toString()))],
        };
      },
      { timeout: 30_000 },
    );

    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.UPDATE,
      tableName: 'bookings',
      recordId: id,
      oldValue: { status: BookingStatus.CONFIRMED },
      newValue: {
        status: BookingStatus.SHIPPED,
        shipSlipCode: dto.slipCode,
        lines: result.lines,
      },
    });
    await this.afterShip(id, result, userId);
    return this.bookings.findOne(id.toString());
  }

  /** Báo Sales, đóng việc chờ của kho, làm mới màn đơn hàng. Lỗi chỉ ghi log (đã commit). */
  private async afterShip(
    id: bigint,
    r: {
      booking: { bookingNo: string; createdById: string; customer: { name: string } };
      shippedQty: number;
      bookedQty: number;
      salesOrderIds: string[];
    },
    userId: string,
  ): Promise<void> {
    try {
      await this.notifications.resolve({
        entityType: 'BOOKING',
        entityId: id.toString(),
        types: ['BOOKING_TO_SHIP', 'BOOKING_SHORT'],
      });
      await this.notifications.emit('BOOKING_SHIPPED', {
        entityId: id.toString(),
        actorId: userId,
        params: {
          bookingId: id.toString(),
          bookingNo: r.booking.bookingNo,
          customerName: r.booking.customer.name,
          shippedQty: r.shippedQty,
          bookedQty: r.bookedQty,
          createdById: r.booking.createdById,
        },
      });
    } catch (e) {
      this.logger.error(`Thông báo xuất booking ${id} lỗi: ${(e as Error).message}`);
    }
    for (const soId of r.salesOrderIds) {
      this.realtime.publishEntityChanged({
        entity: 'SALES_ORDER',
        entityId: soId,
        action: 'UPDATED',
        actorId: userId,
      });
    }
  }

  /** Booking huỷ -> đóng việc chờ đóng cont của kho. */
  async onCancelled(id: bigint): Promise<void> {
    try {
      await this.notifications.resolve({
        entityType: 'BOOKING',
        entityId: id.toString(),
        types: ['BOOKING_TO_SHIP'],
      });
    } catch (e) {
      this.logger.error(`Đóng thông báo booking huỷ ${id} lỗi: ${(e as Error).message}`);
    }
  }

  /** Gọi sau khi Sales xác nhận booking (BookingsService.confirm) - báo thủ kho thành phẩm của kho gom hàng. */
  async notifyToShip(id: bigint): Promise<void> {
    try {
      const b = await this.prisma.booking.findUnique({
        where: { id },
        include: { customer: { select: { name: true } }, lines: { select: { qty: true } } },
      });
      if (!b?.warehouseCode) return;
      await this.notifications.emit('BOOKING_TO_SHIP', {
        entityId: id.toString(),
        dedupeKey: `BOOKING_TO_SHIP:${id}`,
        params: {
          bookingId: id.toString(),
          bookingNo: b.bookingNo,
          customerName: b.customer.name,
          warehouseCode: b.warehouseCode,
          totalQty: b.lines.reduce((s, l) => s + l.qty, 0),
          pickupDate: ddmmyyyy(b.pickupDate ? b.pickupDate.toISOString() : null),
          cutOff: ddmmyyyy(b.cutOffAt),
        },
      });
    } catch (e) {
      this.logger.error(`Thông báo booking cần xuất ${id} lỗi: ${(e as Error).message}`);
    }
  }
}
