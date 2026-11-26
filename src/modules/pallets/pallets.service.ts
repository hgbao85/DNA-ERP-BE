import * as crypto from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  MfgStage,
  PalletStatus,
  Prisma,
  ProductionInvoiceStatus,
  ProductionOrderFloorStage,
  WarehouseKind,
} from '../../generated/prisma/client';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { NOT_CANCELLED_ORDER } from '../../common/utils/cancelled-order.util';
import { loadLenhDisplayCodes } from '../../common/utils/lenh-code.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isStageHandoverEnabled } from '../stage-handover/stage-handover.config';
import { StageHandoverService } from '../stage-handover/stage-handover.service';
import { stageWarehouseOfPi } from '../stage-handover/stage-handover-warehouse.util';
import {
  CreatePalletsDto,
  ListPalletsQueryDto,
  LoadPalletDto,
  PalletLoadOptionsQueryDto,
  SetPieceCapacityDto,
} from './dto/pallet.dto';
import { isPalletSonEnabled, PALLET_SON_DISABLED_MESSAGE } from './pallet-son.config';
import {
  capacityWarning,
  nextPalletCodes,
  PaintQtyResult,
  palletLoadCap,
  resolvePaintQty,
  weavingPalletLimit,
} from './pallet.util';

type Db = PrismaTx | PrismaServiceType;

const STATUS_LABEL: Record<PalletStatus, string> = {
  EMPTY: 'Trống',
  LOADED: 'Chờ sơn',
  PAINTED: 'Sơn xong',
  ON_SLIP: 'Trên phiếu đan',
};

/** Khoá cấp mã PL-NNN (2 người tạo pallet cùng lúc không trùng mã). */
const PALLET_CODE_LOCK = 'pallet-code';

const LOAD_INCLUDE = {
  productionInvoice: { select: { code: true } },
  productionOrder: { select: { mfgProduct: { select: { factoryCode: true, name: true } } } },
  piece: { select: { code: true, name: true, palletCapacity: true } },
  issueSlipLine: { select: { slip: { select: { id: true, code: true, status: true } } } },
} satisfies Prisma.PalletLoadInclude;

const PALLET_INCLUDE = {
  warehouse: { select: { code: true, name: true } },
  currentLoad: { include: LOAD_INCLUDE },
} satisfies Prisma.PalletInclude;

type LoadRow = Prisma.PalletLoadGetPayload<{ include: typeof LOAD_INCLUDE }>;
type PalletRow = Prisma.PalletGetPayload<{ include: typeof PALLET_INCLUDE }>;

/** Pallet đã sơn trên 1 dòng xuất đan đã kiểm (ngoài transaction) - IssueSlipsService gắn vào dòng trong transaction. */
export interface PreparedSlipPallets {
  palletIds: bigint[];
  productionOrderId: bigint;
  pieceId: bigint;
  qty: number;
}

/** 1 lần "Sơn xong" đã kiểm (ngoài transaction) - FloorScanService đưa vào recordProductionBatch. */
export interface PreparedPaint extends PaintQtyResult {
  palletId: bigint;
  palletCode: string;
  loadId: bigint;
  loadQty: number;
  productionInvoiceId: bigint;
  productionOrderId: bigint;
  pieceId: bigint;
  warehouseCode: string;
}

const newPalletToken = (): string => crypto.randomBytes(18).toString('base64url');

const fullName = (u: { firstName: string; lastName: string } | undefined) =>
  u ? `${u.lastName} ${u.firstName}`.trim() : null;

/**
 * Pallet Sơn (24/11/2026 - docs THIET-KE-PALLET-SON-2026-11-24, chốt P1-P8; bật bằng PALLET_SON_ENABLED):
 *  - thủ kho Sơn tạo pallet (tem QR cố định), xếp pallet TRỐNG = 1 lệnh SX (SKU) + 1 mảnh + số; chặn tổng các pallet chờ sơn vượt số
 *    tổ Sơn còn báo được (kế hoạch, và số khung Sơn đã nhận khi bật giao nhận giữa tổ); cảnh báo vượt sức chứa của mảnh;
 *  - công nhân Sơn quét pallet -> "Sơn xong" / "Báo thiếu" (FloorScanService gọi preparePaint + markPaintedInTx trong
 *    recordProductionBatch), báo thiếu thì báo QLSX + thủ kho Sơn;
 *  - xuất đan: pallet Sơn xong quét vào dòng WEAVING_PIECE của phiếu XK (IssueSlipsService gọi prepareSlipPallets /
 *    attachToLinesInTx / releaseForSlipInTx), xác nhận phiếu -> Trống, huỷ phiếu chờ ký -> Sơn xong.
 * KCS không đổi (P8): số trên pallet không bị KCS trừ, chặn xuất đan theo KCS vẫn ở WeavingIssuesService.
 * Thứ tự khoá: các khoá nghiệp vụ của luồng (production-batch-open / stage-handover-cap / weaving-issue / phiếu) TRƯỚC, dòng pallet
 * (SELECT ... FOR UPDATE, theo id tăng dần) SAU CÙNG - không luồng nào khoá pallet rồi mới lấy khoá khác.
 */
@Injectable()
export class PalletsService {
  private readonly logger = new Logger(PalletsService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly notifications: NotificationsService,
    // Giao nhận giữa tổ: trần "Sơn đã nhận" - chỉ dùng khi bật STAGE_HANDOVER_ENABLED.
    @Optional() private readonly stageHandover?: StageHandoverService,
  ) {}

  assertEnabled(): void {
    if (!isPalletSonEnabled()) throw new BadRequestException(PALLET_SON_DISABLED_MESSAGE);
  }

  // ─── Kho Sơn: danh sách / tạo pallet ─────────────────────────────────────────────────────

  async list(query: ListPalletsQueryDto, scope: string | null) {
    const enabled = isPalletSonEnabled();
    if (!enabled) return { enabled, warehouse: null, counts: emptyCounts(), pallets: [] };
    const warehouse = await this.resolveWarehouse(scope, query.warehouseCode);
    const rows = await this.prisma.pallet.findMany({
      where: { warehouseId: warehouse.id, isActive: true },
      include: PALLET_INCLUDE,
      orderBy: { code: 'asc' },
    });
    const dtos = await this.toDtos(rows);
    const counts = emptyCounts();
    for (const d of dtos) counts[d.status] += 1;
    const q = query.q?.trim().toLowerCase();
    const pallets = dtos.filter(
      (d) =>
        (!query.status || d.status === query.status) &&
        (!q ||
          [
            d.code,
            d.load?.lenhCode,
            d.load?.piCode,
            d.load?.sku,
            d.load?.pieceName,
            d.load?.pieceCode,
          ]
            .filter(Boolean)
            .some((s) => s!.toLowerCase().includes(q))),
    );
    return { enabled, warehouse: whDto(warehouse), counts, pallets };
  }

  async create(dto: CreatePalletsDto, scope: string | null, userId: string) {
    this.assertEnabled();
    const warehouse = await this.resolveWarehouse(scope, dto.warehouseCode);
    const created = await this.prisma.$transaction(
      async (tx) => {
        await lockBusinessKey(tx, PALLET_CODE_LOCK);
        const existing = await tx.pallet.findMany({ select: { code: true } });
        const codes = nextPalletCodes(
          existing.map((p) => p.code),
          dto.count,
        );
        await tx.pallet.createMany({
          data: codes.map((code) => ({
            code,
            qrToken: newPalletToken(),
            warehouseId: warehouse.id,
            createdById: userId,
            note: dto.note?.trim() || null,
          })),
        });
        return tx.pallet.findMany({
          where: { code: { in: codes } },
          include: PALLET_INCLUDE,
          orderBy: { code: 'asc' },
        });
      },
      { timeout: 20_000 },
    );
    return this.toDtos(created);
  }

  /** Chi tiết + lịch sử xếp (mới nhất trước). */
  async findOne(id: string, scope: string | null) {
    const pallet = await this.findPalletOrThrow(parseBigIntId(id));
    this.assertPalletScope(pallet, scope);
    const history = await this.prisma.palletLoad.findMany({
      where: { palletId: pallet.id },
      include: LOAD_INCLUDE,
      orderBy: { loadedAt: 'desc' },
      take: 50,
    });
    const [dto] = await this.toDtos([pallet]);
    return { ...dto, history: await this.toLoadDtos(history) };
  }

  /** Tra theo mã tem (token trong link QR, hoặc cả link) hoặc mã in trên tem (PL-001). */
  async lookup(q: string, scope: string | null) {
    this.assertEnabled();
    const raw = q.trim();
    let token = raw;
    try {
      const fromUrl = new URL(raw).searchParams.get('pallet');
      if (fromUrl) token = fromUrl;
    } catch {
      // không phải link - giữ nguyên
    }
    const pallet = await this.prisma.pallet.findFirst({
      where: { OR: [{ qrToken: token }, { code: raw.toUpperCase() }] },
      include: PALLET_INCLUDE,
    });
    if (!pallet) throw new NotFoundException(`Không tìm thấy pallet "${raw}"`);
    this.assertPalletScope(pallet, scope);
    const [dto] = await this.toDtos([pallet]);
    return dto;
  }

  // ─── Kho Sơn: xếp pallet ─────────────────────────────────────────────────────────────────

  /**
   * Lệnh + mảnh xếp được ở kho Sơn: không truyền lệnh -> danh sách lệnh đang chạy có mảnh qua Sơn nơi kho này sơn; có lệnh ->
   * từng (SKU, mảnh) qua Sơn kèm Kế hoạch / Sơn đã nhận / Đã báo / Chờ sơn trên pallet / Còn xếp được / sức chứa.
   */
  async loadOptions(query: PalletLoadOptionsQueryDto, scope: string | null) {
    const enabled = isPalletSonEnabled();
    if (!enabled) return { enabled, warehouse: null, pis: [] };
    const warehouse = await this.resolveWarehouse(scope, query.warehouseCode);
    const handoverOn = isStageHandoverEnabled();
    if (!query.productionInvoiceId) {
      const piIds = await this.piIdsForWarehouse(warehouse.id);
      const lenh = await loadLenhDisplayCodes(this.prisma, piIds);
      const pis = await this.prisma.productionInvoice.findMany({
        where: { id: { in: piIds } },
        select: { id: true, code: true, deadline: true },
      });
      return {
        enabled,
        handoverEnabled: handoverOn,
        warehouse: whDto(warehouse),
        pis: pis
          .sort((a, b) => {
            const x = a.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
            const y = b.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
            return x !== y ? x - y : a.code.localeCompare(b.code);
          })
          .map((p) => ({
            productionInvoiceId: p.id.toString(),
            code: p.code,
            lenhCode: lenh.get(p.id.toString()) ?? p.code,
            deadline: p.deadline,
          })),
      };
    }
    const piId = parseBigIntId(query.productionInvoiceId);
    const pi = await this.prisma.productionInvoice.findUnique({
      where: { id: piId },
      select: { id: true, code: true },
    });
    if (!pi)
      throw new NotFoundException(`Không tìm thấy lệnh sản xuất ${query.productionInvoiceId}`);
    const sonWh = await stageWarehouseOfPi(this.prisma, piId, MfgStage.SON);
    if (sonWh?.id !== warehouse.id) {
      throw new ForbiddenException(
        `Lệnh ${pi.code} sơn ở kho ${sonWh?.code ?? '(chưa có kho Sơn)'} - bạn đang làm kho ${warehouse.code}`,
      );
    }
    const lenh = await loadLenhDisplayCodes(this.prisma, [piId]);
    return {
      enabled,
      handoverEnabled: handoverOn,
      warehouse: whDto(warehouse),
      productionInvoiceId: pi.id.toString(),
      code: pi.code,
      lenhCode: lenh.get(pi.id.toString()) ?? pi.code,
      rows: await this.pieceRows(this.prisma, piId),
    };
  }

  /**
   * Xếp 1 pallet TRỐNG. Trong transaction: khoá production-batch-open:{SKU}:{mảnh}:SON (cùng khoá báo Sơn - xếp và báo không chen
   * nhau) -> stage-handover-cap (khi bật giao nhận) -> dòng pallet; đọc lại trần trong khoá rồi mới ghi.
   */
  async load(id: string, dto: LoadPalletDto, scope: string | null, userId: string) {
    this.assertEnabled();
    const palletId = parseBigIntId(id);
    const pallet = await this.findPalletOrThrow(palletId);
    this.assertPalletScope(pallet, scope);
    const orderId = parseBigIntId(dto.productionOrderId);
    const pieceId = parseBigIntId(dto.pieceId);
    if (!Number.isInteger(dto.qty) || dto.qty <= 0) {
      throw new BadRequestException('Số mảnh xếp phải là số nguyên lớn hơn 0');
    }
    const order = await this.prisma.productionOrder.findFirst({
      where: { id: orderId, ...NOT_CANCELLED_ORDER },
      select: {
        bomRevisionId: true,
        mfgProduct: { select: { factoryCode: true } },
        productionInvoiceItem: {
          select: {
            productionInvoiceId: true,
            productionInvoice: { select: { code: true, status: true } },
          },
        },
      },
    });
    const piId = order?.productionInvoiceItem.productionInvoiceId;
    if (!order || !piId) throw new NotFoundException('Không tìm thấy SKU (lệnh sản xuất) còn chạy');
    const piStatus = order.productionInvoiceItem.productionInvoice?.status;
    if (
      piStatus === ProductionInvoiceStatus.DONE ||
      piStatus === ProductionInvoiceStatus.CANCELLED
    ) {
      throw new ConflictException('Lệnh đã kết thúc - không xếp pallet được');
    }
    const bp = await this.prisma.bomPiece.findUnique({
      where: { bomRevisionId_pieceId: { bomRevisionId: order.bomRevisionId, pieceId } },
      select: { needsSon: true },
    });
    if (!bp?.needsSon) {
      throw new BadRequestException(
        'Mảnh này không qua tổ Sơn trong định mức của SKU - không xếp pallet được',
      );
    }
    const sonWh = await stageWarehouseOfPi(this.prisma, piId, MfgStage.SON);
    if (sonWh?.id !== pallet.warehouseId) {
      throw new BadRequestException(
        `Lệnh này sơn ở kho ${sonWh?.code ?? '(chưa có kho Sơn)'} - pallet ${pallet.code} thuộc kho ${pallet.warehouse.code}`,
      );
    }

    const loaded = await this.prisma.$transaction(
      async (tx) => {
        await lockBusinessKey(tx, `production-batch-open:${orderId}:${pieceId}:${MfgStage.SON}`);
        if (isStageHandoverEnabled()) await lockBusinessKey(tx, `stage-handover-cap:${piId}:SON`);
        const locked = await this.lockPalletsInTx(tx, [palletId]);
        const p = locked.get(palletId.toString());
        if (p?.status !== PalletStatus.EMPTY || !p.isActive) {
          throw new ConflictException(
            `Pallet ${pallet.code} không còn trống (${STATUS_LABEL[p?.status ?? PalletStatus.EMPTY]}) - chọn pallet trống khác`,
          );
        }
        const [row] = (await this.pieceRows(tx, piId)).filter(
          (r) => r.productionOrderId === orderId.toString() && r.pieceId === pieceId.toString(),
        );
        if (!row) throw new BadRequestException('Mảnh không qua tổ Sơn của SKU này');
        if (dto.qty > row.remainingQty) {
          const recv = row.receivedQty == null ? '' : `, Sơn đã nhận ${row.receivedQty}`;
          throw new BadRequestException(
            `${row.pieceName} (SKU ${row.sku}): kế hoạch ${row.plannedQty}${recv}, đã báo Sơn ${row.reportedQty}, đang chờ sơn trên pallet ${row.pendingQty} - còn xếp được tối đa ${row.remainingQty}, bạn nhập ${dto.qty}.`,
          );
        }
        const load = await tx.palletLoad.create({
          data: {
            palletId,
            productionInvoiceId: piId,
            productionOrderId: orderId,
            pieceId,
            qty: dto.qty,
            loadedById: userId,
          },
        });
        await tx.pallet.update({
          where: { id: palletId },
          data: { status: PalletStatus.LOADED, currentLoadId: load.id },
        });
        return row;
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    const [dtoOut] = await this.toDtos([await this.findPalletOrThrow(palletId)]);
    return { pallet: dtoOut, warning: capacityWarning(dto.qty, loaded.capacity) };
  }

  /** Gỡ lượt xếp CHƯA sơn (xếp nhầm) - pallet về Trống, lượt xếp giữ trong lịch sử (UNLOADED). */
  async unload(id: string, scope: string | null, userId: string) {
    this.assertEnabled();
    const palletId = parseBigIntId(id);
    const pallet = await this.findPalletOrThrow(palletId);
    this.assertPalletScope(pallet, scope);
    await this.prisma.$transaction(async (tx) => {
      const p = (await this.lockPalletsInTx(tx, [palletId])).get(palletId.toString());
      if (p?.status !== PalletStatus.LOADED || !p.currentLoadId) {
        throw new ConflictException(
          `Chỉ gỡ được pallet đang Chờ sơn - pallet ${pallet.code} đang ${STATUS_LABEL[p?.status ?? PalletStatus.EMPTY]}`,
        );
      }
      await tx.palletLoad.update({
        where: { id: p.currentLoadId },
        data: { clearedAt: new Date(), clearedById: userId, clearedReason: 'UNLOADED' },
      });
      await tx.pallet.update({
        where: { id: palletId },
        data: { status: PalletStatus.EMPTY, currentLoadId: null },
      });
    });
    const [dto] = await this.toDtos([await this.findPalletOrThrow(palletId)]);
    return dto;
  }

  /** Sức chứa pallet của 1 mảnh (P2) - chỉ dùng để cảnh báo lúc xếp. */
  async setPieceCapacity(dto: SetPieceCapacityDto) {
    this.assertEnabled();
    const pieceId = parseBigIntId(dto.pieceId);
    const piece = await this.prisma.piece.findUnique({
      where: { id: pieceId },
      select: { id: true },
    });
    if (!piece) throw new NotFoundException(`Không tìm thấy mảnh ${dto.pieceId}`);
    const row = await this.prisma.piece.update({
      where: { id: pieceId },
      data: { palletCapacity: dto.capacity },
      select: { id: true, code: true, name: true, palletCapacity: true },
    });
    return {
      pieceId: row.id.toString(),
      pieceCode: row.code,
      pieceName: row.name,
      capacity: row.palletCapacity,
    };
  }

  // ─── Công nhân Sơn: quét pallet, "Sơn xong" ─────────────────────────────────────────────

  /** Màn công nhân sau khi quét tem pallet. Tắt công tắc: { enabled: false }. */
  async workerView(token: string) {
    const enabled = isPalletSonEnabled();
    if (!enabled) return { enabled, pallet: null };
    const pallet = await this.prisma.pallet.findUnique({
      where: { qrToken: token },
      include: PALLET_INCLUDE,
    });
    if (!pallet || !pallet.isActive) {
      throw new NotFoundException('Tem pallet không còn dùng - báo thủ kho Sơn');
    }
    const [dto] = await this.toDtos([pallet]);
    return { enabled, pallet: dto };
  }

  /** Kiểm trước khi báo (ngoài transaction). `replayKey` = lần báo đã ghi với khoá này -> null (để bên gọi trả lại kết quả cũ). */
  async preparePaint(
    token: string,
    input: { qty?: number; shortReason?: string },
    idempotencyKey: string,
  ): Promise<{ replay: true; palletId: bigint } | { replay: false; prepared: PreparedPaint }> {
    this.assertEnabled();
    const pallet = await this.prisma.pallet.findUnique({
      where: { qrToken: token },
      include: {
        warehouse: { select: { code: true } },
        currentLoad: { include: { floorReport: { select: { idempotencyKey: true } } } },
      },
    });
    if (!pallet || !pallet.isActive) {
      throw new NotFoundException('Tem pallet không còn dùng - báo thủ kho Sơn');
    }
    const load = pallet.currentLoad;
    if (load?.floorReport?.idempotencyKey && load.floorReport.idempotencyKey === idempotencyKey) {
      return { replay: true, palletId: pallet.id };
    }
    if (pallet.status !== PalletStatus.LOADED || !load) {
      throw new ConflictException(
        pallet.status === PalletStatus.EMPTY
          ? `Pallet ${pallet.code} đang trống - chưa có hàng để báo. Báo thủ kho Sơn xếp pallet.`
          : `Pallet ${pallet.code} đã báo Sơn xong rồi (${STATUS_LABEL[pallet.status]}) - không báo lần 2.`,
      );
    }
    const r = resolvePaintQty(load.qty, input.qty, input.shortReason);
    if ('error' in r) throw new BadRequestException(r.error);
    return {
      replay: false,
      prepared: {
        ...r,
        palletId: pallet.id,
        palletCode: pallet.code,
        loadId: load.id,
        loadQty: load.qty,
        productionInvoiceId: load.productionInvoiceId,
        productionOrderId: load.productionOrderId,
        pieceId: load.pieceId,
        warehouseCode: pallet.warehouse.code,
      },
    };
  }

  /**
   * Gọi TRONG transaction của recordProductionBatch, SAU khi đợt Sơn đã ghi: khoá dòng pallet, kiểm lại pallet vẫn Chờ sơn đúng
   * lượt xếp này (2 người quét cùng 1 pallet: người sau 409, cả lần báo của họ rollback), ghi Sơn xong + đợt báo.
   */
  async markPaintedInTx(
    tx: PrismaTx,
    p: PreparedPaint,
    link: { productionBatchId: bigint; floorReportId: bigint; userId: string },
  ): Promise<void> {
    const locked = (await this.lockPalletsInTx(tx, [p.palletId])).get(p.palletId.toString());
    if (locked?.status !== PalletStatus.LOADED || locked.currentLoadId !== p.loadId) {
      throw new ConflictException(
        `Pallet ${p.palletCode} vừa được báo ở máy khác hoặc thủ kho vừa gỡ - tải lại để xem.`,
      );
    }
    await tx.palletLoad.update({
      where: { id: p.loadId },
      data: {
        paintedQty: p.qty,
        shortReason: p.reason,
        paintedById: link.userId,
        paintedAt: new Date(),
        productionBatchId: link.productionBatchId,
        floorReportId: link.floorReportId,
      },
    });
    await tx.pallet.update({ where: { id: p.palletId }, data: { status: PalletStatus.PAINTED } });
  }

  /** Báo thiếu: báo QLSX + thủ kho Sơn (sau commit, best-effort). */
  async notifyShort(p: PreparedPaint, actorId: string): Promise<void> {
    if (!p.short) return;
    try {
      const [order, piece, lenh] = await Promise.all([
        this.prisma.productionOrder.findUnique({
          where: { id: p.productionOrderId },
          select: { mfgProduct: { select: { factoryCode: true } } },
        }),
        this.prisma.piece.findUnique({ where: { id: p.pieceId }, select: { name: true } }),
        loadLenhDisplayCodes(this.prisma, [p.productionInvoiceId]),
      ]);
      await this.notifications.emit('PALLET_SHORT_REPORTED', {
        entityId: p.palletId.toString(),
        actorId,
        params: {
          palletCode: p.palletCode,
          lenhCode: lenh.get(p.productionInvoiceId.toString()) ?? '',
          sku: order?.mfgProduct.factoryCode ?? '',
          pieceName: piece?.name ?? '',
          loadQty: p.loadQty,
          paintedQty: p.qty,
          reason: p.reason ?? '',
          warehouseCode: p.warehouseCode,
        },
      });
    } catch (error) {
      this.logger.error(
        `Không tạo được thông báo báo thiếu pallet ${p.palletCode}: ${(error as Error).message}`,
      );
    }
  }

  // ─── Xuất đan theo pallet (phiếu XK dòng WEAVING_PIECE) ──────────────────────────────────

  /**
   * Kiểm pallet của 1 dòng xuất đan (ngoài transaction): pallet có thật, cùng kho xuất, đang Sơn xong, đúng SKU + mảnh của dòng;
   * số của dòng ≤ tổng số đã sơn của các pallet (chỉ sửa giảm). Trần xuất đan theo KCS / tồn mảnh vẫn ở WeavingIssuesService.
   */
  async prepareSlipPallets(
    palletIds: readonly string[],
    line: { productionOrderId: bigint; pieceId: bigint; qty: number; warehouseId: bigint },
  ): Promise<PreparedSlipPallets> {
    this.assertEnabled();
    const ids = [...new Set(palletIds.map((i) => parseBigIntId(i).toString()))].map(BigInt);
    if (ids.length !== palletIds.length) {
      throw new BadRequestException('Dòng xuất đan có pallet bị quét 2 lần');
    }
    const pallets = await this.prisma.pallet.findMany({
      where: { id: { in: ids } },
      include: PALLET_INCLUDE,
    });
    if (pallets.length !== ids.length) throw new NotFoundException('Không tìm thấy pallet đã quét');
    for (const p of pallets) this.assertSlipPallet(p, line);
    const limit = weavingPalletLimit(
      pallets.map((p) => ({ paintedQty: p.currentLoad!.paintedQty! })),
    );
    if (line.qty > limit) {
      throw new BadRequestException(
        `Pallet ${pallets.map((p) => p.code).join(', ')} chỉ có ${limit} mảnh đã sơn - dòng xuất đan chỉ sửa giảm được, bạn nhập ${line.qty}`,
      );
    }
    return {
      palletIds: ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      productionOrderId: line.productionOrderId,
      pieceId: line.pieceId,
      qty: line.qty,
    };
  }

  /**
   * Gắn pallet vào các dòng của phiếu chờ ký vừa tạo (trong transaction tạo phiếu): khoá MỌI pallet của phiếu 1 lượt theo id tăng
   * dần, kiểm lại (vẫn Sơn xong, chưa nằm trên phiếu nào, đúng SKU + mảnh, đủ số), rồi Sơn xong -> Trên phiếu đan. 1 pallet không
   * nằm được trên 2 phiếu chờ ký: phiếu sau thấy pallet đã ON_SLIP -> 409.
   */
  async attachToLinesInTx(
    tx: PrismaTx,
    items: readonly { prepared: PreparedSlipPallets; lineId: bigint }[],
  ): Promise<void> {
    if (items.length === 0) return;
    const allIds = items.flatMap((i) => i.prepared.palletIds);
    if (new Set(allIds.map(String)).size !== allIds.length) {
      throw new BadRequestException('1 pallet không nằm được trên 2 dòng của phiếu');
    }
    const locked = await this.lockPalletsInTx(tx, allIds);
    const loads = await tx.palletLoad.findMany({
      where: {
        id: { in: [...locked.values()].flatMap((r) => (r.currentLoadId ? [r.currentLoadId] : [])) },
      },
      select: {
        id: true,
        palletId: true,
        productionOrderId: true,
        pieceId: true,
        paintedQty: true,
        issueSlipLineId: true,
        clearedAt: true,
        pallet: { select: { code: true } },
      },
    });
    const loadOf = new Map(loads.map((l) => [l.palletId.toString(), l]));
    for (const { prepared: p, lineId } of items) {
      let total = 0;
      const loadIds: bigint[] = [];
      for (const id of p.palletIds) {
        const row = locked.get(id.toString());
        const load = loadOf.get(id.toString());
        if (
          row?.status !== PalletStatus.PAINTED ||
          !load ||
          load.issueSlipLineId != null ||
          load.clearedAt != null ||
          load.paintedQty == null
        ) {
          throw new ConflictException(
            `Pallet ${load?.pallet.code ?? id} vừa được quét vào phiếu xuất đan khác hoặc đổi trạng thái - tải lại rồi quét lại.`,
          );
        }
        if (load.productionOrderId !== p.productionOrderId || load.pieceId !== p.pieceId) {
          throw new ConflictException(
            `Pallet ${load.pallet.code} không còn chứa đúng SKU / mảnh của dòng`,
          );
        }
        total += load.paintedQty;
        loadIds.push(load.id);
      }
      if (p.qty > total) {
        throw new BadRequestException(
          `Các pallet chỉ có ${total} mảnh đã sơn - dòng xuất đan chỉ sửa giảm được, bạn nhập ${p.qty}`,
        );
      }
      await tx.palletLoad.updateMany({
        where: { id: { in: loadIds } },
        data: { issueSlipLineId: lineId },
      });
    }
    await tx.pallet.updateMany({
      where: { id: { in: allIds } },
      data: { status: PalletStatus.ON_SLIP },
    });
  }

  /**
   * Phiếu chờ ký vừa xác nhận (ISSUED: hàng rời pallet -> Trống, lượt xếp giữ lịch sử) hoặc huỷ (CANCELLED: bỏ gắn, về Sơn xong).
   * Gọi trong transaction của phiếu. Phiếu không có pallet: 1 truy vấn đọc, không ghi gì.
   */
  async releaseForSlipInTx(
    tx: PrismaTx,
    slipId: bigint,
    outcome: 'ISSUED' | 'CANCELLED',
    userId: string,
  ): Promise<number> {
    const loads = await tx.palletLoad.findMany({
      where: { issueSlipLine: { slipId }, clearedAt: null },
      select: { id: true, palletId: true },
    });
    if (loads.length === 0) return 0;
    const palletIds = loads.map((l) => l.palletId);
    await this.lockPalletsInTx(tx, palletIds);
    if (outcome === 'ISSUED') {
      await tx.pallet.updateMany({
        where: { id: { in: palletIds } },
        data: { status: PalletStatus.EMPTY, currentLoadId: null },
      });
      await tx.palletLoad.updateMany({
        where: { id: { in: loads.map((l) => l.id) } },
        data: { clearedAt: new Date(), clearedById: userId, clearedReason: 'ISSUED' },
      });
    } else {
      await tx.palletLoad.updateMany({
        where: { id: { in: loads.map((l) => l.id) } },
        data: { issueSlipLineId: null },
      });
      await tx.pallet.updateMany({
        where: { id: { in: palletIds } },
        data: { status: PalletStatus.PAINTED },
      });
    }
    return loads.length;
  }

  // ─── nội bộ ─────────────────────────────────────────────────────────────────────────────

  /** Khoá dòng pallet theo id tăng dần (luôn là khoá SAU CÙNG của transaction). */
  private async lockPalletsInTx(tx: PrismaTx, ids: readonly bigint[]) {
    const sorted = [...new Set(ids.map((i) => i.toString()))].sort((a, b) =>
      BigInt(a) < BigInt(b) ? -1 : 1,
    );
    const out = new Map<
      string,
      { id: bigint; status: PalletStatus; currentLoadId: bigint | null; isActive: boolean }
    >();
    for (const id of sorted) {
      const rows = await tx.$queryRaw<
        { id: bigint; status: PalletStatus; currentLoadId: bigint | null; isActive: boolean }[]
      >`SELECT "id", "status", "currentLoadId", "isActive" FROM "pallets" WHERE "id" = ${BigInt(id)} FOR UPDATE`;
      if (rows[0]) out.set(id, rows[0]);
    }
    return out;
  }

  private assertSlipPallet(
    p: PalletRow,
    line: { productionOrderId: bigint; pieceId: bigint; warehouseId: bigint },
  ): void {
    if (p.warehouseId !== line.warehouseId) {
      throw new BadRequestException(
        `Pallet ${p.code} thuộc kho ${p.warehouse.code} - không cùng kho xuất của dòng đan`,
      );
    }
    const load = p.currentLoad;
    if (p.status !== PalletStatus.PAINTED || !load || load.paintedQty == null) {
      const slip = load?.issueSlipLine?.slip;
      throw new ConflictException(
        p.status === PalletStatus.ON_SLIP && slip
          ? `Pallet ${p.code} đang nằm trên phiếu ${slip.code} chờ ký - huỷ phiếu đó trước nếu muốn đổi`
          : `Pallet ${p.code} đang ${STATUS_LABEL[p.status]} - chỉ pallet Sơn xong mới xuất đan được`,
      );
    }
    if (load.productionOrderId !== line.productionOrderId || load.pieceId !== line.pieceId) {
      throw new BadRequestException(
        `Pallet ${p.code} chứa ${load.piece.name} (SKU ${load.productionOrder.mfgProduct.factoryCode}) - không đúng SKU / mảnh của dòng`,
      );
    }
  }

  /** Từng (SKU, mảnh) qua Sơn của lệnh + số để xếp (dùng cả trong transaction xếp). */
  private async pieceRows(db: Db, piId: bigint) {
    const orders = await db.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId: piId }, ...NOT_CANCELLED_ORDER },
      select: {
        id: true,
        quantity: true,
        bomRevisionId: true,
        mfgProduct: { select: { factoryCode: true, name: true } },
      },
      orderBy: { id: 'asc' },
    });
    if (orders.length === 0) return [];
    const orderIds = orders.map((o) => o.id);
    const [bomPieces, reported, pending, loadedTotal] = await Promise.all([
      db.bomPiece.findMany({
        where: {
          bomRevisionId: { in: [...new Set(orders.map((o) => o.bomRevisionId))] },
          needsSon: true,
        },
        select: {
          bomRevisionId: true,
          pieceId: true,
          qtyPerUnit: true,
          piece: { select: { code: true, name: true, palletCapacity: true } },
        },
        orderBy: { pieceId: 'asc' },
      }),
      db.productionBatch.groupBy({
        by: ['productionOrderId', 'pieceId'],
        where: { stage: MfgStage.SON, productionOrderId: { in: orderIds } },
        _sum: { reportedQty: true },
      }),
      db.palletLoad.groupBy({
        by: ['productionOrderId', 'pieceId'],
        where: { productionOrderId: { in: orderIds }, clearedAt: null, paintedQty: null },
        _sum: { qty: true },
      }),
      db.palletLoad.groupBy({
        by: ['productionOrderId', 'pieceId'],
        where: {
          productionOrderId: { in: orderIds },
          OR: [{ clearedReason: null }, { clearedReason: { not: 'UNLOADED' } }],
        },
        _sum: { qty: true },
      }),
    ]);
    const caps =
      isStageHandoverEnabled() && this.stageHandover
        ? (await this.stageHandover.pieceCapsForPi(db, piId, MfgStage.SON)).caps
        : null;
    const k = (o: bigint, p: bigint) => `${o}:${p}`;
    const reportedOf = new Map(
      reported.map((r) => [k(r.productionOrderId, r.pieceId), r._sum.reportedQty ?? 0]),
    );
    const pendingOf = new Map(
      pending.map((r) => [k(r.productionOrderId, r.pieceId), r._sum.qty ?? 0]),
    );
    const loadedOf = new Map(
      loadedTotal.map((r) => [k(r.productionOrderId, r.pieceId), r._sum.qty ?? 0]),
    );
    const out = [];
    for (const o of orders) {
      for (const bp of bomPieces) {
        if (bp.bomRevisionId !== o.bomRevisionId) continue;
        const key = k(o.id, bp.pieceId);
        const cap = caps?.get(key) ?? null;
        const plannedQty = bp.qtyPerUnit * o.quantity;
        const reportedQty = reportedOf.get(key) ?? 0;
        const pendingQty = pendingOf.get(key) ?? 0;
        const c = palletLoadCap({
          plannedQty,
          reportedQty,
          receivedLeft: cap ? cap.receivedLeft : null,
          pendingQty,
        });
        out.push({
          productionOrderId: o.id.toString(),
          sku: o.mfgProduct.factoryCode,
          productName: o.mfgProduct.name,
          pieceId: bp.pieceId.toString(),
          pieceCode: bp.piece.code,
          pieceName: bp.piece.name,
          plannedQty,
          /** Sơn đã nhận (giao nhận giữa tổ) - null khi công tắc tắt / mảnh không có cổng nhận. */
          receivedQty: cap ? cap.receivedQty + cap.overrideQty : null,
          reportedQty,
          /** Đang chờ sơn trên pallet. */
          pendingQty,
          /** Đã xếp pallet (mọi lượt, trừ lượt gỡ do xếp nhầm). */
          loadedQty: loadedOf.get(key) ?? 0,
          reportableQty: c.reportableQty,
          remainingQty: c.remainingQty,
          capacity: bp.piece.palletCapacity,
        });
      }
    }
    return out;
  }

  /** Lệnh đang chạy (có SKU đã bắt đầu ở xưởng) có mảnh qua Sơn, sơn ở đúng kho này. */
  private async piIdsForWarehouse(warehouseId: bigint): Promise<bigint[]> {
    const pis = await this.prisma.productionInvoice.findMany({
      where: {
        status: { notIn: [ProductionInvoiceStatus.DONE, ProductionInvoiceStatus.CANCELLED] },
        items: {
          some: {
            productionOrder: {
              floorStage: ProductionOrderFloorStage.ACTIVE,
              ...NOT_CANCELLED_ORDER,
            },
          },
        },
      },
      select: { id: true },
      orderBy: { id: 'desc' },
      take: 300,
    });
    const out: bigint[] = [];
    for (const p of pis) {
      const w = await stageWarehouseOfPi(this.prisma, p.id, MfgStage.SON);
      if (w?.id === warehouseId) out.push(p.id);
    }
    return out;
  }

  private async resolveWarehouse(scope: string | null, warehouseCode?: string) {
    const code = scope ?? warehouseCode;
    if (!code) {
      throw new BadRequestException(
        'Chọn kho Sơn (warehouseCode) - tài khoản không gắn kho đang làm',
      );
    }
    if (scope && warehouseCode && warehouseCode !== scope) {
      throw new ForbiddenException(`Bạn đang làm kho ${scope}`);
    }
    const w = await this.prisma.warehouse.findUnique({
      where: { code },
      select: { id: true, code: true, name: true, kind: true },
    });
    if (!w) throw new NotFoundException(`Không tìm thấy kho ${code}`);
    if (w.kind !== WarehouseKind.SON) throw new BadRequestException('Pallet chỉ dùng ở kho Sơn');
    return w;
  }

  private async findPalletOrThrow(id: bigint): Promise<PalletRow> {
    const p = await this.prisma.pallet.findUnique({ where: { id }, include: PALLET_INCLUDE });
    if (!p) throw new NotFoundException(`Không tìm thấy pallet ${id}`);
    return p;
  }

  private assertPalletScope(
    p: { code: string; warehouse: { code: string } },
    scope: string | null,
  ) {
    if (scope && p.warehouse.code !== scope) {
      throw new ForbiddenException(
        `Pallet ${p.code} thuộc kho ${p.warehouse.code} - bạn đang làm kho ${scope}`,
      );
    }
  }

  private async toDtos(rows: PalletRow[]) {
    const loads = rows.flatMap((r) => (r.currentLoad ? [r.currentLoad] : []));
    const loadDtos = new Map((await this.toLoadDtos(loads)).map((l) => [l.id, l]));
    return rows.map((r) => ({
      id: r.id.toString(),
      code: r.code,
      qrToken: r.qrToken,
      status: r.status,
      statusLabel: STATUS_LABEL[r.status],
      warehouseCode: r.warehouse.code,
      warehouseName: r.warehouse.name,
      note: r.note,
      updatedAt: r.updatedAt,
      load: r.currentLoad ? (loadDtos.get(r.currentLoad.id.toString()) ?? null) : null,
    }));
  }

  private async toLoadDtos(loads: LoadRow[]) {
    if (loads.length === 0) return [];
    const userIds = [
      ...new Set(
        loads.flatMap((l) => [l.loadedById, l.paintedById, l.clearedById]).filter(Boolean),
      ),
    ] as string[];
    const [users, lenh] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true },
      }),
      loadLenhDisplayCodes(
        this.prisma,
        loads.map((l) => l.productionInvoiceId),
      ),
    ]);
    const userOf = new Map(users.map((u) => [u.id, u]));
    const name = (id: string | null) => (id ? fullName(userOf.get(id)) : null);
    return loads.map((l) => {
      const slip = l.issueSlipLine?.slip;
      return {
        id: l.id.toString(),
        productionInvoiceId: l.productionInvoiceId.toString(),
        piCode: l.productionInvoice.code,
        lenhCode: lenh.get(l.productionInvoiceId.toString()) ?? l.productionInvoice.code,
        productionOrderId: l.productionOrderId.toString(),
        sku: l.productionOrder.mfgProduct.factoryCode,
        productName: l.productionOrder.mfgProduct.name,
        pieceId: l.pieceId.toString(),
        pieceCode: l.piece.code,
        pieceName: l.piece.name,
        qty: l.qty,
        capacity: l.piece.palletCapacity,
        overCapacity: capacityWarning(l.qty, l.piece.palletCapacity) != null,
        loadedAt: l.loadedAt,
        loadedByName: name(l.loadedById),
        paintedQty: l.paintedQty,
        shortReason: l.shortReason,
        paintedAt: l.paintedAt,
        paintedByName: name(l.paintedById),
        productionBatchId: l.productionBatchId?.toString() ?? null,
        slip: slip
          ? {
              id: slip.id.toString(),
              code: slip.code,
              status: slip.status,
            }
          : null,
        clearedAt: l.clearedAt,
        clearedByName: name(l.clearedById),
        clearedReason: l.clearedReason,
      };
    });
  }
}

function emptyCounts(): Record<PalletStatus, number> {
  return { EMPTY: 0, LOADED: 0, PAINTED: 0, ON_SLIP: 0 };
}

function whDto(w: { id: bigint; code: string; name: string }) {
  return { id: w.id.toString(), code: w.code, name: w.name };
}
