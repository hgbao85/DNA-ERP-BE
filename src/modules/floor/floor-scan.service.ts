import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CutBundleStatus,
  FloorQueueStatus,
  MfgStage,
  ProductionBatchStatus,
  ProductionOrderFloorStage,
  SteelIssueStatus,
  Workstation,
  WorkstationKind,
} from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { CutAllocationService, type CutMachineWork } from './cut-allocation.service';
import { ScanReportDto } from './dto/floor-scan.dto';
import { workstationQueueWorkshopId } from './floor-queue-workshop.util';

const STAGE_LABEL: Record<string, string> = { PHOI: 'Phôi', HAN: 'Hàn', SON: 'Sơn' };

const fullName = (u: { firstName: string; lastName: string; username?: string } | null) =>
  u ? `${u.lastName} ${u.firstName}`.trim() || u.username || null : null;

/**
 * Màn quét của công nhân (2026-10-13, QR tại máy - changelog-2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md mục 22).
 * Mã QR định danh MÁY (không chứa PI); PI lấy từ hàng đợi của tổ (FloorQueueEntry RUNNING). Mọi lần báo đi qua
 * ĐÚNG các hàm báo cũ (recordCutBatch/recordStepBatch/recordProductionBatch/receive) - tổng số, tiến độ, KCS
 * không đổi; ở đây chỉ thêm: kiểm máy–tổ–PI, ghi máy vào sổ, bắt buộc Idempotency-Key (điện thoại ở xưởng hay
 * mất sóng rồi gửi lại).
 */
@Injectable()
export class FloorScanService {
  private readonly logger = new Logger(FloorScanService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly steelIssues: SteelIssuesService,
    private readonly productionBatches: ProductionBatchesService,
    private readonly cutAllocation: CutAllocationService,
  ) {}

  /** Quét mã -> máy + PI đang chạy của tổ (+ PI cũ còn bù lỗi được) + dữ liệu để chọn SKU/cỡ đoạn/mảnh. */
  async getContext(qrToken: string, user: AuthenticatedUser, productionInvoiceId?: string) {
    const ws = await this.resolveWorkstation(qrToken, user);
    const workstation = this.toWorkstation(ws);

    if (ws.kind === WorkstationKind.STEEL_RECEIVE) {
      return { workstation, steelToReceive: await this.listSteelToReceive() };
    }

    // Máy cắt: kèm việc chia cho máy này (đợt C0) + ước tiến độ (C2) - có trong MỌI trường hợp, kể
    // cả chưa có PI đang chạy / đang xem PI bù lỗi.
    const machineWork = ws.kind === WorkstationKind.CUT ? await this.loadMachineWork(ws.id) : null;
    const extra = machineWork ? { machineWork } : {};
    const { running, rework, workshopId } = await this.findReportablePis(ws.stage, ws.workshopId);
    const allocationPis = await this.loadAllocationPis(ws, workshopId, machineWork);
    const runningPi = running
      ? {
          productionInvoiceId: running.productionInvoiceId.toString(),
          code: running.productionInvoice.code,
        }
      : null;
    const reworkPis = rework.map((r) => ({
      productionInvoiceId: r.productionInvoiceId.toString(),
      code: r.productionInvoice.code,
      endedAt: r.endedAt,
    }));

    // Lệnh mặc định (đợt C2): máy CUT làm theo bảng chia -> lệnh của dòng đầu tiên còn cây, không
    // có thì lệnh đang chạy;
    // máy STEP/PIECE -> lệnh đang chạy, không có thì lệnh đầu tiên của bảng chia.
    const firstOpenRow = machineWork?.rows.find((r) => r.barCount - r.barsDoneEst > 0);
    const defaultId =
      ws.kind === WorkstationKind.CUT
        ? (firstOpenRow?.productionInvoiceId ?? runningPi?.productionInvoiceId ?? null)
        : (runningPi?.productionInvoiceId ?? allocationPis[0]?.productionInvoiceId ?? null);
    const selectedId = productionInvoiceId ?? defaultId;
    if (!selectedId) {
      return { workstation, runningPi, reworkPis, allocationPis, pi: null, ...extra };
    }
    this.assertPiReportable(selectedId, running, rework, allocationPis);
    return {
      workstation,
      runningPi,
      reworkPis,
      allocationPis,
      pi: await this.buildPiContext(ws, selectedId),
      ...extra,
    };
  }

  /** 1 lần báo qua mã tại máy - xem ScanReportDto. */
  async report(
    qrToken: string,
    user: AuthenticatedUser,
    dto: ScanReportDto,
    idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    const ws = await this.resolveWorkstation(qrToken, user);
    if (ws.kind === WorkstationKind.STEEL_RECEIVE) {
      throw new BadRequestException('Mã khu nhận sắt chỉ dùng để xác nhận nhận sắt');
    }
    const { running, rework, workshopId } = await this.findReportablePis(ws.stage, ws.workshopId);
    // Lệnh trong bảng chia chỉ cần tải khi lệnh báo không nằm trong hàng đợi (đỡ 1 lần dựng bảng
    // chia).
    const inQueue =
      running?.productionInvoiceId.toString() === dto.productionInvoiceId ||
      rework.some((r) => r.productionInvoiceId.toString() === dto.productionInvoiceId);
    const allocationPis = inQueue ? [] : await this.loadAllocationPis(ws, workshopId, null);
    this.assertPiReportable(dto.productionInvoiceId, running, rework, allocationPis);
    const ctx = { workstationId: ws.id };

    if (ws.kind === WorkstationKind.PIECE) {
      if (!dto.pieceId || !dto.qty) {
        throw new BadRequestException('Chọn mảnh và nhập số mảnh');
      }
      await this.assertOrderInPi(dto.productionOrderId, dto.productionInvoiceId);
      const batch = await this.productionBatches.recordProductionBatch(
        dto.productionOrderId,
        { pieceId: dto.pieceId, qty: dto.qty, stage: ws.stage },
        user.id,
        user.mfgRole,
        idempotencyKey,
        ctx,
      );
      return { kind: ws.kind, productionBatch: batch };
    }

    if (!dto.materialId || !dto.segments?.length) {
      throw new BadRequestException('Chọn loại sắt và nhập số đoạn');
    }
    if (ws.kind === WorkstationKind.STEP) {
      const stepBatch = await this.steelIssues.recordStepBatch(
        dto.productionInvoiceId,
        {
          materialId: dto.materialId,
          step: ws.processStep!,
          productionOrderId: dto.productionOrderId,
          segments: dto.segments,
        },
        user.id,
        idempotencyKey,
        ctx,
      );
      return { kind: ws.kind, stepBatch };
    }

    // CUT - đợt cắt gắn vào 1 lần kho giao (SteelIssue) đã nhận của loại sắt này. Cùng quy tắc chọn với màn
    // Phôi (LenhSanXuatPhoi.tsx targetIssue): ưu tiên lần giao đang giữ đợt CUTTING của chính người báo cho
    // SKU này (để cộng dồn đúng đợt), không có thì lần giao đã nhận sớm nhất.
    const issueId = await this.pickCutTargetIssue(
      parseBigIntId(dto.productionInvoiceId),
      parseBigIntId(dto.materialId),
      parseBigIntId(dto.productionOrderId),
      user.id,
    );
    const cutBundle = await this.steelIssues.recordCutBatch(
      issueId.toString(),
      { productionOrderId: dto.productionOrderId, segments: dto.segments },
      user.id,
      idempotencyKey,
      ctx,
    );
    return { kind: ws.kind, cutBundle };
  }

  /** Mã khu nhận sắt: người nhận đếm rồi tự điền số cây (Sếp chốt, mục 17) - dùng đúng receive() cũ. */
  async receiveSteel(
    qrToken: string,
    user: AuthenticatedUser,
    steelIssueId: string,
    receivedBarCount?: number,
  ) {
    const ws = await this.resolveWorkstation(qrToken, user);
    if (ws.kind !== WorkstationKind.STEEL_RECEIVE) {
      throw new BadRequestException('Mã này không phải mã khu nhận sắt');
    }
    return this.steelIssues.receive(steelIssueId, user.id, receivedBarCount);
  }

  /**
   * "Sản lượng của tôi" (mục 20.5): mọi lần MÌNH báo trong khoảng thời gian, kèm trạng thái đợt (chưa gửi KCS /
   * chờ KCS / đã KCS) và lần bị QLSX đảo + lý do. Đây là số ĐÃ BÁO, không phải số đạt KCS - nhân sự tính
   * công ở giai đoạn sau.
   */
  async myOutput(userId: string, from?: string, to?: string) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 7 * 24 * 3600 * 1000);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Từ ngày/đến ngày phải là ngày hợp lệ (YYYY-MM-DD)');
    }
    const rows = await this.prisma.floorReport.findMany({
      where: {
        reportedById: userId,
        reversalOfId: null,
        createdAt: { gte: fromDate, lte: toDate },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        workstation: { select: { code: true, name: true } },
        productionInvoice: { select: { code: true } },
        lines: {
          include: {
            segmentSpec: { select: { cutLengthMm: true, material: { select: { code: true } } } },
            piece: { select: { code: true, name: true } },
          },
        },
        reversedBy: {
          select: {
            reason: true,
            createdAt: true,
            reportedBy: { select: { firstName: true, lastName: true, username: true } },
          },
        },
        cutBundle: {
          select: {
            status: true,
            steelIssue: { select: { productionInvoice: { select: { code: true } } } },
          },
        },
        stepBatch: {
          select: {
            step: true,
            stepBundle: { select: { status: true } },
            productionInvoice: { select: { code: true } },
          },
        },
        productionBatch: {
          select: {
            stage: true,
            status: true,
            productionOrder: {
              select: {
                productionInvoiceItem: {
                  select: { productionInvoice: { select: { code: true } } },
                },
              },
            },
          },
        },
      },
    });

    return rows.map((r) => {
      let piCode: string | null = null;
      let state: 'OPEN' | 'AWAITING_QC' | 'QC_DONE' | 'REMOVED' = 'REMOVED';
      if (r.cutBundle) {
        piCode = r.cutBundle.steelIssue.productionInvoice.code;
        state =
          r.cutBundle.status === CutBundleStatus.CUTTING
            ? 'OPEN'
            : r.cutBundle.status === CutBundleStatus.AWAITING_QC
              ? 'AWAITING_QC'
              : 'QC_DONE';
      } else if (r.stepBatch) {
        piCode = r.stepBatch.productionInvoice.code;
        state = !r.stepBatch.stepBundle
          ? 'OPEN'
          : r.stepBatch.stepBundle.status === 'AWAITING_QC'
            ? 'AWAITING_QC'
            : 'QC_DONE';
      } else if (r.productionBatch) {
        piCode =
          r.productionBatch.productionOrder.productionInvoiceItem.productionInvoice?.code ?? null;
        state = r.productionBatch.status;
      }
      return {
        id: r.id.toString(),
        kind: r.kind,
        createdAt: r.createdAt,
        piCode: r.productionInvoice?.code ?? piCode,
        step: r.stepBatch?.step ?? null,
        workstation: r.workstation,
        state,
        reversed: r.reversedBy
          ? {
              reason: r.reversedBy.reason,
              at: r.reversedBy.createdAt,
              byName: fullName(r.reversedBy.reportedBy),
            }
          : null,
        lines: r.lines.map((l) => ({
          qty: l.qty,
          segment: l.segmentSpec
            ? {
                cutLengthMm: Number(l.segmentSpec.cutLengthMm),
                materialCode: l.segmentSpec.material.code,
              }
            : null,
          piece: l.piece ? { code: l.piece.code, name: l.piece.name } : null,
        })),
      };
    });
  }

  // ─── nội bộ ─────────────────────────────────────────────────────────────────

  private async resolveWorkstation(
    qrToken: string,
    user: AuthenticatedUser,
  ): Promise<Workstation & { workshop?: { name: string } | null }> {
    // include xưởng để brief máy ghi được tên xưởng (13/11/2026)
    const ws = await this.prisma.workstation.findUnique({
      where: { qrToken },
      include: { workshop: { select: { name: true } } },
    });
    if (!ws || !ws.isActive) {
      throw new NotFoundException('Mã QR không còn dùng - báo QLSX in lại tem');
    }
    // Chỉ công nhân CÙNG TỔ báo được qua mã của máy này (mfgRole = tổ).
    if (user.mfgRole !== ws.stage) {
      throw new ForbiddenException(
        `Mã này của tổ ${STAGE_LABEL[ws.stage] ?? ws.stage} - tài khoản của bạn thuộc tổ khác`,
      );
    }
    return ws;
  }

  /** Việc đã chia cho máy cắt (đợt C0). Lỗi chỉ ghi log, màn quét không được hỏng. */
  private async loadMachineWork(workstationId: bigint): Promise<CutMachineWork> {
    try {
      return await this.cutAllocation.getMachineWork(workstationId);
    } catch (e) {
      this.logger.warn(`Không dựng được việc của máy ${workstationId}: ${(e as Error).message}`);
      return { rows: [], barsDoneEst: 0, barsLeftEst: 0, status: 'EMPTY' };
    }
  }

  /**
   * Lệnh báo được nhờ bảng chia máy cắt (đợt C2) - chỉ máy thuộc tổ Phôi; tổ khác rỗng. CUT: lệnh
   * có dòng chia trên CHÍNH máy
   * này (theo seq); STEP/PIECE: lệnh có dòng chia trên mọi máy cắt cùng xưởng. Lỗi chỉ ghi log (coi
   * như không có lệnh nào).
   */
  private async loadAllocationPis(
    ws: Workstation,
    queueWorkshopId: bigint | null,
    machineWork: CutMachineWork | null,
  ): Promise<Array<{ productionInvoiceId: string; code: string }>> {
    if (ws.stage !== MfgStage.PHOI) return [];
    try {
      if (ws.kind === WorkstationKind.CUT) {
        const work = machineWork ?? (await this.loadMachineWork(ws.id));
        const seen = new Set<string>();
        const out: Array<{ productionInvoiceId: string; code: string }> = [];
        for (const r of [...work.rows].sort((a, b) => a.seq - b.seq)) {
          if (seen.has(r.productionInvoiceId)) continue;
          seen.add(r.productionInvoiceId);
          out.push({ productionInvoiceId: r.productionInvoiceId, code: r.piCode });
        }
        return out;
      }
      if (queueWorkshopId == null) return [];
      return await this.cutAllocation.getWorkshopAllocationPis(queueWorkshopId);
    } catch (e) {
      this.logger.warn(
        `Không lấy được lệnh của bảng chia cho máy ${ws.id}: ${(e as Error).message}`,
      );
      return [];
    }
  }

  /**
   * PI tổ đang chạy + PI tổ đã chuyển qua nhưng còn SKU đang chạy (KCS chấm lỗi sau -> bù lỗi, mục
   * 19) - CHỈ trong hàng đợi (tổ, xưởng
   * của máy). Xưởng của máy = xưởng gắn trên máy, máy chưa gắn thì xưởng mặc định (đợt C1,
   * 14/11/2026).
   */
  private async findReportablePis(stage: MfgStage, machineWorkshopId: bigint | null) {
    const workshopId = await workstationQueueWorkshopId(this.prisma, machineWorkshopId);
    const entries = await this.prisma.floorQueueEntry.findMany({
      where: {
        stage,
        workshopId,
        status: { in: [FloorQueueStatus.RUNNING, FloorQueueStatus.DONE] },
      },
      include: { productionInvoice: { select: { code: true } } },
      orderBy: { endedAt: 'desc' },
    });
    const running = entries.find((e) => e.status === FloorQueueStatus.RUNNING) ?? null;
    const done = entries.filter((e) => e.status === FloorQueueStatus.DONE);
    if (done.length === 0) return { running, rework: [], workshopId };
    const active = await this.prisma.productionOrder.findMany({
      where: {
        floorStage: ProductionOrderFloorStage.ACTIVE,
        productionInvoiceItem: {
          productionInvoiceId: { in: done.map((d) => d.productionInvoiceId) },
        },
      },
      select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
    });
    const activeIds = new Set(
      active.map((a) => String(a.productionInvoiceItem.productionInvoiceId)),
    );
    return {
      running,
      rework: done.filter((d) => activeIds.has(d.productionInvoiceId.toString())),
      workshopId,
    };
  }

  private assertPiReportable(
    productionInvoiceId: string,
    running: { productionInvoiceId: bigint } | null,
    rework: { productionInvoiceId: bigint }[],
    allocationPis: { productionInvoiceId: string }[] = [],
  ) {
    const id = parseBigIntId(productionInvoiceId).toString();
    if (running?.productionInvoiceId.toString() === id) return;
    if (rework.some((r) => r.productionInvoiceId.toString() === id)) return;
    if (allocationPis.some((p) => p.productionInvoiceId === id)) return;
    throw new ConflictException(
      'PI này không phải PI tổ đang chạy của xưởng này (hoặc đã xong hẳn) - hỏi QLSX "Chuyển PI tiếp"',
    );
  }

  private async assertOrderInPi(productionOrderId: string, productionInvoiceId: string) {
    const order = await this.prisma.productionOrder.findFirst({
      where: {
        id: parseBigIntId(productionOrderId),
        productionInvoiceItem: { productionInvoiceId: parseBigIntId(productionInvoiceId) },
      },
      select: { id: true },
    });
    if (!order) throw new BadRequestException('SKU không thuộc PI này');
  }

  private async pickCutTargetIssue(
    piId: bigint,
    materialId: bigint,
    orderId: bigint,
    userId: string,
  ): Promise<bigint> {
    const issues = await this.prisma.steelIssue.findMany({
      where: {
        productionInvoiceId: piId,
        materialId,
        status: { not: SteelIssueStatus.ISSUED },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        bundles: {
          where: {
            status: CutBundleStatus.CUTTING,
            productionOrderId: orderId,
            OR: [{ openedById: userId }, { openedById: null }],
          },
          select: { id: true },
        },
      },
    });
    if (issues.length === 0) {
      throw new ConflictException(
        'Loại sắt này chưa nhận - quét mã khu nhận sắt để xác nhận trước khi báo cắt',
      );
    }
    return (issues.find((i) => i.bundles.length > 0) ?? issues[0]).id;
  }

  private async buildPiContext(ws: Workstation, productionInvoiceId: string) {
    const piId = parseBigIntId(productionInvoiceId);
    const [pi, orders] = await Promise.all([
      this.prisma.productionInvoice.findUniqueOrThrow({
        where: { id: piId },
        select: { id: true, code: true },
      }),
      this.prisma.productionOrder.findMany({
        where: { productionInvoiceItem: { productionInvoiceId: piId } },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          poNumber: true,
          quantity: true,
          floorStage: true,
          mfgProduct: { select: { name: true, factoryCode: true } },
        },
      }),
    ]);
    const base = {
      productionInvoiceId: pi.id.toString(),
      code: pi.code,
      orders: orders.map((o) => ({
        productionOrderId: o.id.toString(),
        poNumber: o.poNumber,
        sku: o.mfgProduct.factoryCode,
        productName: o.mfgProduct.name,
        quantity: o.quantity,
        floorStage: o.floorStage,
      })),
    };

    if (ws.kind === WorkstationKind.PIECE) {
      const plans = await this.productionBatches.getBatchPlanBatch(
        orders.map((o) => o.id.toString()),
        ws.stage,
      );
      // Kế hoạch mảnh bỏ qua đợt OPEN (chưa gửi KCS) - thêm số đó để công nhân thấy lần báo vừa lưu đã vào.
      const open = await this.prisma.productionBatch.groupBy({
        by: ['productionOrderId', 'pieceId'],
        where: {
          stage: ws.stage,
          status: ProductionBatchStatus.OPEN,
          productionOrderId: { in: orders.map((o) => o.id) },
        },
        _sum: { reportedQty: true },
      });
      const openQty = new Map(
        open.map((r) => [`${r.productionOrderId}:${r.pieceId}`, r._sum.reportedQty ?? 0]),
      );
      const piecePlans = Object.fromEntries(
        Object.entries(plans).map(([orderId, plan]) => [
          orderId,
          {
            ...plan,
            items: plan.items.map((it) => ({
              ...it,
              openQty: openQty.get(`${orderId}:${it.pieceId}`) ?? 0,
            })),
          },
        ]),
      );
      return { ...base, piecePlans };
    }

    // CUT/STEP: tiến độ theo loại sắt -> cỡ đoạn (byOrder cho biết cỡ nào thuộc SKU nào). Loại sắt chưa có lần
    // giao nào đã nhận thì CUT chưa báo được (receivedBarCount 0) - FE hiện "chưa nhận sắt".
    const progress =
      ws.kind === WorkstationKind.CUT
        ? await this.steelIssues.getPhoiProgress(productionInvoiceId)
        : await this.steelIssues.getStepProgress(productionInvoiceId, ws.processStep!);
    const received = await this.prisma.steelIssue.groupBy({
      by: ['materialId'],
      where: { productionInvoiceId: piId, status: { not: SteelIssueStatus.ISSUED } },
      _count: { _all: true },
    });
    const receivedSet = new Set(received.map((r) => r.materialId.toString()));
    return {
      ...base,
      materials: progress.map((m) => ({
        materialId: m.materialId,
        materialCode: m.materialCode,
        materialName: m.materialName,
        hasReceivedSteel: receivedSet.has(m.materialId),
        segments: m.segments.map((s) => ({
          segmentSpecId: s.segmentSpecId,
          cutLengthMm: s.cutLengthMm,
          required: s.required,
          done: s.done,
          byOrder: s.byOrder.map((b) => ({
            productionOrderId: b.productionOrderId,
            required: b.required,
            done: b.done,
          })),
        })),
      })),
    };
  }

  /** Đợt kho đã xuất, chưa ai nhận, của PI có SKU đang chạy (receive() cũng chặn PI chưa "Bắt đầu"). */
  private async listSteelToReceive() {
    const rows = await this.prisma.steelIssue.findMany({
      where: {
        status: SteelIssueStatus.ISSUED,
        productionInvoice: {
          items: {
            some: { productionOrder: { floorStage: ProductionOrderFloorStage.ACTIVE } },
          },
        },
      },
      orderBy: { issuedAt: 'asc' },
      select: {
        id: true,
        barCount: true,
        barLengthMm: true,
        issuedAt: true,
        productionInvoice: { select: { id: true, code: true } },
        material: { select: { code: true, name: true } },
        issuedBy: { select: { firstName: true, lastName: true, username: true } },
      },
    });
    return rows.map((r) => ({
      steelIssueId: r.id.toString(),
      productionInvoiceId: r.productionInvoice.id.toString(),
      piCode: r.productionInvoice.code,
      materialCode: r.material.code,
      materialName: r.material.name,
      barCount: r.barCount,
      barLengthMm: Number(r.barLengthMm),
      issuedAt: r.issuedAt,
      issuedByName: fullName(r.issuedBy),
    }));
  }

  private toWorkstation(ws: Workstation & { workshop?: { name: string } | null }) {
    return {
      id: ws.id.toString(),
      code: ws.code,
      name: ws.name,
      stage: ws.stage,
      kind: ws.kind,
      processStep: ws.processStep,
      // 13/11/2026: FE ghi đúng "Máy cắt laser" / "Máy cắt tự động" + xưởng ở tiêu đề màn quét
      cutMachineType: ws.cutMachineType ?? null,
      workshopName: ws.workshop?.name ?? null,
    };
  }
}
