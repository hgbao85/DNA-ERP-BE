import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  AuditAction,
  BookingStatus,
  Prisma,
  ProductionInvoiceStatus,
} from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { auditEvent } from '../../common/utils/audit-event.util';
import { vnDayStart } from '../../common/utils/floor-stats.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { warehouseFamilyOf } from '../../common/utils/warehouse-family.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  allocateShortage,
  bookingDueDay,
  bookingTotals,
  lineM3,
  setVolumeM3,
} from './booking-calc.util';
import {
  BookingAttachmentInputDto,
  BookingLineInputDto,
  CreateBookingDto,
} from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { BookingCandidatesQueryDto, BookingQueryDto } from './dto/booking-query.dto';
import {
  BookingAttachmentDto,
  BookingCandidateDto,
  BookingLineResponseDto,
  BookingMetaDto,
  BookingResponseDto,
  BookingTotalsDto,
} from './dto/booking-response.dto';

/** Booking còn "giữ" hàng: DRAFT / CONFIRMED (SHIPPED = đã xuất, CANCELLED = trả lại số đã xếp). */
const ACTIVE_STATUSES: BookingStatus[] = [BookingStatus.DRAFT, BookingStatus.CONFIRMED];
const DEFAULT_CONTAINER_VOLUME_M3 = 68;
const LIST_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Chờ mở transaction tối đa 10 s (mặc định Prisma 2 s - nhiều Sales xếp cùng lúc / máy chậm bị P2028 "Unable to start a
 *  transaction", gặp khi chạy thử 05/11), chạy tối đa 30 s (khoá dòng đơn có thể phải chờ lượt trước). Như daily-jobs. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

const BOOKING_INCLUDE = {
  customer: { select: { name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  lines: { orderBy: { id: 'asc' } },
} satisfies Prisma.BookingInclude;
export type BookingRow = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;
export { BOOKING_INCLUDE };

const PII_SELECT = {
  id: true,
  lsxCode: true,
  warehouseCode: true,
  warehouseName: true,
  salesOrderId: true,
  salesOrderItemId: true,
  mfgProduct: {
    select: {
      id: true,
      factoryCode: true,
      name: true,
      boxVolumeM3: true,
      boxesPerSet: true,
      loadCont: true,
    },
  },
  productionInvoice: { select: { id: true, code: true, status: true } },
  salesOrder: {
    select: { id: true, orderCode: true, customerId: true, isActive: true, deletedAt: true },
  },
  salesOrderItem: {
    select: {
      id: true,
      totalQty: true,
      shippedQty: true,
      skuName: true,
      deliveryDate: true,
    },
  },
} satisfies Prisma.ProductionInvoiceItemSelect;
type PiiRow = Prisma.ProductionInvoiceItemGetPayload<{ select: typeof PII_SELECT }>;

/**
 * "Đã xuất" của 1 dòng đơn. 10a: = SalesOrderItem.shippedQty (nút "Xuất giao" cũ).
 * 10b đổi nguồn ở đây (khi kho TP xác nhận xuất qua booking) - mọi nơi trong module đọc số đã xuất qua hàm này.
 */
export function orderShippedQtyOf(soi: { shippedQty: number }): number {
  return soi.shippedQty;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dateOnlyStr = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const fullName = (u: { firstName: string; lastName: string } | null) =>
  u ? `${u.lastName} ${u.firstName}`.trim() : null;
const lenhCodeOf = (pii: Pick<PiiRow, 'lsxCode' | 'productionInvoice'>): string | null =>
  pii.lsxCode ?? pii.productionInvoice?.code ?? null;
const trimOrNull = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
};

interface ActiveLine {
  bookingId: string;
  piiId: string;
  soiId: string;
  qty: number;
  shippedQty: number;
  dueDay: string | null;
}

interface EnrichContext {
  containerVolumeM3: number;
  /** Σ boxesPacked theo productionInvoiceItemId. */
  packed: Map<string, number>;
  activeBySoi: Map<string, ActiveLine[]>;
  activeByPii: Map<string, ActiveLine[]>;
}

type ItemInfo = Omit<BookingCandidateDto, 'currentQty' | 'piStatus'>;

const pushTo = <T>(m: Map<string, T[]>, key: string, v: T) => {
  const arr = m.get(key);
  if (arr) arr.push(v);
  else m.set(key, [v]);
};

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly notifications: NotificationsService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  // ─── Đọc ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

  async findAll(query: BookingQueryDto): Promise<BookingResponseDto[]> {
    const and: Prisma.BookingWhereInput[] = [];

    if (query.status) and.push({ status: query.status });
    else if (!query.includeCancelled) and.push({ status: { not: BookingStatus.CANCELLED } });
    if (query.customerId) and.push({ customerId: parseBigIntId(query.customerId) });

    if (query.from || query.to) {
      const fromStart = query.from ? this.requireVnDay(query.from) : null;
      const toStart = query.to ? this.requireVnDay(query.to) : null;
      const toExclusive = toStart ? new Date(toStart.getTime() + DAY_MS) : null;
      const dateRange: Prisma.DateTimeFilter = {};
      if (query.from) dateRange.gte = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) dateRange.lte = new Date(`${query.to}T00:00:00.000Z`);
      const tsRange: Prisma.DateTimeFilter = {};
      if (fromStart) tsRange.gte = fromStart;
      if (toExclusive) tsRange.lt = toExclusive;
      and.push({
        OR: [
          { pickupDate: dateRange },
          { etd: dateRange },
          { cutSiAt: tsRange },
          { cutOffAt: tsRange },
        ],
      });
    }

    const search = query.search?.trim();
    if (search) {
      const c = { contains: search, mode: 'insensitive' as const };
      and.push({
        OR: [
          { bookingNo: c },
          { pod: c },
          { vesselVoyage: c },
          { customer: { name: c } },
          { lines: { some: { salesOrderItem: { salesOrder: { orderCode: c } } } } },
          { lines: { some: { productionInvoiceItem: { lsxCode: c } } } },
          { lines: { some: { productionInvoiceItem: { productionInvoice: { code: c } } } } },
        ],
      });
    }

    const rows = await this.prisma.booking.findMany({
      where: and.length ? { AND: and } : {},
      include: BOOKING_INCLUDE,
      orderBy: [
        { pickupDate: { sort: 'asc', nulls: 'last' } },
        { cutOffAt: { sort: 'asc', nulls: 'last' } },
        { id: 'asc' },
      ],
      take: LIST_LIMIT,
    });
    return this.enrichBookings(this.prisma, rows);
  }

  async findOne(id: string): Promise<BookingResponseDto> {
    return this.findOneWith(this.prisma, parseBigIntId(id));
  }

  private async findOneWith(client: PrismaTx, id: bigint): Promise<BookingResponseDto> {
    const row = await client.booking.findUnique({ where: { id }, include: BOOKING_INCLUDE });
    if (!row) throw new NotFoundException(`Không tìm thấy booking ${id.toString()}`);
    return (await this.enrichBookings(client, [row]))[0];
  }

  async getMeta(): Promise<BookingMetaDto> {
    const [warehouses, cfg] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { isActive: true, isVirtual: false, deletedAt: null },
        select: { code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.systemConfig.findUnique({
        where: { id: 1 },
        select: { containerVolumeM3: true },
      }),
    ]);
    return new BookingMetaDto({
      finishedWarehouses: warehouses
        .filter((w) => warehouseFamilyOf(w.code) === 'thanh-pham')
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
        .map((w) => ({ code: w.code, name: w.name })),
      containerVolumeM3: num(cfg?.containerVolumeM3) ?? DEFAULT_CONTAINER_VOLUME_M3,
    });
  }

  /** Dòng hàng có thể xếp cho 1 khách (bảng chọn hàng): còn được xếp > 0 hoặc đang nằm trong booking `bookingId`. */
  async getCandidates(query: BookingCandidatesQueryDto): Promise<BookingCandidateDto[]> {
    const customerId = parseBigIntId(query.customerId);
    const bookingId = query.bookingId ? parseBigIntId(query.bookingId) : null;

    const [piis, current] = await Promise.all([
      this.prisma.productionInvoiceItem.findMany({
        where: {
          salesOrderItemId: { not: null },
          salesOrder: { customerId, isActive: true, deletedAt: null },
          OR: [
            { productionInvoiceId: null },
            { productionInvoice: { status: { not: ProductionInvoiceStatus.CANCELLED } } },
          ],
        },
        select: PII_SELECT,
      }),
      bookingId
        ? this.prisma.bookingLine.findMany({
            where: { bookingId },
            select: { productionInvoiceItemId: true, qty: true },
          })
        : Promise.resolve([] as { productionInvoiceItemId: bigint; qty: number }[]),
    ]);
    const currentByPii = new Map(current.map((l) => [l.productionInvoiceItemId.toString(), l.qty]));

    // Lọc thô trước (còn hàng chưa xuất hoặc đang nằm trong booking) để khỏi gom số liệu cho cả lịch sử đơn của khách.
    const rows = piis.filter((p) => {
      const soi = p.salesOrderItem;
      if (!soi) return false;
      return soi.totalQty - orderShippedQtyOf(soi) > 0 || currentByPii.has(p.id.toString());
    });
    const ctx = await this.loadContext(
      this.prisma,
      rows.map((p) => p.salesOrderItemId!),
      rows.map((p) => p.id),
    );
    const excludeId = bookingId?.toString() ?? null;
    const out: BookingCandidateDto[] = [];
    for (const pii of rows) {
      const info = this.itemInfo(pii, ctx, excludeId);
      const currentQty = currentByPii.get(pii.id.toString()) ?? 0;
      if (info.availableQty > 0 || currentQty > 0) {
        out.push(
          new BookingCandidateDto({
            ...info,
            currentQty,
            piStatus: pii.productionInvoice?.status ?? null,
          }),
        );
      }
    }
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    return out.sort(
      (a, b) =>
        cmp(a.orderCode, b.orderCode) ||
        (a.lenhCode === b.lenhCode
          ? 0
          : a.lenhCode === null
            ? 1
            : b.lenhCode === null
              ? -1
              : cmp(a.lenhCode, b.lenhCode)) ||
        cmp(a.factoryCode, b.factoryCode),
    );
  }

  // ─── Ghi ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

  async create(dto: CreateBookingDto): Promise<BookingResponseDto> {
    const userId = this.requireUserId();
    const bookingNo = dto.bookingNo.trim();
    const pod = dto.pod.trim();
    if (!bookingNo) throw new BadRequestException('Số booking không được để trống');
    if (!pod) throw new BadRequestException('POD (cảng đến) không được để trống');
    const customerId = parseBigIntId(dto.customerId);
    const now = new Date();

    const { id, snapshot } = await this.prisma.$transaction(async (tx) => {
      await this.assertCustomer(tx, customerId);
      const warehouseCode = trimOrNull(dto.warehouseCode);
      if (warehouseCode) await this.assertFinishedWarehouse(tx, warehouseCode);
      await this.assertBookingNoFree(tx, bookingNo, null);

      const created = await tx.booking.create({
        data: {
          bookingNo,
          customerId,
          containerType: trimOrNull(dto.containerType) ?? '40HC',
          containerQty: dto.containerQty ?? 1,
          pod,
          cutSiAt: dto.cutSiAt ? new Date(dto.cutSiAt) : null,
          pickupDate: this.parseDateOnly(dto.pickupDate),
          cutOffAt: dto.cutOffAt ? new Date(dto.cutOffAt) : null,
          etd: this.parseDateOnly(dto.etd),
          pickupPlace: trimOrNull(dto.pickupPlace),
          vesselVoyage: trimOrNull(dto.vesselVoyage),
          warehouseCode,
          note: trimOrNull(dto.note),
          attachments: this.buildAttachments(dto.attachments ?? [], [], now),
          createdById: userId,
        },
      });
      const lines = dto.lines ?? [];
      await this.applyLines(tx, created.id, customerId, lines);
      return { id: created.id, snapshot: this.snapshotOf(created, lines) };
    }, TX_OPTIONS);

    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.CREATE,
      tableName: 'bookings',
      recordId: id,
      newValue: snapshot,
    });
    return this.findOneWith(this.prisma, id);
  }

  async update(idRaw: string, dto: UpdateBookingDto): Promise<BookingResponseDto> {
    const id = parseBigIntId(idRaw);
    const now = new Date();

    const { before, after } = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `booking:${id.toString()}`);
      const cur = await this.getEditableOrThrow(tx, id);

      const newCustomerId = dto.customerId ? parseBigIntId(dto.customerId) : cur.customerId;
      const customerChanged = newCustomerId !== cur.customerId;
      if (customerChanged) {
        if (cur.lines.length > 0 && dto.lines === undefined) {
          throw new BadRequestException('Đổi khách hàng thì phải chọn lại hàng');
        }
        await this.assertCustomer(tx, newCustomerId);
      }

      const data: Prisma.BookingUncheckedUpdateInput = {};
      if (customerChanged) data.customerId = newCustomerId;
      if (dto.bookingNo !== undefined) {
        const no = dto.bookingNo.trim();
        if (!no) throw new BadRequestException('Số booking không được để trống');
        if (no !== cur.bookingNo) {
          await this.assertBookingNoFree(tx, no, id);
          data.bookingNo = no;
        }
      }
      if (dto.containerType != null) {
        const t = dto.containerType.trim();
        if (!t) throw new BadRequestException('Loại cont không được để trống');
        data.containerType = t;
      }
      if (dto.containerQty != null) data.containerQty = dto.containerQty;
      if (dto.pod != null) {
        const pod = dto.pod.trim();
        if (!pod) throw new BadRequestException('POD (cảng đến) không được để trống');
        data.pod = pod;
      }
      if (dto.cutSiAt !== undefined) data.cutSiAt = dto.cutSiAt ? new Date(dto.cutSiAt) : null;
      if (dto.pickupDate !== undefined) data.pickupDate = this.parseDateOnly(dto.pickupDate);
      if (dto.cutOffAt !== undefined) data.cutOffAt = dto.cutOffAt ? new Date(dto.cutOffAt) : null;
      if (dto.etd !== undefined) data.etd = this.parseDateOnly(dto.etd);
      if (dto.pickupPlace !== undefined) data.pickupPlace = trimOrNull(dto.pickupPlace);
      if (dto.vesselVoyage !== undefined) data.vesselVoyage = trimOrNull(dto.vesselVoyage);
      if (dto.warehouseCode !== undefined) {
        const code = trimOrNull(dto.warehouseCode);
        if (code) await this.assertFinishedWarehouse(tx, code);
        data.warehouseCode = code;
      }
      if (dto.note !== undefined) data.note = trimOrNull(dto.note);
      if (dto.attachments !== undefined) {
        data.attachments = this.buildAttachments(
          dto.attachments,
          this.parseAttachments(cur.attachments),
          now,
        );
      }

      const updated =
        Object.keys(data).length > 0 ? await tx.booking.update({ where: { id }, data }) : cur;
      if (dto.lines !== undefined) {
        await this.applyLines(tx, id, newCustomerId, dto.lines);
      }
      const beforeSnap = this.snapshotOf(
        cur,
        cur.lines.map((l) => ({
          productionInvoiceItemId: l.productionInvoiceItemId.toString(),
          qty: l.qty,
        })),
      );
      const afterSnap = this.snapshotOf(
        updated,
        dto.lines ??
          cur.lines.map((l) => ({
            productionInvoiceItemId: l.productionInvoiceItemId.toString(),
            qty: l.qty,
          })),
      );
      return { before: beforeSnap, after: afterSnap };
    }, TX_OPTIONS);

    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.UPDATE,
      tableName: 'bookings',
      recordId: id,
      oldValue: before,
      newValue: after,
    });
    return this.findOneWith(this.prisma, id);
  }

  async confirm(idRaw: string): Promise<BookingResponseDto> {
    const id = parseBigIntId(idRaw);
    const userId = this.requireUserId();

    const { before, after } = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `booking:${id.toString()}`);
      const cur = await this.getBookingOrThrow(tx, id);
      if (cur.status === BookingStatus.CONFIRMED) {
        throw new ConflictException(`Booking ${cur.bookingNo} đã xác nhận`);
      }
      if (cur.status !== BookingStatus.DRAFT) this.throwNotEditable(cur);
      if (cur.lines.length === 0) {
        throw new BadRequestException(
          `Booking ${cur.bookingNo} chưa có hàng - thêm hàng trước khi xác nhận`,
        );
      }
      if (!cur.warehouseCode) {
        throw new BadRequestException('Chọn kho thành phẩm gom hàng trước khi xác nhận (5.6)');
      }
      const updated = await tx.booking.update({
        where: { id },
        data: { status: BookingStatus.CONFIRMED, confirmedAt: new Date(), confirmedById: userId },
      });
      const lines = cur.lines.map((l) => ({
        productionInvoiceItemId: l.productionInvoiceItemId.toString(),
        qty: l.qty,
      }));
      return { before: this.snapshotOf(cur, lines), after: this.snapshotOf(updated, lines) };
    }, TX_OPTIONS);

    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.UPDATE,
      tableName: 'bookings',
      recordId: id,
      oldValue: before,
      newValue: after,
    });
    return this.findOneWith(this.prisma, id);
  }

  async cancel(idRaw: string, dto: CancelBookingDto): Promise<BookingResponseDto> {
    const id = parseBigIntId(idRaw);
    const userId = this.requireUserId();
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Nhập lý do huỷ booking');

    const { before, after } = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `booking:${id.toString()}`);
      const cur = await this.getEditableOrThrow(tx, id);
      const shipped = cur.lines.find((l) => l.shippedQty > 0);
      if (shipped) {
        throw new ConflictException(
          `Booking ${cur.bookingNo} đã có hàng xuất thực tế - không huỷ được`,
        );
      }
      const updated = await tx.booking.update({
        where: { id },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId,
          cancelReason: reason,
        },
      });
      const lines = cur.lines.map((l) => ({
        productionInvoiceItemId: l.productionInvoiceItemId.toString(),
        qty: l.qty,
      }));
      return {
        before: this.snapshotOf(cur, lines),
        after: { ...this.snapshotOf(updated, lines), cancelReason: reason },
      };
    }, TX_OPTIONS);

    try {
      await this.notifications.resolve({
        entityType: 'BOOKING',
        entityId: id.toString(),
        types: ['BOOKING_SHORT'],
      });
    } catch (err) {
      this.logger.error(
        `Không đóng được thông báo BOOKING_SHORT của booking ${id.toString()}: ${(err as Error).message}`,
      );
    }
    await auditEvent(this.prisma, this.cls, this.logger, {
      action: AuditAction.UPDATE,
      tableName: 'bookings',
      recordId: id,
      oldValue: before,
      newValue: after,
    });
    return this.findOneWith(this.prisma, id);
  }

  // ─── Kiểm tra / ghi dùng chung ────────────────────────────────────────────────────────────────────────────────────────

  private requireUserId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new BadRequestException('Không xác định được người dùng');
    return userId;
  }

  private requireVnDay(day: string): Date {
    const d = vnDayStart(day);
    if (!d) throw new BadRequestException(`Ngày không hợp lệ: ${day}`);
    return d;
  }

  private parseDateOnly(v: string | null | undefined): Date | null {
    if (!v) return null;
    if (!vnDayStart(v)) throw new BadRequestException(`Ngày không hợp lệ: ${v}`);
    return new Date(`${v}T00:00:00.000Z`);
  }

  private async assertCustomer(tx: PrismaTx, customerId: bigint): Promise<void> {
    const c = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!c) throw new BadRequestException('Khách hàng không tồn tại');
  }

  private async assertFinishedWarehouse(tx: PrismaTx, code: string): Promise<void> {
    const ok =
      warehouseFamilyOf(code) === 'thanh-pham' &&
      (await tx.warehouse.findFirst({
        where: { code, isActive: true, isVirtual: false, deletedAt: null },
        select: { id: true },
      }));
    if (!ok) throw new BadRequestException(`Kho ${code} không phải kho thành phẩm đang dùng`);
  }

  /** Số booking không trùng giữa các booking CHƯA HUỶ (không phân biệt hoa/thường). Khoá theo số để 2 người tạo cùng lúc không lọt. */
  private async assertBookingNoFree(
    tx: PrismaTx,
    bookingNo: string,
    selfId: bigint | null,
  ): Promise<void> {
    await lockBusinessKey(tx, `booking-no:${bookingNo.toUpperCase()}`);
    const dup = await tx.booking.findFirst({
      where: {
        bookingNo: { equals: bookingNo, mode: 'insensitive' },
        status: { not: BookingStatus.CANCELLED },
        ...(selfId !== null ? { id: { not: selfId } } : {}),
      },
      select: { id: true, customer: { select: { name: true } } },
    });
    if (dup) {
      throw new ConflictException(
        `Số booking ${bookingNo} đã có ở booking khác (khách ${dup.customer.name})`,
      );
    }
  }

  private async getBookingOrThrow(tx: PrismaTx, id: bigint) {
    const row = await tx.booking.findUnique({ where: { id }, include: { lines: true } });
    if (!row) throw new NotFoundException(`Không tìm thấy booking ${id.toString()}`);
    return row;
  }

  private async getEditableOrThrow(tx: PrismaTx, id: bigint) {
    const row = await this.getBookingOrThrow(tx, id);
    if (!ACTIVE_STATUSES.includes(row.status)) this.throwNotEditable(row);
    return row;
  }

  private throwNotEditable(b: { bookingNo: string; status: BookingStatus }): never {
    throw new ConflictException(
      `Booking ${b.bookingNo} ${b.status === BookingStatus.SHIPPED ? 'đã xuất' : 'đã huỷ'} - không sửa được`,
    );
  }

  private parseAttachments(
    raw: unknown,
  ): { name: string; url: string; uploadedAt: string | null }[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a) => ({
        name: typeof a.name === 'string' ? a.name : '',
        url: typeof a.url === 'string' ? a.url : '',
        uploadedAt: typeof a.uploadedAt === 'string' ? a.uploadedAt : null,
      }));
  }

  /** uploadedAt: giữ của file cũ trùng url, file mới = lúc lưu. */
  private buildAttachments(
    input: BookingAttachmentInputDto[],
    old: { url: string; uploadedAt: string | null }[],
    now: Date,
  ): Prisma.InputJsonValue {
    const oldAt = new Map(old.map((a) => [a.url, a.uploadedAt]));
    return input.map((a) => ({
      name: a.name.trim(),
      url: a.url.trim(),
      uploadedAt: oldAt.get(a.url.trim()) ?? now.toISOString(),
    }));
  }

  private snapshotOf(
    b: {
      bookingNo: string;
      customerId: bigint;
      containerType: string;
      containerQty: number;
      pod: string;
      cutSiAt: Date | null;
      pickupDate: Date | null;
      cutOffAt: Date | null;
      etd: Date | null;
      pickupPlace: string | null;
      vesselVoyage: string | null;
      warehouseCode: string | null;
      note: string | null;
      status: BookingStatus;
    },
    lines: { productionInvoiceItemId: string; qty: number }[],
  ) {
    return {
      bookingNo: b.bookingNo,
      customerId: b.customerId.toString(),
      containerType: b.containerType,
      containerQty: b.containerQty,
      pod: b.pod,
      cutSiAt: b.cutSiAt?.toISOString() ?? null,
      pickupDate: dateOnlyStr(b.pickupDate),
      cutOffAt: b.cutOffAt?.toISOString() ?? null,
      etd: dateOnlyStr(b.etd),
      pickupPlace: b.pickupPlace,
      vesselVoyage: b.vesselVoyage,
      warehouseCode: b.warehouseCode,
      note: b.note,
      status: b.status,
      lines: lines.map((l) => ({ piItemId: l.productionInvoiceItemId, qty: l.qty })),
    };
  }

  /**
   * THAY toàn bộ hàng của booking (xem update-booking.dto). Chạy TRONG transaction ghi header: khoá các dòng đơn
   * (`SELECT ... FOR UPDATE`) TRƯỚC khi đọc số đã xuất/đã xếp - 2 Sales xếp cùng dòng cùng lúc thì transaction sau chờ, rồi đọc
   * lại số mới (V2-6).
   */
  private async applyLines(
    tx: PrismaTx,
    bookingId: bigint,
    customerId: bigint,
    inputs: BookingLineInputDto[],
  ): Promise<void> {
    const piiIds = inputs.map((l) => parseBigIntId(l.productionInvoiceItemId));
    if (new Set(piiIds.map(String)).size !== piiIds.length) {
      throw new BadRequestException('Một dòng lệnh bị chọn 2 lần trong cùng booking');
    }
    const existing = await tx.bookingLine.findMany({
      where: { bookingId },
      select: {
        id: true,
        productionInvoiceItemId: true,
        qty: true,
        shippedQty: true,
        productionInvoiceItem: { select: { mfgProduct: { select: { factoryCode: true } } } },
      },
      orderBy: { id: 'asc' },
    });
    const existingByPii = new Map(existing.map((e) => [e.productionInvoiceItemId.toString(), e]));

    // Dòng đã có hàng xuất thực tế không được gỡ hay giảm dưới số đã xuất.
    const wantByPii = new Map(inputs.map((l) => [l.productionInvoiceItemId, l.qty]));
    for (const e of existing) {
      if (e.shippedQty <= 0) continue;
      const want = wantByPii.get(e.productionInvoiceItemId.toString());
      if (want === undefined || want < e.shippedQty) {
        throw new ConflictException(
          `SKU ${e.productionInvoiceItem.mfgProduct.factoryCode} đã xuất ${e.shippedQty} bộ - không gỡ hay giảm dưới số đã xuất`,
        );
      }
    }

    if (inputs.length === 0) {
      if (existing.length > 0) await tx.bookingLine.deleteMany({ where: { bookingId } });
      return;
    }

    const piiRows = await tx.productionInvoiceItem.findMany({
      where: { id: { in: piiIds } },
      select: PII_SELECT,
    });
    const piiById = new Map(piiRows.map((p) => [p.id.toString(), p]));
    for (const l of inputs) {
      const pii = piiById.get(l.productionInvoiceItemId);
      if (!pii) {
        throw new BadRequestException(`Dòng lệnh ${l.productionInvoiceItemId} không tồn tại`);
      }
      const label = `SKU ${pii.mfgProduct.factoryCode} (PO ${pii.salesOrder?.orderCode ?? '?'})`;
      if (pii.salesOrderItemId === null || !pii.salesOrder) {
        throw new BadRequestException(
          `${label} không gắn với đơn hàng nào - không xếp vào booking được`,
        );
      }
      if (pii.salesOrder.customerId !== customerId) {
        throw new BadRequestException(`${label} không thuộc khách hàng của booking`);
      }
      if (!pii.salesOrder.isActive || pii.salesOrder.deletedAt !== null) {
        throw new BadRequestException(`${label}: đơn hàng đã ngừng hoặc đã xoá`);
      }
      if (pii.productionInvoice?.status === ProductionInvoiceStatus.CANCELLED) {
        throw new BadRequestException(`${label}: lệnh sản xuất đã huỷ`);
      }
    }

    const soiIds = [...new Set(piiRows.map((p) => p.salesOrderItemId!))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    // KHOÁ dòng đơn trước khi đọc số đã xuất / đã xếp ở booking khác.
    await tx.$queryRaw`SELECT id FROM "sales_order_items" WHERE id IN (${Prisma.join(soiIds)}) ORDER BY id FOR UPDATE`;
    const soiRows = await tx.salesOrderItem.findMany({
      where: { id: { in: soiIds } },
      select: { id: true, totalQty: true, shippedQty: true },
    });
    const others = await tx.bookingLine.findMany({
      where: {
        salesOrderItemId: { in: soiIds },
        bookingId: { not: bookingId },
        booking: { status: { in: ACTIVE_STATUSES } },
      },
      select: { salesOrderItemId: true, qty: true, shippedQty: true },
    });
    const bookedOther = new Map<string, number>();
    for (const o of others) {
      const k = o.salesOrderItemId.toString();
      bookedOther.set(k, (bookedOther.get(k) ?? 0) + Math.max(0, o.qty - o.shippedQty));
    }
    const available = new Map<string, number>();
    for (const s of soiRows) {
      const k = s.id.toString();
      available.set(k, Math.max(0, s.totalQty - orderShippedQtyOf(s) - (bookedOther.get(k) ?? 0)));
    }
    const groupQty = new Map<string, number>();
    for (const l of inputs) {
      const k = piiById.get(l.productionInvoiceItemId)!.salesOrderItemId!.toString();
      groupQty.set(k, (groupQty.get(k) ?? 0) + l.qty);
    }
    const over: string[] = [];
    for (const l of inputs) {
      const pii = piiById.get(l.productionInvoiceItemId)!;
      const k = pii.salesOrderItemId!.toString();
      const avail = available.get(k) ?? 0;
      const want = groupQty.get(k) ?? 0;
      if (want > avail) {
        over.push(
          `SKU ${pii.mfgProduct.factoryCode} (PO ${pii.salesOrder!.orderCode}, lệnh ${lenhCodeOf(pii) ?? 'chưa lên lệnh'}) chỉ còn ${avail} bộ được xếp - đang nhập ${want}`,
        );
      }
    }
    if (over.length > 0) throw new BadRequestException(over.join('; '));

    const keep = new Set(inputs.map((l) => l.productionInvoiceItemId));
    const removeIds = existing
      .filter((e) => !keep.has(e.productionInvoiceItemId.toString()))
      .map((e) => e.id);
    if (removeIds.length > 0) await tx.bookingLine.deleteMany({ where: { id: { in: removeIds } } });

    const toCreate: Prisma.BookingLineCreateManyInput[] = [];
    for (const l of inputs) {
      const e = existingByPii.get(l.productionInvoiceItemId);
      if (e) {
        if (e.qty !== l.qty) {
          await tx.bookingLine.update({ where: { id: e.id }, data: { qty: l.qty } });
        }
      } else {
        toCreate.push({
          bookingId,
          productionInvoiceItemId: BigInt(l.productionInvoiceItemId),
          salesOrderItemId: piiById.get(l.productionInvoiceItemId)!.salesOrderItemId!,
          qty: l.qty,
        });
      }
    }
    if (toCreate.length > 0) await tx.bookingLine.createMany({ data: toCreate });
  }

  // ─── Làm giàu response (dùng chung list / detail / candidates / cảnh báo) ──────────────────────────────────────────────

  /** Gom số liệu cho cả lô: mỗi loại 1 truy vấn, không N+1. */
  private async loadContext(
    client: PrismaTx,
    soiIds: bigint[],
    piiIds: bigint[],
  ): Promise<EnrichContext> {
    const uniqSoi = [...new Set(soiIds.map((i) => i.toString()))].map((s) => BigInt(s));
    const uniqPii = [...new Set(piiIds.map((i) => i.toString()))].map((s) => BigInt(s));
    const [cfg, packedRows, activeRows] = await Promise.all([
      client.systemConfig.findUnique({ where: { id: 1 }, select: { containerVolumeM3: true } }),
      uniqPii.length
        ? client.packagingRecord.groupBy({
            by: ['productionInvoiceItemId'],
            where: { productionInvoiceItemId: { in: uniqPii } },
            _sum: { boxesPacked: true },
          })
        : Promise.resolve([]),
      uniqSoi.length
        ? client.bookingLine.findMany({
            where: {
              salesOrderItemId: { in: uniqSoi },
              booking: { status: { in: ACTIVE_STATUSES } },
            },
            select: {
              bookingId: true,
              productionInvoiceItemId: true,
              salesOrderItemId: true,
              qty: true,
              shippedQty: true,
              booking: { select: { pickupDate: true, cutOffAt: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    const packed = new Map<string, number>();
    for (const r of packedRows) {
      packed.set(r.productionInvoiceItemId.toString(), r._sum.boxesPacked ?? 0);
    }
    const activeBySoi = new Map<string, ActiveLine[]>();
    const activeByPii = new Map<string, ActiveLine[]>();
    for (const r of activeRows) {
      const line: ActiveLine = {
        bookingId: r.bookingId.toString(),
        piiId: r.productionInvoiceItemId.toString(),
        soiId: r.salesOrderItemId.toString(),
        qty: r.qty,
        shippedQty: r.shippedQty,
        dueDay: bookingDueDay(r.booking),
      };
      pushTo(activeBySoi, line.soiId, line);
      pushTo(activeByPii, line.piiId, line);
    }
    return {
      containerVolumeM3: num(cfg?.containerVolumeM3) ?? DEFAULT_CONTAINER_VOLUME_M3,
      packed,
      activeBySoi,
      activeByPii,
    };
  }

  /** Phần số liệu chung của 1 dòng hàng. `excludeBookingId`: không tính số đã xếp của chính booking này vào "booking khác". */
  private itemInfo(pii: PiiRow, ctx: EnrichContext, excludeBookingId: string | null): ItemInfo {
    const soi = pii.salesOrderItem;
    const soiId = (pii.salesOrderItemId ?? 0n).toString();
    const orderQty = soi?.totalQty ?? 0;
    const orderShippedQty = soi ? orderShippedQtyOf(soi) : 0;
    let bookedOtherQty = 0;
    for (const a of ctx.activeBySoi.get(soiId) ?? []) {
      if (a.bookingId === excludeBookingId) continue;
      bookedOtherQty += Math.max(0, a.qty - a.shippedQty);
    }
    const packedQty = ctx.packed.get(pii.id.toString()) ?? 0;
    const boxVolumeM3 = num(pii.mfgProduct.boxVolumeM3);
    const boxesPerSet = pii.mfgProduct.boxesPerSet;
    return {
      productionInvoiceItemId: pii.id.toString(),
      salesOrderItemId: soiId,
      salesOrderId: (pii.salesOrder?.id ?? pii.salesOrderId ?? 0n).toString(),
      orderCode: pii.salesOrder?.orderCode ?? '',
      mfgProductId: pii.mfgProduct.id.toString(),
      factoryCode: pii.mfgProduct.factoryCode,
      skuName: soi?.skuName ?? pii.mfgProduct.name,
      deliveryDate: soi?.deliveryDate ?? null,
      lenhCode: lenhCodeOf(pii),
      productionInvoiceId: pii.productionInvoice?.id.toString() ?? null,
      piCode: pii.productionInvoice?.code ?? null,
      itemWarehouseCode: pii.warehouseCode,
      itemWarehouseName: pii.warehouseName,
      orderQty,
      orderShippedQty,
      bookedOtherQty,
      availableQty: Math.max(0, orderQty - orderShippedQty - bookedOtherQty),
      packedQty,
      readyQty: Math.max(0, packedQty - orderShippedQty),
      boxVolumeM3,
      boxesPerSet,
      setVolumeM3: setVolumeM3(boxVolumeM3, boxesPerSet),
      loadCont: pii.mfgProduct.loadCont ?? null,
    };
  }

  /** Dựng response cho 1 lô booking (đọc kèm `BOOKING_INCLUDE`). Dùng chung với `BookingAlertsService`. */
  async enrichBookings(client: PrismaTx, bookings: BookingRow[]): Promise<BookingResponseDto[]> {
    if (bookings.length === 0) return [];
    const allLines = bookings.flatMap((b) => b.lines);
    const piiIds = allLines.map((l) => l.productionInvoiceItemId);
    const soiIds = allLines.map((l) => l.salesOrderItemId);
    const warehouseCodes = [
      ...new Set(bookings.map((b) => b.warehouseCode).filter((c): c is string => !!c)),
    ];

    const [piis, whs, ctx] = await Promise.all([
      piiIds.length
        ? client.productionInvoiceItem.findMany({
            where: {
              id: { in: [...new Set(piiIds.map((i) => i.toString()))].map((s) => BigInt(s)) },
            },
            select: PII_SELECT,
          })
        : Promise.resolve([] as PiiRow[]),
      warehouseCodes.length
        ? client.warehouse.findMany({
            where: { code: { in: warehouseCodes } },
            select: { code: true, name: true },
          })
        : Promise.resolve([] as { code: string; name: string }[]),
      this.loadContext(client, soiIds, piiIds),
    ]);
    const piiById = new Map(piis.map((p) => [p.id.toString(), p]));
    const whName = new Map(whs.map((w) => [w.code, w.name]));

    return bookings.map((b) => {
      const bid = b.id.toString();
      const isActive = ACTIVE_STATUSES.includes(b.status);
      const lines: BookingLineResponseDto[] = [];
      for (const l of b.lines) {
        const pii = piiById.get(l.productionInvoiceItemId.toString());
        if (!pii) continue;
        const info = this.itemInfo(pii, ctx, bid);
        let shortQty = 0;
        if (isActive) {
          const claims = (ctx.activeByPii.get(info.productionInvoiceItemId) ?? []).map((a) => ({
            bookingId: a.bookingId,
            dueDay: a.dueDay,
            outstanding: Math.max(0, a.qty - a.shippedQty),
          }));
          shortQty = allocateShortage(info.readyQty, claims).get(bid) ?? 0;
        }
        lines.push(
          new BookingLineResponseDto({
            ...info,
            id: l.id.toString(),
            qty: l.qty,
            shippedQty: l.shippedQty,
            lineM3: lineM3(l.qty, info.boxVolumeM3, info.boxesPerSet),
            shortQty,
          }),
        );
      }
      const totals = bookingTotals(
        lines.map((l) => ({
          factoryCode: l.factoryCode,
          qty: l.qty,
          boxVolumeM3: l.boxVolumeM3,
          boxesPerSet: l.boxesPerSet,
          shortQty: l.shortQty,
        })),
        ctx.containerVolumeM3,
        b.containerQty,
      );
      return new BookingResponseDto({
        id: bid,
        bookingNo: b.bookingNo,
        customerId: b.customerId.toString(),
        customerName: b.customer.name,
        containerType: b.containerType,
        containerQty: b.containerQty,
        pod: b.pod,
        cutSiAt: b.cutSiAt,
        pickupDate: dateOnlyStr(b.pickupDate),
        cutOffAt: b.cutOffAt,
        etd: dateOnlyStr(b.etd),
        pickupPlace: b.pickupPlace,
        vesselVoyage: b.vesselVoyage,
        warehouseCode: b.warehouseCode,
        warehouseName: b.warehouseCode ? (whName.get(b.warehouseCode) ?? null) : null,
        note: b.note,
        attachments: this.parseAttachments(b.attachments).map((a) => new BookingAttachmentDto(a)),
        status: b.status,
        orderCodes: [...new Set(lines.map((l) => l.orderCode))],
        lenhCodes: [...new Set(lines.map((l) => l.lenhCode).filter((c): c is string => !!c))],
        createdById: b.createdById,
        createdByName: fullName(b.createdBy),
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        confirmedAt: b.confirmedAt,
        cancelledAt: b.cancelledAt,
        cancelReason: b.cancelReason,
        totals: new BookingTotalsDto(totals),
        lines,
      });
    });
  }
}
