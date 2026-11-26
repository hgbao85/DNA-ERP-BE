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
import {
  AuditAction,
  MfgStage,
  Prisma,
  PrismaClient,
  ProductionOrderFloorStage,
  ProductionOrderStatus,
  TransferCheckBatchStatus,
  TransferStatus,
  WorkstationKind,
} from '../../generated/prisma/client';
import type { AppClsStore } from '../../common/interfaces/cls-store.interface';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { assertItemNotCancelled, assertPiHasActiveFloor } from '../../common/utils/floor-gate.util';
import { loadLenhDisplayCodes } from '../../common/utils/lenh-code.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { writeAuditLog } from '../../prisma/extensions/audit-log.extension';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductionInvoicesService } from '../production-invoices/production-invoices.service';
import { PIECE_TRANSFER_LEAVES_FRAME } from '../warehouse-transfers/transfer-routes.constant';
import { isViTriKhoEnabled } from '../vi-tri-kho/vi-tri-kho.config';
import { ViTriKhoService } from '../vi-tri-kho/vi-tri-kho.service';
import {
  kcsExtraDefect,
  loadSetsPassed,
  loadTransferCheckUsage,
  packagingLockKey,
  packingAvailable,
  transferCheckAvailable,
  transferCheckLockKey,
  validateKcsGrade,
} from './ck-dg-caps.util';
import { CK_DG_QR_DISABLED_MESSAGE, isCkDgQrEnabled } from './ck-dg-qr.config';
import type {
  CancelPackingReportDto,
  GradeTransferCheckBatchDto,
  ListPackingReportsQueryDto,
  ListTransferCheckBatchesQueryDto,
  ReportPackingDto,
  ReportTransferCheckBatchDto,
} from './dto/ck-dg-qr.dto';

type Person = { firstName: string; lastName: string; username: string } | null;
const nameOf = (u: Person): string | null =>
  u ? `${u.lastName} ${u.firstName}`.trim() || u.username : null;

const PERSON = { select: { firstName: true, lastName: true, username: true } } as const;

const BATCH_INCLUDE = {
  productionInvoiceItem: {
    select: {
      id: true,
      productionInvoiceId: true,
      mfgProduct: { select: { factoryCode: true, name: true } },
      productionInvoice: { select: { code: true } },
    },
  },
  piece: { select: { name: true, code: true } },
  workstation: { select: { code: true, warehouse: { select: { code: true, name: true } } } },
  reportedBy: PERSON,
  reviewedBy: PERSON,
  defectReason: { select: { label: true } },
  kcsDefectReason: { select: { label: true } },
} satisfies Prisma.TransferCheckBatchInclude;
type BatchRow = Prisma.TransferCheckBatchGetPayload<{ include: typeof BATCH_INCLUDE }>;

const PACKING_INCLUDE = {
  productionInvoiceItem: {
    select: {
      id: true,
      productionInvoiceId: true,
      mfgProduct: { select: { factoryCode: true, name: true } },
      productionInvoice: { select: { code: true } },
    },
  },
  workstation: { select: { code: true, warehouse: { select: { code: true, name: true } } } },
  reportedBy: PERSON,
  cancelledBy: PERSON,
  location: { select: { code: true } },
} satisfies Prisma.PackingReportInclude;
type PackingRow = Prisma.PackingReportGetPayload<{ include: typeof PACKING_INCLUDE }>;

const WS_INCLUDE = { warehouse: { select: { id: true, code: true, name: true } } } as const;
type WsRow = Prisma.WorkstationGetPayload<{ include: typeof WS_INCLUDE }>;

/** Tổ của từng loại điểm (khớp CHECK workstations_stage_chk). */
const KIND_STAGE: Partial<Record<WorkstationKind, MfgStage>> = {
  [WorkstationKind.TRANSFER_CHECK]: MfgStage.CHUYEN_KIEM,
  [WorkstationKind.PACKING]: MfgStage.DONG_GOI,
};

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Công nhân tự báo Chuyền kiểm + Đóng gói bằng quét QR (24/11/2026 - docs THIET-KE-CHUYEN-KIEM-DONG-GOI-QR, chốt C1-C4, D1-D4),
 * bật bằng CK_DG_QR_ENABLED (ck-dg-qr.config.ts).
 *  - Chuyền kiểm: công nhân báo đợt (TransferCheckBatch) -> KCS chuyền kiểm chấm -> ghi 1 TransferCheckResult (+ TransferCheckDefect)
 *    như nhập tay cũ, nên Bảng mốc / trần xuất vật tư đóng gói / thống kê đọc như cũ. Trần C3 dưới khoá (SKU, mảnh) dùng chung.
 *  - Đóng gói: ghi qua ProductionInvoicesService.recordPackagingEntry (cùng khoá SKU, cùng tin "đóng gói xong" / "Kết thúc"), chặn
 *    thêm theo số bộ đã qua KCS chuyền kiểm (D2). Thủ kho Thành phẩm huỷ lần báo sai (D4).
 */
@Injectable()
export class CkDgQrService {
  private readonly logger = new Logger(CkDgQrService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly productionInvoices: ProductionInvoicesService,
    private readonly notifications: NotificationsService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly viTriKho: ViTriKhoService,
  ) {}

  getConfig() {
    return { enabled: isCkDgQrEnabled() };
  }

  private assertEnabled(): void {
    if (!isCkDgQrEnabled()) throw new BadRequestException(CK_DG_QR_DISABLED_MESSAGE);
  }

  // ─── Công nhân: quét tem điểm chuyền kiểm / khu đóng gói ─────────────────────────────────────

  /**
   * Quét tem -> điểm + lệnh (SKU) của kho Thành phẩm của điểm + (chọn SKU) mảnh / số còn báo được + lần báo gần đây của mình.
   * Tắt công tắc: { enabled: false }.
   */
  async scanContext(qrToken: string, user: AuthenticatedUser, itemId?: string) {
    if (!isCkDgQrEnabled()) return { enabled: false as const };
    const ws = await this.resolveWorkstation(qrToken, user);
    const items = await this.listScopeItems(ws);
    const isCk = ws.kind === WorkstationKind.TRANSFER_CHECK;
    const selected = itemId ? items.find((i) => i.itemId === itemId) : undefined;
    if (itemId && !selected) {
      throw new ConflictException(
        'Lệnh này không còn ở kho của điểm (đã xong, tạm dừng hoặc kho khác) - chọn lệnh khác',
      );
    }
    const [detail, recent, defectReasons] = await Promise.all([
      selected
        ? isCk
          ? this.transferCheckDetail(BigInt(selected.itemId))
          : this.packingDetail(BigInt(selected.itemId))
        : Promise.resolve(null),
      this.recentReports(ws, user.id),
      isCk ? this.listDefectReasons() : Promise.resolve([]),
    ]);
    return {
      enabled: true as const,
      workstation: this.toWorkstation(ws),
      items,
      selectedItemId: selected?.itemId ?? null,
      pieces: isCk ? (detail as Awaited<ReturnType<typeof this.transferCheckDetail>> | null) : null,
      packing: !isCk ? (detail as Awaited<ReturnType<typeof this.packingDetail>> | null) : null,
      // Vị trí kho (25/11/2026): bật thì khu đóng gói phải quét tem ô khi báo (báo đóng gói = cất vào ô).
      requireLocation: !isCk && isViTriKhoEnabled(),
      defectReasons,
      recent,
    };
  }

  /** C1/C3: công nhân chuyền kiểm báo 1 đợt. Idempotency-Key bắt buộc - gửi lại cùng khoá trả đợt cũ, không báo lần 2. */
  async reportTransferCheck(
    qrToken: string,
    user: AuthenticatedUser,
    dto: ReportTransferCheckBatchDto,
    idempotencyKey: string | undefined,
  ) {
    this.assertEnabled();
    if (!idempotencyKey) throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    const ws = await this.resolveWorkstation(qrToken, user, WorkstationKind.TRANSFER_CHECK);
    const replay = await this.replayBatch(idempotencyKey, user.id);
    if (replay) return { replay: true, batch: replay };

    if (dto.passedQty + dto.defectQty <= 0) {
      throw new BadRequestException('Nhập số đạt hoặc số lỗi (lớn hơn 0)');
    }
    const photoUrls = dto.defectQty > 0 ? (dto.photoUrls ?? []) : [];
    let defectReasonId: bigint | null = null;
    if (dto.defectQty > 0) {
      if (!dto.defectReasonId) throw new BadRequestException('Có lỗi thì chọn nguyên nhân lỗi');
      if (photoUrls.length === 0) {
        throw new BadRequestException('Có lỗi thì chụp ít nhất 1 ảnh lỗi');
      }
      defectReasonId = parseBigIntId(dto.defectReasonId);
      const reason = await this.prisma.defectReason.findUnique({ where: { id: defectReasonId } });
      if (!reason) throw new BadRequestException(`Nguyên nhân lỗi ${dto.defectReasonId} không có`);
    }

    const item = await this.loadScopedItem(ws, dto.itemId);
    await assertPiHasActiveFloor(this.prisma, item.productionInvoiceId, 'báo chuyền kiểm');
    await assertItemNotCancelled(this.prisma, item.id, 'báo chuyền kiểm');
    const pieceId = parseBigIntId(dto.pieceId);
    const bomPiece = await this.prisma.bomPiece.findUnique({
      where: { bomRevisionId_pieceId: { bomRevisionId: item.order.bomRevisionId, pieceId } },
      include: { piece: { select: { name: true } } },
    });
    if (!bomPiece) {
      throw new NotFoundException(`Mảnh ${dto.pieceId} không thuộc định mức của SKU này`);
    }

    let created: { id: bigint };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await lockBusinessKey(tx, transferCheckLockKey(item.id, pieceId));
        const { readyQty, usage } = await loadTransferCheckUsage(tx, {
          itemId: item.id,
          productionOrderId: item.order.id,
          pieceId,
          isWoven: bomPiece.isWoven,
        });
        const available = transferCheckAvailable(readyQty, usage);
        const qty = dto.passedQty + dto.defectQty;
        if (qty > available) {
          throw new BadRequestException(
            `Đạt + lỗi (${qty}) vượt số còn kiểm được (${available}) - Hiện có ${readyQty}, đã kiểm ${usage.checkedQty}, ` +
              `đang chờ KCS ${usage.pendingQty}${usage.scrapQty ? `, đã bỏ ${usage.scrapQty}` : ''}`,
          );
        }
        return tx.transferCheckBatch.create({
          data: {
            productionInvoiceItemId: item.id,
            pieceId,
            workstationId: ws.id,
            reportedById: user.id,
            passedQty: dto.passedQty,
            defectQty: dto.defectQty,
            defectReasonId,
            photoUrls,
            note: dto.note?.trim() || null,
            idempotencyKey,
          },
          select: { id: true },
        });
      });
    } catch (e) {
      // 2 lần gửi cùng khoá chạy song song: lần thua dính unique -> trả đợt của lần thắng.
      if (isUniqueViolation(e)) {
        const again = await this.replayBatch(idempotencyKey, user.id);
        if (again) return { replay: true, batch: again };
      }
      throw e;
    }

    const batch = await this.findBatchDto(created.id);
    try {
      await this.notifications.emit('TRANSFER_CHECK_BATCH_TO_KCS', {
        entityId: created.id.toString(),
        actorId: user.id,
        dedupeKey: `TRANSFER_CHECK_BATCH_TO_KCS:${created.id}`,
        params: {
          lenhCode: batch.lenhCode,
          sku: batch.sku,
          pieceName: batch.pieceName,
          passedQty: batch.passedQty,
          defectQty: batch.defectQty,
        },
      });
    } catch (error) {
      this.logger.error(
        `Không báo được KCS chuyền kiểm (đợt ${created.id}): ${(error as Error).message}`,
      );
    }
    return { replay: false, batch };
  }

  /** D1/D2: công nhân đóng gói báo số bộ đã đóng - tính luôn (không duyệt, D4). Idempotency-Key bắt buộc. */
  async reportPacking(
    qrToken: string,
    user: AuthenticatedUser,
    dto: ReportPackingDto,
    idempotencyKey: string | undefined,
  ) {
    this.assertEnabled();
    if (!idempotencyKey) throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    const ws = await this.resolveWorkstation(qrToken, user, WorkstationKind.PACKING);
    const replay = await this.replayPacking(idempotencyKey, user.id);
    if (replay) return { replay: true, report: replay, mixWarning: null };
    const item = await this.loadScopedItem(ws, dto.itemId);
    // V2 (vị trí kho, 25/11/2026): bật công tắc thì báo đóng gói = cất vào ô vừa quét - thiếu ô là 400, ô khác kho / đang tắt 409.
    const putaway = isViTriKhoEnabled();
    if (putaway && !dto.locationId) {
      throw new BadRequestException('Quét tem vị trí kho (ô cất thùng) trước khi báo đóng gói');
    }
    const location =
      putaway && dto.locationId
        ? await this.viTriKho.assertPackingLocation(dto.locationId, ws.warehouse?.id ?? null)
        : null;

    let reportId: bigint | null = null;
    let mixWarning: string | null = null;
    try {
      await this.productionInvoices.recordPackagingEntry({
        piId: item.productionInvoiceId.toString(),
        itemId: item.id.toString(),
        boxesPacked: dto.qty,
        note: dto.note?.trim() || undefined,
        actorUserId: user.id,
        afterWriteInTx: async (tx, record) => {
          const r = await tx.packingReport.create({
            data: {
              productionInvoiceItemId: item.id,
              workstationId: ws.id,
              reportedById: user.id,
              qty: dto.qty,
              note: dto.note?.trim() || null,
              idempotencyKey,
              packagingRecordId: record.id,
              locationId: location?.id ?? null,
            },
            select: { id: true },
          });
          reportId = r.id;
          if (location) {
            mixWarning = await this.viTriKho.putawayFromPackingInTx(tx, {
              location,
              item: {
                id: item.id,
                mfgProductId: item.mfgProductId,
                salesOrderItemId: item.salesOrderItemId,
              },
              qty: dto.qty,
              packingReportId: r.id,
              actorId: user.id,
            });
          }
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await this.replayPacking(idempotencyKey, user.id);
        if (again) return { replay: true, report: again, mixWarning: null };
      }
      throw e;
    }
    if (reportId == null) throw new ConflictException('Không ghi được lần báo đóng gói');
    return { replay: false, report: await this.findPackingDto(reportId), mixWarning };
  }

  // ─── KCS chuyền kiểm ────────────────────────────────────────────────────────────────────────

  /** Danh sách đợt (KCS chuyền kiểm: chờ chấm / đã chấm; kho Thành phẩm: theo dõi theo SKU). Tắt công tắc: rỗng. */
  async listBatches(query: ListTransferCheckBatchesQueryDto) {
    if (!isCkDgQrEnabled()) return { enabled: false, batches: [] };
    const awaiting = query.status !== 'KCS_DONE';
    const where: Prisma.TransferCheckBatchWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.itemId ? { productionInvoiceItemId: parseBigIntId(query.itemId) } : {}),
      // SKU đã huỷ: đợt chờ không chấm được nữa nên không hiện ở hàng chờ.
      ...(query.status === 'AWAITING_KCS' ? { productionInvoiceItem: { cancelledAt: null } } : {}),
    };
    const rows = await this.prisma.transferCheckBatch.findMany({
      where,
      include: BATCH_INCLUDE,
      orderBy: awaiting && query.status ? { reportedAt: 'asc' } : { reportedAt: 'desc' },
      take: 300,
    });
    const lenh = await loadLenhDisplayCodes(
      this.prisma,
      rows.map((r) => r.productionInvoiceItem.productionInvoiceId!).filter(Boolean),
    );
    return { enabled: true, batches: rows.map((r) => this.toBatchDto(r, lenh)) };
  }

  /** Số đợt chờ KCS chuyền kiểm chấm (số đỏ /me/work-queue). */
  countAwaitingKcs(): Promise<number> {
    if (!isCkDgQrEnabled()) return Promise.resolve(0);
    return this.prisma.transferCheckBatch.count({
      where: {
        status: TransferCheckBatchStatus.AWAITING_KCS,
        productionInvoiceItem: { cancelledAt: null },
      },
    });
  }

  /**
   * C2/C4: KCS chuyền kiểm chấm 1 đợt. Ghi 1 TransferCheckResult: checkedQty = số đạt KCS (chỉ lúc này mới tính "đã qua chuyền
   * kiểm"), mỗi đơn vị lỗi 1 TransferCheckDefect (lỗi công nhân báo: nguyên nhân + ảnh của công nhân; lỗi KCS chấm thêm: nguyên
   * nhân + ảnh của KCS). Làm lại không chiếm "Hiện có" (báo lại được), bỏ thì chiếm vĩnh viễn. Chấm 2 lần: 409.
   */
  async gradeBatch(id: string, dto: GradeTransferCheckBatchDto, reviewerId: string) {
    this.assertEnabled();
    const batchId = parseBigIntId(id);
    const batch = await this.prisma.transferCheckBatch.findUnique({
      where: { id: batchId },
      include: BATCH_INCLUDE,
    });
    if (!batch) throw new NotFoundException(`Không có đợt chuyền kiểm ${id}`);
    if (batch.status !== TransferCheckBatchStatus.AWAITING_KCS) {
      throw new ConflictException('Đợt này đã được KCS chuyền kiểm chấm rồi');
    }
    const invalid = validateKcsGrade(batch, dto);
    if (invalid) throw new BadRequestException(invalid);
    const extra = kcsExtraDefect(batch.passedQty, dto.passedQty);
    let kcsReason: { id: bigint; label: string } | null = null;
    if (dto.defectReasonId) {
      kcsReason = await this.prisma.defectReason.findUnique({
        where: { id: parseBigIntId(dto.defectReasonId) },
        select: { id: true, label: true },
      });
      if (!kcsReason)
        throw new BadRequestException(`Nguyên nhân lỗi ${dto.defectReasonId} không có`);
    }
    if (extra > 0 && !kcsReason) {
      throw new BadRequestException(
        `KCS chấm lỗi thêm ${extra} so với số công nhân báo đạt - chọn nguyên nhân lỗi`,
      );
    }
    const item = batch.productionInvoiceItem;
    await assertPiHasActiveFloor(this.prisma, item.productionInvoiceId!, 'chấm chuyền kiểm');
    await assertItemNotCancelled(this.prisma, item.id, 'chấm chuyền kiểm');

    const workerReason = batch.defectReason?.label ?? 'Lỗi chuyền kiểm';
    const defects: { reason: string; imageUrl: string | null }[] = [
      ...Array.from({ length: batch.defectQty }, (_, i) => ({
        reason: workerReason,
        imageUrl: batch.photoUrls[i] ?? null,
      })),
      ...Array.from({ length: extra }, (_, i) => ({
        reason: `${kcsReason?.label ?? 'Lỗi'} (KCS chuyền kiểm)`,
        imageUrl: i === 0 ? (dto.photoUrl ?? null) : null,
      })),
    ];
    const note =
      `Đợt chuyền kiểm QR #${batch.id}: báo đạt ${batch.passedQty}, lỗi ${batch.defectQty} · ` +
      `KCS đạt ${dto.passedQty}, làm lại ${dto.reworkQty}, bỏ ${dto.scrapQty}` +
      (dto.note?.trim() ? ` · ${dto.note.trim()}` : '');

    const resultId = await this.prisma.$transaction(async (tx) => {
      // Cùng khoá (SKU, mảnh) với lần báo / nhập tay: đọc trần của người khác luôn thấy kết quả chấm đã xong hoặc chưa bắt đầu.
      await lockBusinessKey(tx, transferCheckLockKey(item.id, batch.pieceId));
      const result = await tx.transferCheckResult.create({
        data: {
          productionInvoiceItemId: item.id,
          pieceId: batch.pieceId,
          checkedQty: dto.passedQty,
          note,
          checkedById: reviewerId,
          defects: defects.length ? { create: defects } : undefined,
        },
        select: { id: true },
      });
      const { count } = await tx.transferCheckBatch.updateMany({
        where: { id: batch.id, status: TransferCheckBatchStatus.AWAITING_KCS },
        data: {
          status: TransferCheckBatchStatus.KCS_DONE,
          kcsPassedQty: dto.passedQty,
          kcsReworkQty: dto.reworkQty,
          kcsScrapQty: dto.scrapQty,
          kcsDefectReasonId: kcsReason?.id ?? null,
          kcsPhotoUrl: dto.photoUrl ?? null,
          kcsNote: dto.note?.trim() || null,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          transferCheckResultId: result.id,
        },
      });
      if (count === 0) throw new ConflictException('Đợt này đã được KCS chuyền kiểm chấm rồi');
      return result.id;
    });

    await this.notifications.resolve({
      entityType: 'TRANSFER_CHECK_BATCH',
      entityId: batch.id.toString(),
    });
    if (defects.length > 0) {
      try {
        await this.notifications.emit('TRANSFER_CHECK_DEFECT_FOUND', {
          entityId: resultId.toString(),
          actorId: reviewerId,
          params: {
            piCode: item.productionInvoice?.code ?? `#${item.productionInvoiceId}`,
            pieceName: batch.piece.name,
            defectCount: defects.length,
            reason: defects[0].reason,
          },
        });
      } catch (error) {
        this.logger.error(
          `Không báo được lỗi chuyền kiểm (đợt ${batch.id}): ${(error as Error).message}`,
        );
      }
    }
    return this.findBatchDto(batch.id);
  }

  // ─── Kho Thành phẩm: đối chiếu đóng gói ───────────────────────────────────────────────────

  async listPackingReports(query: ListPackingReportsQueryDto) {
    if (!isCkDgQrEnabled()) return { enabled: false, reports: [] };
    const rows = await this.prisma.packingReport.findMany({
      where: query.itemId ? { productionInvoiceItemId: parseBigIntId(query.itemId) } : {},
      include: PACKING_INCLUDE,
      orderBy: { reportedAt: 'desc' },
      take: 300,
    });
    const lenh = await loadLenhDisplayCodes(
      this.prisma,
      rows.map((r) => r.productionInvoiceItem.productionInvoiceId!).filter(Boolean),
    );
    return { enabled: true, reports: rows.map((r) => this.toPackingDto(r, lenh)) };
  }

  /**
   * D4: thủ kho Thành phẩm huỷ 1 lần công nhân đóng gói báo sai - lý do bắt buộc. Xoá PackagingRecord của lần báo (trả số), giữ
   * dòng PackingReport làm vết + nhật ký, báo QLSX và công nhân. Cùng khoá SKU với lần báo. Huỷ 2 lần: 409.
   */
  async cancelPackingReport(
    id: string,
    dto: CancelPackingReportDto,
    actor: { id: string; warehouseScope?: string | null },
  ) {
    this.assertEnabled();
    const reportId = parseBigIntId(id);
    const report = await this.prisma.packingReport.findUnique({
      where: { id: reportId },
      include: {
        ...PACKING_INCLUDE,
        productionInvoiceItem: {
          select: {
            ...PACKING_INCLUDE.productionInvoiceItem.select,
            warehouseCode: true,
            mfgProductId: true,
            salesOrderItemId: true,
            productionOrder: { select: { quantity: true } },
          },
        },
      },
    });
    if (!report) throw new NotFoundException(`Không có lần báo đóng gói ${id}`);
    if (report.cancelledAt) throw new ConflictException('Lần báo này đã bị huỷ rồi');
    const item = report.productionInvoiceItem;
    // Thủ kho gắn kho: chỉ huỷ lần báo của SKU thuộc kho mình (SKU chưa chọn kho thì ai cũng huỷ được, như màn kho).
    if (actor.warehouseScope && item.warehouseCode && item.warehouseCode !== actor.warehouseScope) {
      throw new ForbiddenException('Lần báo này thuộc SKU của kho Thành phẩm khác');
    }
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException('Ghi lý do huỷ (ít nhất 3 ký tự)');

    const packedAfter = await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, packagingLockKey(item.id));
      const now = new Date();
      const { count } = await tx.packingReport.updateMany({
        where: { id: reportId, cancelledAt: null },
        data: { cancelledAt: now, cancelledById: actor.id, cancelReason: reason },
      });
      if (count === 0) throw new ConflictException('Lần báo này đã bị huỷ rồi');
      if (report.packagingRecordId != null) {
        await tx.packagingRecord.deleteMany({ where: { id: report.packagingRecordId } });
      }
      // Vị trí kho (25/11/2026): lần báo đã cất vào ô -> lấy đúng số đó ra khỏi ô (đã chuyển / lấy đi thì 409, không huỷ).
      if (report.locationId != null) {
        await this.viTriKho.cancelPutawayInTx(tx, {
          locationId: report.locationId,
          item: {
            id: item.id,
            mfgProductId: item.mfgProductId,
            salesOrderItemId: item.salesOrderItemId,
          },
          qty: report.qty,
          packingReportId: report.id,
          actorId: actor.id,
        });
      } else {
        // Lần báo cũ (chưa gắn ô): thủ kho có thể đã cất hàng đó vào ô sau này - chặn nếu huỷ làm tồn ô vượt số đã đóng.
        await this.viTriKho.assertCancelKeepsBinStockInTx(tx, { id: item.id });
      }
      await writeAuditLog(tx as unknown as Pick<PrismaClient, 'auditLog'>, this.cls, {
        action: AuditAction.UPDATE,
        tableName: 'PackingReport',
        recordId: id,
        oldValue: {
          qty: report.qty,
          packagingRecordId: report.packagingRecordId?.toString() ?? null,
        },
        newValue: { cancelledAt: now.toISOString(), cancelledById: actor.id, cancelReason: reason },
      });
      const sum = await tx.packagingRecord.aggregate({
        where: { productionInvoiceItemId: item.id },
        _sum: { boxesPacked: true },
      });
      return sum._sum.boxesPacked ?? 0;
    });

    const lenh = await loadLenhDisplayCodes(this.prisma, [item.productionInvoiceId!]);
    try {
      await this.notifications.emit('PACKING_REPORT_CANCELLED', {
        entityId: id,
        actorId: actor.id,
        params: {
          lenhCode:
            lenh.get(item.productionInvoiceId!.toString()) ?? item.productionInvoice?.code ?? '',
          sku: item.mfgProduct.factoryCode,
          qty: report.qty,
          workerId: report.reportedById,
          workerName: nameOf(report.reportedBy) ?? '',
          reason,
        },
      });
      // Huỷ làm SKU hết "đóng đủ": đóng luôn tin nhắc QLSX bấm Kết thúc (nếu còn mở).
      if (packedAfter < (item.productionOrder?.quantity ?? 0)) {
        await this.notifications.resolve({
          entityType: 'PRODUCTION_INVOICE_ITEM',
          entityId: item.id.toString(),
          types: ['PI_ITEM_READY_TO_FINISH'],
        });
      }
    } catch (error) {
      this.logger.error(`Không báo được huỷ đóng gói (${id}): ${(error as Error).message}`);
    }
    return this.findPackingDto(reportId);
  }

  // ─── Dữ liệu cho màn quét ─────────────────────────────────────────────────────────────────

  /** Mảnh của 1 SKU: Tổng cần / Hiện có / Đã kiểm (đạt KCS + nhập tay) / Chờ KCS / Đã bỏ / Còn kiểm được. */
  async transferCheckDetail(itemId: bigint) {
    const order = await this.prisma.productionOrder.findUnique({
      where: { productionInvoiceItemId: itemId },
      select: { id: true, quantity: true, bomRevisionId: true },
    });
    if (!order) return [];
    const [bomPieces, receipts, transfers, checked, pending, scrapped] = await Promise.all([
      this.prisma.bomPiece.findMany({
        where: { bomRevisionId: order.bomRevisionId },
        include: { piece: { select: { name: true, code: true } } },
        orderBy: { pieceId: 'asc' },
      }),
      this.prisma.weavingReceipt.groupBy({
        by: ['pieceId'],
        where: { productionOrderId: order.id },
        _sum: { qty: true },
      }),
      this.prisma.warehouseTransferPieceItem.groupBy({
        by: ['pieceId'],
        where: {
          productionOrderId: order.id,
          transfer: { status: TransferStatus.CONFIRMED, ...PIECE_TRANSFER_LEAVES_FRAME },
        },
        _sum: { quantity: true },
      }),
      this.prisma.transferCheckResult.groupBy({
        by: ['pieceId'],
        where: { productionInvoiceItemId: itemId },
        _sum: { checkedQty: true },
      }),
      this.prisma.transferCheckBatch.groupBy({
        by: ['pieceId'],
        where: { productionInvoiceItemId: itemId, status: TransferCheckBatchStatus.AWAITING_KCS },
        _sum: { passedQty: true, defectQty: true },
      }),
      this.prisma.transferCheckBatch.groupBy({
        by: ['pieceId'],
        where: { productionInvoiceItemId: itemId, status: TransferCheckBatchStatus.KCS_DONE },
        _sum: { kcsScrapQty: true },
      }),
    ]);
    const map = <T extends { pieceId: bigint }>(rows: T[], f: (r: T) => number) =>
      new Map(rows.map((r) => [r.pieceId.toString(), f(r)]));
    const received = map(receipts, (r) => r._sum.qty ?? 0);
    const transferred = map(transfers, (r) => r._sum.quantity ?? 0);
    const checkedBy = map(checked, (r) => r._sum.checkedQty ?? 0);
    const pendingBy = map(pending, (r) => (r._sum.passedQty ?? 0) + (r._sum.defectQty ?? 0));
    const scrapBy = map(scrapped, (r) => r._sum.kcsScrapQty ?? 0);
    return bomPieces.map((bp) => {
      const k = bp.pieceId.toString();
      const readyQty = (bp.isWoven ? received : transferred).get(k) ?? 0;
      const usage = {
        checkedQty: checkedBy.get(k) ?? 0,
        pendingQty: pendingBy.get(k) ?? 0,
        scrapQty: scrapBy.get(k) ?? 0,
      };
      return {
        pieceId: k,
        pieceName: bp.piece.name,
        pieceCode: bp.piece.code,
        totalQty: bp.qtyPerUnit * order.quantity,
        readyQty,
        ...usage,
        availableQty: transferCheckAvailable(readyQty, usage),
      };
    });
  }

  /** Đóng gói 1 SKU: số lượng lệnh / đã đóng / số bộ đã qua KCS chuyền kiểm / còn đóng được. */
  async packingDetail(itemId: bigint) {
    const order = await this.prisma.productionOrder.findUnique({
      where: { productionInvoiceItemId: itemId },
      select: { quantity: true, bomRevisionId: true },
    });
    if (!order) return null;
    const [sets, packed] = await Promise.all([
      loadSetsPassed(this.prisma, order.bomRevisionId, itemId),
      this.prisma.packagingRecord.aggregate({
        where: { productionInvoiceItemId: itemId },
        _sum: { boxesPacked: true },
      }),
    ]);
    const packedQty = packed._sum.boxesPacked ?? 0;
    return {
      totalQty: order.quantity,
      packedQty,
      setsPassed: sets,
      availableQty: packingAvailable({ orderQty: order.quantity, setsPassed: sets, packedQty }),
    };
  }

  /**
   * Lệnh (SKU) hiện ở điểm: lệnh SX đang chạy (QLSX đã Bắt đầu, chưa huỷ), SKU thuộc kho Thành phẩm của điểm (warehouseCode) hoặc
   * chưa chọn kho - cùng quy tắc lọc của màn kho (KhoChuyenKiemPage inWarehouseScope).
   */
  private async listScopeItems(ws: WsRow) {
    const rows = await this.prisma.productionInvoiceItem.findMany({
      where: this.scopeWhere(ws),
      select: {
        id: true,
        productionInvoiceId: true,
        quantity: true,
        mfgProduct: { select: { factoryCode: true, name: true } },
        productionInvoice: { select: { code: true } },
        productionOrder: { select: { quantity: true } },
      },
      orderBy: { id: 'asc' },
      take: 300,
    });
    const lenh = await loadLenhDisplayCodes(
      this.prisma,
      rows.map((r) => r.productionInvoiceId!).filter(Boolean),
    );
    return rows.map((r) => ({
      itemId: r.id.toString(),
      productionInvoiceId: r.productionInvoiceId?.toString() ?? null,
      piCode: r.productionInvoice?.code ?? null,
      lenhCode:
        lenh.get(r.productionInvoiceId?.toString() ?? '') ?? r.productionInvoice?.code ?? '',
      sku: r.mfgProduct.factoryCode,
      productName: r.mfgProduct.name,
      quantity: r.productionOrder?.quantity ?? r.quantity,
    }));
  }

  private scopeWhere(ws: WsRow): Prisma.ProductionInvoiceItemWhereInput {
    return {
      cancelledAt: null,
      productionInvoiceId: { not: null },
      OR: [{ warehouseCode: ws.warehouse?.code ?? '' }, { warehouseCode: null }],
      productionOrder: {
        is: {
          floorStage: ProductionOrderFloorStage.ACTIVE,
          status: { not: ProductionOrderStatus.CANCELLED },
        },
      },
    };
  }

  /** SKU được báo phải đang hiện ở điểm (409 nếu không) - trả kèm lệnh SX. */
  private async loadScopedItem(ws: WsRow, itemIdRaw: string) {
    const itemId = parseBigIntId(itemIdRaw);
    const row = await this.prisma.productionInvoiceItem.findFirst({
      where: { id: itemId, ...this.scopeWhere(ws) },
      select: {
        id: true,
        productionInvoiceId: true,
        mfgProductId: true,
        salesOrderItemId: true,
        productionOrder: { select: { id: true, bomRevisionId: true, quantity: true } },
      },
    });
    if (!row || !row.productionOrder || row.productionInvoiceId == null) {
      throw new ConflictException(
        'Lệnh này không báo được ở điểm này (khác kho Thành phẩm, đã xong / tạm dừng hoặc đã huỷ)',
      );
    }
    return {
      id: row.id,
      productionInvoiceId: row.productionInvoiceId,
      mfgProductId: row.mfgProductId,
      salesOrderItemId: row.salesOrderItemId,
      order: row.productionOrder,
    };
  }

  /** Lần báo gần đây của chính mình ở điểm này (10 lần). */
  private async recentReports(ws: WsRow, userId: string) {
    if (ws.kind === WorkstationKind.TRANSFER_CHECK) {
      const rows = await this.prisma.transferCheckBatch.findMany({
        where: { workstationId: ws.id, reportedById: userId },
        include: BATCH_INCLUDE,
        orderBy: { reportedAt: 'desc' },
        take: 10,
      });
      const lenh = await loadLenhDisplayCodes(
        this.prisma,
        rows.map((r) => r.productionInvoiceItem.productionInvoiceId!).filter(Boolean),
      );
      return rows.map((r) => this.toBatchDto(r, lenh));
    }
    const rows = await this.prisma.packingReport.findMany({
      where: { workstationId: ws.id, reportedById: userId },
      include: PACKING_INCLUDE,
      orderBy: { reportedAt: 'desc' },
      take: 10,
    });
    const lenh = await loadLenhDisplayCodes(
      this.prisma,
      rows.map((r) => r.productionInvoiceItem.productionInvoiceId!).filter(Boolean),
    );
    return rows.map((r) => this.toPackingDto(r, lenh));
  }

  /** Nguyên nhân lỗi: danh mục riêng của chuyền kiểm (stageType CHUYEN_KIEM); chưa khai thì dùng cả danh mục. */
  async listDefectReasons() {
    const own = await this.prisma.defectReason.findMany({
      where: { stageType: MfgStage.CHUYEN_KIEM },
      orderBy: { label: 'asc' },
      select: { id: true, label: true },
    });
    const rows =
      own.length > 0
        ? own
        : await this.prisma.defectReason.findMany({
            orderBy: { label: 'asc' },
            select: { id: true, label: true },
            take: 200,
          });
    return rows.map((r) => ({ id: r.id.toString(), label: r.label }));
  }

  /** Mã điểm -> điểm chuyền kiểm / khu đóng gói đang bật của đúng tổ người quét. */
  private async resolveWorkstation(
    qrToken: string,
    user: AuthenticatedUser,
    expectedKind?: WorkstationKind,
  ): Promise<WsRow> {
    const ws = await this.prisma.workstation.findUnique({
      where: { qrToken },
      include: WS_INCLUDE,
    });
    if (!ws) throw new NotFoundException('Mã QR không còn dùng - báo QLSX in lại tem');
    if (!ws.isActive) {
      throw new NotFoundException('Điểm này đang tắt - báo QLSX bật lại ở “Máy & tem QR”');
    }
    const stage = KIND_STAGE[ws.kind];
    if (!stage) {
      throw new BadRequestException('Mã này không phải tem điểm chuyền kiểm / khu đóng gói');
    }
    if (user.mfgRole !== stage) {
      throw new ForbiddenException(
        `Mã này của tổ ${stage === MfgStage.CHUYEN_KIEM ? 'Chuyền kiểm' : 'Đóng gói'} - tài khoản của bạn thuộc tổ khác`,
      );
    }
    if (expectedKind && ws.kind !== expectedKind) {
      throw new BadRequestException(
        expectedKind === WorkstationKind.TRANSFER_CHECK
          ? 'Mã này không phải tem điểm chuyền kiểm'
          : 'Mã này không phải tem khu đóng gói',
      );
    }
    return ws;
  }

  private toWorkstation(ws: WsRow) {
    return {
      id: ws.id.toString(),
      code: ws.code,
      name: ws.name,
      stage: ws.stage,
      kind: ws.kind,
      warehouseCode: ws.warehouse?.code ?? null,
      warehouseName: ws.warehouse?.name ?? null,
    };
  }

  private async replayBatch(idempotencyKey: string, userId: string) {
    const existing = await this.prisma.transferCheckBatch.findUnique({
      where: { idempotencyKey },
      select: { id: true, reportedById: true },
    });
    if (!existing) return null;
    if (existing.reportedById !== userId) {
      throw new ConflictException('Khoá gửi lại (Idempotency-Key) đã được dùng cho lần báo khác');
    }
    return this.findBatchDto(existing.id);
  }

  private async replayPacking(idempotencyKey: string, userId: string) {
    const existing = await this.prisma.packingReport.findUnique({
      where: { idempotencyKey },
      select: { id: true, reportedById: true },
    });
    if (!existing) return null;
    if (existing.reportedById !== userId) {
      throw new ConflictException('Khoá gửi lại (Idempotency-Key) đã được dùng cho lần báo khác');
    }
    return this.findPackingDto(existing.id);
  }

  private async findBatchDto(id: bigint) {
    const row = await this.prisma.transferCheckBatch.findUniqueOrThrow({
      where: { id },
      include: BATCH_INCLUDE,
    });
    const lenh = await loadLenhDisplayCodes(
      this.prisma,
      row.productionInvoiceItem.productionInvoiceId
        ? [row.productionInvoiceItem.productionInvoiceId]
        : [],
    );
    return this.toBatchDto(row, lenh);
  }

  private async findPackingDto(id: bigint) {
    const row = await this.prisma.packingReport.findUniqueOrThrow({
      where: { id },
      include: PACKING_INCLUDE,
    });
    const lenh = await loadLenhDisplayCodes(
      this.prisma,
      row.productionInvoiceItem.productionInvoiceId
        ? [row.productionInvoiceItem.productionInvoiceId]
        : [],
    );
    return this.toPackingDto(row, lenh);
  }

  private toBatchDto(r: BatchRow, lenh: Map<string, string>) {
    const item = r.productionInvoiceItem;
    const piId = item.productionInvoiceId?.toString() ?? '';
    return {
      id: r.id.toString(),
      status: r.status,
      itemId: item.id.toString(),
      productionInvoiceId: piId || null,
      piCode: item.productionInvoice?.code ?? null,
      lenhCode: lenh.get(piId) ?? item.productionInvoice?.code ?? '',
      sku: item.mfgProduct.factoryCode,
      productName: item.mfgProduct.name,
      pieceId: r.pieceId.toString(),
      pieceName: r.piece.name,
      workstationCode: r.workstation.code,
      warehouseCode: r.workstation.warehouse?.code ?? null,
      warehouseName: r.workstation.warehouse?.name ?? null,
      reportedById: r.reportedById,
      reportedByName: nameOf(r.reportedBy),
      reportedAt: r.reportedAt,
      passedQty: r.passedQty,
      defectQty: r.defectQty,
      defectReasonId: r.defectReasonId?.toString() ?? null,
      defectReason: r.defectReason?.label ?? null,
      photoUrls: r.photoUrls,
      note: r.note,
      kcs:
        r.status === TransferCheckBatchStatus.KCS_DONE
          ? {
              passedQty: r.kcsPassedQty ?? 0,
              reworkQty: r.kcsReworkQty ?? 0,
              scrapQty: r.kcsScrapQty ?? 0,
              defectReason: r.kcsDefectReason?.label ?? null,
              photoUrl: r.kcsPhotoUrl,
              note: r.kcsNote,
              reviewedByName: nameOf(r.reviewedBy),
              reviewedAt: r.reviewedAt,
              transferCheckResultId: r.transferCheckResultId?.toString() ?? null,
            }
          : null,
    };
  }

  private toPackingDto(r: PackingRow, lenh: Map<string, string>) {
    const item = r.productionInvoiceItem;
    const piId = item.productionInvoiceId?.toString() ?? '';
    return {
      id: r.id.toString(),
      itemId: item.id.toString(),
      productionInvoiceId: piId || null,
      piCode: item.productionInvoice?.code ?? null,
      lenhCode: lenh.get(piId) ?? item.productionInvoice?.code ?? '',
      sku: item.mfgProduct.factoryCode,
      productName: item.mfgProduct.name,
      qty: r.qty,
      note: r.note,
      workstationCode: r.workstation.code,
      warehouseCode: r.workstation.warehouse?.code ?? null,
      warehouseName: r.workstation.warehouse?.name ?? null,
      reportedById: r.reportedById,
      reportedByName: nameOf(r.reportedBy),
      reportedAt: r.reportedAt,
      cancelled: r.cancelledAt != null,
      cancelledAt: r.cancelledAt,
      cancelledByName: nameOf(r.cancelledBy),
      cancelReason: r.cancelReason,
      locationCode: r.location?.code ?? null,
    };
  }
}
