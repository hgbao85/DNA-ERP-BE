import { BadRequestException, ConflictException } from '@nestjs/common';
import { BookingContainerStatus } from '../../generated/prisma/client';
import type { PrismaTx } from '../../prisma/prisma.service';
import { isViTriKhoEnabled } from './vi-tri-kho.config';
import { shipMismatches } from './vi-tri-kho.util';

/**
 * Nối vị trí kho vào đường xuất booking CŨ (BookingShipmentsService.ship - phiếu XK, ảnh phiếu ký, cộng shippedQty dòng booking +
 * dòng đơn). Không có đường xuất song song: bật VI_TRI_KHO_ENABLED thì trước khi ghi, trong CÙNG transaction (đã khoá booking):
 *  - booking phải có ≥ 1 cont và MỌI cont đã đóng (LOADED);
 *  - số thực xuất từng dòng booking = tổng hàng của dòng đó trong các cont (V7) - lệch 1 dòng là 400, không ghi gì.
 * Hàng đã trừ khỏi ô lúc lấy vào cont (BookingLoadService.pick), nên lúc xuất không trừ tồn ô lần nữa. Tắt công tắc: không làm gì.
 */
export async function assertShipMatchesContainers(
  tx: Pick<PrismaTx, 'bookingContainer'>,
  booking: {
    id: bigint;
    bookingNo: string;
    lines: { id: bigint; productionInvoiceItem: { mfgProduct: { factoryCode: string } } }[];
  },
  want: Map<string, number>,
): Promise<void> {
  if (!isViTriKhoEnabled()) return;
  const containers = await tx.bookingContainer.findMany({
    where: { bookingId: booking.id },
    select: {
      containerNo: true,
      status: true,
      lines: { select: { bookingLineId: true, qty: true } },
    },
    orderBy: { id: 'asc' },
  });
  if (containers.length === 0) {
    throw new BadRequestException(
      `Booking ${booking.bookingNo}: chưa có cont nào - soạn hàng (quét ô) vào cont và đóng cont trước khi xác nhận xuất`,
    );
  }
  const open = containers.filter((c) => c.status !== BookingContainerStatus.LOADED);
  if (open.length > 0) {
    throw new ConflictException(
      `Booking ${booking.bookingNo}: còn ${open.length} cont chưa đóng (${open
        .map((c) => c.containerNo ?? 'chưa có số')
        .join(', ')}) - đóng hết cont trước khi xác nhận xuất`,
    );
  }
  const byLine = new Map<string, number>();
  for (const c of containers) {
    for (const l of c.lines) {
      const k = l.bookingLineId.toString();
      byLine.set(k, (byLine.get(k) ?? 0) + l.qty);
    }
  }
  const bad = shipMismatches(
    booking.lines.map((l) => ({
      id: l.id.toString(),
      label: `SKU ${l.productionInvoiceItem.mfgProduct.factoryCode}`,
    })),
    byLine,
    want,
  );
  if (bad.length > 0) {
    throw new BadRequestException(
      `Số thực xuất phải đúng bằng hàng đã đóng cont - ${bad.join('; ')}`,
    );
  }
}

/** Tổng bộ đã lấy vào cont theo dòng booking (mọi trạng thái cont) - chặn Sales gỡ / giảm dòng, huỷ booking. */
export async function loadedQtyByLine(
  tx: Pick<PrismaTx, 'bookingContainerLine'>,
  bookingId: bigint,
): Promise<Map<string, number>> {
  const rows = await tx.bookingContainerLine.groupBy({
    by: ['bookingLineId'],
    where: { container: { bookingId }, qty: { gt: 0 } },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.bookingLineId.toString(), r._sum.qty ?? 0]));
}
