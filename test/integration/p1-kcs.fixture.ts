import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module';
import {
  BomRevisionStatus,
  CutBundleStatus,
  FloorReportKind,
  MfgStage,
  PieceStepBundleStatus,
  ProcessStep,
  ProductionBatchStatus,
  ProductionOrderFloorStage,
  StepBundleStatus,
  SteelIssueStatus,
  StockLedgerRefType,
  WarehouseKind,
  WorkshopCapacityMode,
} from '../../src/generated/prisma/client';
import { FloorAlertsService } from '../../src/modules/floor/floor-alerts.service';
import { FloorReviewService } from '../../src/modules/floor/floor-review.service';
import { MaterialYieldRecipeProductionService } from '../../src/modules/material-yield-recipes/material-yield-recipe-production.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ProductionBatchesService } from '../../src/modules/production-batches/production-batches.service';
import { QcReviewsService } from '../../src/modules/qc-reviews/qc-reviews.service';
import { StockLedgerService } from '../../src/modules/stock/stock-ledger.service';
import { SteelIssuesService } from '../../src/modules/steel-issues/steel-issues.service';
import { CloudinaryService } from '../../src/modules/uploads/cloudinary.service';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { RealtimeService } from '../../src/realtime/realtime.service';
import { TEST_DATABASE_URL } from '../test-db.constants';

/**
 * Dữ liệu thử + công cụ chung cho các test tích hợp gói P1 "KCS tự chuyển" (18/11/2026).
 *
 * - `createHarness()` dựng Nest từ AppModule thật (KHÔNG gọi init nên không có lượt nền / socket), thay Realtime và Cloudinary bằng bản giả.
 *   Các hàm CHƯA có trong code (FloorReviewService.close*, QcReviewsService nhận shortQty / scrapQty, notes) được gọi qua kiểu cấu trúc
 *   `P1Api` bên dưới: khi code chưa có thì test đỏ với "is not a function", không làm vỡ biên dịch.
 * - `raceWith()` chép theo test/integration/n1-nhom1.integration.spec.ts: kết nối `pg` thứ hai giữ khoá chưa commit, gọi hàm service
 *   (không await), đợi tới khi thấy backend khác CHỜ khoá thật, rồi COMMIT. Thêm `ordered` (ép thứ tự thắng theo hàng đợi khoá) và
 *   `doneBeforeRelease` (lời gọi nào đã xong khi khoá còn giữ = không bị khoá chặn).
 * - `P1World` dựng dữ liệu bằng Prisma (hậu tố riêng, tự dọn): xưởng + kho, sắt + cỡ đoạn, định mức, PI / SKU, đợt đã báo kiểu cũ.
 */

// ---------------------------------------------------------------------------------------------
// Kiểu cấu trúc cho phần chưa có trong code (hợp đồng v2)
// ---------------------------------------------------------------------------------------------

export interface P1Dto {
  id: string;
  status: string;
  [key: string]: unknown;
}

export interface P1ReviewDto {
  id: string;
  failedQty?: number;
  shortQty?: number;
  notes?: string[];
  [key: string]: unknown;
}

export interface P1CutReviewInput {
  segments: { segmentSpecId: string; failedQty: number; shortQty?: number; scrapQty?: number }[];
  reason?: string;
  defectReasonId?: string;
}

export interface P1QtyReviewInput {
  failedQty: number;
  shortQty?: number;
  reason?: string;
  defectReasonId?: string;
}

export interface P1Api {
  closeCutBundle(id: string, actorId: string): Promise<P1Dto>;
  closeStepGroup(
    dto: {
      productionInvoiceId: string;
      materialId: string;
      step: ProcessStep;
      productionOrderId: string | null;
      workerId: string | null;
    },
    actorId: string,
  ): Promise<P1Dto>;
  closeProductionBatch(id: string, actorId: string): Promise<P1Dto>;
  closePieceStepGroup(
    dto: { productionOrderId: string; pieceId: string; step: ProcessStep },
    actorId: string,
  ): Promise<P1Dto>;
  closeMaterialYieldGroup(
    dto: { productionInvoiceId: string; recipeId: string; step: ProcessStep },
    actorId: string,
  ): Promise<P1Dto>;
  reviewCutBundle(id: string, dto: P1CutReviewInput, actorId: string): Promise<P1ReviewDto>;
  reviewStepBundle(id: string, dto: P1CutReviewInput, actorId: string): Promise<P1ReviewDto>;
  reviewProductionBatch(id: string, dto: P1QtyReviewInput, actorId: string): Promise<P1ReviewDto>;
  reviewPieceStep(id: string, dto: P1QtyReviewInput, actorId: string): Promise<P1ReviewDto>;
  reviewMaterialYieldStep(id: string, dto: P1QtyReviewInput, actorId: string): Promise<P1ReviewDto>;
  /** Lô mảnh gửi KCS qua bút toán gom nút "Gửi KCS" của tài khoản thống kê (pat) - route cũ giữ lại. */
  submitPieceStep(
    productionOrderId: string,
    dto: { pieceId: string; step: ProcessStep },
    actorId: string,
    role: string,
  ): Promise<P1Dto>;
  submitMaterialYieldStep(
    productionInvoiceId: string,
    dto: { recipeId: string; step: ProcessStep },
    actorId: string,
    role: string,
  ): Promise<P1Dto>;
}

export interface P1Harness {
  moduleRef: TestingModule;
  prisma: PrismaServiceType;
  steel: SteelIssuesService;
  batches: ProductionBatchesService;
  qc: QcReviewsService;
  review: FloorReviewService;
  alerts: FloorAlertsService;
  ledger: StockLedgerService;
  notifications: NotificationsService;
  api: P1Api;
  /** Các lần gọi NotificationsService.emit đã ghi (loại tin, tuỳ chọn). */
  emitCalls: () => Array<{ type: string; options: Record<string, unknown> }>;
  clearEmits: () => void;
  close: () => Promise<void>;
}

/** `realEmit: true` = emit ghi tin thật xuống DB (IT4); mặc định chỉ ghi nhận lời gọi, không ghi DB. */
export async function createHarness(opts: { realEmit?: boolean } = {}): Promise<P1Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RealtimeService)
    .useValue({
      publishEntityChanged: jest.fn(),
      publishNotificationCreated: jest.fn(),
      publishNotificationChanged: jest.fn(),
    })
    .overrideProvider(CloudinaryService)
    .useValue({})
    .compile();
  const get = <T>(token: new (...args: never[]) => T): T => moduleRef.get(token, { strict: false });
  const notifications = get(NotificationsService);
  const emitSpy = jest.spyOn(notifications, 'emit');
  if (!opts.realEmit) emitSpy.mockResolvedValue(undefined);

  const review = get(FloorReviewService);
  const qc = get(QcReviewsService);
  const batches = get(ProductionBatchesService);
  const myield = get(MaterialYieldRecipeProductionService);
  const pending = {
    review: review as unknown as Pick<
      P1Api,
      | 'closeCutBundle'
      | 'closeStepGroup'
      | 'closeProductionBatch'
      | 'closePieceStepGroup'
      | 'closeMaterialYieldGroup'
    >,
    qc: qc as unknown as Pick<
      P1Api,
      | 'reviewCutBundle'
      | 'reviewStepBundle'
      | 'reviewProductionBatch'
      | 'reviewPieceStep'
      | 'reviewMaterialYieldStep'
    >,
  };
  const api: P1Api = {
    closeCutBundle: (id, actor) => pending.review.closeCutBundle(id, actor),
    closeStepGroup: (dto, actor) => pending.review.closeStepGroup(dto, actor),
    closeProductionBatch: (id, actor) => pending.review.closeProductionBatch(id, actor),
    closePieceStepGroup: (dto, actor) => pending.review.closePieceStepGroup(dto, actor),
    closeMaterialYieldGroup: (dto, actor) => pending.review.closeMaterialYieldGroup(dto, actor),
    reviewCutBundle: (id, dto, actor) => pending.qc.reviewCutBundle(id, dto, actor),
    reviewStepBundle: (id, dto, actor) => pending.qc.reviewStepBundle(id, dto, actor),
    reviewProductionBatch: (id, dto, actor) => pending.qc.reviewProductionBatch(id, dto, actor),
    reviewPieceStep: (id, dto, actor) => pending.qc.reviewPieceStep(id, dto, actor),
    reviewMaterialYieldStep: (id, dto, actor) => pending.qc.reviewMaterialYieldStep(id, dto, actor),
    // Nút "Gửi KCS" của tài khoản thống kê Phôi: route cũ, vẫn còn (hàm có sẵn trong code).
    submitPieceStep: (orderId, dto, actor, role) =>
      batches.submitPieceStep(orderId, dto, actor, role) as unknown as Promise<P1Dto>,
    submitMaterialYieldStep: (piId, dto, actor, role) =>
      myield.submitStep(piId, dto, actor, role) as unknown as Promise<P1Dto>,
  };

  return {
    moduleRef,
    prisma: get(PRISMA_SERVICE as never),
    steel: get(SteelIssuesService),
    batches,
    qc,
    review,
    alerts: get(FloorAlertsService),
    ledger: get(StockLedgerService),
    notifications,
    api,
    emitCalls: () =>
      emitSpy.mock.calls.map((c) => ({
        type: c[0],
        options: (c[1] ?? {}) as Record<string, unknown>,
      })),
    clearEmits: () => emitSpy.mockClear(),
    close: async () => {
      emitSpy.mockRestore();
      await moduleRef.close();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Giữ khoá ở kết nối thứ hai (chép theo n1-nhom1 :236-302, thêm ordered / doneBeforeRelease)
// ---------------------------------------------------------------------------------------------

function dbUrl(): string {
  const u = new URL(TEST_DATABASE_URL);
  u.search = '';
  return u.toString();
}

export interface Outcome {
  ok: boolean;
  value?: unknown;
  error?: unknown;
  /** Đã thấy đủ số backend chờ khoá thật (xem RaceOptions.minWaiting) trước khi nhả khoá. */
  waited: boolean;
  /** Lời gọi đã xong khi khoá CÒN giữ = không bị khoá này chặn. */
  doneBeforeRelease: boolean;
}

export interface RaceOptions {
  /** Số backend phải thấy đang chờ khoá; mặc định = số lời gọi. */
  minWaiting?: number;
  /** Bắt đầu từng lời gọi theo thứ tự, mỗi lời gọi phải thấy đang chờ trước khi bắt đầu lời gọi kế (khoá xếp hàng FIFO). */
  ordered?: boolean;
  /** Lời gọi chạy sau khi giữ khoá và TRƯỚC khi nhả (vd kết nối thứ hai xoá dòng như reverseStep làm). */
  beforeRelease?: (client: Client) => Promise<void>;
}

/**
 * Tìm vai theo tên KỂ CẢ dòng đã xoá mềm (extension của PrismaService biến deleteMany thành xoá mềm, nên bộ test
 * trước để lại dòng `deletedAt` và `create` sau đó dính unique name). Có dòng xoá mềm: khôi phục và coi như do test tạo.
 */
export async function ensureRoleRow(
  prisma: PrismaServiceType,
  name: string,
): Promise<{ id: string; created: boolean }> {
  const rows = await prisma.$queryRaw<{ id: string; deletedAt: Date | null }[]>`
    SELECT "id", "deletedAt" FROM "roles" WHERE "name" = ${name}`;
  if (rows.length > 0) {
    if (rows[0].deletedAt === null) return { id: rows[0].id, created: false };
    await prisma.$executeRaw`UPDATE "roles" SET "deletedAt" = NULL WHERE "id" = ${rows[0].id}`;
    return { id: rows[0].id, created: true };
  }
  const role = await prisma.role.create({ data: { name, description: 'p1 test' } });
  return { id: role.id, created: true };
}

/** Xoá CỨNG các vai do test tạo (kèm liên kết quyền / người dùng) để không để lại dòng xoá mềm. */
export async function purgeRoleRows(prisma: PrismaServiceType, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.$executeRaw`DELETE FROM "role_permissions" WHERE "roleId" = ANY(${ids}::text[])`;
  await prisma.$executeRaw`DELETE FROM "user_roles" WHERE "roleId" = ANY(${ids}::text[])`;
  await prisma.$executeRaw`DELETE FROM "roles" WHERE "id" = ANY(${ids}::text[])`;
}

export const lockSql = (key: string): string =>
  `SELECT pg_advisory_xact_lock(hashtext('${key}')::bigint)`;

export const rowLockSql = (table: string, id: bigint | string): string =>
  `SELECT 1 FROM "${table}" WHERE "id" = ${id.toString()} FOR UPDATE`;

export async function raceWith(
  prisma: PrismaServiceType,
  holdSql: string[],
  calls: Array<() => Promise<unknown>>,
  opts: RaceOptions = {},
): Promise<Outcome[]> {
  const minWaiting = opts.minWaiting ?? calls.length;
  const client = new Client({ connectionString: dbUrl() });
  await client.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const holderPid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
      .rows[0].pid;
    for (const sql of holdSql) await client.query(sql);

    const waitingCount = async (): Promise<number> => {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> ${holderPid}::int
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'`;
      return Number(rows[0]?.n ?? 0);
    };
    const done: boolean[] = calls.map(() => false);
    const start = (i: number) =>
      calls[i]().then(
        (value): Pick<Outcome, 'ok' | 'value'> => {
          done[i] = true;
          return { ok: true, value };
        },
        (error: unknown): Pick<Outcome, 'ok' | 'error'> => {
          done[i] = true;
          return { ok: false, error };
        },
      );
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const deadline = Date.now() + 8000;

    const pending: Array<ReturnType<typeof start>> = [];
    if (opts.ordered) {
      for (let i = 0; i < calls.length; i += 1) {
        pending.push(start(i));
        while (!done[i] && (await waitingCount()) < i + 1 && Date.now() < deadline) await sleep(25);
      }
    } else {
      for (let i = 0; i < calls.length; i += 1) pending.push(start(i));
    }
    let waited = false;
    while (Date.now() < deadline) {
      if (done.every(Boolean)) break;
      const waiting = await waitingCount();
      if (waiting >= minWaiting) {
        waited = true;
        // Lời gọi không bị khoá chặn còn đang chạy dở: chờ tới khi MỌI lời gọi hoặc đã xong hoặc đang chờ khoá,
        // nếu không `doneBeforeRelease` đo nhầm tốc độ chứ không đo việc có bị khoá chặn.
        if (done.filter(Boolean).length + waiting >= calls.length) break;
      }
      await sleep(25);
    }
    if (opts.beforeRelease) await opts.beforeRelease(client);
    const doneBeforeRelease = [...done];
    await client.query('COMMIT');
    committed = true;
    const results = await Promise.all(pending);
    return results.map((r, i) => ({ ...r, waited, doneBeforeRelease: doneBeforeRelease[i] }));
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

export const msg = (e: unknown): string => (e as { message?: string }).message ?? String(e);

export const httpStatus = (e: unknown): number | undefined =>
  e instanceof HttpException ? e.getStatus() : undefined;

/** Tách kết quả cuộc đua 2 lời gọi: đúng 1 thành công + 1 lỗi (khẳng định luôn). */
export function oneWinner(out: Outcome[]): { winner: Outcome; loser: Outcome } {
  const ok = out.filter((o) => o.ok);
  const bad = out.filter((o) => !o.ok);
  if (ok.length !== 1 || bad.length !== 1) {
    throw new Error(
      `Cần đúng 1 lời gọi thành công + 1 lỗi, thực tế ${ok.length} thành công / ${bad.length} lỗi: ${bad
        .map((b) => msg(b.error))
        .join(' | ')}`,
    );
  }
  return { winner: ok[0], loser: bad[0] };
}

/** Không ca nào được trả 500 / P2034 / 40P01 (luật chung mục 6 kế hoạch test). */
export function expectNoServerFault(out: Outcome[]): void {
  for (const o of out) {
    if (o.ok) continue;
    const text = msg(o.error);
    expect(text).not.toMatch(/P2034|40P01|deadlock|Internal server error/i);
    const status = httpStatus(o.error);
    if (status !== undefined) expect(status).toBeLessThan(500);
  }
}

// ---------------------------------------------------------------------------------------------
// Dữ liệu thử
// ---------------------------------------------------------------------------------------------

export interface World {
  piId: bigint;
  code: string;
  itemIds: bigint[];
  orderIds: bigint[];
}

export interface WorkshopRef {
  id: bigint;
  name: string;
  phoiWhId: bigint;
  phoiWhCode: string;
  hanWhId: bigint;
}

interface Ids {
  users: string[];
  workshops: bigint[];
  warehouses: bigint[];
  materials: bigint[];
  specs: bigint[];
  pis: bigint[];
  items: bigint[];
  orders: bigint[];
  pieces: bigint[];
  recipes: bigint[];
  roles: string[];
}

/**
 * Dữ liệu dùng chung 1 file test. Định mức (1 bản BOM) cố định:
 *  - mảnh CUT  : cỡ 441 (Cắt) + cỡ 355 (Cắt, Uốn)  - sắt `steelId`, mỗi cỡ cần = số lượng của SKU.
 *  - mảnh HAN  : cỡ 1000 + cỡ 1200 (không công đoạn) - sắt `hanSteelId`, tổ Hàn, cần = số lượng của SKU.
 *  - mảnh HAN4 : 4 cỡ (AC40), tổ Hàn.
 *  - mảnh PHOI : không định mức đoạn, tổ Phôi (create() của tài khoản thống kê).
 *  - mảnh PAT  : vật tư tự tính (tấm sắt la), công đoạn Cắt -> Dập.
 *  - công thức CHÂN NHÔM: công đoạn Cắt, kho đầu ra riêng.
 */
export class P1World {
  readonly ids: Ids = {
    users: [],
    workshops: [],
    warehouses: [],
    materials: [],
    specs: [],
    pis: [],
    items: [],
    orders: [],
    pieces: [],
    recipes: [],
    roles: [],
  };
  /** Bản định mức phụ do test dựng thêm (xoá sau khi xoá lệnh / mảnh dùng nó). */
  readonly extraBomRevisionIds: bigint[] = [];
  private seq = 0;
  private createdVirtualCodes: string[] = [];
  mfgProductId!: bigint;
  bomRevisionId!: bigint;

  workerA!: string;
  workerB!: string;
  kcsA!: string;
  kcsB!: string;
  qlsx!: string;
  admin!: string;

  steelId!: bigint;
  hanSteelId!: bigint;
  plateId!: bigint;
  aluInId!: bigint;
  aluOutId!: bigint;
  spec441!: bigint;
  spec355!: bigint;
  specH1!: bigint;
  specH2!: bigint;
  specM!: bigint[];
  pieceCut!: bigint;
  pieceHan!: bigint;
  pieceHan4!: bigint;
  piecePhoi!: bigint;
  piecePat!: bigint;
  recipeId!: bigint;
  /** Xưởng mặc định của world (kho Phôi / Hàn riêng, để SEGMENT_CONSUME ghi vào kho này). */
  ws!: WorkshopRef;
  supplierWhId!: bigint;
  productionWhId!: bigint;
  outWhId!: bigint;
  /** Lý do lỗi dùng chung (20/11/2026, T4-5: chấm có phần không đạt thì bắt buộc nguyên nhân). */
  defectReasonId!: bigint;

  constructor(
    readonly h: Pick<P1Harness, 'prisma' | 'ledger'>,
    readonly sfx: string | number,
  ) {}

  private get prisma(): PrismaServiceType {
    return this.h.prisma;
  }

  code(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.sfx}-${this.seq}`;
  }

  async makeUser(tag: string, extra: { workshopId?: bigint; roles?: string[] } = {}) {
    const u = await this.prisma.user.create({
      data: {
        username: this.code(`p1${tag}`),
        password: 'x',
        firstName: 'P1',
        lastName: tag,
        ...(extra.workshopId ? { workshopId: extra.workshopId } : {}),
      },
    });
    this.ids.users.push(u.id);
    for (const roleName of extra.roles ?? []) {
      const role = await this.ensureRole(roleName);
      await this.prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
    }
    return u.id;
  }

  /** Vai có sẵn thì dùng; chưa có thì tạo và nhớ để dọn đúng phần mình tạo (DB test có thể chưa seed vai). */
  async ensureRole(name: string) {
    const { id, created } = await ensureRoleRow(this.prisma, name);
    if (created) this.ids.roles.push(id);
    return this.prisma.role.findUniqueOrThrow({ where: { id } });
  }

  async makeWorkshop(tag: string): Promise<WorkshopRef> {
    const ws = await this.prisma.workshop.create({
      data: {
        code: this.code(`WS${tag}`),
        name: `Xuong test ${tag} ${this.sfx}`,
        capacityMode: WorkshopCapacityMode.CONT_PER_DAY,
      },
    });
    this.ids.workshops.push(ws.id);
    const phoi = await this.prisma.warehouse.create({
      data: {
        code: this.code(`PHOI${tag}`),
        name: `Kho Phoi ${tag}`,
        kind: WarehouseKind.PHOI,
        workshopId: ws.id,
      },
    });
    const han = await this.prisma.warehouse.create({
      data: {
        code: this.code(`HAN${tag}`),
        name: `Kho Han ${tag}`,
        kind: WarehouseKind.HAN,
        workshopId: ws.id,
      },
    });
    this.ids.warehouses.push(phoi.id, han.id);
    return { id: ws.id, name: ws.name, phoiWhId: phoi.id, phoiWhCode: phoi.code, hanWhId: han.id };
  }

  private async virtualWarehouse(code: string): Promise<bigint> {
    const existing = await this.prisma.warehouse.findUnique({ where: { code } });
    if (existing) return existing.id;
    this.createdVirtualCodes.push(code);
    return (await this.prisma.warehouse.create({ data: { code, name: code, isVirtual: true } })).id;
  }

  async init(): Promise<void> {
    const p = this.prisma;
    this.workerA = await this.makeUser('wa');
    this.workerB = await this.makeUser('wb');
    this.kcsA = await this.makeUser('kcsa');
    this.kcsB = await this.makeUser('kcsb');
    this.qlsx = await this.makeUser('qlsx');
    this.admin = await this.makeUser('admin');
    this.defectReasonId = (await p.defectReason.create({ data: { label: this.code('LOI') } })).id;
    this.ws = await this.makeWorkshop('A');
    this.supplierWhId = await this.virtualWarehouse('SUPPLIER');
    this.productionWhId = await this.virtualWarehouse('PRODUCTION');
    const out = await p.warehouse.create({
      data: { code: this.code('OUT'), name: 'Kho dau ra chan nhom' },
    });
    this.ids.warehouses.push(out.id);
    this.outWhId = out.id;

    const mat = async (tag: string, extra: { warehouseId?: bigint } = {}) => {
      const m = await p.material.create({
        data: { code: this.code(`P1-${tag}`), name: `VT ${tag}`, unit: 'cai', ...extra },
      });
      this.ids.materials.push(m.id);
      return m.id;
    };
    this.steelId = await mat('SAT');
    this.hanSteelId = await mat('SATHAN');
    this.plateId = await mat('SATLA');
    this.aluInId = await mat('NHOM');
    this.aluOutId = await mat('CHANNHOM', { warehouseId: this.outWhId });
    const spec = async (materialId: bigint, mm: number) => {
      const s = await p.segmentSpec.create({ data: { materialId, cutLengthMm: mm } });
      this.ids.specs.push(s.id);
      return s.id;
    };
    this.spec441 = await spec(this.steelId, 441);
    this.spec355 = await spec(this.steelId, 355);
    this.specH1 = await spec(this.hanSteelId, 1000);
    this.specH2 = await spec(this.hanSteelId, 1200);
    this.specM = [
      await spec(this.hanSteelId, 601),
      await spec(this.hanSteelId, 602),
      await spec(this.hanSteelId, 603),
      await spec(this.hanSteelId, 604),
    ];

    this.mfgProductId = (
      await p.mfgProduct.create({ data: { factoryCode: this.code('P1SKU'), name: 'SP P1' } })
    ).id;
    this.bomRevisionId = (
      await p.bomRevision.create({
        data: { mfgProductId: this.mfgProductId, revNo: 1, status: BomRevisionStatus.DRAFT },
      })
    ).id;
    const piece = async (tag: string, flags: { needsHan: boolean; needsSon?: boolean }) => {
      const pc = await p.piece.create({
        data: {
          mfgProductId: this.mfgProductId,
          code: this.code(tag),
          groupNumber: 1,
          pieceNumber: this.seq,
          name: `Manh ${tag}`,
        },
      });
      this.ids.pieces.push(pc.id);
      await p.bomPiece.create({
        data: {
          bomRevisionId: this.bomRevisionId,
          pieceId: pc.id,
          qtyPerUnit: 1,
          needsHan: flags.needsHan,
          needsSon: flags.needsSon ?? false,
        },
      });
      return pc.id;
    };
    const bom = (pieceId: bigint, segmentSpecId: bigint, steps: ProcessStep[]) =>
      p.pieceBom.create({
        data: {
          bomRevisionId: this.bomRevisionId,
          mfgProductId: this.mfgProductId,
          pieceId,
          segmentSpecId,
          qtyPerPiece: 1,
          processSteps: steps,
        },
      });
    const pieceCut = await piece('CUT', { needsHan: false });
    this.pieceCut = pieceCut;
    await bom(pieceCut, this.spec441, [ProcessStep.CAT]);
    await bom(pieceCut, this.spec355, [ProcessStep.CAT, ProcessStep.UON]);
    this.pieceHan = await piece('HAN', { needsHan: true });
    await bom(this.pieceHan, this.specH1, []);
    await bom(this.pieceHan, this.specH2, []);
    this.pieceHan4 = await piece('HAN4', { needsHan: true });
    for (const s of this.specM) await bom(this.pieceHan4, s, []);
    this.piecePhoi = await piece('PHOI', { needsHan: false });
    this.piecePat = await piece('PAT', { needsHan: false });
    await p.pieceMaterialYield.create({
      data: {
        bomRevisionId: this.bomRevisionId,
        mfgProductId: this.mfgProductId,
        pieceId: this.piecePat,
        materialId: this.plateId,
        piecesPerBar: 10,
        qtyPerPiece: 1,
        processSteps: [ProcessStep.CAT, ProcessStep.DAP],
      },
    });
    const recipe = await p.materialYieldRecipe.create({
      data: {
        outputMaterialId: this.aluOutId,
        inputMaterialId: this.aluInId,
        piecesPerBar: 5,
        processSteps: [ProcessStep.CAT],
      },
    });
    this.ids.recipes.push(recipe.id);
    this.recipeId = recipe.id;
  }

  /**
   * Bản định mức PHỤ (cùng sản phẩm, số bản khác) chỉ có mảnh Cắt với các dòng sắt cho trước - để dựng SKU có định mức khác
   * bản chung (vd SKU không có cỡ 355). Tự dọn cùng world.
   */
  async makeBomRevision(
    revNo: number,
    lines: { specId: bigint; steps: ProcessStep[] }[],
  ): Promise<bigint> {
    const rev = await this.prisma.bomRevision.create({
      data: { mfgProductId: this.mfgProductId, revNo, status: BomRevisionStatus.DRAFT },
    });
    this.extraBomRevisionIds.push(rev.id);
    await this.prisma.bomPiece.create({
      data: {
        bomRevisionId: rev.id,
        pieceId: this.pieceCut,
        qtyPerUnit: 1,
        needsHan: false,
        needsSon: false,
      },
    });
    for (const l of lines) {
      await this.prisma.pieceBom.create({
        data: {
          bomRevisionId: rev.id,
          mfgProductId: this.mfgProductId,
          pieceId: this.pieceCut,
          segmentSpecId: l.specId,
          qtyPerPiece: 1,
          processSteps: l.steps,
        },
      });
    }
    return rev.id;
  }

  /** PI + 1..n SKU. `quantities[i]` = số lượng SKU thứ i (cần Cắt / Uốn / Hàn của SKU = số này). */
  async newInvoice(
    opts: {
      quantities?: number[];
      workshopId?: bigint | null;
      floorStage?: ProductionOrderFloorStage;
      /** Bản định mức riêng từng SKU (mặc định mọi SKU dùng bản chung của world). */
      bomRevisionIds?: bigint[];
    } = {},
  ): Promise<World> {
    const p = this.prisma;
    const quantities = opts.quantities ?? [100];
    const workshopId = opts.workshopId === undefined ? this.ws.id : opts.workshopId;
    const pi = await p.productionInvoice.create({ data: { code: this.code('P1PI') } });
    this.ids.pis.push(pi.id);
    const itemIds: bigint[] = [];
    const orderIds: bigint[] = [];
    for (const [index, quantity] of quantities.entries()) {
      const item = await p.productionInvoiceItem.create({
        data: {
          productionInvoiceId: pi.id,
          mfgProductId: this.mfgProductId,
          quantity,
          ...(workshopId ? { workshopId } : {}),
        },
      });
      this.ids.items.push(item.id);
      itemIds.push(item.id);
      const order = await p.productionOrder.create({
        data: {
          poNumber: this.code('P1PO'),
          productionInvoiceItemId: item.id,
          mfgProductId: this.mfgProductId,
          bomRevisionId: opts.bomRevisionIds?.[index] ?? this.bomRevisionId,
          quantity,
          floorStage: opts.floorStage ?? ProductionOrderFloorStage.ACTIVE,
        },
      });
      this.ids.orders.push(order.id);
      orderIds.push(order.id);
    }
    return { piId: pi.id, code: pi.code, itemIds, orderIds };
  }

  async newIssue(piId: bigint, materialId: bigint = this.steelId): Promise<bigint> {
    const issue = await this.prisma.steelIssue.create({
      data: {
        productionInvoiceId: piId,
        materialId,
        barLengthMm: 6000,
        barCount: 100,
        issuedById: this.admin,
        status: SteelIssueStatus.RECEIVED,
        receivedAt: new Date(),
        receivedById: this.workerA,
        receivedBarCount: 100,
      },
    });
    return issue.id;
  }

  // ---------- dựng đợt ĐÃ BÁO (kiểu dữ liệu sau khi công nhân báo) ----------

  async seedCutBundle(
    issueId: bigint,
    w: World,
    opts: {
      orderId?: bigint | null;
      segs: { specId: bigint; qty: number }[];
      status?: CutBundleStatus;
      openedById?: string | null;
      withReport?: boolean;
      reportAt?: Date;
    },
  ): Promise<{ bundleId: bigint; reportId: bigint | null }> {
    const orderId = opts.orderId === undefined ? w.orderIds[0] : opts.orderId;
    const bundle = await this.prisma.cutBundle.create({
      data: {
        steelIssueId: issueId,
        productionOrderId: orderId,
        openedById: opts.openedById === undefined ? this.workerA : opts.openedById,
        status: opts.status ?? CutBundleStatus.CUTTING,
        completedSteps: [ProcessStep.CAT],
        ...(opts.status && opts.status !== CutBundleStatus.CUTTING
          ? { completedAt: new Date() }
          : {}),
        segments: { create: opts.segs.map((s) => ({ segmentSpecId: s.specId, qty: s.qty })) },
      },
    });
    let reportId: bigint | null = null;
    if (opts.withReport ?? true) {
      reportId = (
        await this.prisma.floorReport.create({
          data: {
            kind: FloorReportKind.CUT,
            reportedById: opts.openedById ?? this.workerA,
            cutBundleId: bundle.id,
            productionInvoiceId: w.piId,
            ...(opts.reportAt ? { createdAt: opts.reportAt } : {}),
            lines: { create: opts.segs.map((s) => ({ segmentSpecId: s.specId, qty: s.qty })) },
          },
        })
      ).id;
    }
    return { bundleId: bundle.id, reportId };
  }

  /** 1 lần báo công đoạn phụ (StepBatch). `bundleId` có = đã gom vào đợt. */
  async seedStepBatch(
    w: World,
    opts: {
      step: ProcessStep;
      segs: { specId: bigint; qty: number }[];
      orderId?: bigint | null;
      reportedById?: string | null;
      bundleId?: bigint | null;
      withReport?: boolean;
      createdAt?: Date;
    },
  ): Promise<{ batchId: bigint; reportId: bigint | null }> {
    const orderId = opts.orderId === undefined ? w.orderIds[0] : opts.orderId;
    const worker = opts.reportedById === undefined ? this.workerA : opts.reportedById;
    const batch = await this.prisma.stepBatch.create({
      data: {
        productionInvoiceId: w.piId,
        materialId: this.steelId,
        step: opts.step,
        productionOrderId: orderId,
        reportedById: worker,
        stepBundleId: opts.bundleId ?? null,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        segments: { create: opts.segs.map((s) => ({ segmentSpecId: s.specId, qty: s.qty })) },
      },
    });
    let reportId: bigint | null = null;
    if ((opts.withReport ?? true) && worker) {
      reportId = (
        await this.prisma.floorReport.create({
          data: {
            kind: FloorReportKind.STEP,
            reportedById: worker,
            stepBatchId: batch.id,
            productionInvoiceId: w.piId,
            ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
            lines: { create: opts.segs.map((s) => ({ segmentSpecId: s.specId, qty: s.qty })) },
          },
        })
      ).id;
    }
    return { batchId: batch.id, reportId };
  }

  async seedStepBundle(
    w: World,
    opts: {
      step: ProcessStep;
      orderId?: bigint | null;
      workerId?: string | null;
      status?: StepBundleStatus;
    },
  ): Promise<bigint> {
    const orderId = opts.orderId === undefined ? w.orderIds[0] : opts.orderId;
    return (
      await this.prisma.stepBundle.create({
        data: {
          productionInvoiceId: w.piId,
          materialId: this.steelId,
          step: opts.step,
          status: opts.status ?? StepBundleStatus.AWAITING_QC,
          submittedById: this.qlsx,
          productionOrderId: orderId,
          reportedById: opts.workerId === undefined ? this.workerA : opts.workerId,
        },
      })
    ).id;
  }

  /** Số đoạn một công đoạn phụ đã tính xong (đợt QC_PASSED, không lỗi) - để dựng "đã tính" / giới hạn vật lý. */
  async seedStepDone(w: World, step: ProcessStep, specId: bigint, qty: number, orderId?: bigint) {
    const bundleId = await this.seedStepBundle(w, {
      step,
      orderId: orderId ?? w.orderIds[0],
      status: StepBundleStatus.QC_PASSED,
    });
    await this.seedStepBatch(w, {
      step,
      segs: [{ specId, qty }],
      orderId: orderId ?? w.orderIds[0],
      bundleId,
      withReport: false,
    });
    return bundleId;
  }

  /** Đã cắt xong (QC_PASSED, không lỗi) `qty` đoạn cỡ `specId` cho SKU - nền cho giới hạn vật lý của công đoạn phụ. */
  async seedCutDone(issueId: bigint, w: World, specId: bigint, qty: number, orderId?: bigint) {
    return this.seedCutBundle(issueId, w, {
      orderId: orderId ?? w.orderIds[0],
      segs: [{ specId, qty }],
      status: CutBundleStatus.QC_PASSED,
      withReport: false,
    });
  }

  async seedPieceBatch(
    w: World,
    opts: {
      pieceId: bigint;
      stage: MfgStage;
      qty: number;
      status?: ProductionBatchStatus;
      reportedById?: string;
      orderId?: bigint;
      withReport?: boolean;
      reportAt?: Date;
    },
  ): Promise<{ batchId: bigint; reportId: bigint | null }> {
    const worker = opts.reportedById ?? this.workerA;
    const batch = await this.prisma.productionBatch.create({
      data: {
        stage: opts.stage,
        productionOrderId: opts.orderId ?? w.orderIds[0],
        pieceId: opts.pieceId,
        reportedQty: opts.qty,
        status: opts.status ?? ProductionBatchStatus.OPEN,
        reportedById: worker,
        ...(opts.reportAt ? { reportedAt: opts.reportAt } : {}),
      },
    });
    let reportId: bigint | null = null;
    if (opts.withReport ?? true) {
      reportId = (
        await this.prisma.floorReport.create({
          data: {
            kind: FloorReportKind.PIECE,
            reportedById: worker,
            productionBatchId: batch.id,
            productionInvoiceId: w.piId,
            ...(opts.reportAt ? { createdAt: opts.reportAt } : {}),
            lines: { create: [{ pieceId: opts.pieceId, qty: opts.qty }] },
          },
        })
      ).id;
    }
    return { batchId: batch.id, reportId };
  }

  /** Nhóm pat: 1 lần báo chưa gom (bundleId null) hoặc đã gom. Trả id đợt gom nếu `bundled`. */
  async seedPieceStep(
    w: World,
    opts: {
      step: ProcessStep;
      qty: number;
      bundled?: PieceStepBundleStatus;
      createdAt?: Date;
    },
  ): Promise<bigint | null> {
    const orderId = w.orderIds[0];
    let bundleId: bigint | null = null;
    if (opts.bundled) {
      bundleId = (
        await this.prisma.pieceStepBundle.create({
          data: {
            productionOrderId: orderId,
            pieceId: this.piecePat,
            step: opts.step,
            qty: opts.qty,
            status: opts.bundled,
            submittedById: this.qlsx,
          },
        })
      ).id;
    }
    await this.prisma.pieceStepBatch.create({
      data: {
        productionOrderId: orderId,
        pieceId: this.piecePat,
        step: opts.step,
        qty: opts.qty,
        pieceStepBundleId: bundleId,
        reportedById: this.workerA,
        ...(opts.createdAt ? { reportedAt: opts.createdAt } : {}),
      },
    });
    return bundleId;
  }

  async seedMaterialYield(
    w: World,
    opts: {
      step: ProcessStep;
      qty: number;
      bundled?: PieceStepBundleStatus;
      createdAt?: Date;
    },
  ): Promise<bigint | null> {
    let bundleId: bigint | null = null;
    if (opts.bundled) {
      bundleId = (
        await this.prisma.materialYieldStepBundle.create({
          data: {
            productionInvoiceId: w.piId,
            recipeId: this.recipeId,
            step: opts.step,
            qty: opts.qty,
            status: opts.bundled,
            submittedById: this.qlsx,
          },
        })
      ).id;
    }
    await this.prisma.materialYieldStepBatch.create({
      data: {
        productionInvoiceId: w.piId,
        recipeId: this.recipeId,
        step: opts.step,
        qty: opts.qty,
        materialYieldStepBundleId: bundleId,
        reportedById: this.workerA,
        ...(opts.createdAt ? { reportedAt: opts.createdAt } : {}),
      },
    });
    return bundleId;
  }

  /** Cho kho Phôi của xưởng world có `qty` đoạn (cỡ, bộ công đoạn rỗng) - phần dư dùng được cho lô Hàn. */
  async stockSegment(specId: bigint, qty: number, warehouseId: bigint = this.ws.phoiWhId) {
    await this.h.ledger.postEntry({
      fromWarehouseId: this.supplierWhId,
      toWarehouseId: warehouseId,
      segmentSpecId: specId,
      segmentSteps: '',
      qty,
      refType: StockLedgerRefType.OPENING_BALANCE,
      refId: `p1-open-${this.sfx}-${specId}`,
      idempotencyKey: `p1-open-${this.sfx}-${warehouseId}-${specId}-${this.nextKey()}`,
    });
  }

  private keyCounter = 0;
  nextKey(): string {
    this.keyCounter += 1;
    return `${Date.now()}-${this.keyCounter}`;
  }

  // ---------- đọc lại ----------

  /** Dòng qc_reviews (kể cả cột shortQty mới, đọc bằng SQL thô vì schema.prisma chưa có trước BE-0). */
  async qcReviews(where: {
    cutBundleId?: bigint;
    stepBundleId?: bigint;
    productionBatchId?: bigint;
    pieceStepBundleId?: bigint;
    materialYieldStepBundleId?: bigint;
  }): Promise<Array<{ id: bigint; failedQty: number; shortQty: number }>> {
    const [col, id] = Object.entries(where)[0];
    return this.prisma.$queryRawUnsafe<Array<{ id: bigint; failedQty: number; shortQty: number }>>(
      `SELECT "id", "failedQty", "shortQty" FROM "qc_reviews" WHERE "${col}" = ${id.toString()} ORDER BY "id"`,
    );
  }

  async ledgerCount(refType: StockLedgerRefType, refId: string): Promise<number> {
    return this.prisma.stockLedger.count({ where: { refType, refId } });
  }

  async userIdsWithRole(roleName: string): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { roles: { some: { role: { name: roleName } } }, id: { in: this.ids.users } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // ---------- dọn ----------

  async cleanup(): Promise<void> {
    const p = this.prisma;
    const { pis, orders, specs, pieces, materials, users, workshops, warehouses, recipes, roles } =
      this.ids;
    const piIn = { in: pis };
    const orderIn = { in: orders };
    const has = (a: unknown[]) => a.length > 0;
    if (has(pis)) {
      const qcWhere = {
        OR: [
          { cutBundle: { steelIssue: { productionInvoiceId: piIn } } },
          { stepBundle: { productionInvoiceId: piIn } },
          { productionBatch: { productionOrderId: orderIn } },
          { pieceStepBundle: { productionOrderId: orderIn } },
          { materialYieldStepBundle: { productionInvoiceId: piIn } },
        ],
      };
      // thông báo: chỉ tin gửi cho người dùng test hoặc tin theo khoá '<tổ>:<id xưởng>' của xưởng test (không đụng tin của dữ liệu khác)
      const entityIds = workshops.flatMap((id) => [`PHOI:${id}`, `HAN:${id}`, `SON:${id}`]);
      await p.notification.deleteMany({
        where: {
          OR: [
            { entityId: { in: entityIds } },
            { recipients: { some: { userId: { in: users } } } },
          ],
        },
      });
      await p.auditLog.deleteMany({ where: { userId: { in: users } } });
      await p.floorReportLine.deleteMany({ where: { floorReport: { productionInvoiceId: piIn } } });
      await p.floorReport.deleteMany({ where: { productionInvoiceId: piIn } });
      await p.qcReviewSegment.deleteMany({ where: { qcReview: qcWhere } });
      await p.qcReview.deleteMany({ where: qcWhere });
      await p.segmentOverage.deleteMany({ where: { productionInvoiceId: piIn } });
      await p.segmentReservation.deleteMany({ where: { productionInvoiceId: piIn } });
      await p.segmentProduction.deleteMany({ where: { productionInvoiceId: piIn } });
      await p.pieceStepBatch.deleteMany({ where: { productionOrderId: orderIn } });
      await p.pieceStepBundle.deleteMany({ where: { productionOrderId: orderIn } });
      await p.materialYieldStepBatch.deleteMany({ where: { productionInvoiceId: piIn } });
      await p.materialYieldStepBundle.deleteMany({ where: { productionInvoiceId: piIn } });
      await p.productionBatch.deleteMany({ where: { productionOrderId: orderIn } });
      await p.stepBatchSegment.deleteMany({ where: { stepBatch: { productionInvoiceId: piIn } } });
      await p.stepBatch.deleteMany({ where: { productionInvoiceId: piIn } });
      await p.stepBundle.deleteMany({ where: { productionInvoiceId: piIn } });
      await p.cutPatternSegment.deleteMany({
        where: { cutBundle: { steelIssue: { productionInvoiceId: piIn } } },
      });
      await p.cutBundle.deleteMany({ where: { steelIssue: { productionInvoiceId: piIn } } });
      await p.steelIssue.deleteMany({ where: { productionInvoiceId: piIn } });
      await p.floorQueueEntry.deleteMany({ where: { productionInvoiceId: piIn } });
    }
    await p.stockLedger.deleteMany({
      where: {
        OR: [
          { segmentSpecId: { in: specs } },
          { pieceId: { in: pieces } },
          { materialId: { in: materials } },
        ],
      },
    });
    await p.stockQuant.deleteMany({
      where: {
        OR: [
          { segmentSpecId: { in: specs } },
          { pieceId: { in: pieces } },
          { materialId: { in: materials } },
        ],
      },
    });
    if (has(orders)) {
      await p.materialYieldIssue.deleteMany({ where: { productionOrderId: orderIn } });
      await p.productionOrder.deleteMany({ where: { id: orderIn } });
    }
    if (has(pis))
      await p.materialYieldRecipeIssue.deleteMany({ where: { productionInvoiceId: piIn } });
    if (has(this.ids.items)) {
      await p.productionInvoiceItem.deleteMany({ where: { id: { in: this.ids.items } } });
    }
    if (has(pis)) await p.productionInvoice.deleteMany({ where: { id: piIn } });
    if (has(recipes)) await p.materialYieldRecipe.deleteMany({ where: { id: { in: recipes } } });
    if (has(pieces)) {
      await p.pieceMaterialItem.deleteMany({ where: { pieceId: { in: pieces } } });
      await p.pieceMaterialYield.deleteMany({ where: { pieceId: { in: pieces } } });
      await p.pieceBom.deleteMany({ where: { pieceId: { in: pieces } } });
      await p.bomPiece.deleteMany({ where: { pieceId: { in: pieces } } });
      await p.piece.deleteMany({ where: { id: { in: pieces } } });
    }
    if (has(this.extraBomRevisionIds)) {
      await p.bomRevision.deleteMany({ where: { id: { in: this.extraBomRevisionIds } } });
    }
    if (this.bomRevisionId) await p.bomRevision.deleteMany({ where: { id: this.bomRevisionId } });
    if (this.mfgProductId) await p.mfgProduct.deleteMany({ where: { id: this.mfgProductId } });
    if (has(specs)) await p.segmentSpec.deleteMany({ where: { id: { in: specs } } });
    if (has(materials)) await p.material.deleteMany({ where: { id: { in: materials } } });
    if (has(warehouses)) await p.warehouse.deleteMany({ where: { id: { in: warehouses } } });
    if (has(this.createdVirtualCodes)) {
      await p.warehouse.deleteMany({ where: { code: { in: this.createdVirtualCodes } } });
    }
    if (this.defectReasonId)
      await p.defectReason.deleteMany({ where: { id: this.defectReasonId } });
    if (has(users)) await p.user.deleteMany({ where: { id: { in: users } } });
    if (has(workshops)) await p.workshop.deleteMany({ where: { id: { in: workshops } } });
    if (has(roles)) await purgeRoleRows(p, roles);
  }
}

/** Bật / tắt công tắc tồn đoạn trong 1 khối lệnh rồi trả lại giá trị cũ. */
export async function withSegmentStock<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.SEGMENT_STOCK_ENABLED;
  process.env.SEGMENT_STOCK_ENABLED = enabled ? 'true' : 'false';
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.SEGMENT_STOCK_ENABLED;
    else process.env.SEGMENT_STOCK_ENABLED = prev;
  }
}

export const PAST = (hoursAgo: number): Date => new Date(Date.now() - hoursAgo * 3_600_000);
