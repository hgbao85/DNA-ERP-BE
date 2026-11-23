import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import {
  CutAllocationLogAction,
  MfgRole,
  MfgStage,
  ProcessStep,
  Prisma,
  SolverMachine,
  WorkstationKind,
} from '../../generated/prisma/client';
import { MFG_FLOOR_WAREHOUSE_SCOPE } from '../../common/constants/role-permissions.constant';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { lockBusinessKey } from '../../common/utils/advisory-lock.util';
import { PIN_CLAIM_HOURS } from '../../common/utils/pin.util';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { toMaterialChoiceRef } from '../../common/utils/material-choice-ref.util';
import { NOT_CANCELLED_ORDER } from '../../common/utils/cancelled-order.util';
import {
  WorkshopScope,
  WorkshopScopeService,
} from '../../common/workshop-scope/workshop-scope.service';
import { PRISMA_SERVICE, PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import {
  CreateFloorWorkerDto,
  FloorWorkerStage,
  UpdateFloorWorkerDto,
} from './dto/floor-worker.dto';
import { CreateWorkstationDto, UpdateWorkstationDto } from './dto/workstation.dto';
import { KCS_STALE_HOURS, listKcsPendingItems } from './kcs-pending.util';
import { filterByQueueWorkshop } from './floor-queue-workshop.util';
import {
  type FloorProgress,
  type PhoiItems,
  progressFrom,
  type StageData,
} from './floor-stage-progress';

const fullName = (u: { firstName: string; lastName: string } | null) =>
  u ? `${u.lastName} ${u.firstName}`.trim() : null;

/** Token trong link mã QR - 18 byte ngẫu nhiên (24 ký tự base64url), không đoán/dò được. */
function newQrToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

/** Nạp tên xưởng cùng lúc với máy (không N+1) - 13/11/2026. */
const WORKSTATION_INCLUDE = { workshop: { select: { name: true } } } as const;

/** Cùng mức với TX_OPTIONS của cut-allocation.service.ts: mọi chỗ giữ khoá `cut-allocation:<xưởng>` chờ lâu như nhau. */
const CUT_LOCK_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

const WORKER_SELECT = {
  id: true,
  workshopId: true,
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

/**
 * Phần QLSX quản lý của QR tại máy (2026-10-13, changelog-2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md mục 22):
 * điểm làm việc + mã QR, tài khoản công nhân, số đỏ KCS (hàng đợi PI theo tổ đã bỏ 23/11/2026). Màn quét của công nhân ở FloorScanService,
 * kiểm/gửi KCS/đảo lần báo ở FloorReviewService.
 */
@Injectable()
export class FloorAdminService {
  private readonly logger = new Logger(FloorAdminService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
    private readonly steelIssues: SteelIssuesService,
    private readonly productionBatches: ProductionBatchesService,
    private readonly workshopScope: WorkshopScopeService,
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

  /**
   * X4 16/11: QLSX gắn xưởng chỉ thấy/sửa máy của xưởng mình + máy chưa khai xưởng (NULL); tạo máy mới
   * luôn gán xưởng mình. Người không gắn xưởng như cũ.
   */
  async listWorkstations(userId?: string) {
    const scope = await this.workshopScope.getScope(userId);
    const rows = await this.prisma.workstation.findMany({
      where: this.ownOrUnassigned(scope),
      orderBy: [{ stage: 'asc' }, { code: 'asc' }],
      include: WORKSTATION_INCLUDE,
    });
    return rows.map((w) => this.toWorkstation(w));
  }

  async createWorkstation(dto: CreateWorkstationDto, userId?: string) {
    this.assertWorkstationShape(dto.stage, dto.kind, dto.processStep ?? null);
    const scope = await this.workshopScope.getScope(userId);
    // 13/11/2026: máy cắt BẮT BUỘC có loại (CHECK DB) - thiếu thì mặc định laser; loại khác không
    // được mang loại máy cắt.
    if (dto.kind !== WorkstationKind.CUT && dto.cutMachineType) {
      throw new BadRequestException('Chỉ máy cắt mới có loại máy cắt (MC Laser / MC Tự động)');
    }
    const cutMachineType =
      dto.kind === WorkstationKind.CUT ? (dto.cutMachineType ?? SolverMachine.laser) : null;
    const asked = dto.workshopId ? await this.assertWorkshopUsable(dto.workshopId) : null;
    this.workshopScope.assertCanManage(scope, [asked], 'xưởng chọn cho máy');
    const workshopId = asked ?? scope.workshopId;
    const code = dto.code.trim().toUpperCase();
    try {
      const created = await this.prisma.workstation.create({
        data: {
          code,
          // 21/11/2026: màn bỏ ô "Tên gọi" - không gửi tên thì tên = mã.
          name: dto.name?.trim() || code,
          stage: dto.stage,
          kind: dto.kind,
          processStep: dto.kind === WorkstationKind.STEP ? dto.processStep : null,
          cutMachineType,
          workshopId,
          qrToken: newQrToken(),
        },
        include: WORKSTATION_INCLUDE,
      });
      return this.toWorkstation(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Mã điểm làm việc ${code} đã có`);
      }
      throw e;
    }
  }

  async updateWorkstation(id: string, dto: UpdateWorkstationDto, userId?: string) {
    const current = await this.findWorkstationOrThrow(id);
    const scope = await this.workshopScope.getScope(userId);
    this.workshopScope.assertCanManage(scope, [current.workshopId], 'máy này');
    if (dto.cutMachineType !== undefined && current.kind !== WorkstationKind.CUT) {
      throw new BadRequestException('Chỉ máy cắt mới đổi được loại máy cắt');
    }
    // workshopId: undefined = giữ nguyên, null = bỏ xưởng, chuỗi = đổi xưởng (phải đang hoạt động).
    let workshopId: bigint | null | undefined;
    if (dto.workshopId === null) {
      if (scope.workshopId != null) {
        throw new ForbiddenException(
          'QLSX gắn xưởng không bỏ xưởng của máy được - nhờ người phụ trách chung đổi',
        );
      }
      workshopId = null;
    } else if (dto.workshopId !== undefined) {
      workshopId = await this.assertWorkshopUsable(dto.workshopId);
      this.workshopScope.assertCanManage(scope, [workshopId], 'xưởng chọn cho máy');
    }
    // 21/11/2026: đổi mã ngắn - tên gọi đổi theo mã (màn chỉ còn hiện mã). Mã QR giữ nguyên.
    const code = dto.code?.trim().toUpperCase();
    const data = {
      code,
      name: code ?? dto.name?.trim(),
      isActive: dto.isActive,
      cutMachineType: dto.cutMachineType,
      workshopId,
    };
    const machineId = parseBigIntId(id);
    try {
      return await this.applyWorkstationUpdate(current, machineId, data, dto, workshopId, userId);
    } catch (e) {
      if (code && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Mã điểm làm việc ${code} đã có`);
      }
      throw e;
    }
  }

  private async applyWorkstationUpdate(
    current: Awaited<ReturnType<FloorAdminService['findWorkstationOrThrow']>>,
    machineId: bigint,
    data: Prisma.WorkstationUncheckedUpdateInput,
    dto: UpdateWorkstationDto,
    workshopId: bigint | null | undefined,
    userId?: string,
  ) {
    // Máy cắt tắt / đổi xưởng: phần việc đã chia cho máy bị xoá cùng lúc (về "Chưa chia"), vì máy
    // tắt hay xưởng khác thì dòng chia không còn đúng chỗ.
    const switchedOff = dto.isActive === false && current.isActive;
    const movedWorkshop = workshopId !== undefined && workshopId !== current.workshopId;
    // Bật lại máy cắt: lúc máy tắt các dòng chia còn sót là dòng cũ (máy rảnh có thể đã chia lại số cây đó
    // cho máy khác) nên dọn khi bật lại.
    const switchedOn = dto.isActive === true && !current.isActive;
    if (current.kind === WorkstationKind.CUT && current.workshopId != null) {
      if (switchedOff || movedWorkshop || switchedOn) {
        const oldWorkshopId = current.workshopId;
        const note = switchedOff
          ? 'Máy cắt bị tắt'
          : movedWorkshop
            ? 'Máy cắt đổi xưởng'
            : 'Dọn dòng cũ khi bật lại máy';
        const updated = await this.prisma.$transaction(async (tx) => {
          await lockBusinessKey(tx, `cut-allocation:${oldWorkshopId}`);
          await this.dropMachineAllocations(tx, machineId, note, userId);
          return tx.workstation.update({
            where: { id: machineId },
            data,
            include: WORKSTATION_INCLUDE,
          });
        }, CUT_LOCK_TX_OPTIONS);
        return this.toWorkstation(updated);
      }
    }
    const updated = await this.prisma.workstation.update({
      where: { id: machineId },
      data,
      include: WORKSTATION_INCLUDE,
    });
    return this.toWorkstation(updated);
  }

  /** Xoá mọi dòng chia của 1 máy cắt, mỗi dòng ghi 1 dòng nhật ký REMOVE kèm lý do. */
  private async dropMachineAllocations(
    tx: PrismaTx,
    machineId: bigint,
    note: string,
    userId?: string,
  ): Promise<void> {
    const rows = await tx.cutAllocation.findMany({
      where: { workstationId: machineId },
      include: { pattern: { select: { bundles: true } } },
    });
    if (rows.length === 0) return;
    await tx.cutAllocationLog.createMany({
      data: rows.map((r) => ({
        workshopId: r.workshopId,
        productionInvoiceId: r.productionInvoiceId,
        cutAllocationId: r.id,
        patternId: r.patternId,
        action: CutAllocationLogAction.REMOVE,
        fromWorkstationId: r.workstationId,
        barCount: r.barCount,
        isBundle: r.pattern.bundles != null,
        note,
        createdById: userId ?? null,
      })),
    });
    await tx.cutAllocation.deleteMany({ where: { workstationId: machineId } });
  }

  /** Đổi mã QR (tem mất / bị chụp lại mang đi chỗ khác) - tem cũ quét ra "mã không còn dùng". */
  async regenerateWorkstationToken(id: string, userId?: string) {
    const current = await this.findWorkstationOrThrow(id);
    this.workshopScope.assertCanManage(
      await this.workshopScope.getScope(userId),
      [current.workshopId],
      'máy này',
    );
    const updated = await this.prisma.workstation.update({
      where: { id: parseBigIntId(id) },
      data: { qrToken: newQrToken() },
      include: WORKSTATION_INCLUDE,
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

  /** Xưởng gán cho máy phải tồn tại và đang hoạt động; trả id số để ghi. */
  private async assertWorkshopUsable(workshopId: string): Promise<bigint> {
    const wid = parseBigIntId(workshopId);
    const ws = await this.prisma.workshop.findUnique({
      where: { id: wid },
      select: { id: true, isActive: true },
    });
    if (!ws) throw new BadRequestException(`Xưởng ${workshopId} không tồn tại`);
    if (!ws.isActive)
      throw new BadRequestException('Xưởng này đã ngừng hoạt động, không gán máy vào được');
    return wid;
  }

  /** Lọc máy/công nhân: QLSX gắn xưởng -> của xưởng mình + chưa khai xưởng; không gắn -> tất cả. */
  private ownOrUnassigned(scope: WorkshopScope) {
    return scope.workshopId != null
      ? { OR: [{ workshopId: scope.workshopId }, { workshopId: null }] }
      : {};
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
    workshopId?: bigint | null;
    cutMachineType?: SolverMachine | null;
    workshop?: { name: string } | null;
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
      workshopId: w.workshopId != null ? w.workshopId.toString() : null,
      workshopName: w.workshop?.name ?? null,
      cutMachineType: w.cutMachineType ?? null,
    };
  }

  // ─── Tài khoản công nhân ─────────────────────────────────────────────────────
  // User thường, role FLOOR_WORKER, tổ = mfgRole, cùng warehouseScope 'phoi-son-han' như tài khoản thống kê
  // cũ (finishProductionBatch trừ tồn đoạn theo scope). QLSX chỉ sửa được tài khoản mang role này.

  /** X4 16/11: cùng quy tắc xưởng như máy - xem listWorkstations. */
  async listWorkers(userId?: string) {
    const scope = await this.workshopScope.getScope(userId);
    const rows = await this.prisma.user.findMany({
      where: {
        ...this.ownOrUnassigned(scope),
        deletedAt: null,
        roles: { some: { role: { name: BUSINESS_ROLES.FLOOR_WORKER } } },
      },
      orderBy: [{ mfgRole: 'asc' }, { username: 'asc' }],
      select: WORKER_SELECT,
    });
    return rows.map((u) => this.toWorker(u));
  }

  async createWorker(dto: CreateFloorWorkerDto, userId?: string) {
    const scope = await this.workshopScope.getScope(userId);
    const role = await this.prisma.role.findUnique({
      where: { name: BUSINESS_ROLES.FLOOR_WORKER },
    });
    if (!role) {
      throw new ConflictException('Chưa có vai trò FLOOR_WORKER - chạy seed (npm run seed) trước');
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
          // X4: công nhân QLSX gắn xưởng tạo thuộc xưởng đó (quét QR cũng theo xưởng này).
          workshopId: scope.workshopId,
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

  async updateWorker(id: string, dto: UpdateFloorWorkerDto, userId?: string) {
    await this.findWorkerOrThrow(id, userId);
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
  async resetWorkerPin(id: string, userId?: string) {
    await this.findWorkerOrThrow(id, userId);
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
  async unlockWorker(id: string, userId?: string) {
    await this.findWorkerOrThrow(id, userId);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null },
      select: WORKER_SELECT,
    });
    return this.toWorker(updated);
  }

  /** Có `actorId` thì kiểm thêm công nhân thuộc xưởng người thao tác (hoặc chưa khai xưởng). */
  private async findWorkerOrThrow(id: string, actorId?: string) {
    const u = await this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
        roles: { some: { role: { name: BUSINESS_ROLES.FLOOR_WORKER } } },
      },
      select: { id: true, workshopId: true },
    });
    if (!u) throw new NotFoundException(`Không có tài khoản công nhân ${id}`);
    if (actorId) {
      this.workshopScope.assertCanManage(
        await this.workshopScope.getScope(actorId),
        [u.workshopId],
        'công nhân này',
      );
    }
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

  /** Tiến độ của tổ trên 1 PI - xem `progressFrom`. */
  async computeProgress(stage: MfgStage, productionInvoiceId: bigint): Promise<FloorProgress> {
    return progressFrom(await this.loadStageData(stage, productionInvoiceId));
  }

  /**
   * Ngăn "còn thiếu gì" của thẻ PI (mục 45.4): tiến độ + ĐÚNG dữ liệu gốc đã dùng để tính (phoi-progress, batch-plan
   * theo SKU) để FE dựng bảng chi tiết bằng bảng sẵn có mà số không lệch thẻ. Mở được cho PI đang chạy, đang chờ
   * (xem trước đã nhận sắt chưa) hay đã xong (bù lỗi) - chỉ cần PI đã có lệnh sản xuất.
   */
  async stageDetail(stage: FloorWorkerStage, productionInvoiceIdRaw: string) {
    const productionInvoiceId = parseBigIntId(productionInvoiceIdRaw);
    const pi = await this.prisma.productionInvoice.findUnique({
      where: { id: productionInvoiceId },
      select: { id: true, code: true },
    });
    if (!pi) throw new NotFoundException('Không tìm thấy PI');
    const data = await this.loadStageData(stage, productionInvoiceId);
    return {
      productionInvoiceId: pi.id.toString(),
      piCode: pi.code,
      stage,
      progress: progressFrom(data),
      orders: data.orders,
      phoi: data.phoi,
      plans: data.plans,
    };
  }

  /** Tải 1 lần dữ liệu tiến độ của tổ trên PI (dùng chung cho thẻ PI, nhắc "đủ số" và ngăn chi tiết). */
  private async loadStageData(stage: MfgStage, productionInvoiceId: bigint): Promise<StageData> {
    let phoi: PhoiItems | null = null;
    if (stage === MfgStage.PHOI) {
      const key = productionInvoiceId.toString();
      const batch = await this.steelIssues.getPhoiProgressBatch([key]);
      // Batch BỎ PI lỗi khỏi kết quả (không trả rỗng) - thiếu khoá thì báo lỗi, đừng coi là "không có việc".
      const items = batch[key];
      if (!items) throw new Error(`Không tính được tiến độ Phôi của PI ${key}`);
      phoi = items;
    }
    // Huỷ lệnh theo SKU (23/11/2026): bỏ lệnh đã huỷ - không thì tổ không bao giờ "đủ số" (phoiDoneAt không được ghi).
    const orderRows = await this.prisma.productionOrder.findMany({
      where: { productionInvoiceItem: { productionInvoiceId }, ...NOT_CANCELLED_ORDER },
      select: { id: true, wireMaterial: true, cushionMaterial: true },
      orderBy: { id: 'asc' },
    });
    const plans =
      orderRows.length > 0
        ? await this.productionBatches.getBatchPlanBatch(
            orderRows.map((o) => o.id.toString()),
            stage,
          )
        : {};
    const choiceById = new Map(orderRows.map((o) => [o.id.toString(), o]));
    const orders = Object.entries(plans).map(([id, plan]) => {
      const row = choiceById.get(id);
      return {
        productionOrderId: id,
        poNumber: plan.poNumber,
        productName: plan.productName,
        wireMaterial: row?.wireMaterial ? toMaterialChoiceRef(row.wireMaterial) : null,
        cushionMaterial: row?.cushionMaterial ? toMaterialChoiceRef(row.cushionMaterial) : null,
      };
    });
    return { phoi, plans, orders };
  }

  /**
   * Số đỏ menu "Sản lượng xưởng" theo tổ (P1, 18/11/2026): { open, awaitingKcs, stale } - cùng nguồn kcs-pending với số
   * đỏ menu KCS và tin chờ lâu, DÒNG BỊ CHẶN (lệnh dừng / chưa gắn SKU) không đếm.
   * - open: đợt đang mở CÓ sổ báo (đợt cắt, nhóm công đoạn phụ, lô mảnh) - khớp danh sách QLSX; pat / chân nhôm không có
   *   sổ báo nên không đếm ở đây.
   * - awaitingKcs: đợt KCS đã chốt, chưa chấm xong (cả 5 loại).
   * - stale: mọi đợt chưa chấm (đang mở + đã chốt, cả 5 loại) có mốc chờ quá KCS_STALE_HOURS giờ.
   * X4 16/11: QLSX gắn xưởng chỉ đếm đợt của xưởng mình (filterByQueueWorkshop) - khớp danh sách FloorReviewService.listOpen().
   */
  async summary(userId?: string, now: Date = new Date()) {
    const scope = await this.workshopScope.getScope(userId);
    const items = await listKcsPendingItems(this.prisma);
    const staleBefore = now.getTime() - KCS_STALE_HOURS * 3_600_000;
    const out: Record<
      'PHOI' | 'HAN' | 'SON',
      { open: number; awaitingKcs: number; stale: number }
    > = {
      PHOI: { open: 0, awaitingKcs: 0, stale: 0 },
      HAN: { open: 0, awaitingKcs: 0, stale: 0 },
      SON: { open: 0, awaitingKcs: 0, stale: 0 },
    };
    for (const stage of ['PHOI', 'HAN', 'SON'] as const) {
      const ofStage = items.filter((i) => i.stage === stage && !i.blockedReason);
      const rows = await filterByQueueWorkshop(
        this.prisma,
        scope.workshopId,
        MfgStage[stage],
        ofStage,
        (i) => i.productionInvoiceId,
      );
      for (const i of rows) {
        if (i.state === 'AWAITING_QC') out[stage].awaitingKcs += 1;
        else if (i.kind === 'CUT' || i.kind === 'STEP' || i.kind === 'PIECE_BATCH') {
          out[stage].open += 1;
        }
        if (i.waitingSince.getTime() < staleBefore) out[stage].stale += 1;
      }
    }
    return out;
  }

  /**
   * "Xong Phôi" TỰ TÍNH (Sếp chốt 14/11, câu 8; đổi nơi lưu 23/11/2026): FloorAlertsService gọi khi mọi dòng tổ Phôi của lệnh
   * đã KCS đạt đủ - không ai bấm. Ghi `phoiDoneAt` nếu còn trống (UPDATE có điều kiện nên gọi chồng không ghi đè mốc cũ).
   * Trả true khi vừa ghi.
   */
  async autoCompletePhoi(productionInvoiceId: bigint, now: Date = new Date()): Promise<boolean> {
    const { count } = await this.prisma.productionInvoice.updateMany({
      where: { id: productionInvoiceId, phoiDoneAt: null },
      data: { phoiDoneAt: now },
    });
    return count === 1;
  }
}
