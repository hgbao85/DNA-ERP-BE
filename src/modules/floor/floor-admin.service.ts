import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import {
  FloorQueueStatus,
  MfgRole,
  MfgStage,
  ProcessStep,
  Prisma,
  WorkstationKind,
} from '../../generated/prisma/client';
import { MFG_FLOOR_WAREHOUSE_SCOPE } from '../../common/constants/role-permissions.constant';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { PIN_CLAIM_HOURS } from '../../common/utils/pin.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import {
  CreateFloorWorkerDto,
  FloorWorkerStage,
  UpdateFloorWorkerDto,
} from './dto/floor-worker.dto';
import { CreateWorkstationDto, UpdateWorkstationDto } from './dto/workstation.dto';

/** Token trong link mã QR - 18 byte ngẫu nhiên (24 ký tự base64url), không đoán/dò được. */
function newQrToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

const WORKER_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  mfgRole: true,
  isActive: true,
  createdAt: true,
  pinPending: true,
  pinClaimExpiresAt: true,
  pinSetAt: true,
  lockedUntil: true,
} as const;

const QUEUE_INCLUDE = {
  productionInvoice: { select: { id: true, code: true } },
  startedBy: { select: { firstName: true, lastName: true } },
  endedBy: { select: { firstName: true, lastName: true } },
} as const;

type QueueRow = Prisma.FloorQueueEntryGetPayload<{ include: typeof QUEUE_INCLUDE }>;

export interface FloorProgress {
  required: number;
  reported: number;
  percent: number;
  complete: boolean;
}

const fullName = (u: { firstName: string; lastName: string } | null) =>
  u ? `${u.lastName} ${u.firstName}`.trim() : null;

/** Dòng DONE đóng gần nhất của 1 tổ (cùng thứ tự với `reopenLast`: endedAt giảm dần, rồi id giảm dần). */
function latestDone(rows: QueueRow[]): QueueRow | null {
  let best: QueueRow | null = null;
  for (const r of rows) {
    if (r.status !== FloorQueueStatus.DONE) continue;
    if (!best) {
      best = r;
      continue;
    }
    const d = (r.endedAt?.getTime() ?? 0) - (best.endedAt?.getTime() ?? 0);
    if (d > 0 || (d === 0 && r.id > best.id)) best = r;
  }
  return best;
}

/**
 * Phần QLSX quản lý của QR tại máy (2026-10-13, changelog-2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md mục 22):
 * điểm làm việc + mã QR, tài khoản công nhân, hàng đợi PI theo tổ. Màn quét của công nhân ở FloorScanService,
 * kiểm/gửi KCS/đảo lần báo ở FloorReviewService.
 */
@Injectable()
export class FloorAdminService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly steelIssues: SteelIssuesService,
    private readonly productionBatches: ProductionBatchesService,
  ) {}

  // ─── Địa chỉ ERP dùng cho tem QR ────────────────────────────────────────────

  /**
   * Địa chỉ gốc in lên tem (null = dùng địa chỉ trình duyệt đang mở) - QLSX CHỈ ĐỌC. Đây là cấu hình hệ thống theo từng môi
   * trường, Admin đặt ở "Cấu hình hệ thống" (PUT /system-config, có nhật ký ai đổi) - xem SystemConfig.floorPublicUrl.
   */
  async getSettings() {
    const c = await this.prisma.systemConfig.findUnique({
      where: { id: 1 },
      select: { floorPublicUrl: true },
    });
    return { publicUrl: c?.floorPublicUrl ?? null };
  }

  // ─── Điểm làm việc (máy) + mã QR ────────────────────────────────────────────

  async listWorkstations() {
    const rows = await this.prisma.workstation.findMany({
      orderBy: [{ stage: 'asc' }, { code: 'asc' }],
    });
    return rows.map((w) => this.toWorkstation(w));
  }

  async createWorkstation(dto: CreateWorkstationDto) {
    this.assertWorkstationShape(dto.stage, dto.kind, dto.processStep ?? null);
    const code = dto.code.trim().toUpperCase();
    try {
      const created = await this.prisma.workstation.create({
        data: {
          code,
          name: dto.name.trim(),
          stage: dto.stage,
          kind: dto.kind,
          processStep: dto.kind === WorkstationKind.STEP ? dto.processStep : null,
          qrToken: newQrToken(),
        },
      });
      return this.toWorkstation(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Mã điểm làm việc ${code} đã có`);
      }
      throw e;
    }
  }

  async updateWorkstation(id: string, dto: UpdateWorkstationDto) {
    await this.findWorkstationOrThrow(id);
    const updated = await this.prisma.workstation.update({
      where: { id: parseBigIntId(id) },
      data: { name: dto.name?.trim(), isActive: dto.isActive },
    });
    return this.toWorkstation(updated);
  }

  /** Đổi mã QR (tem mất / bị chụp lại mang đi chỗ khác) - tem cũ quét ra "mã không còn dùng". */
  async regenerateWorkstationToken(id: string) {
    await this.findWorkstationOrThrow(id);
    const updated = await this.prisma.workstation.update({
      where: { id: parseBigIntId(id) },
      data: { qrToken: newQrToken() },
    });
    return this.toWorkstation(updated);
  }

  /** CUT/STEP/STEEL_RECEIVE chỉ của tổ Phôi; STEP phải có công đoạn phụ (khác Cắt); PIECE cho Phôi/Hàn/Sơn.
   *  Trùng CHECK DB - kiểm ở đây để trả lỗi dễ hiểu thay vì lỗi ràng buộc. */
  private assertWorkstationShape(
    stage: MfgStage,
    kind: WorkstationKind,
    processStep: ProcessStep | null,
  ) {
    if (stage === MfgStage.DAN) {
      throw new BadRequestException('Tổ Đan không dùng mã QR tại máy');
    }
    if (kind !== WorkstationKind.PIECE && stage !== MfgStage.PHOI) {
      throw new BadRequestException('Máy cắt, máy công đoạn phụ và khu nhận sắt chỉ thuộc tổ Phôi');
    }
    if (kind === WorkstationKind.STEP && (!processStep || processStep === ProcessStep.CAT)) {
      throw new BadRequestException(
        'Máy công đoạn phụ phải chọn công đoạn (Uốn/Dập/Đục lỗ/Tán/Tóp đầu/Xẻ/Nhấn)',
      );
    }
  }

  private async findWorkstationOrThrow(id: string) {
    const w = await this.prisma.workstation.findUnique({ where: { id: parseBigIntId(id) } });
    if (!w) throw new NotFoundException(`Điểm làm việc ${id} không tồn tại`);
    return w;
  }

  private toWorkstation(w: {
    id: bigint;
    code: string;
    name: string;
    stage: MfgStage;
    kind: WorkstationKind;
    processStep: ProcessStep | null;
    qrToken: string;
    isActive: boolean;
    createdAt: Date;
  }) {
    return {
      id: w.id.toString(),
      code: w.code,
      name: w.name,
      stage: w.stage,
      kind: w.kind,
      processStep: w.processStep,
      qrToken: w.qrToken,
      isActive: w.isActive,
      createdAt: w.createdAt,
    };
  }

  // ─── Tài khoản công nhân ─────────────────────────────────────────────────────
  // User thường, role FLOOR_WORKER, tổ = mfgRole, cùng warehouseScope 'phoi-son-han' như tài khoản thống kê
  // cũ (finishProductionBatch trừ tồn đoạn theo scope). QLSX chỉ sửa được tài khoản mang role này.

  async listWorkers() {
    const rows = await this.prisma.user.findMany({
      where: { deletedAt: null, roles: { some: { role: { name: BUSINESS_ROLES.FLOOR_WORKER } } } },
      orderBy: [{ mfgRole: 'asc' }, { username: 'asc' }],
      select: WORKER_SELECT,
    });
    return rows.map((u) => this.toWorker(u));
  }

  async createWorker(dto: CreateFloorWorkerDto) {
    const role = await this.prisma.role.findUnique({
      where: { name: BUSINESS_ROLES.FLOOR_WORKER },
    });
    if (!role) {
      throw new ConflictException('Chưa có role FLOOR_WORKER - chạy seed (npm run seed) trước');
    }
    const username = dto.username.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) throw new ConflictException(`Tên đăng nhập ${username} đã có người dùng`);

    // Chưa có PIN: password là hash của chuỗi ngẫu nhiên không ai biết; công nhân tự đặt PIN ở lần đăng nhập đầu
    // (AuthService.pinSetup) - QLSX không bao giờ biết PIN. Hạn đặt PIN PIN_CLAIM_HOURS giờ.
    const password = await argon2.hash(crypto.randomBytes(32).toString('hex'));
    try {
      const created = await this.prisma.user.create({
        data: {
          username,
          email: null,
          password,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          mfgRole: dto.stage as MfgRole,
          warehouseScope: MFG_FLOOR_WAREHOUSE_SCOPE,
          pinPending: true,
          pinClaimExpiresAt: new Date(Date.now() + PIN_CLAIM_HOURS * 3_600_000),
          roles: { create: { roleId: role.id } },
        },
        select: WORKER_SELECT,
      });
      return this.toWorker(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Tên đăng nhập ${username} đã có người dùng`);
      }
      throw e;
    }
  }

  async updateWorker(id: string, dto: UpdateFloorWorkerDto) {
    await this.findWorkerOrThrow(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          firstName: dto.firstName?.trim(),
          lastName: dto.lastName?.trim(),
          mfgRole: dto.stage as MfgRole | undefined,
          isActive: dto.isActive,
        },
        select: WORKER_SELECT,
      });
      // Khoá hoặc đổi tổ -> đăng xuất mọi máy (token cũ còn mang tổ cũ trong mfgRole).
      if (dto.isActive === false || dto.stage) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return u;
    });
    return this.toWorker(updated);
  }

  /**
   * "Cho đặt lại PIN" (quên PIN / nghi bị lộ): xoá PIN cũ (đổi sang hash ngẫu nhiên), tài khoản về trạng thái chờ đặt PIN trong
   * PIN_CLAIM_HOURS giờ, mở khoá, đăng xuất mọi máy. Công nhân tự đặt PIN mới ở lần đăng nhập kế - QLSX không biết PIN.
   */
  async resetWorkerPin(id: string) {
    await this.findWorkerOrThrow(id);
    const password = await argon2.hash(crypto.randomBytes(32).toString('hex'));
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          password,
          pinPending: true,
          pinClaimExpiresAt: new Date(Date.now() + PIN_CLAIM_HOURS * 3_600_000),
          failedLoginCount: 0,
          lockedUntil: null,
        },
        select: WORKER_SELECT,
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return u;
    });
    return this.toWorker(updated);
  }

  /** Mở khoá sớm tài khoản đang bị khoá tạm do nhập sai PIN quá 5 lần. */
  async unlockWorker(id: string) {
    await this.findWorkerOrThrow(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null },
      select: WORKER_SELECT,
    });
    return this.toWorker(updated);
  }

  private async findWorkerOrThrow(id: string) {
    const u = await this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
        roles: { some: { role: { name: BUSINESS_ROLES.FLOOR_WORKER } } },
      },
      select: { id: true },
    });
    if (!u) throw new NotFoundException(`Không có tài khoản công nhân ${id}`);
    return u;
  }

  private toWorker(u: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    mfgRole: MfgRole | null;
    isActive: boolean;
    createdAt: Date;
    pinPending: boolean;
    pinClaimExpiresAt: Date | null;
    pinSetAt: Date | null;
    lockedUntil: Date | null;
  }) {
    const now = new Date();
    // ADMIN_SET: tài khoản tạo từ trước khi có luồng tự đặt PIN (pinSetAt trống) - PIN do QLSX đặt nên QLSX biết;
    // nên cho đặt lại để chính công nhân giữ PIN.
    const pinState = !u.pinPending
      ? u.pinSetAt
        ? 'SET'
        : 'ADMIN_SET'
      : u.pinClaimExpiresAt && u.pinClaimExpiresAt > now
        ? 'PENDING'
        : 'EXPIRED';
    return {
      id: u.id,
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      fullName: fullName(u),
      stage: u.mfgRole as FloorWorkerStage | null,
      isActive: u.isActive,
      createdAt: u.createdAt,
      /** SET = công nhân tự đặt PIN; ADMIN_SET = PIN do QLSX đặt (tài khoản cũ); PENDING = chờ đặt PIN lần đầu (còn hạn); EXPIRED = quá hạn. */
      pinState,
      pinClaimExpiresAt: u.pinPending ? u.pinClaimExpiresAt : null,
      pinSetAt: u.pinSetAt,
      /** Còn khoá tạm (nhập sai PIN quá 5 lần) đến giờ này; null = không khoá. */
      lockedUntil: u.lockedUntil && u.lockedUntil > now ? u.lockedUntil : null,
    };
  }

  // ─── Hàng đợi PI theo tổ (mục 19) ───────────────────────────────────────────

  async listQueue(stage?: FloorWorkerStage) {
    const rows = await this.prisma.floorQueueEntry.findMany({
      where: stage ? { stage: stage as MfgStage } : undefined,
      include: QUEUE_INCLUDE,
      orderBy: [{ stage: 'asc' }, { position: 'asc' }],
    });
    const activePiIds = await this.findPiIdsWithActiveFloor(rows.map((r) => r.productionInvoiceId));
    // Tiến độ chỉ tính cho PI ĐANG CHẠY (mỗi tổ đúng 1) - để nhắc "đủ số, chuyển PI tiếp" (mục 19).
    const progressById = new Map<string, FloorProgress | null>();
    await Promise.all(
      rows
        .filter((r) => r.status === FloorQueueStatus.RUNNING)
        .map(async (r) =>
          progressById.set(
            r.id.toString(),
            await this.computeProgress(r.stage, r.productionInvoiceId).catch(() => null),
          ),
        ),
    );
    const reopenable = await this.findReopenableIds(rows);
    // RUNNING trước, rồi QUEUED theo thứ tự, DONE mới nhất cuối cùng.
    const rank = { RUNNING: 0, QUEUED: 1, DONE: 2 } as const;
    return rows
      .sort((a, b) => {
        if (a.stage !== b.stage) return a.stage.localeCompare(b.stage);
        const r = rank[a.status] - rank[b.status];
        if (r !== 0) return r;
        if (a.status === FloorQueueStatus.DONE)
          return (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0);
        return a.position - b.position;
      })
      .map((r) =>
        this.toQueueEntry(
          r,
          activePiIds.has(r.productionInvoiceId.toString()),
          progressById.get(r.id.toString()) ?? null,
          reopenable.has(r.id.toString()),
        ),
      );
  }

  /**
   * Dòng DONE gần nhất của từng tổ mà "Mở lại PI vừa chuyển" làm được: tổ không có PI đang chạy, hoặc PI đang chạy
   * CHƯA có lần báo nào của công nhân (trả nó về hàng đợi không làm mất việc ai đã báo). Cùng điều kiện với
   * `reopenLast` - FE chỉ bày nút khi bấm được.
   */
  private async findReopenableIds(rows: QueueRow[]): Promise<Set<string>> {
    const out = new Set<string>();
    const stages = [...new Set(rows.map((r) => r.stage))];
    await Promise.all(
      stages.map(async (stage) => {
        const inStage = rows.filter((r) => r.stage === stage);
        const last = latestDone(inStage);
        if (!last) return;
        const running = inStage.find((r) => r.status === FloorQueueStatus.RUNNING);
        if (running) {
          const reports = await this.prisma.floorReport.count({
            where: { productionInvoiceId: running.productionInvoiceId, workstation: { stage } },
          });
          if (reports > 0) return;
        }
        out.add(last.id.toString());
      }),
    );
    return out;
  }

  /**
   * Tiến độ của tổ trên 1 PI: Σ số cần vs Σ số đã báo, MỖI dòng (cỡ đoạn / mảnh) chặn trần ở số cần - dòng
   * báo vượt không che dòng còn thiếu. Phôi: đoạn cắt (CAT); Hàn/Sơn: mảnh theo định mức, tính cả đợt chưa gửi
   * KCS. Chỉ là gợi ý nhắc QLSX, KHÔNG tự chuyển PI và không chặn gì.
   */
  async computeProgress(stage: MfgStage, productionInvoiceId: bigint): Promise<FloorProgress> {
    let required = 0;
    let reported = 0;
    if (stage === MfgStage.PHOI) {
      const items = await this.steelIssues.getPhoiProgress(productionInvoiceId.toString());
      for (const m of items) {
        for (const sg of m.segments) {
          required += sg.required;
          reported += Math.min(sg.done, sg.required);
        }
      }
    } else {
      const orders = await this.prisma.productionOrder.findMany({
        where: { productionInvoiceItem: { productionInvoiceId } },
        select: { id: true },
      });
      const orderIds = orders.map((o) => o.id);
      const [plans, open] = await Promise.all([
        this.productionBatches.getBatchPlanBatch(
          orderIds.map((o) => o.toString()),
          stage,
        ),
        this.prisma.productionBatch.groupBy({
          by: ['productionOrderId', 'pieceId'],
          where: { stage, status: 'OPEN', productionOrderId: { in: orderIds } },
          _sum: { reportedQty: true },
        }),
      ]);
      const openQty = new Map(
        open.map((r) => [`${r.productionOrderId}:${r.pieceId}`, r._sum.reportedQty ?? 0]),
      );
      for (const [orderId, plan] of Object.entries(plans)) {
        for (const it of plan.items) {
          const done =
            it.passedQty + it.awaitingQcQty + (openQty.get(`${orderId}:${it.pieceId}`) ?? 0);
          required += it.plannedQty;
          reported += Math.min(done, it.plannedQty);
        }
      }
    }
    return {
      required,
      reported,
      percent: required > 0 ? Math.round((reported / required) * 100) : 0,
      complete: required > 0 && reported >= required,
    };
  }

  /** Số đợt đang chờ QLSX gửi KCS theo tổ - chấm số trên menu "Sản lượng xưởng". */
  async summary() {
    const [cut, stepBatches, pieces] = await Promise.all([
      this.prisma.cutBundle.count({ where: { status: 'CUTTING' } }),
      this.prisma.stepBatch.findMany({
        where: { stepBundleId: null },
        distinct: ['productionInvoiceId', 'materialId', 'step', 'productionOrderId'],
        select: { id: true },
      }),
      this.prisma.productionBatch.groupBy({
        by: ['stage'],
        where: { status: 'OPEN' },
        _count: { _all: true },
      }),
    ]);
    const pieceBy = (stage: MfgStage) => pieces.find((p) => p.stage === stage)?._count._all ?? 0;
    return {
      PHOI: { open: cut + stepBatches.length + pieceBy(MfgStage.PHOI) },
      HAN: { open: pieceBy(MfgStage.HAN) },
      SON: { open: pieceBy(MfgStage.SON) },
    };
  }

  /** PI đã có lệnh sản xuất, chưa nằm trong hàng đợi của tổ (kể cả đã xong) - ô chọn "Thêm PI vào hàng đợi". */
  async queueCandidates(stage: FloorWorkerStage) {
    const rows = await this.prisma.productionInvoice.findMany({
      where: {
        floorQueueEntries: { none: { stage: stage as MfgStage } },
        items: { some: { productionOrder: { isNot: null } } },
        status: { not: 'CANCELLED' },
      },
      orderBy: { id: 'desc' },
      take: 60,
      select: {
        id: true,
        code: true,
        deadline: true,
        items: {
          where: { productionOrder: { isNot: null } },
          select: { productionOrder: { select: { floorStage: true } } },
        },
      },
    });
    return rows.map((r) => ({
      productionInvoiceId: r.id.toString(),
      code: r.code,
      deadline: r.deadline,
      orderCount: r.items.length,
      activeOrderCount: r.items.filter((i) => i.productionOrder?.floorStage === 'ACTIVE').length,
    }));
  }

  async enqueue(stage: FloorWorkerStage, productionInvoiceId: string, actorId: string) {
    const piId = parseBigIntId(productionInvoiceId);
    const pi = await this.prisma.productionInvoice.findUnique({
      where: { id: piId },
      select: { id: true, code: true },
    });
    if (!pi) throw new NotFoundException(`PI ${productionInvoiceId} không tồn tại`);
    const orderCount = await this.prisma.productionOrder.count({
      where: { productionInvoiceItem: { productionInvoiceId: piId } },
    });
    if (orderCount === 0) {
      throw new BadRequestException(`${pi.code} chưa được Sếp duyệt (chưa có lệnh sản xuất nào)`);
    }
    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `floor-queue:${stage}`);
      const dup = await tx.floorQueueEntry.findUnique({
        where: {
          stage_productionInvoiceId: { stage: stage as MfgStage, productionInvoiceId: piId },
        },
      });
      if (dup) {
        throw new ConflictException(
          dup.status === FloorQueueStatus.DONE
            ? `${pi.code} đã chạy xong ở tổ ${stage} nên không xếp lại vào hàng đợi được. Vừa chuyển nhầm thì bấm “Mở lại” ở khối PI đang chạy; muốn báo bù thì công nhân chọn PI này ở mục “Bù lỗi” trên màn quét.`
            : `${pi.code} đã có trong hàng đợi tổ ${stage}`,
        );
      }
      const last = await tx.floorQueueEntry.aggregate({
        where: { stage: stage as MfgStage },
        _max: { position: true },
      });
      await tx.floorQueueEntry.create({
        data: {
          stage: stage as MfgStage,
          productionInvoiceId: piId,
          position: (last._max.position ?? 0) + 1,
          queuedById: actorId,
        },
      });
    });
    return this.listQueue(stage);
  }

  async reorder(stage: FloorWorkerStage, entryIds: string[]) {
    const ids = entryIds.map(parseBigIntId);
    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `floor-queue:${stage}`);
      const queued = await tx.floorQueueEntry.findMany({
        where: { stage: stage as MfgStage, status: FloorQueueStatus.QUEUED },
        select: { id: true, position: true },
      });
      const current = new Set(queued.map((q) => q.id.toString()));
      if (ids.length !== current.size || ids.some((id) => !current.has(id.toString()))) {
        throw new ConflictException('Danh sách PI đang chờ đã thay đổi - tải lại rồi xếp lại');
      }
      const base = Math.min(...queued.map((q) => q.position));
      for (const [i, id] of ids.entries()) {
        await tx.floorQueueEntry.update({ where: { id }, data: { position: base + i } });
      }
    });
    return this.listQueue(stage);
  }

  /** Bỏ 1 PI CHƯA chạy khỏi hàng đợi. PI đang chạy/đã xong không bỏ được (giữ lịch sử PI–tổ). */
  async removeEntry(id: string) {
    const entry = await this.prisma.floorQueueEntry.findUnique({
      where: { id: parseBigIntId(id) },
    });
    if (!entry) throw new NotFoundException(`Không có dòng hàng đợi ${id}`);
    if (entry.status !== FloorQueueStatus.QUEUED) {
      throw new ConflictException('Chỉ bỏ được PI đang chờ - PI đang chạy dùng "Chuyển PI tiếp"');
    }
    await this.prisma.floorQueueEntry.delete({ where: { id: entry.id } });
    return this.listQueue(entry.stage as FloorWorkerStage);
  }

  /**
   * "Chuyển PI tiếp" - PI đang chạy của tổ -> DONE, PI đầu hàng đợi -> RUNNING (tổ chưa chạy PI nào thì chỉ bắt
   * đầu PI đầu hàng). QLSX tự bấm, không tự chuyển khi đủ số: còn đợt chờ KCS/cắt bù (mục 19). PI đã DONE vẫn
   * báo được qua mục "Bù lỗi" khi còn SKU đang chạy.
   */
  async advance(stage: FloorWorkerStage, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `floor-queue:${stage}`);
      const now = new Date();
      const running = await tx.floorQueueEntry.findFirst({
        where: { stage: stage as MfgStage, status: FloorQueueStatus.RUNNING },
      });
      const next = await tx.floorQueueEntry.findFirst({
        where: { stage: stage as MfgStage, status: FloorQueueStatus.QUEUED },
        orderBy: { position: 'asc' },
      });
      if (!running && !next) {
        throw new ConflictException(`Tổ ${stage} chưa có PI nào trong hàng đợi`);
      }
      if (running) {
        await tx.floorQueueEntry.update({
          where: { id: running.id },
          data: { status: FloorQueueStatus.DONE, endedAt: now, endedById: actorId },
        });
      }
      if (next) {
        await tx.floorQueueEntry.update({
          where: { id: next.id },
          data: { status: FloorQueueStatus.RUNNING, startedAt: now, startedById: actorId },
        });
      }
    });
    return this.listQueue(stage);
  }

  /**
   * "Mở lại PI vừa chuyển" - hoàn tác 1 lần bấm "Chuyển PI tiếp" nhầm: PI đóng gần nhất của tổ chạy lại; PI đang chạy
   * (nếu có) trở về hàng đợi, giữ nguyên vị trí nên vẫn đứng đầu hàng. CHỈ làm khi PI đang chạy CHƯA có lần báo nào của
   * công nhân tại tổ này - đã có người báo thì đó là lần chuyển có chủ đích, không kéo ngược (báo bù PI cũ đi qua mục
   * "Bù lỗi"). Số liệu không đổi: báo cáo gắn theo PI, hàng đợi chỉ quyết PI nào là mặc định ở màn quét.
   */
  async reopenLast(stage: FloorWorkerStage) {
    await this.prisma.$transaction(async (tx) => {
      await lockBusinessKey(tx, `floor-queue:${stage}`);
      const last = await tx.floorQueueEntry.findFirst({
        where: { stage: stage as MfgStage, status: FloorQueueStatus.DONE },
        orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
        include: { productionInvoice: { select: { code: true } } },
      });
      if (!last) throw new ConflictException(`Tổ ${stage} chưa chuyển PI nào để mở lại`);
      const running = await tx.floorQueueEntry.findFirst({
        where: { stage: stage as MfgStage, status: FloorQueueStatus.RUNNING },
        include: { productionInvoice: { select: { code: true } } },
      });
      if (running) {
        const reports = await tx.floorReport.count({
          where: {
            productionInvoiceId: running.productionInvoiceId,
            workstation: { stage: stage as MfgStage },
          },
        });
        if (reports > 0) {
          throw new ConflictException(
            `${running.productionInvoice.code} đã có ${reports} lần báo của công nhân nên không trả về hàng đợi được. Muốn báo tiếp vào ${last.productionInvoice.code} thì công nhân chọn PI này ở mục “Bù lỗi” trên màn quét.`,
          );
        }
        // Trả PI đang chạy về hàng đợi TRƯỚC khi mở PI cũ: mỗi tổ đúng 1 dòng RUNNING (partial unique index).
        await tx.floorQueueEntry.update({
          where: { id: running.id },
          data: { status: FloorQueueStatus.QUEUED, startedAt: null, startedById: null },
        });
      }
      await tx.floorQueueEntry.update({
        where: { id: last.id },
        data: { status: FloorQueueStatus.RUNNING, endedAt: null, endedById: null },
      });
    });
    return this.listQueue(stage);
  }

  private async findPiIdsWithActiveFloor(piIds: bigint[]): Promise<Set<string>> {
    if (piIds.length === 0) return new Set();
    const rows = await this.prisma.productionOrder.findMany({
      where: {
        floorStage: 'ACTIVE',
        productionInvoiceItem: { productionInvoiceId: { in: piIds } },
      },
      select: { productionInvoiceItem: { select: { productionInvoiceId: true } } },
    });
    return new Set(rows.map((r) => String(r.productionInvoiceItem.productionInvoiceId)));
  }

  private toQueueEntry(
    r: QueueRow,
    hasActiveFloor: boolean,
    progress: FloorProgress | null,
    canReopen: boolean,
  ) {
    return {
      id: r.id.toString(),
      stage: r.stage,
      productionInvoiceId: r.productionInvoiceId.toString(),
      piCode: r.productionInvoice.code,
      position: r.position,
      status: r.status,
      queuedAt: r.queuedAt,
      startedAt: r.startedAt,
      startedByName: fullName(r.startedBy),
      endedAt: r.endedAt,
      endedByName: fullName(r.endedBy),
      /** Có ít nhất 1 SKU QLSX đã bấm "Bắt đầu" - false thì công nhân quét được nhưng chưa báo được. */
      hasActiveFloor,
      /** Chỉ có ở PI đang chạy (RUNNING); null = chưa tính được. */
      progress,
      /** Chỉ true ở dòng DONE đóng gần nhất của tổ và "Mở lại PI vừa chuyển" làm được (xem `reopenLast`). */
      canReopen,
    };
  }
}
