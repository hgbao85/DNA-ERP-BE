import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { StockLedgerRefType, WarehouseKind } from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import {
  isNormalizedSegmentSteps,
  segmentBucketLockKey,
  segmentCodeLabel,
} from '../../common/utils/segment-code.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';

/** Kho ảo "Cân đối tồn kho" - đối ứng của mọi bút toán chỉnh tay / kiểm kê. */
const ADJUST_WAREHOUSE_CODE = 'OPENING_BALANCE';
const round4 = (n: number) => Math.round(n * 1e4) / 1e4 + 0;

export interface SegmentStocktakeInput {
  warehouseId: bigint;
  segmentSpecId: bigint;
  segmentSteps: string;
  /** Số đoạn thủ kho đếm được. */
  countedQty: number;
  /** Tồn hệ thống lúc thủ kho mở form - lệch với tồn thật lúc ghi thì 409 (ai đó vừa đổi). */
  expectedCurrentQty: number;
  note: string;
  actorId: string;
  /** Phạm vi kho của người kiểm (user.warehouseScope) - có thì chỉ kiểm được đúng kho đó. */
  warehouseScope: string | null;
}

export interface SegmentStocktakeResult {
  label: string;
  beforeQty: number;
  countedQty: number;
  deltaQty: number;
  /** Còn giữ cho lệnh ở ô này - lớn hơn số đếm thì phần giữ vượt tồn thật (Hàn / Sơn sẽ thiếu, ghi sổ báo vượt). */
  heldQty: number;
}

/**
 * Kiểm kê đoạn (anh Nhân 13/11/2026: thủ kho Phôi không nhập tay, chỉ chỉnh khi kiểm kê). Thủ kho nhập SỐ ĐẾM của 1 mã đoạn ở kho
 * Phôi, hệ thống ghi phần chênh bằng bút toán ADJUST (đối ứng "Cân đối tồn kho"). Khoá CÙNG khoá ô (kho, mã đoạn) với phía cộng /
 * phía trừ (SegmentStockService) nên không đan xen với Hàn / Sơn đang trừ. Phần chênh vào / ra cột Dư (tồn - còn giữ); không đụng
 * phần giữ của lệnh.
 */
@Injectable()
export class SegmentStocktakeService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly stockLedger: StockLedgerService,
  ) {}

  async stocktake(input: SegmentStocktakeInput): Promise<SegmentStocktakeResult> {
    if (!isNormalizedSegmentSteps(input.segmentSteps)) {
      throw new BadRequestException(`Bộ công đoạn '${input.segmentSteps}' không đúng dạng mã đoạn`);
    }
    if (!Number.isFinite(input.countedQty) || input.countedQty < 0) {
      throw new BadRequestException('Số đếm phải là số không âm');
    }
    const [warehouse, spec, adjustWh] = await Promise.all([
      this.prisma.warehouse.findUnique({
        where: { id: input.warehouseId },
        select: { id: true, code: true, kind: true },
      }),
      this.prisma.segmentSpec.findUnique({
        where: { id: input.segmentSpecId },
        select: { cutLengthMm: true, material: { select: { code: true } } },
      }),
      this.prisma.warehouse.findUniqueOrThrow({
        where: { code: ADJUST_WAREHOUSE_CODE },
        select: { id: true },
      }),
    ]);
    if (!warehouse || warehouse.kind !== WarehouseKind.PHOI) {
      throw new BadRequestException('Chỉ kiểm kê đoạn ở kho Phôi');
    }
    if (!spec) throw new BadRequestException(`Không tìm thấy cỡ đoạn ${input.segmentSpecId}`);
    if (input.warehouseScope && input.warehouseScope !== warehouse.code) {
      throw new ForbiddenException('Bạn chỉ kiểm kê được kho mình phụ trách');
    }
    const label = segmentCodeLabel(
      spec.material.code,
      Number(spec.cutLengthMm),
      input.segmentSteps,
    );

    return this.prisma.$transaction(
      async (tx) => {
        await lockBusinessKey(
          tx,
          segmentBucketLockKey(input.warehouseId, input.segmentSpecId, input.segmentSteps),
        );
        const [quant, reservations] = await Promise.all([
          tx.stockQuant.findFirst({
            where: {
              warehouseId: input.warehouseId,
              segmentSpecId: input.segmentSpecId,
              segmentSteps: input.segmentSteps,
            },
            select: { qty: true },
          }),
          tx.segmentReservation.findMany({
            where: {
              warehouseId: input.warehouseId,
              segmentSpecId: input.segmentSpecId,
              segmentSteps: input.segmentSteps,
            },
            select: { reservedQty: true, consumedQty: true },
          }),
        ]);
        const beforeQty = quant ? Number(quant.qty) : 0;
        if (Math.abs(beforeQty - input.expectedCurrentQty) > 1e-9) {
          throw new ConflictException(
            `Tồn ${label} vừa đổi (${input.expectedCurrentQty} → ${beforeQty}) - tải lại rồi nhập lại số đếm`,
          );
        }
        const heldQty = round4(
          reservations.reduce((n, r) => n + Number(r.reservedQty) - Number(r.consumedQty), 0),
        );
        const deltaQty = round4(input.countedQty - beforeQty);
        if (deltaQty !== 0) {
          await this.stockLedger.postEntry(
            {
              fromWarehouseId: deltaQty > 0 ? adjustWh.id : input.warehouseId,
              toWarehouseId: deltaQty > 0 ? input.warehouseId : adjustWh.id,
              segmentSpecId: input.segmentSpecId,
              segmentSteps: input.segmentSteps,
              qty: Math.abs(deltaQty),
              refType: StockLedgerRefType.ADJUST,
              note: `Kiểm kê đoạn: ${beforeQty} → ${input.countedQty}. ${input.note}`,
              createdById: input.actorId,
            },
            tx,
          );
        }
        return { label, beforeQty, countedQty: input.countedQty, deltaQty, heldQty };
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }
}
