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
  MfgStage,
  ProductionBatchStatus,
  ProductionOrderFloorStage,
  SteelIssueStatus,
  Workstation,
  WorkstationKind,
} from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { NOT_CANCELLED_ORDER } from '../../common/utils/cancelled-order.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { CutAllocationService, type CutMachineWork } from './cut-allocation.service';
import { ScanReportDto } from './dto/floor-scan.dto';
import { goodQty } from './floor-progress.util';
import {
  queueWorkshopIdOfPi,
  queueWorkshopIdsOfPis,
  workstationQueueWorkshopId,
} from './floor-queue-workshop.util';
import { pieceMaxNow } from './floor-review.service';
import { FloorStageService, type StagePi } from './floor-stage.service';

const STAGE_LABEL: Record<string, string> = { PHOI: 'Phôi', HAN: 'Hàn', SON: 'Sơn' };

/** Lệnh Hàn / Sơn trả cho màn quét (contract D5). */
function toStagePiDto(p: StagePi) {
  return {
    productionInvoiceId: p.productionInvoiceId.toString(),
    code: p.code,
    deadline: p.deadline?.toISOString() ?? null,
    missingPieces: p.missingPieces,
  };
}

const fullName = (u: { firstName: string; lastName: string; username?: string } | null) =>
  u ? `${u.lastName} ${u.firstName}`.trim() || u.username || null : null;

/**
 * Màn quét của công nhân (2026-10-13, QR tại máy - changelog-2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md mục 22).
 * Mã QR định danh MÁY (không chứa PI); từ 23/11/2026 hàng đợi xưởng đã bỏ: Phôi lấy lệnh từ bảng chia máy cắt, Hàn / Sơn
 * lấy tập lệnh làm được (FloorStageService, D2) và công nhân tự chọn. Mọi lần báo đi qua
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
    private readonly stages: FloorStageService,
  ) {}

  /**
   * Quét mã -> máy + lệnh làm được + dữ liệu để chọn SKU/cỡ đoạn/mảnh. Phôi: `allocationPis` theo bảng chia máy cắt; Hàn / Sơn:
   * `stagePis` (D2, 23/11/2026) công nhân tự chọn. `runningPi` luôn null và `reworkPis` luôn [] (giữ trường cho FE cũ).
   */
  async getContext(qrToken: string, user: AuthenticatedUser, productionInvoiceId?: string) {
    const ws = await this.resolveWorkstation(qrToken, user);
    const workstation = this.toWorkstation(ws);

    if (ws.kind === WorkstationKind.STEEL_RECEIVE) {
      return { workstation, steelToReceive: await this.listSteelToReceive(ws.workshopId) };
    }

    // Máy cắt: kèm việc chia cho máy này (đợt C0) + ước tiến độ (C2) - có trong MỌI trường hợp.
    const machineWork = ws.kind === WorkstationKind.CUT ? await this.loadMachineWork(ws.id) : null;
    const extra = machineWork ? { machineWork } : {};
    const workshopId = await workstationQueueWorkshopId(this.prisma, ws.workshopId);
    const allocationPis = await this.loadAllocationPis(ws, workshopId, machineWork);
    const stagePisRaw =
      ws.stage === MfgStage.PHOI ? [] : await this.stages.listReportablePis(ws.stage, workshopId);
    const stagePis = stagePisRaw.map(toStagePiDto);
    const base = { workstation, runningPi: null, reworkPis: [], allocationPis, stagePis };

    // Lệnh mặc định: máy CUT -> lệnh của dòng đầu tiên còn cây; máy STEP/PIECE -> lệnh đầu tiên của bảng chia; Hàn / Sơn -> chỉ
    // chọn sẵn khi có đúng 1 lệnh (nhiều lệnh thì công nhân tự chọn).
    const firstOpenRow = machineWork?.rows.find((r) => r.barCount - r.barsDoneEst > 0);
    const defaultId =
      ws.stage !== MfgStage.PHOI
        ? stagePis.length === 1
          ? stagePis[0].productionInvoiceId
          : null
        : ws.kind === WorkstationKind.CUT
          ? (firstOpenRow?.productionInvoiceId ?? null)
          : (allocationPis[0]?.productionInvoiceId ?? null);
    const selectedId = productionInvoiceId ?? defaultId;
    if (!selectedId) return { ...base, pi: null, ...extra };
    this.assertPiReportable(ws.stage, selectedId, allocationPis, stagePisRaw);
    return { ...base, pi: await this.buildPiContext(ws, selectedId), ...extra };
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
    const workshopId = await workstationQueueWorkshopId(this.prisma, ws.workshopId);
    const piId = parseBigIntId(dto.productionInvoiceId);
    if (ws.stage === MfgStage.PHOI) {
      const allocationPis = await this.loadAllocationPis(ws, workshopId, null);
      this.assertPiReportable(ws.stage, dto.productionInvoiceId, allocationPis, []);
    } else {
      // Chỉ kiểm đúng lệnh được báo (đỡ tính tiến độ cả danh sách).
      const stagePis = await this.stages.listReportablePis(ws.stage, workshopId, [piId]);
      this.assertPiReportable(ws.stage, dto.productionInvoiceId, [], stagePis);
    }
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
    // Lô sắt của xưởng khác thì không nhận ở mã của xưởng này (hàng đợi đã tách theo xưởng).
    const issue = await this.prisma.steelIssue.findUnique({
      where: { id: parseBigIntId(steelIssueId) },
      select: { productionInvoiceId: true },
    });
    if (issue) {
      const machineWorkshopId = await workstationQueueWorkshopId(this.prisma, ws.workshopId);
      const piWorkshopId = await queueWorkshopIdOfPi(
        this.prisma,
        MfgStage.PHOI,
        issue.productionInvoiceId,
      );
      if (piWorkshopId !== machineWorkshopId) {
        throw new ConflictException(
          'Lô sắt này của xưởng khác. Lô của xưởng nào thì nhận bằng mã "Khu nhận sắt" của xưởng đó; nhầm thì báo thủ kho.',
        );
      }
    }
    return this.steelIssues.receive(steelIssueId, user.id, receivedBarCount);
  }

  /**
   * "Sản lượng của tôi" (mục 20.5): mọi lần MÌNH báo trong khoảng thời gian, kèm trạng thái đợt (chờ kiểm hàng /
   * KCS đang chấm / đã KCS) và lần bị QLSX đảo + lý do. Đây là số ĐÃ BÁO, không phải số đạt KCS - nhân sự tính
   * công ở giai đoạn sau. P1: lần báo thuộc đợt đã chấm có thêm `kcs: { failedQty, shortQty }` = số lỗi / thiếu của
   * CẢ ĐỢT (cộng các phiếu chấm của đợt); null với đợt đang mở / đã chốt chờ chấm, hoặc đợt cũ không có phiếu chấm.
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
            qcReviews: { select: { failedQty: true, shortQty: true } },
            steelIssue: { select: { productionInvoice: { select: { code: true } } } },
          },
        },
        stepBatch: {
          select: {
            step: true,
            stepBundleId: true,
            stepBundle: {
              select: { status: true, qcReviews: { select: { failedQty: true, shortQty: true } } },
            },
            productionInvoice: { select: { code: true } },
          },
        },
        productionBatch: {
          select: {
            stage: true,
            status: true,
            qcReviews: { select: { failedQty: true, shortQty: true } },
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
      let reviews: { failedQty: number; shortQty: number }[] = [];
      if (r.cutBundle) {
        piCode = r.cutBundle.steelIssue.productionInvoice.code;
        state =
          r.cutBundle.status === CutBundleStatus.CUTTING
            ? 'OPEN'
            : r.cutBundle.status === CutBundleStatus.AWAITING_QC
              ? 'AWAITING_QC'
              : 'QC_DONE';
        reviews = r.cutBundle.qcReviews;
      } else if (r.stepBatch) {
        piCode = r.stepBatch.productionInvoice.code;
        state = !r.stepBatch.stepBundle
          ? 'OPEN'
          : r.stepBatch.stepBundle.status === 'AWAITING_QC'
            ? 'AWAITING_QC'
            : 'QC_DONE';
        reviews = r.stepBatch.stepBundle?.qcReviews ?? [];
      } else if (r.productionBatch) {
        piCode =
          r.productionBatch.productionOrder.productionInvoiceItem.productionInvoice?.code ?? null;
        state = r.productionBatch.status;
        reviews = r.productionBatch.qcReviews;
      }
      const kcs =
        state === 'QC_DONE' && reviews.length > 0
          ? {
              failedQty: reviews.reduce((n, v) => n + v.failedQty, 0),
              shortQty: reviews.reduce((n, v) => n + v.shortQty, 0),
            }
          : null;
      // P1 (19/11): mã đợt KCS chấm - FE gom các lần báo cùng đợt để chỉ hiện nhãn "KCS chấm cả đợt" 1 lần (kcs là số của
      // CẢ đợt). Công đoạn phụ: đợt = nhóm gửi KCS (stepBundle); chưa gom thì null.
      const batchKey =
        r.cutBundleId != null
          ? `CUT:${r.cutBundleId.toString()}`
          : r.stepBatch?.stepBundleId != null
            ? `STEP:${r.stepBatch.stepBundleId.toString()}`
            : r.productionBatchId != null
              ? `BATCH:${r.productionBatchId.toString()}`
              : null;
      return {
        id: r.id.toString(),
        kind: r.kind,
        createdAt: r.createdAt,
        piCode: r.productionInvoice?.code ?? piCode,
        step: r.stepBatch?.step ?? null,
        workstation: r.workstation,
        state,
        kcs,
        batchKey,
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
    if (!ws) {
      throw new NotFoundException('Mã QR không còn dùng - báo QLSX in lại tem');
    }
    if (!ws.isActive) {
      throw new NotFoundException('Máy này đang tắt - báo QLSX bật lại máy ở “Máy & tem QR”');
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
   * Lệnh báo được: Phôi theo bảng chia máy cắt (như cũ); Hàn / Sơn theo tập lệnh làm được (D2). Lệnh ngoài tập -> 409 (câu của
   * hợp đồng D5, không nhắc "Chuyển PI tiếp" vì hàng đợi đã bỏ).
   */
  private assertPiReportable(
    stage: MfgStage,
    productionInvoiceId: string,
    allocationPis: { productionInvoiceId: string }[],
    stagePis: StagePi[],
  ) {
    const id = parseBigIntId(productionInvoiceId).toString();
    if (stage === MfgStage.PHOI) {
      if (allocationPis.some((p) => p.productionInvoiceId === id)) return;
      throw new ConflictException(
        'Lệnh này chưa làm được ở tổ Phôi của xưởng này (lệnh không có trong bảng chia máy cắt của xưởng, hoặc đã xong / đã kết thúc). Tải lại màn để xem lệnh làm được.',
      );
    }
    if (stagePis.some((p) => p.productionInvoiceId.toString() === id)) return;
    const upstream = stage === MfgStage.SON ? 'khung Hàn' : 'mảnh Phôi';
    throw new ConflictException(
      `Lệnh này chưa làm được ở tổ ${STAGE_LABEL[stage] ?? stage} của xưởng này (chưa có ${upstream} đạt KCS, hoặc đã đủ số / đã kết thúc). Tải lại màn để xem lệnh làm được.`,
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
      // Huỷ lệnh theo SKU (23/11/2026): SKU đã huỷ không còn để chọn báo.
      this.prisma.productionOrder.findMany({
        where: { productionInvoiceItem: { productionInvoiceId: piId }, ...NOT_CANCELLED_ORDER },
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
      // Kế hoạch mảnh bỏ qua đợt OPEN (chưa báo xong cho KCS) - thêm số đó để công nhân thấy lần báo vừa lưu đã vào.
      // P1: maxNow = max(0, cần - đạt - chờ KCS chấm - đang mở) = số tối đa lần báo kế tiếp được nhận (cùng công thức
      // ProductionBatchesService chặn báo vượt); đạt (passedQty) đã trừ lỗi + thiếu nên đoạn lỗi được báo bù.
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
            items: plan.items.map((it) => {
              const open = openQty.get(`${orderId}:${it.pieceId}`) ?? 0;
              return {
                ...it,
                openQty: open,
                maxNow: pieceMaxNow({ ...it, openQty: open }),
              };
            }),
          },
        ]),
      );
      return { ...base, piecePlans };
    }

    // CUT/STEP: tiến độ theo loại sắt -> cỡ đoạn (byOrder cho biết cỡ nào thuộc SKU nào).
    // P1 (18/11/2026): `done` trả về màn quét = SỐ ĐÃ TÍNH = thô - lỗi - thiếu (API phoi-progress: done = thô - thiếu,
    // vẫn gồm lỗi - khác nghĩa, đừng lẫn). `reportedQty` = số thô công nhân đã báo (đọc trường reportedQty của tiến độ,
    // KHÔNG lấy done). Kèm `failed` (lỗi KCS), `shortQty` (KCS ghi thiếu), `baseRequired` / `extraNeed` (required =
    // định mức + cắt lại), `maxNow` (lần báo kế tiếp tối đa, BE chặn đúng số này) và `physicalLeft` (số đoạn còn làm
    // được, null với Cắt). FE chỉ hiện các số này, không tự tính lại.
    // Loại sắt chưa có lần giao nào đã nhận thì CUT chưa báo được (receivedBarCount 0) - FE hiện "chưa nhận sắt".
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
          baseRequired: s.baseRequired,
          extraNeed: s.extraNeed,
          done: goodQty({ done: s.done, failed: s.failed ?? 0 }),
          failed: s.failed ?? 0,
          shortQty: s.shortQty,
          reportedQty: s.reportedQty,
          maxNow: s.maxNow,
          physicalLeft: s.physicalLeft,
          byOrder: s.byOrder.map((b) => ({
            productionOrderId: b.productionOrderId,
            required: b.required,
            baseRequired: b.baseRequired,
            extraNeed: b.extraNeed,
            done: goodQty({ done: b.done, failed: b.failed ?? 0 }),
            failed: b.failed ?? 0,
            shortQty: b.shortQty,
            reportedQty: b.reportedQty,
            maxNow: b.maxNow,
            physicalLeft: b.physicalLeft,
          })),
        })),
      })),
    };
  }

  /** Đợt kho đã xuất, chưa ai nhận, của PI có SKU đang chạy (receive() cũng chặn PI chưa "Bắt đầu"). */
  private async listSteelToReceive(machineWorkshopId: bigint | null) {
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
    // Chỉ lô của xưởng máy đang quét (xưởng của PI theo tổ Phôi; máy chưa gắn xưởng = xưởng mặc định).
    const machineWorkshopOf = await workstationQueueWorkshopId(this.prisma, machineWorkshopId);
    const piWorkshopOf = await queueWorkshopIdsOfPis(this.prisma, MfgStage.PHOI, [
      ...new Set(rows.map((r) => r.productionInvoice.id)),
    ]);
    const ofMachine = rows.filter(
      (r) => piWorkshopOf.get(r.productionInvoice.id.toString()) === machineWorkshopOf,
    );
    return ofMachine.map((r) => ({
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
