import { readFileSync } from 'fs';
import { join } from 'path';
import { ConflictException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { lockBusinessKey } from '../../src/common/utils/advisory-lock.util';
import configuration from '../../src/config/configuration';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  BomRevisionStatus,
  MaterialIssueStatus,
  MfgStage,
  ProductionOrderFloorStage,
  StockLedgerRefType,
  WarehouseKind,
} from '../../src/generated/prisma/client';
import { MaterialIssuesService } from '../../src/modules/material-issues/material-issues.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { SEGMENT_LEGACY_CONVERSION_LOCK } from '../../src/modules/segment-stock/segment-stock.config';
import {
  SEGMENT_STOCKTAKE_NOT_CONVERTED_MESSAGE,
  SegmentStocktakeService,
} from '../../src/modules/segment-stock/segment-stocktake.service';
import { StockLedgerService } from '../../src/modules/stock/stock-ledger.service';
import { StockReservationsService } from '../../src/modules/stock/stock-reservations.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PRISMA_SERVICE, PrismaServiceType } from '../../src/prisma/prisma.service';
import { RealtimeService } from '../../src/realtime/realtime.service';

/**
 * Gói P3 (18/11/2026), DB test thật (Postgres cổng 5433):
 *  A. Migration 20261118080000: phiếu vật tư Hàn / Sơn chờ nhận + tin cũ -> đã nhận + tin đóng; phiếu Phôi không bị đụng.
 *  B. Kho xuất vật tư Hàn / Sơn là đã nhận (mỗi phiếu 1 kho: dây hàn ở kho Hàn, bột sơn ở kho Sơn), receive() trả 409.
 *  C. Kiểm kê đoạn + sửa tồn có segmentSpecId: chặn khi 2 bảng đoạn theo lệnh cùng trống, chạy được khi đã chuyển đổi, khoá chung.
 * Dữ liệu tự dựng với hậu tố riêng, dọn ở afterAll. Thông báo / realtime là mock.
 */
const MIGRATION_DIR = '20261118080000_vat_tu_han_son_kho_xuat_la_da_nhan';
const ALREADY_RECEIVED =
  'Vật tư hàn / sơn: kho xác nhận phiếu xuất có chữ ký người nhận là đã nhận, không cần xác nhận nữa';
const OLD_PAGE = 'han-son-xac-nhan-vat-tu';
const reasonMessage = (e: unknown): string => (e as { message: string }).message;
const sleep = (ms: number) => new Promise<'pending'>((r) => setTimeout(() => r('pending'), ms));

describe('P3: vật tư Hàn / Sơn đã nhận + kiểm kê đoạn (integration, real Postgres)', () => {
  let prisma: PrismaServiceType;
  let issues: MaterialIssuesService;
  let stocktake: SegmentStocktakeService;
  let ledger: StockLedgerService;
  const notif = { emit: jest.fn(), resolve: jest.fn() };
  const realtime = { publishEntityChanged: jest.fn() };

  const sfx = Date.now();
  let userId: string;
  let userBId: string;
  let supplierWhId: bigint;
  let adjustWhId: bigint;
  let hanWhId: bigint;
  let sonWhId: bigint;
  let phoiWhId: bigint;
  let plainWhId: bigint;
  let plainWhCode: string;
  let mfgProductId: bigint;
  let bomRevisionId: bigint;
  let piId: bigint;
  let itemId: bigint;
  let orderId: bigint;
  let hanMatId: bigint;
  let sonMatId: bigint;
  let segMatId: bigint;
  let segSpecId: bigint;
  const createdWarehouseCodes: string[] = [];
  const ids = {
    notifications: [] as string[],
    materialIssues: [] as bigint[],
    steelIssues: [] as bigint[],
    materials: [] as bigint[],
  };

  async function upsertVirtualWarehouse(code: string): Promise<bigint> {
    const existing = await prisma.warehouse.findUnique({ where: { code } });
    if (existing) return existing.id;
    createdWarehouseCodes.push(code);
    return (await prisma.warehouse.create({ data: { code, name: code, isVirtual: true } })).id;
  }

  async function makeWarehouse(tag: string, kind: WarehouseKind | null): Promise<bigint> {
    const code = `p3-${tag}-${sfx}`;
    createdWarehouseCodes.push(code);
    return (await prisma.warehouse.create({ data: { code, name: `Kho ${tag}`, kind } })).id;
  }

  async function makeMaterial(tag: string, whId: bigint, onHand: number): Promise<bigint> {
    const m = await prisma.material.create({
      data: { code: `P3-${tag}-${sfx}`, name: `VT ${tag}`, unit: 'kg', warehouseId: whId },
    });
    ids.materials.push(m.id);
    if (onHand > 0) {
      await ledger.postEntry({
        fromWarehouseId: supplierWhId,
        toWarehouseId: whId,
        materialId: m.id,
        qty: onHand,
        refType: StockLedgerRefType.OPENING_BALANCE,
        refId: `p3-open-${tag}-${sfx}`,
        idempotencyKey: `p3-open-${tag}-${sfx}`,
      });
    }
    return m.id;
  }

  const stocktakeInput = (over: Partial<Parameters<SegmentStocktakeService['stocktake']>[0]>) => ({
    warehouseId: phoiWhId,
    segmentSpecId: segSpecId,
    segmentSteps: '',
    countedQty: 10,
    expectedCurrentQty: 0,
    note: 'dem thuc te',
    actorId: userId,
    warehouseScope: null as string | null,
    ...over,
  });

  const segQty = async (steps = '') =>
    Number(
      (
        await prisma.stockQuant.findFirst({
          where: { warehouseId: phoiWhId, segmentSpecId: segSpecId, segmentSteps: steps },
        })
      )?.qty ?? 0,
    );
  const segTablesCount = async () =>
    (await prisma.segmentReservation.count()) + (await prisma.segmentProduction.count());
  const clearMySegmentRows = async () => {
    await prisma.segmentReservation.deleteMany({ where: { productionInvoiceId: piId } });
    await prisma.segmentProduction.deleteMany({ where: { productionInvoiceId: piId } });
  };
  const mkReservation = (reserved = 4, consumed = 1) =>
    prisma.segmentReservation.create({
      data: {
        warehouseId: phoiWhId,
        productionInvoiceId: piId,
        segmentSpecId: segSpecId,
        segmentSteps: '',
        reservedQty: reserved,
        consumedQty: consumed,
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
          validationSchema: envValidationSchema,
        }),
        ClsModule.forRoot({ global: true }),
        PrismaModule,
      ],
      providers: [
        MaterialIssuesService,
        SegmentStocktakeService,
        StockLedgerService,
        StockReservationsService,
        { provide: NotificationsService, useValue: notif },
        { provide: RealtimeService, useValue: realtime },
      ],
    }).compile();
    prisma = moduleRef.get(PRISMA_SERVICE);
    issues = moduleRef.get(MaterialIssuesService);
    stocktake = moduleRef.get(SegmentStocktakeService);
    ledger = moduleRef.get(StockLedgerService);

    const mkUser = async (tag: string) =>
      (
        await prisma.user.create({
          data: { username: `p3-${tag}-${sfx}`, password: 'x', firstName: 'P3', lastName: tag },
        })
      ).id;
    userId = await mkUser('a');
    userBId = await mkUser('b');
    supplierWhId = await upsertVirtualWarehouse('SUPPLIER');
    await upsertVirtualWarehouse('PRODUCTION');
    adjustWhId = await upsertVirtualWarehouse('OPENING_BALANCE');
    hanWhId = await makeWarehouse('han', WarehouseKind.HAN);
    sonWhId = await makeWarehouse('son', WarehouseKind.SON);
    phoiWhId = await makeWarehouse('phoi', WarehouseKind.PHOI);
    plainWhId = await makeWarehouse('thanhpham', WarehouseKind.THANH_PHAM);
    plainWhCode = `p3-thanhpham-${sfx}`;

    mfgProductId = (
      await prisma.mfgProduct.create({ data: { factoryCode: `P3-${sfx}`, name: 'SP p3' } })
    ).id;
    bomRevisionId = (
      await prisma.bomRevision.create({
        data: { mfgProductId, revNo: 1, status: BomRevisionStatus.DRAFT },
      })
    ).id;
    piId = (await prisma.productionInvoice.create({ data: { code: `P3-PI-${sfx}` } })).id;
    itemId = (
      await prisma.productionInvoiceItem.create({
        data: { productionInvoiceId: piId, mfgProductId, quantity: 10 },
      })
    ).id;
    orderId = (
      await prisma.productionOrder.create({
        data: {
          poNumber: `P3-PO-${sfx}`,
          productionInvoiceItemId: itemId,
          mfgProductId,
          bomRevisionId,
          quantity: 10,
          floorStage: ProductionOrderFloorStage.ACTIVE,
        },
      })
    ).id;
    hanMatId = await makeMaterial('DAYHAN', hanWhId, 100);
    sonMatId = await makeMaterial('BOTSON', sonWhId, 100);
    await prisma.consumableBom.createMany({
      data: [
        { bomRevisionId, stage: MfgStage.HAN, materialId: hanMatId, qtyPerUnit: 1 },
        { bomRevisionId, stage: MfgStage.SON, materialId: sonMatId, qtyPerUnit: 1 },
      ],
    });
    segMatId = await makeMaterial('SAT', phoiWhId, 0);
    segSpecId = (
      await prisma.segmentSpec.create({ data: { materialId: segMatId, cutLengthMm: 450 } })
    ).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.notification.deleteMany({ where: { id: { in: ids.notifications } } });
    await prisma.steelIssue.deleteMany({ where: { id: { in: ids.steelIssues } } });
    await prisma.materialIssue.deleteMany({ where: { productionOrderId: orderId } });
    await prisma.segmentReservation.deleteMany({ where: { productionInvoiceId: piId } });
    await prisma.segmentProduction.deleteMany({ where: { productionInvoiceId: piId } });
    await prisma.consumableBom.deleteMany({ where: { bomRevisionId } });
    await prisma.stockLedger.deleteMany({
      where: {
        OR: [{ materialId: { in: ids.materials } }, { segmentSpecId: segSpecId }],
      },
    });
    await prisma.stockQuant.deleteMany({
      where: { OR: [{ materialId: { in: ids.materials } }, { segmentSpecId: segSpecId }] },
    });
    await prisma.segmentSpec.deleteMany({ where: { id: segSpecId } });
    await prisma.productionOrder.deleteMany({ where: { id: orderId } });
    await prisma.productionInvoiceItem.deleteMany({ where: { id: itemId } });
    await prisma.productionInvoice.deleteMany({ where: { id: piId } });
    await prisma.bomRevision.deleteMany({ where: { id: bomRevisionId } });
    await prisma.mfgProduct.deleteMany({ where: { id: mfgProductId } });
    await prisma.material.deleteMany({ where: { id: { in: ids.materials } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, userBId] } } });
    await prisma.warehouse.deleteMany({ where: { code: { in: createdWarehouseCodes } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    notif.emit.mockClear();
    notif.resolve.mockClear();
    realtime.publishEntityChanged.mockClear();
  });

  // ---------------------------------------------------------------- B. kho xuất là đã nhận
  describe('B. kho xuất vật tư Hàn / Sơn là đã nhận (mỗi phiếu 1 kho)', () => {
    it('xuất dây hàn (kho Hàn) và bột sơn (kho Sơn) đều ra RECEIVED, số nhận = số xuất, không có người nhận, không emit tin', async () => {
      const han = await issues.create(
        orderId.toString(),
        { stage: MfgStage.HAN, materialId: hanMatId.toString(), issuedQty: 3 },
        userId,
        null,
      );
      const son = await issues.create(
        orderId.toString(),
        { stage: MfgStage.SON, materialId: sonMatId.toString(), issuedQty: 4 },
        userId,
        null,
      );
      for (const [dto, qty] of [
        [han, 3],
        [son, 4],
      ] as const) {
        const row = await prisma.materialIssue.findUniqueOrThrow({ where: { id: BigInt(dto.id) } });
        expect(row.status).toBe(MaterialIssueStatus.RECEIVED);
        expect(Number(row.receivedQty)).toBe(qty);
        expect(row.receivedAt?.getTime()).toBe(row.issuedAt.getTime());
        expect(row.receivedById).toBeNull();
        expect(dto.status).toBe('RECEIVED');
      }
      expect(notif.emit).not.toHaveBeenCalled();
      expect(realtime.publishEntityChanged).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'MATERIAL_ISSUE', action: 'CREATED' }),
      );
      // Sổ kho vẫn ghi đúng kho của từng vật tư (mỗi vật tư 1 kho).
      const hanQuant = await prisma.stockQuant.findFirst({
        where: { warehouseId: hanWhId, materialId: hanMatId },
      });
      const sonQuant = await prisma.stockQuant.findFirst({
        where: { warehouseId: sonWhId, materialId: sonMatId },
      });
      expect(Number(hanQuant?.qty)).toBe(97);
      expect(Number(sonQuant?.qty)).toBe(96);
    });

    it('receive() dòng đã RECEIVED: 409 đúng câu mới, không đổi dòng, không resolve tin', async () => {
      const row = await prisma.materialIssue.findFirstOrThrow({
        where: { productionOrderId: orderId, materialId: hanMatId },
      });
      await expect(
        issues.receive(row.id.toString(), { receivedQty: 1 }, userBId, 'HAN'),
      ).rejects.toMatchObject({ status: 409, message: ALREADY_RECEIVED });
      const after = await prisma.materialIssue.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.receivedById).toBeNull();
      expect(Number(after.receivedQty)).toBe(3);
      expect(notif.resolve).not.toHaveBeenCalled();
    });

    it('đồng thời: 2 lần xuất cùng khoá (lệnh, công đoạn, vật tư) vượt định mức -> chỉ 1 thành công, tổng không vượt', async () => {
      // Định mức Hàn = 10, đã xuất 3 -> còn 7; 2 lệnh song song mỗi lệnh 5 -> đúng 1 đạt.
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          issues.create(
            orderId.toString(),
            { stage: MfgStage.HAN, materialId: hanMatId.toString(), issuedQty: 5 },
            userId,
            null,
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(reasonMessage(failed.reason)).toContain('vượt quá số lượng còn có thể xuất');
      const sum = await prisma.materialIssue.aggregate({
        where: { productionOrderId: orderId, materialId: hanMatId },
        _sum: { issuedQty: true },
      });
      expect(Number(sum._sum.issuedQty)).toBe(8);
    });

    it('dòng ISSUED sót (khe deploy) vẫn nhận được; 2 người nhận song song -> 1 đạt, 1 bị 409 câu mới', async () => {
      const left = await prisma.materialIssue.create({
        data: {
          stage: MfgStage.SON,
          productionOrderId: orderId,
          materialId: sonMatId,
          issuedQty: 2,
          issuedById: userId,
          status: MaterialIssueStatus.ISSUED,
        },
      });
      const results = await Promise.allSettled([
        issues.receive(left.id.toString(), { receivedQty: 2 }, userId, 'SON'),
        issues.receive(left.id.toString(), { receivedQty: 1 }, userBId, 'SON'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason).toBeInstanceOf(ConflictException);
      expect(reasonMessage(failed.reason)).toBe(ALREADY_RECEIVED);
      const after = await prisma.materialIssue.findUniqueOrThrow({ where: { id: left.id } });
      expect(after.status).toBe(MaterialIssueStatus.RECEIVED);
      expect([userId, userBId]).toContain(after.receivedById);
    });

    it('receive() sai tổ trên dòng ISSUED vẫn bị chặn 403 (hành vi cũ giữ nguyên)', async () => {
      const left = await prisma.materialIssue.create({
        data: {
          stage: MfgStage.HAN,
          productionOrderId: orderId,
          materialId: hanMatId,
          issuedQty: 1,
          issuedById: userId,
          status: MaterialIssueStatus.ISSUED,
        },
      });
      await expect(issues.receive(left.id.toString(), {}, userBId, 'SON')).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  // ---------------------------------------------------------------- A. migration
  describe('A. migration 20261118080000 trên dữ liệu dựng sẵn', () => {
    const statements = readFileSync(
      join(__dirname, '../../prisma/migrations', MIGRATION_DIR, 'migration.sql'),
      'utf8',
    )
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let issuedHanId: bigint;
    let issuedSonId: bigint;
    let shortReceivedId: bigint;
    let steelIssueId: bigint;
    let nOpen: string;
    let nOpenOtherPage: string;
    let nResolved: string;
    let nOtherType: string;
    const resolvedAtFixed = new Date('2026-11-10T03:00:00.000Z');
    const issuedAtHan = new Date('2026-11-12T01:02:03.000Z');

    const mkNotification = async (
      type: string,
      page: string,
      resolvedAt: Date | null,
    ): Promise<string> => {
      const n = await prisma.notification.create({
        data: {
          type,
          title: `p3 ${type}`,
          message: 'm',
          link: { module: 'production', page, params: { x: '1' } },
          recipients: { create: [{ userId, resolvedAt }] },
        },
      });
      ids.notifications.push(n.id);
      return n.id;
    };

    beforeAll(async () => {
      const mk = (stage: MfgStage, matId: bigint, issuedAt: Date) =>
        prisma.materialIssue.create({
          data: {
            stage,
            productionOrderId: orderId,
            materialId: matId,
            issuedQty: 7,
            issuedById: userId,
            issuedAt,
            status: MaterialIssueStatus.ISSUED,
          },
        });
      issuedHanId = (await mk(MfgStage.HAN, hanMatId, issuedAtHan)).id;
      issuedSonId = (await mk(MfgStage.SON, sonMatId, new Date('2026-11-13T05:00:00.000Z'))).id;
      shortReceivedId = (
        await prisma.materialIssue.create({
          data: {
            stage: MfgStage.HAN,
            productionOrderId: orderId,
            materialId: hanMatId,
            issuedQty: 10,
            issuedById: userId,
            status: MaterialIssueStatus.RECEIVED,
            receivedQty: 6,
            receivedAt: new Date('2026-11-14T00:00:00.000Z'),
            receivedById: userBId,
          },
        })
      ).id;
      steelIssueId = (
        await prisma.steelIssue.create({
          data: {
            productionInvoiceId: piId,
            materialId: segMatId,
            barLengthMm: 6000,
            barCount: 5,
            issuedById: userId,
          },
        })
      ).id;
      ids.steelIssues.push(steelIssueId);
      nOpen = await mkNotification('MATERIAL_ISSUE_TO_TEAM', OLD_PAGE, null);
      nOpenOtherPage = await mkNotification('MATERIAL_ISSUE_TO_TEAM', 'phoi-lenh-sx', null);
      nResolved = await mkNotification('MATERIAL_ISSUE_TO_TEAM', OLD_PAGE, resolvedAtFixed);
      nOtherType = await mkNotification('PIECES_TO_PAINT_PENDING', OLD_PAGE, null);
    });

    it('migration.sql có đúng 3 câu và không đụng schema', () => {
      expect(statements).toHaveLength(3);
      expect(statements.every((s) => s.toUpperCase().startsWith('UPDATE'))).toBe(true);
    });

    it('chạy nguyên văn: phiếu chờ nhận -> đã nhận; tin cũ đóng + đổi link; phiếu Phôi và tin loại khác không đổi', async () => {
      const before = await prisma.steelIssue.findUniqueOrThrow({ where: { id: steelIssueId } });
      for (const s of statements) await prisma.$executeRawUnsafe(s);

      for (const [id, issuedAt] of [
        [issuedHanId, issuedAtHan],
        [issuedSonId, undefined],
      ] as const) {
        const row = await prisma.materialIssue.findUniqueOrThrow({ where: { id } });
        expect(row.status).toBe(MaterialIssueStatus.RECEIVED);
        expect(Number(row.receivedQty)).toBe(7);
        expect(row.receivedAt?.getTime()).toBe(row.issuedAt.getTime());
        if (issuedAt) expect(row.receivedAt?.getTime()).toBe(issuedAt.getTime());
        expect(row.receivedById).toBeNull();
      }
      // Dòng đã nhận thiếu: giữ số nhận thiếu và người nhận.
      const short = await prisma.materialIssue.findUniqueOrThrow({
        where: { id: shortReceivedId },
      });
      expect(Number(short.receivedQty)).toBe(6);
      expect(short.receivedById).toBe(userBId);
      expect(short.receivedAt?.toISOString()).toBe('2026-11-14T00:00:00.000Z');
      // Phiếu Phôi (steel_issues) không bị đụng.
      const steel = await prisma.steelIssue.findUniqueOrThrow({ where: { id: steelIssueId } });
      expect(steel).toEqual(before);
      expect(steel.status).toBe('ISSUED');

      const rec = async (id: string) =>
        prisma.notificationRecipient.findFirstOrThrow({ where: { notificationId: id } });
      expect((await rec(nOpen)).resolvedAt).not.toBeNull();
      expect((await rec(nOpenOtherPage)).resolvedAt).not.toBeNull();
      expect((await rec(nResolved)).resolvedAt?.getTime()).toBe(resolvedAtFixed.getTime());
      const other = await rec(nOtherType);
      expect(other.resolvedAt).toBeNull();

      const page = async (id: string) =>
        (await prisma.notification.findUniqueOrThrow({ where: { id } })).link as {
          module: string;
          page: string;
          params: unknown;
        };
      expect(await page(nOpen)).toEqual({
        module: 'production',
        page: 'phoi-lenh-sx',
        params: { x: '1' },
      });
      expect((await page(nResolved)).page).toBe('phoi-lenh-sx');
      expect((await page(nOtherType)).page).toBe(OLD_PAGE);
    });

    it('chạy lại lượt 2: cả 3 câu trả 0 dòng, dữ liệu giữ nguyên', async () => {
      const snapshot = await prisma.materialIssue.findMany({
        where: { productionOrderId: orderId },
        orderBy: { id: 'asc' },
      });
      for (const s of statements) expect(await prisma.$executeRawUnsafe(s)).toBe(0);
      const again = await prisma.materialIssue.findMany({
        where: { productionOrderId: orderId },
        orderBy: { id: 'asc' },
      });
      expect(again).toEqual(snapshot);
    });

    it('sau migration không còn phiếu ISSUED nào và không còn tin mở loại MATERIAL_ISSUE_TO_TEAM (câu đếm sau deploy = 0)', async () => {
      const [{ n: issued }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*) AS n FROM "material_issues" WHERE "status"='ISSUED'`,
      );
      const [{ n: openTin }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*) AS n FROM "notification_recipients" nr JOIN "notifications" n ON n."id"=nr."notificationId" WHERE n."type"='MATERIAL_ISSUE_TO_TEAM' AND nr."resolvedAt" IS NULL`,
      );
      const [{ n: oldLink }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*) AS n FROM "notifications" WHERE "type"='MATERIAL_ISSUE_TO_TEAM' AND "link"->>'page'='${OLD_PAGE}'`,
      );
      expect([Number(issued), Number(openTin), Number(oldLink)]).toEqual([0, 0, 0]);
    });
  });

  // ---------------------------------------------------------------- C. kiểm kê đoạn
  describe('C. kiểm kê đoạn / sửa tồn đoạn', () => {
    it('C1 chưa chuyển đổi (2 bảng đoạn theo lệnh cùng trống): kiểm kê 409 đúng câu, không ghi sổ, không phát realtime', async () => {
      expect(await segTablesCount()).toBe(0); // điều kiện: DB test không còn dòng đoạn của suite khác
      await expect(stocktake.stocktake(stocktakeInput({ countedQty: 10 }))).rejects.toMatchObject({
        status: 409,
        message: SEGMENT_STOCKTAKE_NOT_CONVERTED_MESSAGE,
      });
      expect(await segQty()).toBe(0);
      expect(await prisma.stockLedger.count({ where: { segmentSpecId: segSpecId } })).toBe(0);
      expect(realtime.publishEntityChanged).not.toHaveBeenCalled();
    });

    it('C2 thứ tự kiểm: 400 bộ công đoạn / số đếm, 400 kho không phải Phôi, 403 phạm vi đều ra TRƯỚC câu 409 chưa chuyển đổi', async () => {
      await expect(
        stocktake.stocktake(stocktakeInput({ segmentSteps: 'DAP,UON' })),
      ).rejects.toMatchObject({
        status: 400,
      });
      await expect(stocktake.stocktake(stocktakeInput({ countedQty: -1 }))).rejects.toMatchObject({
        status: 400,
        message: 'Số đếm phải là số không âm',
      });
      await expect(
        stocktake.stocktake(stocktakeInput({ warehouseId: plainWhId })),
      ).rejects.toMatchObject({ status: 400, message: 'Chỉ kiểm kê đoạn ở kho Phôi' });
      await expect(
        stocktake.stocktake(stocktakeInput({ warehouseScope: plainWhCode })),
      ).rejects.toMatchObject({
        status: 403,
        message: 'Bạn chỉ kiểm kê được kho mình phụ trách',
      });
    });

    it('C3 sửa tồn POST /stock-ledger/adjust có segmentSpecId cũng bị chặn 409 cùng câu; không ghi sổ; chân vật tư không bị ảnh hưởng', async () => {
      await expect(
        ledger.adjust(
          {
            fromWarehouseId: adjustWhId.toString(),
            toWarehouseId: phoiWhId.toString(),
            segmentSpecId: segSpecId.toString(),
            qty: 5,
            note: 'sua tay',
          },
          `p3-adj-blocked-${sfx}`,
          userId,
          null,
        ),
      ).rejects.toMatchObject({ status: 409, message: SEGMENT_STOCKTAKE_NOT_CONVERTED_MESSAGE });
      expect(
        await prisma.stockLedger.count({ where: { idempotencyKey: `p3-adj-blocked-${sfx}` } }),
      ).toBe(0);
      expect(await segQty()).toBe(0);

      // Chân vật tư: sửa tăng 2 cho dây hàn vẫn chạy khi 2 bảng đoạn trống.
      await ledger.adjust(
        {
          fromWarehouseId: adjustWhId.toString(),
          toWarehouseId: hanWhId.toString(),
          materialId: hanMatId.toString(),
          qty: 2,
          stockLengthMm: 0,
          note: 'sua vat tu',
        },
        `p3-adj-mat-${sfx}`,
        userId,
        null,
      );
      const q = await prisma.stockQuant.findFirstOrThrow({
        where: { warehouseId: hanWhId, materialId: hanMatId },
      });
      expect(Number(q.qty)).toBe(94); // 100 - 3 - 5 (đợt xuất đã đạt ở nhóm B) + 2
    });

    it('C4 đã chuyển đổi (có dòng segment_reservations): kiểm kê ghi ADJUST, phát STOCK đúng 1 lần, trả heldQty', async () => {
      await mkReservation(4, 1);
      const res = await stocktake.stocktake(
        stocktakeInput({ countedQty: 10, expectedCurrentQty: 0 }),
      );
      expect(res).toMatchObject({ beforeQty: 0, countedQty: 10, deltaQty: 10, heldQty: 3 });
      expect(await segQty()).toBe(10);
      const entry = await prisma.stockLedger.findFirstOrThrow({
        where: { segmentSpecId: segSpecId },
      });
      expect(entry.refType).toBe(StockLedgerRefType.ADJUST);
      expect(entry.createdById).toBe(userId);
      expect(entry.fromWarehouseId).toBe(adjustWhId);
      expect(entry.toWarehouseId).toBe(phoiWhId);
      expect(realtime.publishEntityChanged).toHaveBeenCalledTimes(1);
      expect(realtime.publishEntityChanged).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'STOCK', action: 'ADJUSTED', actorId: userId }),
      );
    });

    it('C5 đếm khớp: không ghi sổ, không phát realtime; đếm giảm: ghi bút toán chiều ra', async () => {
      const entriesBefore = await prisma.stockLedger.count({ where: { segmentSpecId: segSpecId } });
      const same = await stocktake.stocktake(
        stocktakeInput({ countedQty: 10, expectedCurrentQty: 10 }),
      );
      expect(same.deltaQty).toBe(0);
      expect(await prisma.stockLedger.count({ where: { segmentSpecId: segSpecId } })).toBe(
        entriesBefore,
      );
      expect(realtime.publishEntityChanged).not.toHaveBeenCalled();

      const down = await stocktake.stocktake(
        stocktakeInput({ countedQty: 7, expectedCurrentQty: 10 }),
      );
      expect(down).toMatchObject({ beforeQty: 10, deltaQty: -3 });
      expect(await segQty()).toBe(7);
      const last = await prisma.stockLedger.findFirstOrThrow({
        where: { segmentSpecId: segSpecId },
        orderBy: { id: 'desc' },
      });
      expect(last.fromWarehouseId).toBe(phoiWhId);
      expect(last.toWarehouseId).toBe(adjustWhId);
      expect(Number(last.qty)).toBe(3);
    });

    it('C6 tồn đã đổi so với số thủ kho thấy: 409 "vừa đổi", không ghi', async () => {
      await expect(
        stocktake.stocktake(stocktakeInput({ countedQty: 20, expectedCurrentQty: 10 })),
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('vừa đổi (10 → 7)') as string,
      });
      expect(await segQty()).toBe(7);
    });

    it('C7 sửa tồn có segmentSpecId chạy được khi đã chuyển đổi; giảm quá tồn bị 400', async () => {
      await ledger.adjust(
        {
          fromWarehouseId: adjustWhId.toString(),
          toWarehouseId: phoiWhId.toString(),
          segmentSpecId: segSpecId.toString(),
          qty: 2,
          note: 'sua tay',
        },
        `p3-adj-ok-${sfx}`,
        userId,
        null,
      );
      expect(await segQty()).toBe(9);
      await expect(
        ledger.adjust(
          {
            fromWarehouseId: phoiWhId.toString(),
            toWarehouseId: adjustWhId.toString(),
            segmentSpecId: segSpecId.toString(),
            qty: 50,
            note: 'sua tay',
          },
          `p3-adj-neg-${sfx}`,
          userId,
          null,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(await segQty()).toBe(9);
    });

    it('C8 đồng thời: 2 kiểm kê cùng ô, cùng expectedCurrentQty -> 1 thành công, 1 bị 409 "vừa đổi"', async () => {
      const results = await Promise.allSettled([
        stocktake.stocktake(stocktakeInput({ countedQty: 5, expectedCurrentQty: 9 })),
        stocktake.stocktake(
          stocktakeInput({ countedQty: 6, expectedCurrentQty: 9, actorId: userBId }),
        ),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      expect(ok).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason).toBeInstanceOf(ConflictException);
      expect(reasonMessage(failed.reason)).toContain('vừa đổi');
      const winner = (ok[0] as PromiseFulfilledResult<{ countedQty: number }>).value.countedQty;
      expect(await segQty()).toBe(winner);
    });

    it('C9 chỉ có segment_productions (reservations trống) cũng coi là đã chuyển đổi', async () => {
      await clearMySegmentRows();
      await prisma.segmentProduction.create({
        data: {
          productionInvoiceId: piId,
          segmentSpecId: segSpecId,
          segmentSteps: 'UON',
          warehouseId: phoiWhId,
          heldQty: 1,
        },
      });
      const res = await stocktake.stocktake(
        stocktakeInput({ segmentSteps: 'UON', countedQty: 4, expectedCurrentQty: 0 }),
      );
      expect(res).toMatchObject({ beforeQty: 0, deltaQty: 4, heldQty: 0 });
      expect(await segQty('UON')).toBe(4);
    });

    it('C10 khoá dùng chung: lượt chuyển đổi giữ khoá độc quyền và ghi dữ liệu -> kiểm kê CHỜ rồi ghi được (số không bị xoá)', async () => {
      await clearMySegmentRows();
      expect(await segTablesCount()).toBe(0);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockedP = new Promise<void>((r) => (locked = r));
      const converter = prisma.$transaction(
        async (tx) => {
          await lockBusinessKey(tx, SEGMENT_LEGACY_CONVERSION_LOCK);
          locked();
          await gate;
          await tx.segmentReservation.create({
            data: {
              warehouseId: phoiWhId,
              productionInvoiceId: piId,
              segmentSpecId: segSpecId,
              segmentSteps: '',
              reservedQty: 1,
            },
          });
        },
        { timeout: 30_000 },
      );
      await lockedP;
      const pending = stocktake.stocktake(
        stocktakeInput({ countedQty: 12, expectedCurrentQty: await segQty() }),
      );
      expect(await Promise.race([pending.then(() => 'done'), sleep(1200)])).toBe('pending');
      release();
      await converter;
      await expect(pending).resolves.toMatchObject({ countedQty: 12 });
      expect(await segQty()).toBe(12);
    });

    it('C11 khoá dùng chung: lượt chuyển đổi kết thúc mà 2 bảng vẫn trống -> kiểm kê chờ xong rồi bị chặn 409', async () => {
      await clearMySegmentRows();
      await mkReservation(1, 0);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockedP = new Promise<void>((r) => (locked = r));
      const converter = prisma.$transaction(
        async (tx) => {
          await lockBusinessKey(tx, SEGMENT_LEGACY_CONVERSION_LOCK);
          locked();
          await tx.segmentReservation.deleteMany({ where: { productionInvoiceId: piId } });
          await gate;
        },
        { timeout: 30_000 },
      );
      await lockedP;
      const before = await segQty();
      const pending = stocktake.stocktake(
        stocktakeInput({ countedQty: 99, expectedCurrentQty: before }),
      );
      const settled = pending.then(
        () => 'ok',
        (e: { status?: number }) => `err${e.status}`,
      );
      expect(await Promise.race([settled, sleep(1200)])).toBe('pending');
      release();
      await converter;
      expect(await settled).toBe('err409');
      expect(await segQty()).toBe(before);
    });
  });
});
