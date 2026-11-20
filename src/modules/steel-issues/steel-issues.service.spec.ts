import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { assertWorkshopUnchanged, lockPisForIssue } from '../../common/utils/pi-workshop-lock.util';
import {
  CutBundleStatus,
  FloorReportKind,
  Prisma,
  ProcessStep,
  SteelIssueStatus,
} from '../../generated/prisma/client';
import { FLOOR_REPORT_REVERSED_REPLAY_MESSAGE } from '../../common/utils/floor-report.util';
import { IdempotencyKeyReusedException } from '../../common/utils/idempotency.util';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SteelIssuesService } from './steel-issues.service';
import { RealtimeService } from '../../realtime/realtime.service';

// Rà soát 14/11 CK6: khoá dòng lệnh chung với đổi xưởng (pi-workshop-lock.util) - mock ở đây để không xen vào thứ tự $queryRaw
// của các test cũ; hành vi khoá + so xưởng có test riêng (pi-workshop-lock.util.spec.ts và các ca "CK6" dưới).
jest.mock('../../common/utils/pi-workshop-lock.util', () => ({
  ...jest.requireActual<typeof import('../../common/utils/pi-workshop-lock.util')>(
    '../../common/utils/pi-workshop-lock.util',
  ),
  lockPisForIssue: jest.fn(() => Promise.resolve(new Map())),
  workshopsOfPis: jest.fn(() => Promise.resolve(new Map())),
  assertWorkshopUnchanged: jest.fn(),
}));

// Prisma trả Decimal cho cutLengthMm/solverBladeWidthMm (vd Decimal(7,1) = 452.7). Service gọi
// cả .toNumber() lẫn .toString() nên mock phải có đủ 2, không dùng number trần.
const decimal = (n: number) => ({ toNumber: () => n, toString: () => String(n) });

/** Câu SQL của 1 lời gọi tagged-template ($queryRaw) đã ghép phần Prisma.sql lồng nhau, kèm giá trị theo thứ tự. */
function flattenRaw(call: unknown[]): { text: string; values: unknown[] } {
  const strings = call[0] as readonly string[];
  const vals = call.slice(1);
  let text = '';
  const values: unknown[] = [];
  strings.forEach((str, i) => {
    text += str;
    if (i >= vals.length) return;
    const v = vals[i] as { sql?: string; values?: unknown[] } | null;
    if (v && typeof v === 'object' && typeof v.sql === 'string') {
      text += v.sql;
      values.push(...(v.values ?? []));
    } else {
      text += '?';
      values.push(v);
    }
  });
  return { text, values };
}

describe('SteelIssuesService', () => {
  let service: SteelIssuesService;
  let stockLedgerService: { postEntry: jest.Mock };
  let prisma: {
    steelIssue: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    floorReport: { create: jest.Mock; findUnique: jest.Mock; findFirst: jest.Mock };
    productionInvoice: { findUnique: jest.Mock; findMany: jest.Mock };
    auditLog: { create: jest.Mock };
    productionOrder: { findMany: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock };
    pieceBom: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    material: { findMany: jest.Mock; findUniqueOrThrow: jest.Mock; findUnique: jest.Mock };
    cuttingProposalLine: { findFirst: jest.Mock; findMany: jest.Mock };
    cutBundle: {
      create: jest.Mock;
      aggregate: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    cutPatternSegment: {
      findMany: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    qcReviewSegment: { findMany: jest.Mock };
    segmentSpec: { findMany: jest.Mock };
    stepBatch: {
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    stepBatchSegment: { findMany: jest.Mock };
    stepBundle: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    systemConfig: { findUnique: jest.Mock };
    stockReservation: { update: jest.Mock; findMany: jest.Mock };
    stockQuant: { findMany: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    productionInvoiceItem: { findFirst: jest.Mock };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let stockReservationsService: { drainPool: jest.Mock };
  let notificationsService: { emit: jest.Mock; resolve: jest.Mock };
  let realtimeStub: { publishEntityChanged: jest.Mock; publishNotificationCreated: jest.Mock };

  const invoice = { id: 1n, code: 'PI-31' };
  // floorStage ACTIVE mặc định (2026-08-31) - đa số test không quan tâm gate
  // assertPiHasActiveFloor(), xem mục riêng "QLSX Bắt đầu" bên dưới mới override.
  const order = {
    id: 1n,
    bomRevisionId: 5n,
    quantity: 10,
    floorStage: 'ACTIVE' as const,
    productionInvoiceItem: { productionInvoiceId: 1n },
  };
  // processSteps mặc định chỉ [CAT] - piece "đơn giản" chỉ cần cắt là đủ điều kiện KCS ngay,
  // đúng hành vi cũ (test step-gating multi-step override riêng ở describe('completeStep')).
  const pieceBomRow = {
    bomRevisionId: 5n,
    pieceId: 20n,
    qtyPerPiece: 4,
    processSteps: [ProcessStep.CAT],
    segmentSpecId: 30n,
    segmentSpec: {
      id: 30n,
      materialId: 30n,
      cutLengthMm: decimal(745),
      material: { id: 30n, code: 'ST-18', name: 'Sắt vuông 18x18' },
    },
  };
  const issue = {
    id: 100n,
    productionInvoiceId: 1n,
    materialId: 30n,
    barLengthMm: 6000,
    barCount: 20,
    status: SteelIssueStatus.ISSUED,
    idempotencyKey: null,
    actualBarCount: null,
    issuedAt: new Date(),
    issuedById: 'user-1',
    completedAt: null,
    reworkOfId: null,
    completedSteps: [] as ProcessStep[],
    productionInvoice: { code: 'PI-31', salesOrder: { orderCode: 'PO-31' } },
    material: { id: 30n, code: 'ST-18', name: 'Sắt vuông 18x18' },
  };

  // B4 Đợt 2 / L5 (2026-08-26): physicalStockQty điều khiển câu $queryRaw duy nhất còn lại mà
  // consumeReservationAndDeduct() tự gọi (khoá stock_quant) - phần khoá/rút giữ chỗ đã chuyển
  // hẳn sang StockReservationsService.drainPool() (mock riêng, xem stockReservationsService dưới)
  // nên $queryRaw ở đây không còn cần phân nhánh theo SQL nữa. Chỉ có tác dụng cho test nào set
  // `approvedAt` của cuttingProposal SAU cutover (mặc định TRƯỚC cutover, không đụng tới cả
  // drainPool lẫn $queryRaw - xem default cuttingProposalLine.findFirst dưới).
  let physicalStockQty: number;
  // Kết quả 2 câu SQL khoá đợt cắt trong transaction: danh sách đợt ứng viên của recordCutBatch
  // (SELECT ... openedById ... FOR UPDATE) và trạng thái + SKU của dòng đợt mà assignCutBundleOrder khoá (null = đã bị xoá).
  let openCutRows: { id: bigint; openedById: string | null }[];
  let lockedCutStatus: CutBundleStatus | null;
  // P1: kết quả SELECT ... FOR UPDATE các dòng step_batches chờ của submitStepBundle (id các dòng chờ).
  let pendingStepRows: { id: bigint }[];
  // P1: productionOrderId của dòng cut_bundles mà assignCutBundleOrder khoá (null = đợt cũ chưa gắn SKU).
  let lockedCutOrderId: bigint | null;

  beforeEach(() => {
    physicalStockQty = 100;
    openCutRows = [];
    lockedCutStatus = CutBundleStatus.CUTTING;
    pendingStepRows = [];
    lockedCutOrderId = null;
    prisma = {
      steelIssue: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      // Sổ ghi từng lần báo (2026-10-12) - mặc định chưa có khoá nào (findUnique null), không có lần
      // báo trước để đảo (findFirst null).
      floorReport: {
        create: jest.fn().mockResolvedValue({ id: 900n }),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      productionInvoice: {
        findUnique: jest.fn().mockResolvedValue(invoice),
        findMany: jest.fn().mockResolvedValue([invoice]),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      // findFirst dùng bởi assertPiHasActiveFloor() (floor-gate.util.ts) - gọi từ receive/
      // recordCutBatch/finishCutting/recordStepBatch/completeStep (2026-09-01, vá lỗ hổng gate chỉ
      // che create()). Mặc định trả `order` (floorStage ACTIVE) để không phá các test hiện có.
      productionOrder: {
        findMany: jest.fn().mockResolvedValue([order]),
        findFirst: jest.fn().mockResolvedValue(order),
        // P1: nhãn SKU trong câu lỗi chặn báo vượt.
        findUnique: jest.fn().mockResolvedValue({ mfgProduct: { factoryCode: 'SKU-A' } }),
      },
      pieceBom: { findMany: jest.fn().mockResolvedValue([pieceBomRow]) },
      // P1: số cần = qtyPerPiece (4) × qtyPerUnit (1) × SL SKU (10) = 40 đoạn cỡ 30 - phép chặn báo vượt đọc số cần từ đây.
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([{ bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 1 }]),
      },
      material: {
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
        // Đợt 7: prepareIssue() đọc kho mặc định của vật tư để đổi theo xưởng - kho chưa phân loại thì giữ nguyên.
        findUnique: jest.fn().mockResolvedValue({
          code: 'ST-18',
          warehouse: { id: 800n, code: 'phoi-son-han', kind: null, workshopId: null },
        }),
      },
      // Mặc định approvedAt TRƯỚC STEEL_ISSUE_RESERVATION_CUTOVER (2026-08-18) - đa số test
      // không nói riêng về B4 Đợt 2, giữ đúng hành vi "nhánh cũ" (không đụng
      // stock_reservations/stock_quant/warehouse). Test nào cần nhánh MỚI tự override.
      cuttingProposalLine: {
        findFirst: jest.fn().mockResolvedValue({
          cuttingProposal: { id: 1n, approvedAt: new Date('2026-08-10T00:00:00.000Z') },
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      cutBundle: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(() => prisma.cutBundle.findUnique() as unknown),
        create: jest.fn().mockResolvedValue({
          id: 1n,
          steelIssueId: 100n,
          proposalPatternId: null,
          barCount: 0,
          mauNguyenMm: 0,
          scrapMm: 0,
          status: CutBundleStatus.CUTTING,
          completedSteps: [ProcessStep.CAT],
          completedAt: null,
          createdAt: new Date('2026-09-05T00:00:00.000Z'),
          segments: [],
        }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { barCount: null } }),
        // recordCutBatch() giờ luôn reload bundle qua findBundleOrThrow() (findUnique) sau khi
        // tạo/cộng dồn - mặc định khớp với `create` ở trên (đủ để .toBundleResponseDto() chạy qua).
        findUnique: jest.fn().mockResolvedValue({
          id: 1n,
          steelIssueId: 100n,
          proposalPatternId: null,
          barCount: 0,
          mauNguyenMm: 0,
          scrapMm: 0,
          status: CutBundleStatus.CUTTING,
          completedSteps: [ProcessStep.CAT],
          completedAt: null,
          createdAt: new Date('2026-09-05T00:00:00.000Z'),
          segments: [],
        }),
        // Mặc định KHÔNG có đợt nào đang mở - recordCutBatch() tạo đợt mới (findFirst() trả null).
        // Test riêng cho hành vi cộng dồn override giá trị này.
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        delete: jest.fn(),
      },
      cutPatternSegment: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        // Mặc định "còn segment khác" sau khi hoàn tác - test riêng cho case xoá cả bundle override.
        count: jest.fn().mockResolvedValue(1),
      },
      qcReviewSegment: { findMany: jest.fn().mockResolvedValue([]) },
      segmentSpec: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 30n, materialId: 30n, cutLengthMm: decimal(745) }]),
      },
      // Mặc định rỗng - đa số test không quan tâm công đoạn phụ (xem mục 'recordStepBatch'/
      // 'submitStepBundle' bên dưới mới override).
      stepBatch: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // recordStepBatch() đọc lại dòng vừa tạo để trả response (2026-10-12) - mặc định trả đúng giá
        // trị `create` vừa trả, để các test cũ chỉ cần mock `create`.
        findUniqueOrThrow: jest.fn(
          () => prisma.stepBatch.create.mock.results.at(-1)?.value as unknown,
        ),
      },
      stepBatchSegment: { findMany: jest.fn().mockResolvedValue([]) },
      stepBundle: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // trim 10mm + lưỡi cưa 1mm = mặc định SystemConfig, dùng số thật để phép cân bằng khớp.
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue({
          solverTrimStartMm: 10,
          solverBladeWidthMm: decimal(1),
          // Cặp riêng của MC Tự động (mặc định theo app cat_sat_iea).
          solverMctdTrimStartMm: 0,
          solverMctdBladeWidthMm: decimal(2.5),
        }),
      },
      stockReservation: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      stockQuant: { findMany: jest.fn().mockResolvedValue([]) },
      warehouse: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 950n }) },
      // Xưởng của lệnh lúc tra kho (rà soát 14/11 CK6, PreparedSteelIssue.workshopId) - mặc định chưa chọn xưởng.
      productionInvoiceItem: { findFirst: jest.fn().mockResolvedValue(null) },
      // 2026-09-03: assertPiHasActiveFloorLocked() (vá race TOCTOU) giờ cũng dùng $queryRaw
      // (FOR UPDATE lên production_orders) ngay dòng đầu transaction create() - phải phân nhánh
      // theo nội dung câu SQL, không còn chỉ có 1 loại câu raw duy nhất như trước.
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('production_orders')) return Promise.resolve([{ floorStage: 'ACTIVE' }]);
        if (sql.includes('cut_bundles') && sql.includes('openedById'))
          return Promise.resolve(openCutRows);
        if (sql.includes('step_batches')) return Promise.resolve(pendingStepRows);
        if (sql.includes('cut_bundles'))
          return Promise.resolve(
            lockedCutStatus
              ? [{ status: lockedCutStatus, productionOrderId: lockedCutOrderId }]
              : [],
          );
        return Promise.resolve([{ qty: { toNumber: () => physicalStockQty } }]);
      }),
      // lockBusinessKey() (Nghiêm trọng #6, đính chính audit độc lập 09/09 - khoá race
      // recordStepBatch()) dùng $executeRaw - no-op ở test, cùng idiom material-issues.spec.ts.
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    stockLedgerService = { postEntry: jest.fn() };
    // L5 (2026-08-26): drainPool() thay hẳn lookup 1-dòng cố định cũ - mặc định trả về 1 kho giả
    // định đủ giữ chỗ, test nào cần mô phỏng "không đủ"/"pool rỗng" tự override bằng
    // mockRejectedValueOnce (hành vi thật đã kiểm riêng ở stock-reservations.service.spec.ts).
    stockReservationsService = {
      drainPool: jest.fn().mockResolvedValue({ warehouseId: 800n }),
    };
    notificationsService = {
      emit: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(undefined),
    };
    realtimeStub = { publishEntityChanged: jest.fn(), publishNotificationCreated: jest.fn() };
    service = new SteelIssuesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
      stockReservationsService as unknown as StockReservationsService,
      notificationsService as unknown as NotificationsService,
      realtimeStub as unknown as RealtimeService,
    );
  });

  describe('create', () => {
    it('xác thực materialId thuộc BOM của PI và tạo đợt xuất mới gộp theo PI', async () => {
      prisma.steelIssue.create.mockResolvedValue(issue);

      const result = await service.create(
        '1',
        { materialId: '30', barLengthMm: 6000, barCount: 20 },
        'user-1',
        null,
      );

      expect(prisma.cuttingProposalLine.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          where: expect.objectContaining({ materialId: 30n }),
        }),
      );
      expect(prisma.steelIssue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            productionInvoiceId: 1n,
            materialId: 30n,
            barCount: 20,
          }),
        }),
      );
      expect(result.id).toBe('100');
      expect(result.status).toBe(SteelIssueStatus.ISSUED);
    });

    // Phase 3b, nhóm 7.5-i (Sắt -> Phôi -> KCS), changelog 2026-09-25 mục 19.
    it('emit STEEL_ISSUE_TO_PHOI sau khi tạo đợt xuất mới', async () => {
      prisma.steelIssue.create.mockResolvedValue(issue);

      await service.create(
        '1',
        { materialId: '30', barLengthMm: 6000, barCount: 20 },
        'user-1',
        null,
      );

      expect(notificationsService.emit).toHaveBeenCalledWith(
        'STEEL_ISSUE_TO_PHOI',
        expect.objectContaining({
          entityId: '100',
          params: { piCode: 'PI-31', materialCode: 'ST-18', barCount: 20 },
        }),
      );
    });

    it('phát entity.changed kèm parentId=productionInvoiceId (2026-10-17, FE lọc banner theo đúng PI đang xem)', async () => {
      prisma.steelIssue.create.mockResolvedValue(issue);

      await service.create(
        '1',
        { materialId: '30', barLengthMm: 6000, barCount: 20 },
        'user-1',
        null,
      );

      expect(realtimeStub.publishEntityChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'STEEL_ISSUE',
          entityId: issue.id,
          action: 'CREATED',
          parentId: issue.productionInvoiceId,
        }),
      );
    });

    it('idempotency short-circuit - KHÔNG emit lại STEEL_ISSUE_TO_PHOI (đã báo ở lần tạo đầu)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue);

      await service.create(
        '1',
        { materialId: '30', barLengthMm: 6000, barCount: 20 },
        'user-1',
        null,
        'idem-key-1',
      );

      expect(notificationsService.emit).not.toHaveBeenCalled();
    });

    it('idempotency short-circuit - trả về đợt cũ, không tạo mới', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue);

      const result = await service.create(
        '1',
        { materialId: '30', barLengthMm: 6000, barCount: 20 },
        'user-1',
        null,
        'idem-key-1',
      );

      expect(prisma.steelIssue.create).not.toHaveBeenCalled();
      expect(result.id).toBe('100');
    });

    it('chặn caller bị giới hạn kho khác kho sắt', async () => {
      await expect(
        service.create(
          '1',
          { materialId: '30', barLengthMm: 6000, barCount: 20 },
          'user-1',
          'thanh-pham',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.steelIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép caller không có warehouseScope (tổng kho)', async () => {
      prisma.steelIssue.create.mockResolvedValue(issue);
      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 20 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('Đợt 7: thủ kho đúng kho Phôi của lệnh xuất được', async () => {
      prisma.steelIssue.create.mockResolvedValue(issue);
      await expect(
        service.create(
          '1',
          { materialId: '30', barLengthMm: 6000, barCount: 20 },
          'user-1',
          'phoi-son-han',
        ),
      ).resolves.toBeDefined();
    });

    it('Đợt 7: thủ kho kho khác cùng nhóm Phôi-Hàn-Sơn (vd kho Hàn, kho Phôi xưởng khác) KHÔNG xuất được sắt của lệnh', async () => {
      await expect(
        service.create(
          '1',
          { materialId: '30', barLengthMm: 6000, barCount: 20 },
          'user-1',
          'phoi-son-han-han-pa',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.steelIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép chọn đúng 1 trong nhiều loại sắt đang dùng trong PI', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        pieceBomRow,
        { ...pieceBomRow, segmentSpec: { ...pieceBomRow.segmentSpec, materialId: 999n } },
      ]);
      prisma.steelIssue.create.mockResolvedValue(issue);

      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 20 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('ném BadRequestException khi materialId client chọn không thuộc BOM của bất kỳ mảnh nào trong PI', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([pieceBomRow]); // PI chỉ dùng material 30n

      await expect(
        service.create('1', { materialId: '999', barLengthMm: 6000, barCount: 20 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.steelIssue.create).not.toHaveBeenCalled();
    });

    it('ném NotFoundException khi PI chưa có lệnh sản xuất nào được duyệt', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([]);

      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 20 }, 'user-1', null),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném ConflictException khi chưa có CuttingProposal APPROVED cho vật tư này', async () => {
      prisma.cuttingProposalLine.findFirst.mockResolvedValue(null);

      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 20 }, 'user-1', null),
      ).rejects.toThrow(ConflictException);
    });

    it('chỉ chấp nhận dòng phương án CẮT ĐƯỢC - không cho xuất sắt theo dòng feasible=false', async () => {
      // saveSuccess() tạo CuttingProposalLine cho MỌI vật tư solver trả về, kể cả loại nó báo
      // không cắt được (không có pattern nào để làm theo). Loại đó cũng bị approve() lọc khỏi đề
      // xuất mua, nên còn chẳng có sắt để xuất - phải chặn ngay ở guard này.
      prisma.steelIssue.create.mockResolvedValue(issue);

      await service.create(
        '1',
        { materialId: '30', barLengthMm: 6000, barCount: 20 },
        'user-1',
        null,
      );

      expect(prisma.cuttingProposalLine.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          where: expect.objectContaining({ feasible: true }),
        }),
      );
    });
  });

  describe('rà soát 14/11 XK4: chiều dài cây theo phương án đã duyệt', () => {
    it('cây khác chiều dài phương án -> 400, không ghi', async () => {
      prisma.cuttingProposalLine.findMany.mockResolvedValueOnce([{ bestStockLengthMm: 5900 }]);
      const err = await service
        .create('1', { materialId: '30', barLengthMm: 6000, barCount: 20 }, 'user-1', null)
        .catch((e: Error) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toContain('5900mm');
      expect(prisma.cuttingProposalLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          where: expect.objectContaining({
            materialId: 30n,
            feasible: true,
            bestStockLengthMm: { not: null },
          }),
        }),
      );
      expect(prisma.steelIssue.create).not.toHaveBeenCalled();
    });

    it('đúng chiều dài phương án -> xuất được; phương án cũ chưa lưu chiều dài -> không kiểm', async () => {
      prisma.steelIssue.create.mockResolvedValue(issue);
      prisma.cuttingProposalLine.findMany.mockResolvedValueOnce([{ bestStockLengthMm: 6000 }]);
      await service.create(
        '1',
        { materialId: '30', barLengthMm: 6000, barCount: 20 },
        'user-1',
        null,
      );
      prisma.cuttingProposalLine.findMany.mockResolvedValueOnce([]);
      await service.create(
        '1',
        { materialId: '30', barLengthMm: 5000, barCount: 20 },
        'user-1',
        null,
      );
      expect(prisma.steelIssue.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('createInTx - rà soát 14/11 CK6: khoá dòng lệnh chung với đổi xưởng', () => {
    const prepared = {
      productionInvoiceId: 1n,
      materialId: 30n,
      barLengthMm: 6000,
      barCount: 2,
      isPostCutover: false,
      warehouse: { id: 800n, code: 'phoi-son-han' },
      workshopId: 5n,
    };

    it('cờ "cần kiểm lại phương án cắt" vừa bật (đọc SAU khoá) -> 409, không ghi', async () => {
      (lockPisForIssue as jest.Mock).mockResolvedValueOnce(
        new Map([['1', { workshopId: 5n, cuttingRecheckRequired: true }]]),
      );

      await expect(
        service.createInTx(prisma as unknown as PrismaTx, prepared, 'user-1'),
      ).rejects.toThrow(ConflictException);
      expect(lockPisForIssue).toHaveBeenCalledWith(expect.anything(), [1n]);
      expect(prisma.steelIssue.create).not.toHaveBeenCalled();
    });

    it('so xưởng SAU khoá với xưởng lúc tra kho; đổi xưởng chen giữa -> 409, không ghi', async () => {
      const locked = { workshopId: 6n, cuttingRecheckRequired: false };
      (lockPisForIssue as jest.Mock).mockResolvedValueOnce(new Map([['1', locked]]));
      (assertWorkshopUnchanged as jest.Mock).mockImplementationOnce(() => {
        throw new ConflictException('đổi xưởng');
      });

      await expect(
        service.createInTx(prisma as unknown as PrismaTx, prepared, 'user-1'),
      ).rejects.toThrow(ConflictException);
      expect(assertWorkshopUnchanged).toHaveBeenCalledWith(locked, 5n);
      expect(prisma.steelIssue.create).not.toHaveBeenCalled();
    });
  });

  describe('create - QLSX "Bắt đầu" gate (assertPiHasActiveFloor, 2026-08-31)', () => {
    it('ném ConflictException khi PI có ProductionOrder nhưng KHÔNG SKU nào ACTIVE', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([{ ...order, floorStage: 'PENDING' }]);

      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 20 }, 'user-1', null),
      ).rejects.toThrow(ConflictException);
      expect(prisma.steelIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép xuất khi PI có ÍT NHẤT 1 SKU ACTIVE, kể cả khi các SKU khác còn PENDING', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([
        { ...order, id: 1n, floorStage: 'PENDING' },
        { ...order, id: 2n, floorStage: 'ACTIVE' },
      ]);
      prisma.steelIssue.create.mockResolvedValue(issue);

      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 20 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    // 2026-09-03: assertOrdersHaveActiveFloor() ở TRÊN chỉ đọc `orders` đã fetch sẵn TRƯỚC khi mở
    // transaction (fast-path) - không tự chốt được race QLSX bấm "Tạm dừng" đúng lúc giữa đọc và
    // ghi. assertPiHasActiveFloorLocked() (FOR UPDATE, chạy NGAY ĐẦU transaction) mới là nguồn
    // đúng cuối cùng - test này giả lập đúng race đó: pre-check thấy ACTIVE (orders mock không đổi)
    // nhưng câu SELECT FOR UPDATE bên trong transaction đọc lại thấy PAUSED.
    it('ném ConflictException khi race: pre-check thấy ACTIVE nhưng SELECT FOR UPDATE trong transaction đọc lại thấy PAUSED (TOCTOU)', async () => {
      prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
        strings.join('').includes('production_orders')
          ? Promise.resolve([{ floorStage: 'PAUSED' }])
          : Promise.resolve([{ qty: { toNumber: () => physicalStockQty } }]),
      );

      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 20 }, 'user-1', null),
      ).rejects.toThrow(ConflictException);
      expect(prisma.steelIssue.create).not.toHaveBeenCalled();
    });
  });

  // B4 Đợt 2 (changelog mục 13) - phương án cắt duyệt SAU STEEL_ISSUE_RESERVATION_CUTOVER
  // (2026-08-18) không còn bị trừ tồn ở approve() nữa, create() ở đây mới là nơi trừ thật + tiêu
  // giữ chỗ tương ứng. approvedAt SAU mốc bật nhánh mới - set riêng ở từng test dưới.
  describe('create - B4 Đợt 2 (trừ tồn thật + tiêu giữ chỗ, phương án duyệt SAU cutover)', () => {
    const setPostCutover = () => {
      prisma.cuttingProposalLine.findFirst.mockResolvedValue({
        cuttingProposal: { id: 1n, approvedAt: new Date('2026-08-19T00:00:00.000Z') },
      });
    };

    // L5 (2026-08-26): việc rút giữ chỗ (đủ 1 dòng, vắt qua nhiều dòng, chặn xuất thừa, chặn pool
    // rỗng) đã chuyển hẳn sang StockReservationsService.drainPool() - đã kiểm đầy đủ ở
    // stock-reservations.service.spec.ts. 4 test dưới đây chỉ còn xác nhận SteelIssuesService gọi
    // drainPool() ĐÚNG tham số (productionInvoiceId, không còn cuttingProposalId) và dùng đúng
    // warehouseId nó trả về, cộng với phần logic CÒN LẠI thuộc về chính service này (chặn tồn âm
    // vật lý cục bộ).
    it('đủ giữ chỗ: gọi drainPool đúng (PI, vật tư, số cây), postEntry dùng warehouseId trả về', async () => {
      setPostCutover();
      prisma.steelIssue.create.mockResolvedValue(issue);

      await service.create(
        '1',
        { materialId: '30', barLengthMm: 6000, barCount: 12 },
        'user-1',
        null,
      );

      expect(stockReservationsService.drainPool).toHaveBeenCalledWith(expect.anything(), {
        productionInvoiceId: 1n,
        materialId: 30n,
        qty: 12,
        warehouseId: 800n, // rà soát 14/11 CK3: chỉ rút giữ chỗ ở kho Phôi của xưởng làm lệnh
      });
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        {
          fromWarehouseId: 800n,
          toWarehouseId: 950n,
          materialId: 30n,
          qty: 12,
          refType: 'STEEL_ISSUE',
          refId: '100',
          createdById: 'user-1',
          idempotencyKey: 'steel-issue:100:consume',
          stockLengthMm: 6000,
        },
        expect.anything(),
      );
    });

    // 2026-09-05: tồn kho sắt phân theo chiều dài - chặn tồn âm phải soi ĐÚNG bucket đang xuất
    // (barLengthMm), không phải tổng mọi chiều dài. 2 lượt xuất CÙNG vật tư nhưng KHÁC chiều dài
    // phải soi 2 bucket khác nhau, không lẫn vào nhau.
    it('chặn tồn âm cục bộ soi ĐÚNG bucket chiều dài đang xuất, không lẫn chiều dài khác', async () => {
      setPostCutover();
      prisma.steelIssue.create.mockResolvedValue(issue);
      prisma.$queryRaw.mockImplementation(
        (strings: TemplateStringsArray) =>
          strings.join('').includes('production_orders')
            ? Promise.resolve([{ floorStage: 'ACTIVE' }])
            : Promise.resolve([{ qty: { toNumber: () => 5 } }]), // chỉ 5 cây ở ĐÚNG bucket được lọc
      );

      await service.create(
        '1',
        { materialId: '30', barLengthMm: 5900, barCount: 5 },
        'user-1',
        null,
      );

      const stockQuantCalls = (
        prisma.$queryRaw.mock.calls as unknown[][] as [TemplateStringsArray][]
      ).filter(([strings]) => Array.isArray(strings) && strings.join('').includes('stock_quant'));
      expect(stockQuantCalls.length).toBeGreaterThan(0);
      for (const [, ...values] of stockQuantCalls) {
        expect(values).toContain(5900);
      }
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ stockLengthMm: 5900 }),
        expect.anything(),
      );
    });

    it('rà soát 14/11 CK3: giữ chỗ ở kho Phôi xưởng khác không rút được - drainPool (lọc theo kho Phôi của lệnh) báo cần phiếu chuyển, không ghi StockLedger', async () => {
      setPostCutover();
      stockReservationsService.drainPool.mockRejectedValue(
        new ConflictException(
          'Lệnh còn giữ 8 ở Kho Phôi Phú An - cần phiếu chuyển hàng của lệnh sang kho này trước khi xuất',
        ),
      );
      prisma.steelIssue.create.mockResolvedValue(issue);

      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 8 }, 'user-1', null),
      ).rejects.toThrow('cần phiếu chuyển hàng của lệnh');
      expect(stockReservationsService.drainPool).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ warehouseId: 800n }),
      );
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    // drainPool() ném lỗi (không đủ giữ chỗ trong CẢ pool) - create() phải để lỗi đó nổi lên
    // nguyên vẹn, KHÔNG được nuốt hay đổi loại exception.
    it('chặn xuất thừa - propagate đúng lỗi từ drainPool(), không ghi StockLedger', async () => {
      setPostCutover();
      stockReservationsService.drainPool.mockRejectedValue(
        new BadRequestException('vượt quá phần đã giữ chỗ còn lại'),
      );
      prisma.steelIssue.create.mockResolvedValue(issue);

      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 6 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('chặn tồn âm cục bộ - tồn vật lý bị điều chỉnh tay lệch khỏi giữ chỗ', async () => {
      setPostCutover();
      physicalStockQty = 5; // giữ chỗ đủ (drainPool mặc định resolve) nhưng tồn vật lý thật chỉ còn 5 (bị chỉnh tay)
      prisma.steelIssue.create.mockResolvedValue(issue);

      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 10 }, 'user-1', null),
      ).rejects.toThrow(ConflictException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('không tìm thấy giữ chỗ nào cho PI+vật tư (pool rỗng) - propagate ConflictException từ drainPool', async () => {
      setPostCutover();
      stockReservationsService.drainPool.mockRejectedValue(
        new ConflictException('Không tìm thấy giữ chỗ tồn kho'),
      );
      prisma.steelIssue.create.mockResolvedValue(issue);

      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 5 }, 'user-1', null),
      ).rejects.toThrow(ConflictException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });
  });

  describe('receive', () => {
    const receivedRow = (receivedBarCount: number) => ({
      ...issue,
      status: SteelIssueStatus.RECEIVED,
      receivedBarCount,
      receivedAt: new Date(),
      receivedById: 'user-2',
      receivedBy: { firstName: 'An', lastName: 'Nguyễn Văn', username: 'cn1' },
    });

    it('ISSUED -> RECEIVED, lưu số cây (mặc định = số kho xuất) + người + giờ nhận', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue);
      prisma.steelIssue.findUniqueOrThrow.mockResolvedValue(receivedRow(20));

      const result = await service.receive('100', 'user-2');

      expect(prisma.steelIssue.update).toHaveBeenCalledWith({
        where: { id: 100n, status: SteelIssueStatus.ISSUED },
        data: expect.objectContaining({
          status: SteelIssueStatus.RECEIVED,
          receivedBarCount: 20,
          receivedById: 'user-2',
          receivedAt: expect.any(Date) as unknown,
        }) as unknown,
      });
      expect(result.status).toBe(SteelIssueStatus.RECEIVED);
      expect(result.receivedBarCount).toBe(20);
      expect(result.receivedByName).toBe('Nguyễn Văn An');
      // Khớp số -> không báo lệch.
      expect(notificationsService.emit).not.toHaveBeenCalledWith(
        'STEEL_ISSUE_RECEIVED_MISMATCH',
        expect.anything(),
      );
      // 2026-10-17: entity.changed RECEIVED cũng mang parentId=productionInvoiceId, không chỉ CREATED.
      expect(realtimeStub.publishEntityChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'STEEL_ISSUE',
          action: 'RECEIVED',
          parentId: issue.productionInvoiceId,
        }),
      );
    });

    it('nhận LỆCH số (18/20): vẫn RECEIVED, báo thủ kho đã xuất + QLSX, không ghi sổ kho', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue);
      prisma.steelIssue.findUniqueOrThrow.mockResolvedValue(receivedRow(18));

      await service.receive('100', 'user-2', 18);

      expect(prisma.steelIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ receivedBarCount: 18 }) as unknown,
        }),
      );
      expect(notificationsService.emit).toHaveBeenCalledWith('STEEL_ISSUE_RECEIVED_MISMATCH', {
        entityId: '100',
        actorId: 'user-2',
        params: expect.objectContaining({
          barCount: 20,
          receivedBarCount: 18,
          issuedById: 'user-1',
          receiverName: 'Nguyễn Văn An',
        }) as unknown,
      });
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('2 người bấm nhận cùng lúc: người sau nhận 409 (updateMany có điều kiện ISSUED)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue);
      prisma.steelIssue.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(service.receive('100', 'user-2')).rejects.toThrow(ConflictException);
    });

    it('resolve STEEL_ISSUE_TO_PHOI sau khi nhận', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue);
      prisma.steelIssue.findUniqueOrThrow.mockResolvedValue(receivedRow(20));

      await service.receive('100', 'user-2');

      expect(notificationsService.resolve).toHaveBeenCalledWith({
        entityType: 'STEEL_ISSUE',
        entityId: '100',
        types: ['STEEL_ISSUE_TO_PHOI'],
      });
    });

    it('ném ConflictException nếu không phải ISSUED', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue({
        ...issue,
        status: SteelIssueStatus.RECEIVED,
      });

      await expect(service.receive('100', 'user-2')).rejects.toThrow(ConflictException);
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc" (assertPiHasActiveFloor, 2026-09-01)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue);
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.receive('100', 'user-2')).rejects.toThrow(ConflictException);
      expect(prisma.steelIssue.update).not.toHaveBeenCalled();
    });
  });

  // Dùng chung cho recordCutBatch/finishCutting/completeStep - đợt đã được Phôi xác nhận nhận.
  const receivedIssue = { ...issue, status: SteelIssueStatus.RECEIVED };

  describe('recordCutBatch', () => {
    // 2026-09-05: bỏ 2 ô nhập "số cây đã dùng"/"mẩu nguyên" theo yêu cầu nghiệp vụ (1 loại sắt
    // gộp nhiều lần kho giao, tách cây theo từng đợt cắt là tuỳ tiện). Kéo theo bỏ luôn cân bằng
    // vật chất + chặn "vượt số cây kho giao" - 3 test cũ khoá đúng các hành vi đó đã xoá, thay
    // bằng 2 test dưới. Kiểm soát giờ dồn hết về KCS (duyệt theo từng đợt cắt).
    it('ghi 1 đợt cắt CHỈ theo số đoạn - không cần số cây, không tính phế liệu', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);

      await service.recordCutBatch(
        '100',
        {
          productionOrderId: '1',
          segments: [{ segmentSpecId: '30', qty: 8 }],
        },
        'user-1',
      );

      expect(prisma.cutBundle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            steelIssueId: 100n,
            productionOrderId: 1n, // đợt gắn đúng SKU đã chọn (2026-09-21)
            barCount: 0,
            mauNguyenMm: 0,
            status: CutBundleStatus.CUTTING,
            completedSteps: [ProcessStep.CAT],
          }) as unknown,
        }),
      );
    });

    it('KHÔNG chặn dù số đoạn khai ra vượt xa lượng sắt kho giao (cân bằng vật chất đã bỏ)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);

      // 9 đoạn 745mm từ 1 cây 6000mm - trước 2026-09-05 bị chặn cứng, giờ cho qua (P1: miễn là chưa vượt SỐ CẦN).
      prisma.bomPiece.findMany.mockResolvedValue([
        { bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 1000 },
      ]);
      await expect(
        service.recordCutBatch(
          '100',
          {
            productionOrderId: '1',
            segments: [{ segmentSpecId: '30', qty: 9999 }],
          },
          'user-1',
        ),
      ).resolves.toBeDefined();
      expect(prisma.cutBundle.create).toHaveBeenCalled();
    });

    // ---- P1 (18/11/2026): chặn báo CẮT vượt số cần, đọc trong khoá cut-cap ----
    describe('chặn báo vượt số cần (P1)', () => {
      const cutDto = (qty: number) => ({
        productionOrderId: '1',
        segments: [{ segmentSpecId: '30', qty }],
      });
      const cutRow = (qty: number) => ({
        segmentSpecId: 30n,
        qty,
        cutBundle: { productionOrderId: 1n },
      });
      let warn: jest.SpyInstance;

      beforeEach(() => {
        prisma.steelIssue.findUnique.mockResolvedValue({
          ...issue,
          status: SteelIssueStatus.RECEIVED,
        });
        warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      });
      afterEach(() => warn.mockRestore());

      it('còn 5 (cần 40, đã tính 35): báo 6 bị 400 đúng câu hợp đồng, không ghi gì, có logger.warn', async () => {
        prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(35)]);

        const err: unknown = await service.recordCutBatch('100', cutDto(6), 'user-1').then(
          () => null,
          (e: unknown) => e,
        );

        expect(err).toBeInstanceOf(BadRequestException);
        const msg = (err as Error).message;
        expect(msg).toContain('Cỡ 745mm (SKU SKU-A): cần 40 đoạn, đã tính 35');
        expect(msg).toContain('lần này báo được tối đa 5 đoạn, bạn nhập 6');
        expect(msg.endsWith('Số cần sai thì báo QLSX.')).toBe(true);
        expect(prisma.cutBundle.create).not.toHaveBeenCalled();
        expect(prisma.cutPatternSegment.upsert).not.toHaveBeenCalled();
        expect(prisma.floorReport.create).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        const line = String((warn.mock.calls as unknown[][])[0][0]);
        expect(line).toContain('PI 1');
        expect(line).toContain('SKU-A');
        expect(line).toContain('745mm');
        expect(line).toContain('cần 40');
        expect(line).toContain('đã tính 35');
        expect(line).toContain('số nhập 6');
      });

      it('báo đúng 5 (bằng số còn lại) thì qua', async () => {
        prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(35)]);
        await expect(service.recordCutBatch('100', cutDto(5), 'user-1')).resolves.toBeDefined();
        expect(prisma.cutBundle.create).toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
      });

      it('đã đủ 40: báo thêm 1 bị chặn "tối đa 0"; số đã vượt từ trước deploy (45) không ra số âm', async () => {
        prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(45)]);
        const err: unknown = await service.recordCutBatch('100', cutDto(1), 'user-1').then(
          () => null,
          (e: unknown) => e,
        );
        expect((err as Error).message).toContain('tối đa 0 đoạn, bạn nhập 1');
      });

      it('KCS chấm lỗi / ghi thiếu thì số đã tính giảm: cắt 40, lỗi 6 + thiếu 4 -> báo thêm 10 được, 11 bị chặn', async () => {
        prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(40)]);
        prisma.qcReviewSegment.findMany
          .mockResolvedValueOnce([
            {
              segmentSpecId: 30n,
              failedQty: 6,
              shortQty: 4,
              qcReview: { cutBundle: { productionOrderId: 1n } },
            },
          ])
          .mockResolvedValue([]);
        await expect(service.recordCutBatch('100', cutDto(10), 'user-1')).resolves.toBeDefined();

        prisma.qcReviewSegment.findMany
          .mockResolvedValueOnce([
            {
              segmentSpecId: 30n,
              failedQty: 6,
              shortQty: 4,
              qcReview: { cutBundle: { productionOrderId: 1n } },
            },
          ])
          .mockResolvedValue([]);
        await expect(service.recordCutBatch('100', cutDto(11), 'user-1')).rejects.toThrow(
          'tối đa 10',
        );
      });

      // P1 [7]: phiếu chấm cả lô kiểu cũ (qc_reviews.cutBundleId NULL, steelIssueId có). Prisma loại mọi dòng có quan hệ
      // cutBundle NULL khi where đòi `cutBundle: ...` - mock mô phỏng đúng cách đó để bắt lỗi lọc.
      it('P1 [7]: PI 1 SKU, phiếu chấm cũ cả lô lỗi 10, cắt thô = số cần 40 -> báo 10 qua, 11 bị chặn "tối đa 10" (cùng số màn quét)', async () => {
        prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(40)]);
        const legacy = {
          segmentSpecId: 30n,
          failedQty: 10,
          shortQty: 0,
          qcReview: { cutBundle: null },
        };
        prisma.qcReviewSegment.findMany.mockImplementation(
          (args: { where: { qcReview?: Record<string, unknown> } }) => {
            const qc = args.where.qcReview ?? {};
            if ('stepBundle' in qc) return Promise.resolve([]);
            return Promise.resolve('cutBundle' in qc ? [] : [legacy]);
          },
        );

        await expect(service.recordCutBatch('100', cutDto(10), 'user-1')).resolves.toBeDefined();
        await expect(service.recordCutBatch('100', cutDto(11), 'user-1')).rejects.toThrow(
          'tối đa 10',
        );
      });

      it('P1 [7]: phiếu chấm Cắt lọc theo lô sắt (không đòi cutBundle) và loại phiếu có stepBundleId', async () => {
        prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(35)]);

        await service.recordCutBatch('100', cutDto(1), 'user-1');

        const cutQcWhere = (
          prisma.qcReviewSegment.findMany.mock.calls[0] as [{ where: { qcReview: object } }]
        )[0].where.qcReview;
        expect(cutQcWhere).toEqual({
          steelIssue: { productionInvoiceId: 1n, materialId: 30n },
          stepBundleId: null,
        });
      });

      it('Uốn bỏ 5 thì Cắt cần 45: đã cắt 40 -> báo 5 được, 6 bị chặn; câu nói "gồm 5 đoạn cắt lại"', async () => {
        prisma.pieceBom.findMany.mockResolvedValue([
          { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON] },
        ]);
        const scrap = () => [
          {
            segmentSpecId: 30n,
            failedQty: 5,
            shortQty: 0,
            scrapQty: 5,
            qcReview: { stepBundle: { productionOrderId: 1n, step: ProcessStep.UON } },
          },
        ];
        prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(40)]);
        prisma.qcReviewSegment.findMany
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(scrap())
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(scrap());
        await expect(service.recordCutBatch('100', cutDto(5), 'user-1')).resolves.toBeDefined();

        await expect(service.recordCutBatch('100', cutDto(6), 'user-1')).rejects.toThrow(
          'cần 45 đoạn (gồm 5 đoạn cắt lại cho đoạn KCS bỏ)',
        );
      });

      it('thứ tự khoá: cut-cap TRƯỚC cut-report; transaction có timeout 20 giây', async () => {
        await service.recordCutBatch('100', cutDto(1), 'user-1');

        const keys = prisma.$executeRaw.mock.calls.map((c) => String((c as unknown[])[1]));
        const cap = keys.findIndex((k) => k === 'cut-cap:1:30:1');
        const report = keys.findIndex((k) => k.startsWith('cut-report:'));
        expect(cap).toBeGreaterThanOrEqual(0);
        expect(report).toBeGreaterThan(cap);
        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20_000 });
      });

      it('số cần đọc TRONG khoá: cut-cap lấy trước mọi truy vấn đọc số đã báo', async () => {
        await service.recordCutBatch('100', cutDto(1), 'user-1');
        const capCall = prisma.$executeRaw.mock.invocationCallOrder[0];
        expect(capCall).toBeLessThan(prisma.cutPatternSegment.findMany.mock.invocationCallOrder[0]);
        expect(capCall).toBeLessThan(prisma.pieceBom.findMany.mock.invocationCallOrder.at(-1)!);
      });
    });

    // 2026-09-06: "Lưu đợt cắt" nhiều lần trong ngày cho tới khi "Báo cắt xong" giờ CỘNG DỒN vào
    // cùng 1 đợt (CutBundle) thay vì mỗi lần lưu tạo 1 đợt rời rạc - xem doc comment trên hàm.
    it('còn đợt đang CUTTING của lô → CỘNG DỒN vào đợt đó (upsert qty), KHÔNG tạo đợt mới', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      openCutRows = [{ id: 5n, openedById: 'user-1' }];

      await service.recordCutBatch(
        '100',
        {
          productionOrderId: '1',
          segments: [{ segmentSpecId: '30', qty: 3 }],
        },
        'user-1',
      );

      expect(prisma.cutBundle.create).not.toHaveBeenCalled();
      expect(prisma.cutPatternSegment.upsert).toHaveBeenCalledWith({
        where: { cutBundleId_segmentSpecId: { cutBundleId: 5n, segmentSpecId: 30n } },
        update: { qty: { increment: 3 } },
        create: { cutBundleId: 5n, segmentSpecId: 30n, qty: 3 },
      });
      expect(prisma.cutBundle.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5n } }) as unknown,
      );
    });

    // 2026-10-13 (QR tại máy, mục 22): mỗi công nhân 1 đợt riêng - KCS chấm đạt/lỗi theo đợt nên phải biết của ai.
    it('chỉ cộng vào đợt CUTTING của CHÍNH người báo; đợt mới ghi người mở + máy + PI vào sổ', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      openCutRows = []; // không có đợt của mình, không có đợt cũ vô chủ

      await service.recordCutBatch(
        '100',
        { productionOrderId: '1', segments: [{ segmentSpecId: '30', qty: 2 }] },
        'cn-2',
        'k-1',
        { workstationId: 9n },
      );

      // Khoá advisory theo (lô, SKU, người báo) rồi khoá các đợt ứng viên bằng SQL thô.
      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('FOR UPDATE')]),
        100n,
        1n,
        'cn-2',
      );
      expect(prisma.cutBundle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ openedById: 'cn-2' }) as unknown,
        }),
      );
      expect(prisma.floorReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reportedById: 'cn-2',
          workstationId: 9n,
          productionInvoiceId: receivedIssue.productionInvoiceId,
        }) as unknown,
      });
    });

    it('đợt CŨ chưa có người mở (tạo trước cột openedById) → người báo đầu tiên nhận luôn đợt đó', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      openCutRows = [{ id: 5n, openedById: null }];

      await service.recordCutBatch(
        '100',
        { productionOrderId: '1', segments: [{ segmentSpecId: '30', qty: 1 }] },
        'cn-3',
      );

      expect(prisma.cutBundle.create).not.toHaveBeenCalled();
      expect(prisma.cutBundle.update).toHaveBeenCalledWith({
        where: { id: 5n },
        data: { openedById: 'cn-3' },
      });
    });

    it('không còn đợt nào đang mở (đợt trước đã Báo cắt xong) → TẠO đợt mới như bình thường', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      openCutRows = []; // đợt trước đã AWAITING_QC/QC_PASSED (hoặc vừa bị xoá) - khoá xong không còn dòng nào

      await service.recordCutBatch(
        '100',
        {
          productionOrderId: '1',
          segments: [{ segmentSpecId: '30', qty: 4 }],
        },
        'user-1',
      );

      expect(prisma.cutPatternSegment.upsert).not.toHaveBeenCalled();
      expect(prisma.cutBundle.create).toHaveBeenCalled();
    });

    it('CHẶN cỡ đoạn không có trong định mức của lệnh (Sếp chốt: chỉ nhập đúng định mức)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      // Cỡ 31n có thật, cùng loại sắt, nhưng KHÔNG xuất hiện trong piece_bom của PI này
      prisma.segmentSpec.findMany.mockResolvedValue([
        { id: 31n, materialId: 30n, cutLengthMm: decimal(300) },
      ]);

      await expect(
        service.recordCutBatch(
          '100',
          {
            productionOrderId: '1',
            barCount: 1,
            segments: [{ segmentSpecId: '31', qty: 2 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('CHẶN cỡ đoạn thuộc LOẠI SẮT KHÁC - khai lẫn vật tư làm hỏng cả tiến độ lẫn cân bằng', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      prisma.segmentSpec.findMany.mockResolvedValue([
        { id: 30n, materialId: 999n, cutLengthMm: decimal(745) },
      ]);

      await expect(
        service.recordCutBatch(
          '100',
          {
            productionOrderId: '1',
            barCount: 1,
            segments: [{ segmentSpecId: '30', qty: 2 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('CHẶN SKU không thuộc PI của lô sắt (2026-09-21) - không ghi đợt cho SKU lạ', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);

      await expect(
        service.recordCutBatch(
          '100',
          {
            productionOrderId: '999',
            segments: [{ segmentSpecId: '30', qty: 2 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.cutBundle.create).not.toHaveBeenCalled();
    });

    it('chỉ gộp vào đợt đang CUTTING CỦA CÙNG SKU - câu khoá đợt lọc theo productionOrderId', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);

      await service.recordCutBatch(
        '100',
        {
          productionOrderId: '1',
          segments: [{ segmentSpecId: '30', qty: 2 }],
        },
        'user-1',
      );

      expect(prisma.$queryRaw).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('"productionOrderId"')]),
        100n,
        1n,
        'user-1',
      );
    });

    it('ném ConflictException nếu CHƯA xác nhận nhận (còn ISSUED)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue); // vẫn ISSUED

      await expect(
        service.recordCutBatch(
          '100',
          {
            productionOrderId: '1',
            barCount: 1,
            segments: [{ segmentSpecId: '30', qty: 8 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.cutBundle.create).not.toHaveBeenCalled();
    });

    // 2026-09-06: sửa lỗ hổng phát sinh từ CutBundle lifecycle (2026-09-05) - lô chỉ có DUY NHẤT
    // 1 đợt cắt, ngay khi đợt đó "Báo cắt xong" thì roll-up đẩy issue.status lên
    // AWAITING_QC/QC_PASSED, và check cũ `!== RECEIVED` VÔ TÌNH biến giá trị ROLL-UP (chỉ để 2 màn
    // cũ hiển thị) thành điều kiện CHẶN THẬT - y hệt vấn đề mà việc tách CutBundle định giải quyết.
    // Giờ CHO PHÉP mở đợt cắt mới dù issue đã roll-up QC_PASSED, miễn KHÔNG còn ISSUED (đã từng
    // xác nhận nhận) - đổi tên khỏi "phần bù không đi qua đây nữa" (không còn đúng nữa).
    it('CHO PHÉP dù issue đã roll-up QC_PASSED - lô có 1 đợt cắt vẫn mở được đợt cắt tiếp theo', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue({
        ...receivedIssue,
        status: SteelIssueStatus.QC_PASSED,
      });

      await expect(
        service.recordCutBatch(
          '100',
          {
            productionOrderId: '1',
            segments: [{ segmentSpecId: '30', qty: 8 }],
          },
          'user-1',
        ),
      ).resolves.toBeDefined();
      expect(prisma.cutBundle.create).toHaveBeenCalled();
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc" (assertPiHasActiveFloor, 2026-09-01)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.recordCutBatch(
          '100',
          {
            productionOrderId: '1',
            barCount: 1,
            segments: [{ segmentSpecId: '30', qty: 8 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.cutBundle.create).not.toHaveBeenCalled();
    });
  });

  // 2026-09-07: hoàn tác ĐÚNG lần "Lưu đợt cắt" gần nhất - FE gửi lại chính xác delta vừa submit,
  // hàm chỉ trừ đối xứng lại (không đọc lịch sử để suy luận).
  // Sổ ghi từng lần báo + chống gửi trùng (phần nền 2026-10-12, changelog-2026-10-08 mục 20).
  describe('sổ ghi từng lần báo (FloorReport) + Idempotency-Key', () => {
    const cutDto = { productionOrderId: '1', segments: [{ segmentSpecId: '30', qty: 8 }] };
    // Dòng sổ đã ghi (T4-4, 20/11/2026): vân tay khớp với cutDto / stepDto gửi bởi 'cn-1' / 'cn-3' bên dưới.
    const prevCut = (over: Record<string, unknown> = {}) => ({
      id: 5n,
      kind: FloorReportKind.CUT,
      reportedById: 'cn-1',
      workstationId: null,
      cutBundleId: 1n,
      lines: [{ segmentSpecId: 30n, pieceId: null, qty: 8 }],
      stepBatch: null,
      cutBundle: { steelIssueId: 100n },
      productionBatch: null,
      ...over,
    });
    const stepDto = {
      productionOrderId: '1',
      materialId: '30',
      step: ProcessStep.UON,
      segments: [{ segmentSpecId: '30', qty: 5 }],
    };
    const prevStep = (over: Record<string, unknown> = {}) => ({
      id: 8n,
      kind: FloorReportKind.STEP,
      reportedById: 'cn-3',
      workstationId: null,
      stepBatchId: 900n,
      lines: [{ segmentSpecId: 30n, pieceId: null, qty: 5 }],
      stepBatch: {
        productionInvoiceId: 1n,
        materialId: 30n,
        step: ProcessStep.UON,
        productionOrderId: 1n,
      },
      cutBundle: null,
      productionBatch: null,
      ...over,
    });

    it('recordCutBatch ghi 1 lần báo CUT: người báo, khoá, đợt cắt, từng dòng cỡ đoạn', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);

      await service.recordCutBatch('100', cutDto, 'cn-1', 'key-1');

      expect(prisma.floorReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: FloorReportKind.CUT,
          reportedById: 'cn-1',
          idempotencyKey: 'key-1',
          cutBundleId: 1n,
          lines: { create: [{ segmentSpecId: 30n, pieceId: undefined, qty: 8 }] },
        }) as unknown,
      });
    });

    it('cộng dồn vào đợt đang mở cũng ghi sổ (mỗi lần lưu 1 dòng, không chỉ lần mở đợt)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      openCutRows = [{ id: 7n, openedById: 'cn-2' }];

      await service.recordCutBatch('100', cutDto, 'cn-2');

      expect(prisma.cutBundle.create).not.toHaveBeenCalled();
      expect(prisma.floorReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reportedById: 'cn-2',
          cutBundleId: 7n,
          idempotencyKey: null,
        }) as unknown,
      });
    });

    it('gửi lại CÙNG khoá: trả đợt đã cộng, không cộng lần 2, không ghi sổ lần 2', async () => {
      prisma.floorReport.findUnique.mockResolvedValue(prevCut());

      const result = await service.recordCutBatch('100', cutDto, 'cn-1', 'key-1');

      expect(result.id).toBe('1');
      expect(prisma.cutBundle.create).not.toHaveBeenCalled();
      expect(prisma.cutPatternSegment.upsert).not.toHaveBeenCalled();
      expect(prisma.floorReport.create).not.toHaveBeenCalled();
    });

    it('gửi lại CÙNG khoá sau khi QLSX đã hủy hết đợt (sổ không còn trỏ đợt): 409 câu rõ, không ghi lại', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      prisma.floorReport.findUnique.mockResolvedValue(
        prevCut({ cutBundleId: null, cutBundle: null }),
      );

      await expect(service.recordCutBatch('100', cutDto, 'cn-1', 'key-1')).rejects.toThrow(
        /đã ghi nhận trước đó và đã bị QLSX hủy/,
      );
      expect(prisma.cutBundle.create).not.toHaveBeenCalled();
      expect(prisma.cutPatternSegment.upsert).not.toHaveBeenCalled();
      expect(prisma.floorReport.create).not.toHaveBeenCalled();
    });

    it('2 request cùng khoá, request thắng đã bị hủy hết đợt trước khi request thua đọc lại: 409 câu rõ', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      prisma.floorReport.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['idempotencyKey'] },
        }),
      );
      prisma.floorReport.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null) // đọc lại trong khoá chống trùng: chưa có (20/11/2026)
        .mockResolvedValueOnce(prevCut({ id: 6n, cutBundleId: null, cutBundle: null }));

      await expect(service.recordCutBatch('100', cutDto, 'cn-1', 'key-race')).rejects.toThrow(
        /đã ghi nhận trước đó và đã bị QLSX hủy/,
      );
    });

    it('2 request cùng khoá chạy song song: request thua (P2002) trả kết quả của request thắng', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      prisma.floorReport.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['idempotencyKey'] },
        }),
      );
      prisma.floorReport.findUnique
        .mockResolvedValueOnce(null) // lúc kiểm trước: chưa có
        .mockResolvedValueOnce(null) // đọc lại trong khoá chống trùng: chưa có (20/11/2026)
        .mockResolvedValueOnce(prevCut({ id: 6n })); // sau khi thua

      const result = await service.recordCutBatch('100', cutDto, 'cn-1', 'key-race');

      expect(result.id).toBe('1');
    });

    it('khoá đã dùng cho loại báo khác -> 422 IdempotencyKeyReusedException (trước đây 409)', async () => {
      prisma.floorReport.findUnique.mockResolvedValue(
        prevCut({ kind: FloorReportKind.PIECE, cutBundleId: null, cutBundle: null }),
      );

      await expect(service.recordCutBatch('100', cutDto, 'cn-1', 'key-x')).rejects.toBeInstanceOf(
        IdempotencyKeyReusedException,
      );
    });

    // T4-4: cùng khoá mà khác nội dung / người / lô thì 422, không trả đợt cũ và không ghi gì.
    it.each([
      [
        'khác số lượng',
        () =>
          service.recordCutBatch(
            '100',
            { ...cutDto, segments: [{ segmentSpecId: '30', qty: 9 }] },
            'cn-1',
            'key-1',
          ),
      ],
      [
        'khác cỡ đoạn',
        () =>
          service.recordCutBatch(
            '100',
            { ...cutDto, segments: [{ segmentSpecId: '31', qty: 8 }] },
            'cn-1',
            'key-1',
          ),
      ],
      ['khác người báo', () => service.recordCutBatch('100', cutDto, 'cn-9', 'key-1')],
      ['sang lô sắt khác', () => service.recordCutBatch('101', cutDto, 'cn-1', 'key-1')],
      [
        'qua máy QR khác',
        () => service.recordCutBatch('100', cutDto, 'cn-1', 'key-1', { workstationId: 4n }),
      ],
    ])(
      'báo cắt gửi lại cùng khoá nhưng %s -> 422, không trả đợt cũ, không ghi sổ',
      async (_l, call) => {
        prisma.floorReport.findUnique.mockResolvedValue(prevCut());

        await expect(call()).rejects.toBeInstanceOf(IdempotencyKeyReusedException);
        expect(prisma.cutBundle.create).not.toHaveBeenCalled();
        expect(prisma.cutPatternSegment.upsert).not.toHaveBeenCalled();
        expect(prisma.floorReport.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['khác số lượng', { ...stepDto, segments: [{ segmentSpecId: '30', qty: 6 }] }, 'cn-3'],
      ['khác công đoạn (Dập thay Uốn)', { ...stepDto, step: ProcessStep.DAP }, 'cn-3'],
      ['khác vật tư', { ...stepDto, materialId: '31' }, 'cn-3'],
      ['khác người báo', stepDto, 'cn-9'],
    ])(
      'báo công đoạn phụ gửi lại cùng khoá nhưng %s -> 422, không trả đợt cũ',
      async (_l, dto, user) => {
        prisma.floorReport.findUnique.mockResolvedValue(prevStep());

        await expect(service.recordStepBatch('1', dto, user, 'key-s')).rejects.toBeInstanceOf(
          IdempotencyKeyReusedException,
        );
        expect(prisma.stepBatch.create).not.toHaveBeenCalled();
        expect(prisma.stepBatch.findUniqueOrThrow).not.toHaveBeenCalled();
        expect(prisma.floorReport.create).not.toHaveBeenCalled();
      },
    );

    it('báo công đoạn phụ gửi lại cùng khoá nhưng đợt đã đổi SKU (body mang SKU khác) -> KHÔNG 422, trả đợt cũ (QA 20/11/2026)', async () => {
      prisma.floorReport.findUnique.mockResolvedValue(prevStep());
      prisma.stepBatch.findUniqueOrThrow.mockResolvedValue({
        id: 900n,
        step: ProcessStep.UON,
        segments: [],
      });

      const res = await service.recordStepBatch(
        '1',
        { ...stepDto, productionOrderId: '2' },
        'cn-3',
        'key-s',
      );

      expect(res.id).toBe('900');
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
      expect(prisma.floorReport.create).not.toHaveBeenCalled();
    });

    it('báo công đoạn phụ gửi vào PI khác với cùng khoá -> 422', async () => {
      prisma.floorReport.findUnique.mockResolvedValue(prevStep());

      await expect(service.recordStepBatch('2', stepDto, 'cn-3', 'key-s')).rejects.toBeInstanceOf(
        IdempotencyKeyReusedException,
      );
    });

    it('recordStepBatch ghi 1 lần báo STEP; gửi lại cùng khoá trả đúng đợt cũ', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON] },
      ]);
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        { segmentSpecId: 30n, qty: 8, cutBundle: { productionOrderId: 1n } },
      ]);
      const row = {
        id: 900n,
        step: ProcessStep.UON,
        segments: [{ segmentSpecId: 30n, qty: 5, segmentSpec: { cutLengthMm: decimal(745) } }],
      };
      prisma.stepBatch.create.mockResolvedValue(row);
      const dto = {
        productionOrderId: '1',
        materialId: '30',
        step: ProcessStep.UON,
        segments: [{ segmentSpecId: '30', qty: 5 }],
      };

      await service.recordStepBatch('1', dto, 'cn-3', 'key-s');
      expect(prisma.floorReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: FloorReportKind.STEP,
          reportedById: 'cn-3',
          stepBatchId: 900n,
          idempotencyKey: 'key-s',
        }) as unknown,
      });

      prisma.stepBatch.create.mockClear();
      prisma.floorReport.findUnique.mockResolvedValue(prevStep());
      prisma.stepBatch.findUniqueOrThrow.mockResolvedValue(row);
      const again = await service.recordStepBatch('1', dto, 'cn-3', 'key-s');
      expect(again.id).toBe('900');
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
    });

    // P1 (AC53, viết test tái hiện trước khi sửa): QLSX hủy lần báo => đợt bị xoá, FK sổ về NULL. Máy gửi lại cùng
    // Idempotency-Key từng bị tính là "lần báo mới" rồi vấp khoá trùng (409 câu kỹ thuật); giờ trả câu lời thường.
    it('recordStepBatch gửi lại CÙNG khoá sau khi QLSX đã hủy hết (stepBatchId NULL): 409 câu lời thường, không ghi lại', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON] },
      ]);
      prisma.floorReport.findUnique.mockResolvedValue(
        prevStep({ stepBatchId: null, stepBatch: null }),
      );

      const call = service.recordStepBatch(
        '1',
        {
          productionOrderId: '1',
          materialId: '30',
          step: ProcessStep.UON,
          segments: [{ segmentSpecId: '30', qty: 5 }],
        },
        'cn-3',
        'key-s',
      );

      await expect(call).rejects.toThrow(ConflictException);
      await expect(call).rejects.toThrow(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
      expect(prisma.floorReport.create).not.toHaveBeenCalled();
    });

    it('recordStepBatch: 2 request cùng khoá, request thắng đã bị hủy hết trước khi request thua đọc lại: 409 câu lời thường', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON] },
      ]);
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        { segmentSpecId: 30n, qty: 8, cutBundle: { productionOrderId: 1n } },
      ]);
      prisma.stepBatch.create.mockResolvedValue({ id: 901n, step: ProcessStep.UON, segments: [] });
      prisma.floorReport.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['idempotencyKey'] },
        }),
      );
      prisma.floorReport.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null) // đọc lại trong khoá chống trùng: chưa có (20/11/2026)
        .mockResolvedValueOnce(prevStep({ id: 6n, stepBatchId: null, stepBatch: null }));

      await expect(
        service.recordStepBatch(
          '1',
          {
            productionOrderId: '1',
            materialId: '30',
            step: ProcessStep.UON,
            segments: [{ segmentSpecId: '30', qty: 5 }],
          },
          'cn-3',
          'key-race',
        ),
      ).rejects.toThrow(FLOOR_REPORT_REVERSED_REPLAY_MESSAGE);
    });
  });

  describe('getPhoiProgress', () => {
    beforeEach(() => {
      // pieceBomRow (mặc định top-level) đã khớp bomRevisionId 5n/pieceId 20n/segmentSpecId 30n -
      // chỉ còn thiếu qtyPerUnit (mặc định bomPiece.findMany trả rỗng).
      prisma.bomPiece.findMany.mockResolvedValue([
        { bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 3 },
      ]);
      prisma.steelIssue.findMany.mockResolvedValue([
        { productionInvoiceId: 1n, materialId: 30n, barCount: 2 },
      ]);
    });

    it('done trả số THÔ (không trừ lỗi), failed = Σ failedQty CỘNG DỒN LỊCH SỬ (2026-09-07 lần 2, bỏ resolvedQty)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          qty: 8,
          cutBundle: { productionOrderId: 1n, steelIssue: { productionInvoiceId: 1n } },
        },
      ]);
      prisma.qcReviewSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          failedQty: 3,
          qcReview: {
            steelIssue: { productionInvoiceId: 1n },
            cutBundle: { productionOrderId: 1n, steelIssue: { productionInvoiceId: 1n } },
          },
        },
      ]);

      const result = await service.getPhoiProgress('1');

      // required = qtyPerPiece(4) x qtyPerUnit(3) x order.quantity(10) = 120
      expect(result[0].segments[0]).toEqual(
        expect.objectContaining({ required: 120, done: 8, failed: 3 }),
      );
    });

    describe('đối chiếu sắt vào - đoạn ra (steelBalance, 2026-10-12)', () => {
      const cut = (qty: number) => [
        {
          segmentSpecId: 30n,
          qty,
          cutBundle: { productionOrderId: 1n, steelIssue: { productionInvoiceId: 1n } },
        },
      ];
      const issueRow = (over: Record<string, unknown>) => ({
        productionInvoiceId: 1n,
        materialId: 30n,
        barCount: 2,
        barLengthMm: 6000,
        status: SteelIssueStatus.RECEIVED,
        receivedBarCount: null,
        reworkOfId: null,
        ...over,
      });

      it('dùng SỐ CÂY THỰC NHẬN × (dài cây − tề 10) so với đoạn × (dài đoạn + mạch 1): trong định mức -> overMm 0', async () => {
        prisma.steelIssue.findMany.mockResolvedValue([issueRow({ receivedBarCount: 2 })]);
        prisma.cutPatternSegment.findMany.mockResolvedValue(cut(8));

        const [item] = await service.getPhoiProgress('1');

        // 2 × 5990 = 11980 ; 8 × 746 = 5968
        expect(item.steelBalance).toEqual(
          expect.objectContaining({
            receivedBarCount: 2,
            usableMm: 11980,
            reportedMm: 5968,
            overMm: 0,
          }),
        );
      });

      it('nhận thiếu (1/2 cây) + báo 9 đoạn -> vượt 724mm (cảnh báo, không chặn)', async () => {
        prisma.steelIssue.findMany.mockResolvedValue([issueRow({ receivedBarCount: 1 })]);
        prisma.cutPatternSegment.findMany.mockResolvedValue(cut(9));

        const [item] = await service.getPhoiProgress('1');

        // 1 × 5990 = 5990 ; 9 × 746 = 6714 -> vượt 724
        expect(item.steelBalance).toEqual(
          expect.objectContaining({ receivedBarCount: 1, usableMm: 5990, overMm: 724 }),
        );
      });

      it('phương án cắt bằng MC Tự động -> dùng tề 0 / lưỡi 2,5 của MCTĐ, không dùng cặp MC Laser (2026-10-23)', async () => {
        prisma.steelIssue.findMany.mockResolvedValue([issueRow({ receivedBarCount: 2 })]);
        prisma.cutPatternSegment.findMany.mockResolvedValue(cut(8));
        prisma.cuttingProposalLine.findMany.mockResolvedValue([
          {
            materialId: 30n,
            machine: 'tu_dong',
            cuttingProposal: { productionInvoiceId: 1n, productionOrder: null },
          },
        ]);

        const [item] = await service.getPhoiProgress('1');

        // 2 × (6000 − 0) = 12000 ; 8 × (746 − 1 + 2.5 = 747.5) = 5980  (mạch 2,5 thay vì 1)
        expect(item.steelBalance).toEqual(
          expect.objectContaining({ usableMm: 12000, reportedMm: 5980, overMm: 0 }),
        );
      });

      it('máy ghi trên phương án neo LỆNH SX của PI cũng được nhận ra; dòng laser / PI khác không đổi máy', async () => {
        prisma.steelIssue.findMany.mockResolvedValue([issueRow({ receivedBarCount: 2 })]);
        prisma.cutPatternSegment.findMany.mockResolvedValue(cut(8));
        prisma.cuttingProposalLine.findMany.mockResolvedValue([
          {
            materialId: 30n,
            machine: 'tu_dong',
            cuttingProposal: {
              productionInvoiceId: null,
              productionOrder: { productionInvoiceItem: { productionInvoiceId: 1n } },
            },
          },
          // PI khác (không thuộc PI 1) - bị bỏ qua.
          {
            materialId: 31n,
            machine: 'tu_dong',
            cuttingProposal: { productionInvoiceId: 2n, productionOrder: null },
          },
        ]);

        const [item] = await service.getPhoiProgress('1');

        expect(item.steelBalance?.usableMm).toBe(12000); // tề 0 của MCTĐ

        prisma.cuttingProposalLine.findMany.mockResolvedValue([
          {
            materialId: 30n,
            machine: 'laser',
            cuttingProposal: { productionInvoiceId: 1n, productionOrder: null },
          },
        ]);
        const [laser] = await service.getPhoiProgress('1');
        expect(laser.steelBalance?.usableMm).toBe(11980); // tề 10 của MC Laser như cũ
      });

      it('đợt kho mới xuất, Phôi CHƯA nhận (ISSUED) không tính; chưa nhận đợt nào -> steelBalance null', async () => {
        prisma.steelIssue.findMany.mockResolvedValue([
          issueRow({ status: SteelIssueStatus.ISSUED }),
        ]);
        prisma.cutPatternSegment.findMany.mockResolvedValue(cut(8));

        const [item] = await service.getPhoiProgress('1');

        expect(item.steelBalance).toBeNull();
        expect(item.issuedBarCount).toBe(2); // kế hoạch xuất vẫn đếm như cũ
      });

      it('đợt rework vẫn cộng vào sắt đã nhận nhưng KHÔNG vào issuedBarCount (giữ nghĩa cũ)', async () => {
        prisma.steelIssue.findMany.mockResolvedValue([
          issueRow({ receivedBarCount: 2 }),
          issueRow({ barCount: 1, receivedBarCount: 1, reworkOfId: 99n }),
        ]);
        prisma.cutPatternSegment.findMany.mockResolvedValue(cut(8));

        const [item] = await service.getPhoiProgress('1');

        expect(item.issuedBarCount).toBe(2);
        expect(item.steelBalance?.receivedBarCount).toBe(3);
      });
    });

    it('failed = 0 khi chưa có lỗi nào (qcReviewSegment rỗng)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          qty: 8,
          cutBundle: { productionOrderId: 1n, steelIssue: { productionInvoiceId: 1n } },
        },
      ]);

      const result = await service.getPhoiProgress('1');

      expect(result[0].segments[0]).toEqual(expect.objectContaining({ done: 8, failed: 0 }));
    });

    it('failed CỘNG DỒN nhiều lần chấm (không tự giảm dù đã bù đủ bằng đợt mới)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          qty: 8,
          cutBundle: { productionOrderId: 1n, steelIssue: { productionInvoiceId: 1n } },
        },
      ]);
      prisma.qcReviewSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          failedQty: 3,
          qcReview: {
            steelIssue: { productionInvoiceId: 1n },
            cutBundle: { productionOrderId: 1n, steelIssue: { productionInvoiceId: 1n } },
          },
        },
        {
          segmentSpecId: 30n,
          failedQty: 1,
          qcReview: {
            steelIssue: { productionInvoiceId: 1n },
            cutBundle: { productionOrderId: 1n, steelIssue: { productionInvoiceId: 1n } },
          },
        },
      ]);

      const result = await service.getPhoiProgress('1');

      expect(result[0].segments[0]).toEqual(expect.objectContaining({ done: 8, failed: 4 }));
    });

    // 2026-09-21: tách tiến độ theo SKU - "Cần" theo định mức riêng từng SKU, "Đã cắt/Lỗi" theo SKU ghi
    // trên đợt cắt; đợt CŨ (productionOrderId null) gom ở dòng productionOrderId=null, không chia bừa.
    it('byOrder: PI chỉ 1 SKU -> đợt CŨ chưa gắn SKU tính cho SKU đó (không mơ hồ)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          qty: 8,
          cutBundle: { productionOrderId: 1n, steelIssue: { productionInvoiceId: 1n } },
        },
        {
          segmentSpecId: 30n,
          qty: 5,
          cutBundle: { productionOrderId: null, steelIssue: { productionInvoiceId: 1n } },
        },
      ]);

      const result = await service.getPhoiProgress('1');

      expect(result[0].segments[0].byOrder).toEqual([
        expect.objectContaining({ productionOrderId: '1', required: 120, done: 13 }),
      ]);
    });

    it('byOrder: tách required/done/failed theo SKU; PI NHIỀU SKU - đợt cũ chưa gắn SKU ra dòng null', async () => {
      // 2 SKU cùng dùng định mức bomRevision 5n (mỗi SKU required 120) -> không thể đoán đợt cũ của SKU nào
      prisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 1n,
          bomRevisionId: 5n,
          quantity: 10,
          floorStage: 'ACTIVE',
          productionInvoiceItem: { productionInvoiceId: 1n },
        },
        {
          id: 2n,
          bomRevisionId: 5n,
          quantity: 10,
          floorStage: 'ACTIVE',
          productionInvoiceItem: { productionInvoiceId: 1n },
        },
      ]);
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          qty: 8,
          cutBundle: { productionOrderId: 1n, steelIssue: { productionInvoiceId: 1n } },
        },
        {
          segmentSpecId: 30n,
          qty: 5,
          cutBundle: { productionOrderId: null, steelIssue: { productionInvoiceId: 1n } },
        },
      ]);
      prisma.qcReviewSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          failedQty: 2,
          qcReview: {
            steelIssue: { productionInvoiceId: 1n },
            cutBundle: { productionOrderId: 1n, steelIssue: { productionInvoiceId: 1n } },
          },
        },
        {
          segmentSpecId: 30n,
          failedQty: 1,
          qcReview: { steelIssue: { productionInvoiceId: 1n }, cutBundle: null },
        },
      ]);

      const result = await service.getPhoiProgress('1');
      const seg30 = result[0].segments[0];

      expect(seg30).toEqual(expect.objectContaining({ required: 240, done: 13, failed: 3 }));
      expect(seg30.byOrder).toEqual([
        expect.objectContaining({ productionOrderId: '1', required: 120, done: 8, failed: 2 }),
        expect.objectContaining({ productionOrderId: '2', required: 120, done: 0, failed: 0 }),
        expect.objectContaining({ productionOrderId: null, required: 0, done: 5, failed: 1 }),
      ]);
      // Tổng các SKU khớp đúng số cả PI
      expect(seg30.byOrder.reduce((t, o) => t + o.done, 0)).toBe(seg30.done);
    });

    it('2026-10-16: tách phần chưa gửi KCS (đợt CUTTING) và chờ KCS (AWAITING_QC) khỏi done, theo cả PI lẫn SKU', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 1n,
          bomRevisionId: 5n,
          quantity: 10,
          floorStage: 'ACTIVE',
          productionInvoiceItem: { productionInvoiceId: 1n },
        },
        {
          id: 2n,
          bomRevisionId: 5n,
          quantity: 10,
          floorStage: 'ACTIVE',
          productionInvoiceItem: { productionInvoiceId: 1n },
        },
      ]);
      const cut = (orderId: bigint, qty: number, status: string) => ({
        segmentSpecId: 30n,
        qty,
        cutBundle: { productionOrderId: orderId, status, steelIssue: { productionInvoiceId: 1n } },
      });
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        cut(1n, 8, 'CUTTING'),
        cut(1n, 5, 'AWAITING_QC'),
        cut(2n, 6, 'QC_PASSED'),
        cut(2n, 3, 'CUTTING'),
      ]);

      const [item] = await service.getPhoiProgress('1');
      const seg30 = item.segments[0];

      expect(seg30).toEqual(expect.objectContaining({ done: 22, openQty: 11, awaitingQcQty: 5 }));
      expect(seg30.byOrder).toEqual([
        expect.objectContaining({ productionOrderId: '1', done: 13, openQty: 8, awaitingQcQty: 5 }),
        expect.objectContaining({ productionOrderId: '2', done: 9, openQty: 3, awaitingQcQty: 0 }),
      ]);
    });

    it('2026-10-16: công đoạn phụ - dòng chưa vào đợt = chưa gửi KCS, đợt AWAITING_QC = chờ KCS, đợt QC_PASSED = đã chấm', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON] },
      ]);
      const step = (qty: number, bundle: { status: string } | null) => ({
        segmentSpecId: 30n,
        qty,
        stepBatch: {
          productionOrderId: 1n,
          step: ProcessStep.UON,
          productionInvoiceId: 1n,
          stepBundle: bundle,
        },
      });
      prisma.stepBatchSegment.findMany.mockResolvedValue([
        step(4, null),
        step(6, { status: 'AWAITING_QC' }),
        step(10, { status: 'QC_PASSED' }),
      ]);

      const [item] = await service.getStepProgress('1', ProcessStep.UON);

      expect(item.segments[0]).toEqual(
        expect.objectContaining({ done: 20, openQty: 4, awaitingQcQty: 6 }),
      );
      expect(item.segments[0].byOrder[0]).toEqual(
        expect.objectContaining({ productionOrderId: '1', openQty: 4, awaitingQcQty: 6 }),
      );
    });
  });

  // Sửa 2026-09-05: getIssuePlan() giờ lấy "Cần" từ CuttingProposalLine (kết quả phần mềm tính cắt
  // sắt đã duyệt: totalBars/bestStockLengthMm) THAY VÌ định mức BOM - Mua hàng cũng mua theo đúng
  // số này nên "Cần" phải khớp. bomPiece/pieceBom không còn được getIssuePlan() dùng nữa.
  // P1 (18/11/2026): tiến độ theo NGHĨA MỚI - done = đã báo - thiếu (vẫn gồm lỗi), required = định mức + phần cắt lại,
  // maxNow / physicalLeft từ phoi-need.util (cùng hàm với phép chặn lúc báo).
  describe('getPhoiProgress / getStepProgress - nghĩa mới (P1)', () => {
    const cutRow = (
      qty: number,
      orderId: bigint | null = 1n,
      status: CutBundleStatus = CutBundleStatus.QC_PASSED,
    ) => ({
      segmentSpecId: 30n,
      qty,
      cutBundle: { productionOrderId: orderId, status, steelIssue: { productionInvoiceId: 1n } },
    });
    const stepRow = (
      qty: number,
      orderId: bigint | null = 1n,
      bundleStatus: string | null = 'QC_PASSED',
    ) => ({
      segmentSpecId: 30n,
      qty,
      stepBatch: {
        productionOrderId: orderId,
        step: ProcessStep.UON,
        productionInvoiceId: 1n,
        stepBundle: bundleStatus ? { status: bundleStatus } : null,
      },
    });
    const cutQc = (failedQty: number, shortQty: number, orderId: bigint | null = 1n) => ({
      segmentSpecId: 30n,
      failedQty,
      shortQty,
      qcReview: {
        steelIssue: { productionInvoiceId: 1n },
        cutBundle: { productionOrderId: orderId },
      },
    });
    const stepQc = (
      failedQty: number,
      scrapQty: number,
      shortQty = 0,
      orderId: bigint | null = 1n,
    ) => ({
      segmentSpecId: 30n,
      failedQty,
      shortQty,
      scrapQty,
      qcReview: {
        stepBundle: { productionOrderId: orderId, step: ProcessStep.UON, productionInvoiceId: 1n },
      },
    });
    const issueRow = (over: Record<string, unknown> = {}) => ({
      productionInvoiceId: 1n,
      materialId: 30n,
      barCount: 2,
      barLengthMm: 6000,
      status: SteelIssueStatus.RECEIVED,
      receivedBarCount: null,
      reworkOfId: null,
      ...over,
    });

    beforeEach(() => {
      // Số cần: qtyPerPiece 4 × qtyPerUnit 3 × SL 10 = 120 đoạn cỡ 30; dòng định mức đi Cắt + Uốn.
      prisma.bomPiece.findMany.mockResolvedValue([
        { bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 3 },
      ]);
      prisma.pieceBom.findMany.mockResolvedValue([
        { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON] },
      ]);
      prisma.steelIssue.findMany.mockResolvedValue([issueRow()]);
    });

    it('P1 [5]/[7]: tiến độ Cắt chỉ đọc phiếu chấm của lô sắt, loại phiếu có stepBundleId (cùng phép chặn lúc báo)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([]);
      prisma.qcReviewSegment.findMany.mockResolvedValue([]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([]);

      await service.getPhoiProgress('1');

      const wheres = (prisma.qcReviewSegment.findMany.mock.calls as [{ where: unknown }][]).map(
        (c) => c[0].where,
      );
      expect(wheres).toContainEqual({
        qcReview: { steelIssue: { productionInvoiceId: { in: [1n] } }, stepBundleId: null },
      });
    });

    it('Cắt: done = thô - thiếu (vẫn gồm lỗi); required = định mức + phần cắt lại cho đoạn Uốn BỎ; maxNow = số cần - đã tính', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(8)]);
      prisma.qcReviewSegment.findMany
        .mockResolvedValueOnce([cutQc(1, 2)]) // QC của Cắt: lỗi 1, thiếu 2
        .mockResolvedValueOnce([stepQc(4, 3)]); // QC của Uốn: lỗi 4 (bỏ 3, làm lại 1)
      prisma.stepBatchSegment.findMany.mockResolvedValue([stepRow(6)]);

      const [item] = await service.getPhoiProgress('1');

      const seg = item.segments[0];
      expect(seg).toEqual(
        expect.objectContaining({
          required: 123, // 120 + 3 cắt lại
          baseRequired: 120,
          extraNeed: 3,
          done: 6, // 8 - thiếu 2
          failed: 1,
          shortQty: 2,
          scrapQty: 0, // Cắt luôn 0
          reportedQty: 8,
          maxNow: 118, // 123 - (8 - 1 - 2)
          physicalLeft: null,
        }),
      );
      expect(seg.byOrder).toHaveLength(1);
      expect(seg.byOrder[0]).toEqual(
        expect.objectContaining({
          productionOrderId: '1',
          required: 123,
          extraNeed: 3,
          maxNow: 118,
        }),
      );
    });

    it('công đoạn phụ: required = định mức + bỏ ở công đoạn SAU; physicalLeft = đoạn cắt thực có - đã dùng; maxNow = min(2 vế)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(8)]);
      prisma.qcReviewSegment.findMany
        .mockResolvedValueOnce([cutQc(0, 2)])
        .mockResolvedValueOnce([stepQc(4, 3)]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([stepRow(6)]);

      const [item] = await service.getStepProgress('1', ProcessStep.UON);

      // Uốn: cần 120 (không có công đoạn sau Uốn bỏ), thô 6, lỗi 4 -> đã tính 2, room 118.
      // Vật lý: cắt thực có 8 - 2 = 6; đã dùng 6 - 0 - (4 - 3 = 1 làm lại) = 5 -> còn 1.
      expect(item.segments[0]).toEqual(
        expect.objectContaining({
          required: 120,
          extraNeed: 0,
          done: 6,
          failed: 4,
          scrapQty: 3,
          reportedQty: 6,
          physicalLeft: 1,
          maxNow: 1,
        }),
      );
    });

    it('openQty / awaitingQcQty vẫn là phần của done (số thô) theo trạng thái đợt', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([
        cutRow(5, 1n, CutBundleStatus.CUTTING),
        cutRow(3, 1n, CutBundleStatus.AWAITING_QC),
      ]);

      const [item] = await service.getPhoiProgress('1');

      expect(item.segments[0]).toEqual(
        expect.objectContaining({ done: 8, openQty: 5, awaitingQcQty: 3 }),
      );
    });

    it('AC60: PI NHIỀU SKU - đợt cũ chưa gắn SKU (kể cả phần "bỏ" do migration) không làm tăng số cần của SKU nào, ra dòng null required 0 maxNow 0', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([
        order,
        { ...order, id: 2n, productionInvoiceItem: { productionInvoiceId: 1n } },
      ]);
      prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(30, null), cutRow(10, 1n)]);
      prisma.qcReviewSegment.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stepQc(4, 4, 0, null)]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([stepRow(7, null)]);

      const [item] = await service.getPhoiProgress('1');

      const seg = item.segments[0];
      expect(seg.extraNeed).toBe(0); // phần bỏ của đợt Uốn null không vào số cần của cả PI
      expect(seg.required).toBe(240); // 2 SKU × 120
      const none = seg.byOrder.find((o) => o.productionOrderId === null)!;
      expect(none).toEqual(
        expect.objectContaining({ required: 0, extraNeed: 0, done: 30, maxNow: 0 }),
      );
      expect(seg.byOrder.find((o) => o.productionOrderId === '1')!.extraNeed).toBe(0);
      expect(seg.byOrder.find((o) => o.productionOrderId === '2')!.extraNeed).toBe(0);
    });

    it('PI 1 SKU: đợt cũ chưa gắn SKU và phần bỏ của nó tính cho SKU duy nhất (extraNeed của SKU tăng)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(30, null)]);
      prisma.qcReviewSegment.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stepQc(4, 4, 0, null)]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([stepRow(7, null)]);

      const [item] = await service.getPhoiProgress('1');

      expect(item.segments[0].byOrder).toHaveLength(1);
      expect(item.segments[0].byOrder[0]).toEqual(
        expect.objectContaining({ productionOrderId: '1', extraNeed: 4, required: 124 }),
      );
    });

    describe('steelBalance gợi ý (chỉ đọc)', () => {
      const held = (remaining: number, stockLengthMm: number) => ({
        productionInvoiceId: 1n,
        materialId: 30n,
        quantity: decimal(remaining + 2),
        consumedQty: decimal(2),
        stockLengthMm,
      });

      it('thiếu sắt: còn phải cắt 112 đoạn, sắt đã nhận chưa cắt + sắt còn xuất được không đủ -> shortMm > 0', async () => {
        prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(8)]);
        prisma.stockReservation.findMany.mockResolvedValue([held(3, 6000)]);

        const [item] = await service.getPhoiProgress('1');

        // usable 2 × 5990 = 11980; đã báo 8 × 746 = 5968; còn phải cắt 112 × 746 = 83552
        expect(item.steelBalance).toEqual(
          expect.objectContaining({
            remainingSegments: 112,
            recutSegments: 0,
            remainingNeedMm: 83552,
            leftoverReceivedMm: 6012,
            issuableMm: 18000,
            shortMm: 83552 - 6012 - 18000,
          }),
        );
      });

      it('đủ sắt: shortMm = 0; "cắt lại" tính vào recutSegments', async () => {
        prisma.steelIssue.findMany.mockResolvedValue([issueRow({ barCount: 200 })]);
        prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(120)]);
        prisma.qcReviewSegment.findMany
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([stepQc(5, 5)]);
        prisma.stepBatchSegment.findMany.mockResolvedValue([stepRow(120)]);

        const [item] = await service.getPhoiProgress('1');

        // Cắt cần 125 (120 + 5 cắt lại), đã tính 120 -> còn 5, toàn bộ là cắt lại.
        expect(item.steelBalance).toEqual(
          expect.objectContaining({ remainingSegments: 5, recutSegments: 5, shortMm: 0 }),
        );
      });

      it('chiều dài cây của phần giữ chỗ không rõ (0) -> issuableMm = null và không tính vào shortMm', async () => {
        prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(8)]);
        prisma.stockReservation.findMany.mockResolvedValue([held(3, 0)]);

        const [item] = await service.getPhoiProgress('1');

        expect(item.steelBalance?.issuableMm).toBeNull();
        expect(item.steelBalance?.shortMm).toBe(83552 - 6012);
      });

      it('không còn giữ chỗ nào: issuableMm = 0', async () => {
        prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(8)]);
        prisma.stockReservation.findMany.mockResolvedValue([]);

        const [item] = await service.getPhoiProgress('1');

        expect(item.steelBalance?.issuableMm).toBe(0);
      });
    });
  });

  describe('stepOveruseAfterCutShortage (P1, AC34)', () => {
    const cutRow = (qty: number) => ({
      segmentSpecId: 30n,
      qty,
      cutBundle: { productionOrderId: 1n },
    });

    beforeEach(() => {
      prisma.bomPiece.findMany.mockResolvedValue([
        { bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 3 },
      ]);
      prisma.pieceBom.findMany.mockResolvedValue([
        { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON] },
      ]);
      prisma.segmentSpec.findMany.mockResolvedValue([
        { id: 30n, materialId: 30n, cutLengthMm: decimal(745) },
      ]);
    });

    it('KCS ghi thiếu 5 ở Cắt, Uốn đã dùng 40 > cắt thực có 35 -> trả { Uốn, cỡ, vượt 5 }', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(40)]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          qty: 40,
          stepBatch: { productionOrderId: 1n, step: ProcessStep.UON },
        },
      ]);
      prisma.qcReviewSegment.findMany
        .mockResolvedValueOnce([
          {
            segmentSpecId: 30n,
            failedQty: 0,
            shortQty: 5,
            qcReview: { cutBundle: { productionOrderId: 1n } },
          },
        ])
        .mockResolvedValue([]);

      const out = await service.stepOveruseAfterCutShortage(1n, 30n, 1n, [30n]);

      expect(out).toEqual([{ step: ProcessStep.UON, cutLengthMm: 745, overBy: 5, cutCap: 35 }]);
    });

    it('chưa vượt -> rỗng; không có SKU (PI nhiều SKU, null) hoặc không có cỡ -> rỗng, không đọc gì', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(40)]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          qty: 30,
          stepBatch: { productionOrderId: 1n, step: ProcessStep.UON },
        },
      ]);
      expect(await service.stepOveruseAfterCutShortage(1n, 30n, 1n, [30n])).toEqual([]);

      prisma.productionOrder.findMany.mockResolvedValue([
        order,
        { ...order, id: 2n, productionInvoiceItem: { productionInvoiceId: 1n } },
      ]);
      expect(await service.stepOveruseAfterCutShortage(1n, 30n, null, [30n])).toEqual([]);
      expect(await service.stepOveruseAfterCutShortage(1n, 30n, 1n, [])).toEqual([]);
    });

    it('productionOrderId null ở PI 1 SKU tính cho SKU duy nhất', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(40)]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          qty: 40,
          stepBatch: { productionOrderId: 1n, step: ProcessStep.UON },
        },
      ]);
      prisma.qcReviewSegment.findMany
        .mockResolvedValueOnce([
          {
            segmentSpecId: 30n,
            failedQty: 0,
            shortQty: 2,
            qcReview: { cutBundle: { productionOrderId: 1n } },
          },
        ])
        .mockResolvedValue([]);

      const out = await service.stepOveruseAfterCutShortage(1n, 30n, null, [30n]);

      expect(out).toEqual([{ step: ProcessStep.UON, cutLengthMm: 745, overBy: 2, cutCap: 38 }]);
    });
  });

  describe('getIssuePlan', () => {
    const lineRow = { materialId: 30n, totalBars: 100, bestStockLengthMm: 6000 };

    it('trả remainingToIssue/physicalStockQty đúng khi có phương án duyệt + giữ chỗ ACTIVE', async () => {
      prisma.cuttingProposalLine.findMany.mockResolvedValue([lineRow]);
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, warehouseId: 800n, code: 'ST-18', name: 'Sắt vuông 18x18' },
      ]);
      prisma.stockReservation.findMany.mockResolvedValue([
        { materialId: 30n, quantity: decimal(20), consumedQty: decimal(12) },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 800n, materialId: 30n, stockLengthMm: 6000, qty: decimal(50) },
      ]);

      const [result] = await service.getIssuePlan('1');

      expect(result.requiredBars).toBe(100);
      expect(result.bestStockLengthMm).toBe(6000);
      expect(result.remainingToIssue).toBe(8); // 20 - 12
      expect(result.physicalStockQty).toBe(50);
    });

    // L5 (2026-08-26): 2 SKU dùng chung 1 loại sắt, mỗi SKU có dòng giữ chỗ riêng (2 CuttingProposal
    // khác nhau) - "còn lại" hiển thị cho Phôi phải là TỔNG của cả 2, không phải chỉ 1 dòng (bug cũ:
    // Map theo materialId ghi đè, chỉ thấy giữ chỗ của SKU ghi SAU trong mảng kết quả truy vấn).
    it('2 SKU dùng chung 1 loại sắt: remainingToIssue = TỔNG của mọi dòng giữ chỗ, không ghi đè', async () => {
      prisma.cuttingProposalLine.findMany.mockResolvedValue([lineRow]);
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, warehouseId: 800n, code: 'ST-18', name: 'Sắt vuông 18x18' },
      ]);
      prisma.stockReservation.findMany.mockResolvedValue([
        { materialId: 30n, quantity: decimal(20), consumedQty: decimal(12) }, // SKU A: còn 8
        { materialId: 30n, quantity: decimal(15), consumedQty: decimal(0) }, // SKU B: còn 15
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 800n, materialId: 30n, stockLengthMm: 6000, qty: decimal(50) },
      ]);

      const [result] = await service.getIssuePlan('1');

      expect(result.remainingToIssue).toBe(23); // 8 + 15, không phải chỉ 1 trong 2
    });

    it('remainingToIssue = null khi không có dòng giữ chỗ ACTIVE nào cho vật tư này', async () => {
      prisma.cuttingProposalLine.findMany.mockResolvedValue([lineRow]);
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, warehouseId: 800n, code: 'ST-18', name: 'Sắt vuông 18x18' },
      ]);
      prisma.stockReservation.findMany.mockResolvedValue([]); // không giữ chỗ nào
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 800n, materialId: 30n, stockLengthMm: 6000, qty: decimal(50) },
      ]);

      const [result] = await service.getIssuePlan('1');

      expect(result.remainingToIssue).toBeNull();
      expect(result.physicalStockQty).toBe(50); // tồn thật vẫn hiện được, độc lập với giữ chỗ
    });

    it('physicalStockQty = null khi vật tư chưa được gán Kho (Material.warehouseId trống)', async () => {
      prisma.cuttingProposalLine.findMany.mockResolvedValue([lineRow]);
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, warehouseId: null, code: 'ST-18', name: 'Sắt vuông 18x18' },
      ]);

      const [result] = await service.getIssuePlan('1');

      expect(result.physicalStockQty).toBeNull();
    });

    it('2 CuttingProposalLine cùng material (PI-anchored + PO-anchored): cộng dồn requiredBars, giữ 1 bestStockLengthMm chung', async () => {
      prisma.cuttingProposalLine.findMany.mockResolvedValue([
        { materialId: 30n, totalBars: 80, bestStockLengthMm: 6000 },
        { materialId: 30n, totalBars: 40, bestStockLengthMm: 6000 },
      ]);
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, warehouseId: 800n, code: 'ST-18', name: 'Sắt vuông 18x18' },
      ]);
      prisma.stockReservation.findMany.mockResolvedValue([
        { materialId: 30n, quantity: decimal(20), consumedQty: decimal(0) },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 800n, materialId: 30n, stockLengthMm: 6000, qty: decimal(50) },
      ]);

      const result = await service.getIssuePlan('1');

      expect(result).toHaveLength(1);
      expect(result[0].materialId).toBe('30');
      expect(result[0].requiredBars).toBe(80 + 40);
      expect(result[0].bestStockLengthMm).toBe(6000);
      expect(result[0].remainingToIssue).toBe(20);
    });

    it('2 loại sắt khác nhau trong PI: sinh 2 dòng kế hoạch riêng, không lẫn issuedBarCount', async () => {
      prisma.cuttingProposalLine.findMany.mockResolvedValue([
        { materialId: 30n, totalBars: 80, bestStockLengthMm: 6000 },
        { materialId: 999n, totalBars: 60, bestStockLengthMm: 6000 },
      ]);
      // Đã xuất 5 cây cho material 30n trong PI này - KHÔNG được lẫn sang dòng material 999n.
      prisma.steelIssue.findMany.mockResolvedValue([{ materialId: 30n, barCount: 5 }]);
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, warehouseId: 800n, code: 'ST-18', name: 'Sắt vuông 18x18' },
        { id: 999n, warehouseId: null, code: 'ST-25', name: 'Sắt hộp 25x25' },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([]);

      const result = await service.getIssuePlan('1');

      expect(result).toHaveLength(2);
      const line30 = result.find((r) => r.materialId === '30');
      const line999 = result.find((r) => r.materialId === '999');
      expect(line30?.materialCode).toBe('ST-18');
      expect(line30?.issuedBarCount).toBe(5);
      expect(line30?.requiredBars).toBe(80);
      expect(line999?.materialCode).toBe('ST-25');
      expect(line999?.issuedBarCount).toBe(0); // không lẫn từ material 30n
      expect(line999?.requiredBars).toBe(60);
    });

    // Phương án cắt phủ vật tư này đã bị tính lại/supersede (không còn dòng APPROVED nào) - vật tư
    // vẫn phải hiện để giữ lịch sử "Đã xuất", chỉ "Cần" về 0/null thay vì biến mất khỏi màn hình.
    it('vật tư chỉ còn lịch sử đã xuất (không còn CuttingProposalLine hiệu lực): vẫn hiện với requiredBars=0, bestStockLengthMm=null', async () => {
      prisma.cuttingProposalLine.findMany.mockResolvedValue([]);
      prisma.steelIssue.findMany.mockResolvedValue([{ materialId: 30n, barCount: 12 }]);
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, warehouseId: 800n, code: 'ST-18', name: 'Sắt vuông 18x18' },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 800n, materialId: 30n, stockLengthMm: 6000, qty: decimal(15) },
        { warehouseId: 800n, materialId: 30n, stockLengthMm: 5900, qty: decimal(9) },
      ]);

      const result = await service.getIssuePlan('1');

      expect(result).toHaveLength(1);
      expect(result[0].requiredBars).toBe(0);
      expect(result[0].bestStockLengthMm).toBeNull();
      expect(result[0].issuedBarCount).toBe(12);
      // Không có bestStockLengthMm cụ thể để lọc -> fallback cộng MỌI bucket (15 + 9).
      expect(result[0].physicalStockQty).toBe(24);
    });

    it('physicalStockQty chỉ cộng ĐÚNG bucket chiều dài đang cần, không cộng lẫn bucket khác', async () => {
      prisma.cuttingProposalLine.findMany.mockResolvedValue([lineRow]); // bestStockLengthMm 6000
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, warehouseId: 800n, code: 'ST-18', name: 'Sắt vuông 18x18' },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 800n, materialId: 30n, stockLengthMm: 6000, qty: decimal(50) },
        { warehouseId: 800n, materialId: 30n, stockLengthMm: 5900, qty: decimal(30) },
      ]);

      const [result] = await service.getIssuePlan('1');

      expect(result.physicalStockQty).toBe(50); // không phải 80
    });
  });

  describe('getOrderSummary', () => {
    it('trả đúng PO/SKU của mọi ProductionOrder thuộc PI, salesOrderCode null khi PI gộp không gắn đơn nào', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([
        {
          id: 47n,
          poNumber: 'PO-47',
          quantity: 20,
          mfgProduct: { name: 'Ghế tình yêu', factoryCode: 'GTY' },
          productionInvoiceItem: {
            salesOrder: { orderCode: 'SO-47' },
            stages: [
              { stageType: 'PHOI_START', deadline: new Date('2026-06-18') },
              { stageType: 'FRAME_PHOI', deadline: new Date('2026-06-20') },
            ],
          },
        },
        {
          id: 48n,
          poNumber: 'PO-48',
          quantity: 8,
          mfgProduct: { name: 'Ghế J55', factoryCode: 'J55' },
          productionInvoiceItem: { salesOrder: null, stages: [] },
        },
      ]);

      const result = await service.getOrderSummary('1');

      expect(result).toEqual([
        {
          productionOrderId: '47',
          sku: 'GTY',
          poNumber: 'PO-47',
          salesOrderCode: 'SO-47',
          productName: 'Ghế tình yêu',
          quantity: 20,
          phoiDeadline: new Date('2026-06-20'),
          phoiStart: new Date('2026-06-18'),
        },
        {
          productionOrderId: '48',
          sku: 'J55',
          poNumber: 'PO-48',
          salesOrderCode: null,
          productName: 'Ghế J55',
          quantity: 8,
          phoiDeadline: null,
          phoiStart: null,
        },
      ]);
    });

    it('trả mảng rỗng khi PI chưa có ProductionOrder nào (chưa được Sếp duyệt)', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([]);

      const result = await service.getOrderSummary('1');

      expect(result).toEqual([]);
    });
  });

  describe('findAllForInvoiceBatch (2026-08-31 - gộp nhiều PI 1 lần cho Bảng thống kê)', () => {
    it('mảng rỗng - trả {} ngay, không query gì', async () => {
      const result = await service.findAllForInvoiceBatch([]);

      expect(result).toEqual({});
      expect(prisma.steelIssue.findMany).not.toHaveBeenCalled();
    });

    it('mọi id truyền vào đều pre-seed [] kể cả khi không có đợt xuất nào', async () => {
      prisma.steelIssue.findMany.mockResolvedValue([]);

      const result = await service.findAllForInvoiceBatch(['1', '2']);

      expect(result).toEqual({ '1': [], '2': [] });
    });

    it('gộp đúng theo productionInvoiceId khi nhiều PI cùng có đợt xuất - không lẫn PI này sang PI khác', async () => {
      const issuePi2 = {
        ...issue,
        id: 200n,
        productionInvoiceId: 2n,
        productionInvoice: { code: 'PI-32', salesOrder: { orderCode: 'PO-32' } },
      };
      prisma.steelIssue.findMany.mockResolvedValue([issue, issuePi2]);

      const result = await service.findAllForInvoiceBatch(['1', '2', '3']);

      expect(Object.keys(result)).toEqual(['1', '2', '3']);
      expect(result['1']).toHaveLength(1);
      expect(result['1'][0].id).toBe('100');
      expect(result['2']).toHaveLength(1);
      expect(result['2'][0].id).toBe('200');
      expect(result['3']).toEqual([]); // id không có đợt xuất nào vẫn phải có mặt, không throw
    });

    it('query steelIssue.findMany đúng 1 lần cho cả batch, WHERE IN theo mọi id (không lặp N lần)', async () => {
      prisma.steelIssue.findMany.mockResolvedValue([]);

      await service.findAllForInvoiceBatch(['1', '2']);

      expect(prisma.steelIssue.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.steelIssue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { productionInvoiceId: { in: [1n, 2n] } } }),
      );
    });
  });

  // 2026-09-05: trạng thái hạ xuống ĐỢT CẮT (CutBundle) - mỗi đợt tự đi
  // CUTTING -> AWAITING_QC -> QC_PASSED, độc lập với các đợt khác cùng lô nhận.
  describe('finishCutBundle', () => {
    const cuttingBundle = {
      id: 1n,
      steelIssueId: 100n,
      status: CutBundleStatus.CUTTING,
      completedSteps: [ProcessStep.CAT],
      completedAt: null,
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
      segments: [],
      steelIssue: { productionInvoiceId: 1n, materialId: 30n },
    };

    // Phase 3b, nhóm 7.5-i, changelog 2026-09-25 mục 19.
    it('emit CUT_BUNDLE_TO_KCS sau khi Phôi báo xong đợt cắt', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(cuttingBundle);
      prisma.cutBundle.findMany.mockResolvedValue([
        { ...cuttingBundle, status: CutBundleStatus.AWAITING_QC },
      ]);

      await service.finishCutBundle('1');

      expect(notificationsService.emit).toHaveBeenCalledWith(
        'CUT_BUNDLE_TO_KCS',
        expect.objectContaining({ entityId: '1', params: { piCode: 'PI-31' } }),
      );
    });

    it('CUTTING -> AWAITING_QC khi đã đủ mọi công đoạn bắt buộc, và ROLL-UP SteelIssue.status', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(cuttingBundle);
      // Roll-up: chỉ đúng 1 bundle của lô này, đang AWAITING_QC sau update -> issue phải thành
      // AWAITING_QC (xem syncIssueStatusFromBundles bên dưới đọc lại từ DB, không phải đọc biến
      // cục bộ - nên mock findMany trả bundle đã ở trạng thái mới).
      prisma.cutBundle.findMany.mockResolvedValue([
        { ...cuttingBundle, status: CutBundleStatus.AWAITING_QC },
      ]);

      await service.finishCutBundle('1');

      expect(prisma.cutBundle.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1n, status: CutBundleStatus.CUTTING },
          data: expect.objectContaining({ status: CutBundleStatus.AWAITING_QC }) as unknown,
        }),
      );
      expect(prisma.steelIssue.update).toHaveBeenCalledWith({
        where: { id: 100n },
        data: { status: SteelIssueStatus.AWAITING_QC, completedAt: null },
      });
    });

    it('KHÔNG còn chặn dù còn công đoạn phụ chưa gửi KCS (2026-09-07, bỏ ràng buộc thứ tự)', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(cuttingBundle);
      prisma.pieceBom.findMany.mockResolvedValue([
        { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON] },
      ]);
      prisma.cutBundle.findMany.mockResolvedValue([
        { ...cuttingBundle, status: CutBundleStatus.AWAITING_QC },
      ]);

      await expect(service.finishCutBundle('1')).resolves.toBeDefined();
      expect(prisma.cutBundle.updateMany).toHaveBeenCalled();
    });

    it('ném ConflictException nếu đợt không còn ở trạng thái CUTTING', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue({
        ...cuttingBundle,
        status: CutBundleStatus.AWAITING_QC,
      });

      await expect(service.finishCutBundle('1')).rejects.toThrow(
        'Đợt cắt này vừa được chốt để chấm - tải lại trang.',
      );
    });

    it('P1: finishCutBundle({ notifyKcs: false, gateLabel }) KHÔNG phát tin CUT_BUNDLE_TO_KCS, vẫn đổi trạng thái + roll-up', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(cuttingBundle);
      prisma.cutBundle.findMany.mockResolvedValue([
        { ...cuttingBundle, status: CutBundleStatus.AWAITING_QC },
      ]);

      await service.finishCutBundle('1', { notifyKcs: false, gateLabel: 'chốt để chấm' });

      expect(prisma.cutBundle.updateMany).toHaveBeenCalled();
      expect(prisma.steelIssue.update).toHaveBeenCalled();
      expect(notificationsService.emit).not.toHaveBeenCalled();
    });

    it('P1 (PH1 rà soát 18/11): KCS chốt đợt cắt (notifyKcs false) vẫn phát realtime PROGRESS cho lô, không phát tin CUT_BUNDLE_TO_KCS', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(cuttingBundle);
      prisma.cutBundle.findMany.mockResolvedValue([
        { ...cuttingBundle, status: CutBundleStatus.AWAITING_QC },
      ]);
      realtimeStub.publishEntityChanged.mockClear();

      await service.finishCutBundle('1', { notifyKcs: false, gateLabel: 'chốt để chấm' });

      expect(notificationsService.emit).not.toHaveBeenCalled();
      expect(realtimeStub.publishEntityChanged).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'STEEL_ISSUE', action: 'PROGRESS' }),
      );
    });

    it('P1: lệnh dừng -> 409 câu floor-gate với nhãn "chốt để chấm"; mặc định vẫn là "báo cắt xong"', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(cuttingBundle);
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.finishCutBundle('1', { notifyKcs: false, gateLabel: 'chốt để chấm' }),
      ).rejects.toThrow(/chưa\/không thể chốt để chấm/);
      await expect(service.finishCutBundle('1')).rejects.toThrow(/chưa\/không thể báo cắt xong/);
      expect(prisma.cutBundle.updateMany).not.toHaveBeenCalled();
    });

    it('thua đua: đợt vừa được người khác gửi KCS -> 409, không thông báo lần 2', async () => {
      prisma.cutBundle.findUnique
        .mockResolvedValueOnce(cuttingBundle) // đọc đầu hàm: còn CUTTING
        .mockResolvedValueOnce({ status: CutBundleStatus.AWAITING_QC }); // đọc lại sau khi updateMany = 0
      prisma.cutBundle.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.finishCutBundle('1')).rejects.toThrow(
        'Đợt cắt này vừa được chốt để chấm - tải lại trang.',
      );
      expect(notificationsService.emit).not.toHaveBeenCalled();
      expect(prisma.steelIssue.update).not.toHaveBeenCalled();
    });

    it('thua đua: đợt vừa bị hủy hết số -> 409 "vừa bị QLSX hủy hết số - không còn gì để chấm"', async () => {
      prisma.cutBundle.findUnique.mockResolvedValueOnce(cuttingBundle).mockResolvedValueOnce(null);
      prisma.cutBundle.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.finishCutBundle('1')).rejects.toThrow(
        'Đợt cắt này vừa bị QLSX hủy hết số - không còn gì để chấm, tải lại trang.',
      );
      expect(notificationsService.emit).not.toHaveBeenCalled();
    });

    it('ném NotFoundException nếu đợt cắt không tồn tại', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(null);

      await expect(service.finishCutBundle('999')).rejects.toThrow(NotFoundException);
    });
  });

  // 2026-09-07 lần 2: viết lại hoàn toàn, đổi scope từ cutBundleId sang PI + vật tư (Sếp Trương
  // Văn Nhân - công đoạn phụ làm SONG SONG, không cần biết đúng đợt cắt nào). catDone giờ tính
  // TỔNG cả PI (Σ mọi CutBundle của vật tư này), không còn giới hạn 1 đợt cắt cụ thể.
  describe('recordStepBatch (viết lại theo PI + vật tư, 2026-09-07 lần 2)', () => {
    const dto = {
      productionOrderId: '1',
      materialId: '30',
      step: ProcessStep.UON,
      segments: [{ segmentSpecId: '30', qty: 5 }],
    };
    const createdRow = {
      id: 900n,
      step: ProcessStep.UON,
      segments: [{ segmentSpecId: 30n, qty: 5, segmentSpec: { cutLengthMm: decimal(745) } }],
    };

    beforeEach(() => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON] },
      ]);
      // Σ đã cắt CẢ PI cho loại sắt này (không phải của 1 đợt cắt cụ thể).
      prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(8)]);
    });
    const cutRow = (qty: number) => ({
      segmentSpecId: 30n,
      qty,
      cutBundle: { productionOrderId: 1n },
    });
    const stepRow = (qty: number) => ({
      segmentSpecId: 30n,
      qty,
      stepBatch: { productionOrderId: 1n, step: ProcessStep.UON },
    });

    it('lưu người báo vào StepBatch để gom đợt theo người (2026-10-13)', async () => {
      prisma.stepBatch.create.mockResolvedValue(createdRow);

      await service.recordStepBatch('1', dto, 'cn-7');

      expect(prisma.stepBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reportedById: 'cn-7' }) as unknown,
        }),
      );
    });

    it('happy path - tạo StepBatch scope PI + vật tư, catDone tính TỔNG cả PI', async () => {
      prisma.stepBatch.create.mockResolvedValue(createdRow);

      const result = await service.recordStepBatch('1', dto, 'user-1');

      expect(prisma.stepBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productionInvoiceId: 1n,
            materialId: 30n,
            step: ProcessStep.UON,
          }) as unknown,
        }),
      );
      expect(result.id).toBe('900');
    });

    it('ném BadRequestException nếu báo vượt tổng đã cắt CẢ PI (đã cắt 8)', async () => {
      await expect(
        service.recordStepBatch(
          '1',
          { ...dto, segments: [{ segmentSpecId: '30', qty: 9 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
    });

    // 17/11/2026: câu lỗi nói nhãn tiếng Việt (không in mã UON) và nói rõ việc phải làm. P1: câu vế VẬT LÝ.
    it('báo vượt số đã cắt: câu lỗi có "Uốn" (không có "UON") và bảo báo cắt thêm đúng số đoạn', async () => {
      prisma.stepBatchSegment.findMany.mockResolvedValue([stepRow(8)]);
      const call = service.recordStepBatch(
        '1',
        { ...dto, segments: [{ segmentSpecId: '30', qty: 5 }] },
        'user-1',
      );
      await expect(call).rejects.toThrow(
        /đã cắt 8 đoạn, đã Uốn 8 - lần này báo được tối đa 0, bạn nhập 5/,
      );
      await expect(call).rejects.toThrow(/báo cắt thêm 5 đoạn 745mm/);
      await expect(call).rejects.toThrow(/Số cần sai thì báo QLSX\.$/);
      await expect(call).rejects.not.toThrow(/UON/);
    });

    it('báo vượt số đã cắt một phần: chỉ bảo cắt thêm PHẦN VƯỢT (đã cắt 8, đã báo 6, báo thêm 5 -> cắt thêm 3)', async () => {
      prisma.stepBatchSegment.findMany.mockResolvedValue([stepRow(6)]);
      const call = service.recordStepBatch(
        '1',
        { ...dto, segments: [{ segmentSpecId: '30', qty: 5 }] },
        'user-1',
      );
      await expect(call).rejects.toThrow(/đã Uốn 6 - lần này báo được tối đa 2, bạn nhập 5/);
      await expect(call).rejects.toThrow(/báo cắt thêm 3 đoạn 745mm/);
    });

    it('P1 vế SỐ CẦN: cần Uốn 40, đã tính 40 -> báo thêm 1 bị 400 "cần Uốn 40 ... tối đa 0", không ghi gì, có logger.warn (AC21)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(50)]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([stepRow(40)]);

      const err: unknown = await service
        .recordStepBatch('1', { ...dto, segments: [{ segmentSpecId: '30', qty: 1 }] }, 'user-1')
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(err).toBeInstanceOf(BadRequestException);
      const msg = (err as Error).message;
      expect(msg).toContain('Cỡ 745mm (SKU SKU-A): cần Uốn 40 đoạn, đã tính 40');
      expect(msg).toContain('lần này báo được tối đa 0 đoạn, bạn nhập 1');
      expect(msg).toContain('Đếm lại số đoạn. Số cần sai thì báo QLSX.');
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
      expect(prisma.floorReport.create).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String((warn.mock.calls as unknown[][])[0][0])).toContain('số nhập 1');
      warn.mockRestore();
    });

    it('P1 AC25: còn 8 theo số cần (KCS bỏ 5 + làm lại 3), còn 3 theo vật lý -> nhập 4 bị câu VẬT LÝ; nhập 3 qua', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(40)]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([stepRow(40)]);
      const qc = () => [
        {
          segmentSpecId: 30n,
          failedQty: 8,
          shortQty: 0,
          scrapQty: 5,
          qcReview: { stepBundle: { productionOrderId: 1n, step: ProcessStep.UON } },
        },
      ];
      // loadNeedIndex đọc QC Cắt rồi QC công đoạn - 2 lần gọi mỗi lần báo.
      prisma.qcReviewSegment.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(qc())
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(qc());

      const err: unknown = await service
        .recordStepBatch('1', { ...dto, segments: [{ segmentSpecId: '30', qty: 4 }] }, 'user-1')
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect((err as Error).message).toContain(
        'đã cắt 40 đoạn, đã Uốn 37 (không tính 3 đoạn KCS cho làm lại)',
      );
      expect((err as Error).message).toContain('tối đa 3, bạn nhập 4');
      expect((err as Error).message).toContain('báo cắt thêm 1 đoạn 745mm');

      prisma.stepBatch.create.mockResolvedValue(createdRow);
      await expect(
        service.recordStepBatch(
          '1',
          { ...dto, segments: [{ segmentSpecId: '30', qty: 3 }] },
          'user-1',
        ),
      ).resolves.toBeDefined();
    });

    it('P1 AC34: KCS ghi thiếu 5 ở Cắt khiến Uốn đã dùng nhiều hơn số cắt thực có -> báo Uốn 1 bị chặn, câu có "KCS ghi thiếu 5 đoạn cắt"', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(40)]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([stepRow(40)]);
      prisma.qcReviewSegment.findMany
        .mockResolvedValueOnce([
          {
            segmentSpecId: 30n,
            failedQty: 0,
            shortQty: 5,
            qcReview: { cutBundle: { productionOrderId: 1n } },
          },
        ])
        .mockResolvedValue([]);
      // Số cần 80 (còn 40) nhưng đã cắt 40 - thiếu 5 = 35 thực có, Uốn đã dùng 40: vế số cần còn 40, vế vật lý -5.
      prisma.bomPiece.findMany.mockResolvedValue([
        { bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 2 },
      ]);
      await expect(
        service.recordStepBatch(
          '1',
          { ...dto, segments: [{ segmentSpecId: '30', qty: 1 }] },
          'user-1',
        ),
      ).rejects.toThrow(/\(KCS ghi thiếu 5 đoạn cắt\)/);
    });

    it('P1: Dập bỏ 4 thì Uốn cần thêm 4 (dòng định mức có cả Uốn lẫn Dập, Uốn đứng trước)', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON, ProcessStep.DAP] },
      ]);
      prisma.cutPatternSegment.findMany.mockResolvedValue([cutRow(44)]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([stepRow(40)]);
      prisma.qcReviewSegment.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            segmentSpecId: 30n,
            failedQty: 4,
            shortQty: 0,
            scrapQty: 4,
            qcReview: { stepBundle: { productionOrderId: 1n, step: ProcessStep.DAP } },
          },
        ])
        .mockResolvedValue([]);
      prisma.stepBatch.create.mockResolvedValue(createdRow);

      // Uốn đã 40/40 nhưng cần 44 và đã cắt 44: báo 4 được.
      await expect(
        service.recordStepBatch(
          '1',
          { ...dto, segments: [{ segmentSpecId: '30', qty: 4 }] },
          'user-1',
        ),
      ).resolves.toBeDefined();
    });

    it('P1: transaction có timeout 20 giây', async () => {
      prisma.stepBatch.create.mockResolvedValue(createdRow);
      await service.recordStepBatch('1', dto, 'user-1');
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20_000 });
    });

    it('công đoạn không thuộc danh sách / cỡ không cần công đoạn: câu lỗi dùng nhãn tiếng Việt', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([pieceBomRow]); // chỉ có CAT
      const call = service.recordStepBatch('1', dto, 'user-1');
      await expect(call).rejects.toThrow(/Công đoạn Uốn không thuộc/);
      await expect(call).rejects.not.toThrow(/UON/);
    });

    it('ném BadRequestException nếu cỡ đoạn không thuộc loại sắt này (lọc theo materialId)', async () => {
      prisma.segmentSpec.findMany.mockResolvedValue([]); // materialId filter loại bỏ hết

      await expect(service.recordStepBatch('1', dto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ném BadRequestException nếu step không thuộc processSteps đã khai của vật tư này', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([pieceBomRow]); // chỉ có CAT

      await expect(service.recordStepBatch('1', dto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
    });

    it('ném BadRequestException nếu step=CAT (dùng route cut-batches riêng)', async () => {
      await expect(
        service.recordStepBatch('1', { ...dto, step: ProcessStep.CAT }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc"', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.recordStepBatch('1', dto, 'user-1')).rejects.toThrow(ConflictException);
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
    });

    // Nghiêm trọng #6 (đính chính audit độc lập 09/09): trước đây `stepDoneRows` đọc NGOÀI
    // transaction, không khoá - 2 request báo công đoạn gần đồng thời cho cùng (invoice, material,
    // step) đều đọc cùng `stepDoneSoFar` cũ, đều pass check, đều tạo dòng -> tổng vượt số thực đã
    // cắt. Giờ bọc $transaction + lockBusinessKey(`step-batch:...`) TRƯỚC khi đọc lại
    // stepDoneRows, mirror ProductionBatchesService.recordPieceStepBatch() (VTTP, đã làm đúng).
    it('khoá advisory theo (invoice, material, step) TRƯỚC khi đọc lại stepDoneRows - chặn race giữa 2 lượt báo gần đồng thời', async () => {
      prisma.stepBatch.create.mockResolvedValue(createdRow);

      await service.recordStepBatch('1', dto, 'user-1');

      expect(prisma.$executeRaw).toHaveBeenCalled();
      const lockCallOrder = prisma.$executeRaw.mock.invocationCallOrder[0];
      // Số đã báo (và số cần) chỉ được đọc SAU khoá step-batch.
      const readStepDoneCallOrder = prisma.stepBatchSegment.findMany.mock.invocationCallOrder[0];
      expect(lockCallOrder).toBeLessThan(readStepDoneCallOrder);
    });

    it('ném NotFoundException nếu PI không tồn tại', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(null);

      await expect(service.recordStepBatch('999', dto, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('gán SKU cho đợt CŨ chưa có SKU (2026-09-21)', () => {
    const twoOrders = [
      { id: 1n, bomRevisionId: 5n, quantity: 10, floorStage: 'ACTIVE' as const },
      { id: 2n, bomRevisionId: 5n, quantity: 10, floorStage: 'ACTIVE' as const },
    ];
    const legacyBundle = {
      id: 77n,
      steelIssueId: 100n,
      status: CutBundleStatus.QC_PASSED,
      productionOrderId: null,
      barCount: 0,
      mauNguyenMm: 0,
      scrapMm: 0,
      proposalPatternId: null,
      completedSteps: [ProcessStep.CAT],
      completedAt: null,
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
      steelIssue: { ...issue },
      segments: [
        { id: 1n, segmentSpecId: 30n, qty: 4, segmentSpec: { cutLengthMm: decimal(745) } },
      ],
    };

    it('gán được đợt cắt cũ cho SKU thuộc PI (updateMany kèm điều kiện null)', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.cutBundle.findUnique.mockResolvedValue(legacyBundle);

      await service.assignCutBundleOrder('77', '2', 'user-1');

      expect(prisma.cutBundle.updateMany).toHaveBeenCalledWith({
        where: { id: 77n, productionOrderId: null },
        data: { productionOrderId: 2n },
      });
    });

    it('gán thường ghi AUDIT LOG (ai, từ SKU nào sang SKU nào)', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.cutBundle.findUnique.mockResolvedValue(legacyBundle);

      await service.assignCutBundleOrder('77', '2', 'user-1');

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          tableName: 'CutBundle',
          recordId: '77',
          oldValue: { productionOrderId: null },
          newValue: { productionOrderId: '2', reassign: false },
        }) as unknown,
      });
    });

    // Đoạn của đợt đọc lại TRONG transaction (kèm cỡ) và số cắt của SKU cũ cho X3 cùng đi qua cutPatternSegment.findMany.
    const segRow = (qty: number, specId = 30n, mm = 745) => ({
      id: 1n,
      segmentSpecId: specId,
      qty,
      segmentSpec: { cutLengthMm: decimal(mm) },
      cutBundle: { productionOrderId: 1n },
    });

    it('ADMIN sửa SKU đợt ĐÃ gắn nhầm (reassign) -> đổi SKU, updateMany kèm SKU hiện tại, ghi audit reassign', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.cutBundle.findUnique.mockResolvedValue({ ...legacyBundle, productionOrderId: 1n });
      lockedCutOrderId = 1n;
      prisma.cutPatternSegment.findMany.mockResolvedValue([segRow(4)]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([]);

      await service.assignCutBundleOrder('77', '2', 'admin-1', true);

      expect(prisma.cutBundle.updateMany).toHaveBeenCalledWith({
        where: { id: 77n, productionOrderId: 1n },
        data: { productionOrderId: 2n },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'admin-1',
          oldValue: { productionOrderId: '1' },
          newValue: { productionOrderId: '2', reassign: true },
        }) as unknown,
      });
    });

    it('reassign CHẶN khi chuyển đợt đi làm SKU cũ có Uốn vượt số đã cắt còn lại', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.cutBundle.findUnique.mockResolvedValue({ ...legacyBundle, productionOrderId: 1n });
      lockedCutOrderId = 1n;
      // SKU cũ mới cắt đúng 4 (chính đợt này); đã Uốn 3 -> chuyển đi còn cắt 0 < Uốn 3
      prisma.cutPatternSegment.findMany.mockResolvedValue([segRow(4)]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          qty: 3,
          stepBatch: { productionOrderId: 1n, step: ProcessStep.UON },
        },
      ]);

      await expect(service.assignCutBundleOrder('77', '2', 'admin-1', true)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.cutBundle.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    // P1: vế vật lý của X3 dùng số đã DÙNG (thô - thiếu - (lỗi - bỏ)), không phải số thô.
    it('P1 X3 trong sửa SKU: Uốn thô 3 nhưng KCS cho làm lại 2 thì chỉ dùng 1 đoạn cắt; chuyển đợt cắt 4 đi vẫn chặn (còn 0 < 1)', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.cutBundle.findUnique.mockResolvedValue({ ...legacyBundle, productionOrderId: 1n });
      lockedCutOrderId = 1n;
      prisma.stepBatchSegment.findMany.mockResolvedValue([
        {
          segmentSpecId: 30n,
          qty: 3,
          stepBatch: { productionOrderId: 1n, step: ProcessStep.UON },
        },
      ]);
      prisma.qcReviewSegment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          segmentSpecId: 30n,
          failedQty: 2,
          shortQty: 0,
          scrapQty: 0,
          qcReview: { stepBundle: { productionOrderId: 1n, step: ProcessStep.UON } },
        },
      ]);
      prisma.cutPatternSegment.findMany.mockResolvedValue([segRow(4)]);

      await expect(service.assignCutBundleOrder('77', '2', 'admin-1', true)).rejects.toThrow(
        /Sửa SKU đợt cắt này làm Uốn cỡ 745mm của SKU cũ vượt số đoạn cắt thực có 0 đoạn \(đã dùng 1\) - hủy bớt lần báo Uốn của SKU cũ trước\./,
      );
    });

    // P1 [4]: phiếu KCS (thiếu) của chính đợt đi theo đợt sang SKU mới nên SKU cũ không còn mang số thiếu đó.
    describe('P1 [4]: sửa SKU - SKU cũ mất cả số thô lẫn số thiếu của chính đợt chuyển đi', () => {
      const setup = (otherRaw: number) => {
        prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
        prisma.cutBundle.findUnique.mockResolvedValue({ ...legacyBundle, productionOrderId: 1n });
        lockedCutOrderId = 1n;
        const ownSeg = segRow(4);
        const otherSeg = { ...segRow(otherRaw), id: 2n };
        // Đoạn của chính đợt (đọc theo cutBundleId) khác với số cắt của SKU cũ (đợt X + đợt khác) cho X3.
        prisma.cutPatternSegment.findMany.mockImplementation(
          (args: { where: { cutBundleId?: bigint } }) =>
            Promise.resolve(args.where.cutBundleId === 77n ? [ownSeg] : [ownSeg, otherSeg]),
        );
        // Uốn của SKU cũ đã báo 9 đoạn (không có làm lại).
        prisma.stepBatchSegment.findMany.mockResolvedValue([
          {
            segmentSpecId: 30n,
            qty: 9,
            stepBatch: { productionOrderId: 1n, step: ProcessStep.UON },
          },
        ]);
        // KCS đã ghi THIẾU 2 ở đợt X (phiếu gắn cutBundleId = 77), thuộc SKU cũ trong chỉ mục.
        const shortRow = {
          segmentSpecId: 30n,
          failedQty: 0,
          shortQty: 2,
          qcReview: { cutBundle: { productionOrderId: 1n } },
        };
        prisma.qcReviewSegment.findMany.mockImplementation(
          (args: { where: { qcReview?: Record<string, unknown> } }) => {
            const qc = args.where.qcReview ?? {};
            if ('stepBundle' in qc) return Promise.resolve([]);
            return Promise.resolve([shortRow]);
          },
        );
      };

      it('SKU cũ còn 10 đoạn cắt (14 thô - 4 của đợt X) không còn số thiếu 2 của X: Uốn 9 ≤ 10 -> cho sửa', async () => {
        setup(10);
        await expect(
          service.assignCutBundleOrder('77', '2', 'admin-1', true),
        ).resolves.toBeDefined();
        expect(prisma.cutBundle.updateMany).toHaveBeenCalled();
      });

      it('SKU cũ chỉ còn 6 đoạn cắt < Uốn 9 -> 400 câu RIÊNG cho sửa SKU (không phải câu hủy báo cắt), không đổi SKU', async () => {
        setup(6);
        const err: unknown = await service.assignCutBundleOrder('77', '2', 'admin-1', true).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as Error).message).toBe(
          'Sửa SKU đợt cắt này làm Uốn cỡ 745mm của SKU cũ vượt số đoạn cắt thực có 6 đoạn (đã dùng 9) - hủy bớt lần báo Uốn của SKU cũ trước.',
        );
        expect(prisma.cutBundle.updateMany).not.toHaveBeenCalled();
      });
    });

    it('P1: sửa SKU trong transaction - cut-cap theo id SKU tăng dần, rồi FOR UPDATE dòng đợt, rồi step-batch (X3); timeout 20 giây', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      // Đợt đang ở SKU 2, sửa sang SKU 1: khoá cut-cap của 1 trước 2.
      prisma.cutBundle.findUnique.mockResolvedValue({ ...legacyBundle, productionOrderId: 2n });
      lockedCutOrderId = 2n;
      prisma.cutPatternSegment.findMany.mockResolvedValue([segRow(4)]);

      await service.assignCutBundleOrder('77', '1', 'admin-1', true);

      const keys = prisma.$executeRaw.mock.calls.map((c) => String((c as unknown[])[1]));
      expect(keys.slice(0, 2)).toEqual(['cut-cap:1:30:1', 'cut-cap:1:30:2']);
      const rowLock = (prisma.$queryRaw.mock.calls as unknown[][]).findIndex((c) =>
        (c[0] as TemplateStringsArray).join('').includes('FOR UPDATE'),
      );
      expect(rowLock).toBeGreaterThanOrEqual(0);
      const rowLockOrder = prisma.$queryRaw.mock.invocationCallOrder[rowLock];
      expect(prisma.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(rowLockOrder);
      expect(rowLockOrder).toBeLessThan(prisma.$executeRaw.mock.invocationCallOrder[2]);
      expect(keys[2]).toMatch(/^step-batch:1:30:/);
      expect(prisma.cutBundle.updateMany).toHaveBeenCalledWith({
        where: { id: 77n, productionOrderId: 2n },
        data: { productionOrderId: 1n },
      });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20_000 });
    });

    it('P1 AC42: gán đợt cũ chỉ lấy cut-cap của SKU đích và KHÔNG chặn vượt dù SKU đích đã đủ số cần (Q6 A)', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.cutBundle.findUnique.mockResolvedValue(legacyBundle);
      prisma.cutPatternSegment.findMany.mockResolvedValue([segRow(4_000)]);

      await expect(service.assignCutBundleOrder('77', '2', 'user-1')).resolves.toBeDefined();

      const keys = prisma.$executeRaw.mock.calls.map((c) => String((c as unknown[])[1]));
      expect(keys).toEqual(['cut-cap:1:30:2']);
    });

    it('P1: đợt vừa bị QLSX hủy hết lúc chờ khoá -> 409 "vừa bị QLSX hủy hết số", không phải "gắn SKU bởi người khác"', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.cutBundle.findUnique.mockResolvedValue({ ...legacyBundle, productionOrderId: 1n });
      lockedCutStatus = null;

      const call = service.assignCutBundleOrder('77', '2', 'admin-1', true);

      await expect(call).rejects.toThrow(ConflictException);
      await expect(call).rejects.toThrow('vừa bị QLSX hủy hết số');
      expect(prisma.cutBundle.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('P1: SKU của đợt đã đổi giữa lúc đọc và lúc khoá -> 409 "vừa được gắn SKU bởi người khác"', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.cutBundle.findUnique.mockResolvedValue(legacyBundle); // lúc đọc: chưa gắn
      lockedCutOrderId = 1n; // lúc khoá: đã có người gắn SKU 1

      await expect(service.assignCutBundleOrder('77', '2', 'user-1')).rejects.toThrow(
        /vừa được gắn SKU bởi người khác/,
      );
      expect(prisma.cutBundle.updateMany).not.toHaveBeenCalled();
    });

    it('P1: đoạn đọc lại TRONG transaction - cỡ mới người báo thêm lúc chờ khoá mà không có trong định mức SKU mới -> 400', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.cutBundle.findUnique.mockResolvedValue(legacyBundle); // lúc đọc ngoài: chỉ cỡ 30
      prisma.cutPatternSegment.findMany.mockResolvedValue([segRow(4), segRow(1, 99n, 111)]);

      await expect(service.assignCutBundleOrder('77', '2', 'user-1')).rejects.toThrow(
        /Cỡ đoạn 111mm không có trong định mức của SKU đã chọn/,
      );
      expect(prisma.cutBundle.updateMany).not.toHaveBeenCalled();
    });

    it('reassign CHẶN đợt chưa có SKU (phải dùng gán thường) và SKU trùng hiện tại', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.cutBundle.findUnique.mockResolvedValue(legacyBundle);
      await expect(service.assignCutBundleOrder('77', '2', 'admin-1', true)).rejects.toThrow(
        BadRequestException,
      );
      prisma.cutBundle.findUnique.mockResolvedValue({ ...legacyBundle, productionOrderId: 2n });
      await expect(service.assignCutBundleOrder('77', '2', 'admin-1', true)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('CHẶN gán lại đợt đã có SKU (409)', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue({ ...legacyBundle, productionOrderId: 1n });
      await expect(service.assignCutBundleOrder('77', '2', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.cutBundle.updateMany).not.toHaveBeenCalled();
    });

    it('CHẶN SKU không thuộc PI', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(legacyBundle);
      await expect(service.assignCutBundleOrder('77', '999', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('2 người gán cùng lúc: người sau (count=0) nhận 409', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.cutBundle.findUnique.mockResolvedValue(legacyBundle);
      prisma.cutBundle.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.assignCutBundleOrder('77', '2', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('đợt công đoạn phụ: CHẶN gán khi làm số đã Uốn của SKU vượt số đã cắt của SKU', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.stepBundle.findUnique.mockResolvedValue({
        id: 9n,
        productionInvoiceId: 1n,
        materialId: 30n,
        step: ProcessStep.UON,
        status: 'AWAITING_QC',
        submittedAt: new Date('2026-09-10T00:00:00.000Z'),
        submittedById: 'u',
        productionOrderId: null,
        material: { name: 'Sắt', spec: null, code: 'ST' },
        batches: [
          {
            segments: [{ segmentSpecId: 30n, qty: 5, segmentSpec: { cutLengthMm: decimal(745) } }],
          },
        ],
      });
      prisma.pieceBom.findMany.mockResolvedValue([pieceBomRow]);
      // SKU 2 chưa cắt đoạn nào -> catDone = 0 < 5
      prisma.cutPatternSegment.findMany.mockResolvedValue([]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([]);

      await expect(service.assignStepBundleOrder('9', '2', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.stepBundle.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('gán SKU cho đợt công đoạn phụ CŨ - vế vật lý mới (P1)', () => {
    const twoOrders = [
      { id: 1n, bomRevisionId: 5n, quantity: 10, floorStage: 'ACTIVE' as const },
      { id: 2n, bomRevisionId: 5n, quantity: 10, floorStage: 'ACTIVE' as const },
    ];
    const bundle = {
      id: 9n,
      productionInvoiceId: 1n,
      materialId: 30n,
      step: ProcessStep.UON,
      status: 'QC_PASSED',
      submittedAt: new Date('2026-09-10T00:00:00.000Z'),
      submittedById: 'u',
      productionOrderId: null,
      material: { name: 'Sắt', spec: null, code: 'ST' },
      batches: [
        {
          segments: [{ segmentSpecId: 30n, qty: 5, segmentSpec: { cutLengthMm: decimal(745) } }],
        },
      ],
    };
    const destCut = (qty: number) => ({
      segmentSpecId: 30n,
      qty,
      cutBundle: { productionOrderId: 2n },
    });

    beforeEach(() => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      prisma.stepBundle.findUnique.mockResolvedValue(bundle);
      prisma.pieceBom.findMany.mockResolvedValue([pieceBomRow]);
      prisma.stepBatchSegment.findMany.mockResolvedValue([]);
    });

    it('số đã dùng của CHÍNH đợt = thô - thiếu - (lỗi - bỏ): đợt 5 đoạn, KCS cho làm lại 2 -> dùng 3, SKU đích cắt 3 thì gán được', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([destCut(3)]);
      prisma.qcReviewSegment.findMany.mockImplementation(
        (args: { where: Record<string, unknown> }) =>
          // 3 lời gọi: QC Cắt + QC công đoạn của loadNeedIndex, và QC của chính đợt (lọc theo stepBundleId).
          Promise.resolve(
            JSON.stringify(args.where, (_k: string, v: unknown) =>
              typeof v === 'bigint' ? String(v) : v,
            ).includes('"stepBundleId":"9"')
              ? [{ segmentSpecId: 30n, failedQty: 2, shortQty: 0, scrapQty: 0 }]
              : [],
          ),
      );

      await expect(service.assignStepBundleOrder('9', '2', 'user-1')).resolves.toBeDefined();
      expect(prisma.stepBundle.updateMany).toHaveBeenCalled();
    });

    it('cùng đợt nhưng SKU đích chỉ cắt 2 (< 3 đoạn đã dùng) -> 400, không đổi SKU', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([destCut(2)]);
      prisma.qcReviewSegment.findMany.mockImplementation(
        (args: { where: Record<string, unknown> }) =>
          Promise.resolve(
            JSON.stringify(args.where, (_k: string, v: unknown) =>
              typeof v === 'bigint' ? String(v) : v,
            ).includes('"stepBundleId":"9"')
              ? [{ segmentSpecId: 30n, failedQty: 2, shortQty: 0, scrapQty: 0 }]
              : [],
          ),
      );

      await expect(service.assignStepBundleOrder('9', '2', 'user-1')).rejects.toThrow(
        /vượt số đã cắt của SKU \(cỡ đoạn 745mm\)/,
      );
      expect(prisma.stepBundle.updateMany).not.toHaveBeenCalled();
    });

    it('P1: transaction gán SKU đợt công đoạn có maxWait 10s + timeout 20s', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([destCut(5)]);

      await service.assignStepBundleOrder('9', '2', 'user-1');

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 10_000,
        timeout: 20_000,
      });
    });

    it('loại chính đợt đang gán khỏi số liệu SKU đích (điều kiện stepBundleId null hoặc khác đợt) - không đếm 2 lần ở PI 1 SKU', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([destCut(5)]);

      await service.assignStepBundleOrder('9', '2', 'user-1');

      expect(prisma.stepBatchSegment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            stepBatch: expect.objectContaining({
              AND: [{ OR: [{ stepBundleId: null }, { stepBundleId: { not: 9n } }] }],
            }) as unknown,
          }) as unknown,
        }),
      );
    });
  });

  describe('getPhoiProgressBatch: PI lỗi bị BỎ KHỎI kết quả, không trả rỗng (2026-09-21)', () => {
    it('PI không tồn tại/lỗi -> không có khoá trong kết quả', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([]);
      const result = await service.getPhoiProgressBatch(['404']);
      expect(result).toEqual({});
    });

    it('PI hợp lệ -> có khoá + tiến độ; PI mà việc tính lỗi -> BỎ KHỎI kết quả (không trả rỗng)', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([{ id: 1n }, { id: 2n }]);
      // PI 1 có 1 lệnh; PI 2 có lệnh nhưng dữ liệu hỏng (định mức thiếu segmentSpec) -> tính sẽ ném lỗi
      prisma.productionOrder.findMany.mockResolvedValue([
        { ...order, id: 1n, productionInvoiceItem: { productionInvoiceId: 1n } },
        { ...order, id: 2n, bomRevisionId: 6n, productionInvoiceItem: { productionInvoiceId: 2n } },
      ]);
      prisma.bomPiece.findMany.mockResolvedValue([
        { bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 3 },
        { bomRevisionId: 6n, pieceId: 21n, qtyPerUnit: 1 },
      ]);
      prisma.pieceBom.findMany.mockResolvedValue([
        pieceBomRow,
        { ...pieceBomRow, bomRevisionId: 6n, pieceId: 21n, segmentSpec: null },
      ]);

      const result = await service.getPhoiProgressBatch(['1', '2']);

      expect(Object.keys(result)).toEqual(['1']);
      expect(result['1'][0].segments[0].required).toBe(120);
      // gộp: chỉ 1 lượt truy vấn cho cả 2 PI (không lặp từng PI)
      expect(prisma.productionOrder.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('công đoạn phụ theo SKU (2026-09-21)', () => {
    const twoOrders = [
      { id: 1n, bomRevisionId: 5n, quantity: 10, floorStage: 'ACTIVE' as const },
      { id: 2n, bomRevisionId: 5n, quantity: 10, floorStage: 'ACTIVE' as const },
    ];

    it('recordStepBatch CHẶN SKU không thuộc PI', async () => {
      await expect(
        service.recordStepBatch(
          '1',
          {
            materialId: '30',
            step: ProcessStep.UON,
            productionOrderId: '999',
            segments: [{ segmentSpecId: '30', qty: 1 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
    });

    it('submitStepBundle CHẶN SKU không thuộc PI', async () => {
      await expect(
        service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi', '999'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stepBundle.create).not.toHaveBeenCalled();
    });

    it('PI NHIỀU SKU: gửi KCS chỉ gom đợt của ĐÚNG SKU - KHÔNG kèm đợt cũ chưa gắn SKU (không mơ hồ)', async () => {
      prisma.productionOrder.findMany.mockResolvedValue(twoOrders);
      pendingStepRows = [];

      await expect(
        service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi', '2'),
      ).rejects.toThrow(BadRequestException); // rỗng -> "không còn lần báo nào chưa chấm"

      const lockCall = (prisma.$queryRaw.mock.calls as unknown[][]).find((c) =>
        (c[0] as TemplateStringsArray).join('').includes('step_batches'),
      )!;
      const { text, values } = flattenRaw(lockCall);
      expect(text).toContain('"productionOrderId" = ?');
      expect(text).not.toContain('IS NULL OR'); // PI nhiều SKU: đợt cũ chưa gắn SKU không vào
      expect(text).not.toContain('"productionOrderId" IS NULL');
      expect(values).toContain(2n);
    });
  });

  describe('submitStepBundle (viết lại theo PI + vật tư, 2026-09-07 lần 2)', () => {
    const pendingBatches = [
      {
        id: 500n,
        segments: [{ segmentSpecId: 30n, qty: 5, segmentSpec: { cutLengthMm: decimal(745) } }],
      },
    ];
    const createdStepBundle = {
      id: 700n,
      productionInvoiceId: 1n,
      materialId: 30n,
      step: ProcessStep.UON,
      status: 'AWAITING_QC',
      submittedAt: new Date(),
      submittedById: 'user-phoi',
    };

    beforeEach(() => {
      prisma.material.findUniqueOrThrow.mockResolvedValue({
        id: 30n,
        code: 'ST-18',
        name: 'Sắt vuông 18x18',
        spec: null,
      });
    });

    const rawLockCall = () =>
      (prisma.$queryRaw.mock.calls as unknown[][]).find((c) =>
        (c[0] as TemplateStringsArray).join('').includes('step_batches'),
      );

    it('happy path - khoá FOR UPDATE các dòng chờ, tạo StepBundle, gán stepBundleId (điều kiện chưa gom), đọc lại đúng dòng đã gán', async () => {
      pendingStepRows = [{ id: 500n }];
      prisma.stepBatch.findMany.mockResolvedValue(pendingBatches);
      prisma.stepBundle.create.mockResolvedValue(createdStepBundle);

      const result = await service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi', '1');

      const { text, values } = flattenRaw(rawLockCall()!);
      expect(text).toContain('FROM "step_batches"');
      expect(text).toContain('"stepBundleId" IS NULL');
      expect(text).toContain('FOR UPDATE');
      // PI chỉ 1 SKU: đợt gắn SKU này + đợt CŨ chưa gắn SKU (chắc chắn của SKU duy nhất)
      expect(text).toContain('("productionOrderId" = ? OR "productionOrderId" IS NULL)');
      expect(values).toEqual([1n, 30n, ProcessStep.UON, 1n]);
      expect(prisma.stepBundle.create).toHaveBeenCalledWith({
        data: {
          productionInvoiceId: 1n,
          materialId: 30n,
          step: ProcessStep.UON,
          submittedById: 'user-phoi',
          productionOrderId: 1n,
          reportedById: null, // gọi kiểu cũ (màn Phôi) - gom hết, bundle không gắn người
        },
      });
      expect(prisma.stepBatch.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [500n] }, stepBundleId: null },
        data: { stepBundleId: 700n },
      });
      expect(prisma.stepBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stepBundleId: 700n } }),
      );
      expect(result.id).toBe('700');
      expect(result.segments[0]).toEqual(
        expect.objectContaining({ segmentSpecId: '30', qty: 5, cutLengthMm: 745 }),
      );
    });

    it('P1: transaction giữ khoá cả PI có maxWait 10s + timeout 20s (không dùng mặc định 5s)', async () => {
      pendingStepRows = [{ id: 500n }];
      prisma.stepBatch.findMany.mockResolvedValue(pendingBatches);
      prisma.stepBundle.create.mockResolvedValue(createdStepBundle);

      await service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi', '1');

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 10_000,
        timeout: 20_000,
      });
    });

    it('P1 AC7: 0 dòng chờ (QLSX vừa hủy hết / KCS khác vừa chốt) -> 400 câu hợp đồng, không tạo step_bundle', async () => {
      pendingStepRows = [];

      const call = service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi', '1');

      await expect(call).rejects.toThrow(BadRequestException);
      await expect(call).rejects.toThrow(
        'Nhóm Uốn này không còn lần báo nào chưa chấm (có thể vừa được chốt hoặc vừa bị hủy) - tải lại trang.',
      );
      expect(prisma.stepBundle.create).not.toHaveBeenCalled();
    });

    it('P1: updateMany gán lệch số dòng (1/2) -> chỉ trả các dòng ĐÃ gán thật', async () => {
      pendingStepRows = [{ id: 500n }, { id: 501n }];
      prisma.stepBundle.create.mockResolvedValue(createdStepBundle);
      prisma.stepBatch.updateMany.mockResolvedValue({ count: 1 });
      prisma.stepBatch.findMany.mockResolvedValue(pendingBatches); // đọc lại theo đợt: chỉ dòng 500 đã gán

      const result = await service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi', '1');

      expect(prisma.stepBatch.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [500n, 501n] }, stepBundleId: null },
        data: { stepBundleId: 700n },
      });
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].qty).toBe(5);
    });

    it('P1: không gán được dòng nào (count = 0) -> 400 và ném trong transaction để rollback, không để step_bundle rỗng', async () => {
      pendingStepRows = [{ id: 500n }];
      prisma.stepBundle.create.mockResolvedValue(createdStepBundle);
      prisma.stepBatch.updateMany.mockResolvedValue({ count: 0 });
      prisma.stepBatch.findMany.mockResolvedValue([]);

      await expect(
        service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi', '1'),
      ).rejects.toThrow(/không còn lần báo nào chưa chấm/);
    });

    it('P1: opts.gateLabel = "chốt để chấm" thành nhãn cổng lệnh dừng (cả cổng ngoài lẫn cổng trong khoá)', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.submitStepBundle('1', '30', ProcessStep.UON, 'kcs-1', '1', undefined, {
          gateLabel: 'chốt để chấm',
        }),
      ).rejects.toThrow(/chưa\/không thể chốt để chấm/);
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc"', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi', '1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.stepBundle.create).not.toHaveBeenCalled();
    });

    // Đính chính audit toàn diện 09/09 (mục Thấp): trước đây không khoá - 2 lượt "Gửi KCS" gần
    // đồng thời cho cùng (invoice, material, step) đều đọc cùng danh sách pending, đều tạo
    // 2026-10-13 (QR tại máy, mục 26): mỗi công nhân 1 đợt riêng cho công đoạn phụ.
    it('có worker -> CHỈ gom lần báo của đúng người đó và gắn người vào StepBundle', async () => {
      pendingStepRows = [{ id: 500n }];
      prisma.stepBatch.findMany.mockResolvedValue(pendingBatches);
      prisma.stepBundle.create.mockResolvedValue(createdStepBundle);

      await service.submitStepBundle('1', '30', ProcessStep.UON, 'qlsx-1', '1', { id: 'cn-2' });

      const { text, values } = flattenRaw(rawLockCall()!);
      expect(text).toContain('AND "reportedById" = ?');
      expect(values).toContain('cn-2');
      expect(prisma.stepBundle.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ submittedById: 'qlsx-1', reportedById: 'cn-2' }) as unknown,
      });
    });

    it('worker.id = null -> gom đúng các đợt CŨ chưa biết người (IS NULL), không lẫn đợt của người khác', async () => {
      pendingStepRows = [{ id: 500n }];
      prisma.stepBatch.findMany.mockResolvedValue(pendingBatches);
      prisma.stepBundle.create.mockResolvedValue(createdStepBundle);

      await service.submitStepBundle('1', '30', ProcessStep.UON, 'qlsx-1', '1', { id: null });

      expect(flattenRaw(rawLockCall()!).text).toContain('AND "reportedById" IS NULL');
    });

    // StepBundle riêng, rồi updateMany gán stepBundleId không kiểm tra lại -> đợt commit sau ghi
    // đè đợt commit trước, để lại 1 StepBundle rỗng. Vá bằng lockBusinessKey, mirror
    // ProductionBatchesService.submitPieceStep() (VTTP, đã làm đúng từ trước).
    it('khoá advisory theo (invoice, material, step, SKU) TRƯỚC khi khoá + đọc danh sách chờ - chặn race giữa 2 lượt gửi KCS gần đồng thời', async () => {
      pendingStepRows = [{ id: 500n }];
      prisma.stepBatch.findMany.mockResolvedValue(pendingBatches);
      prisma.stepBundle.create.mockResolvedValue(createdStepBundle);

      await service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi', '1');

      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(String((prisma.$executeRaw.mock.calls[0] as unknown[])[1])).toBe(
        'step-bundle:1:30:UON:1',
      );
      const lockCallOrder = prisma.$executeRaw.mock.invocationCallOrder[0];
      const rawIdx = (prisma.$queryRaw.mock.calls as unknown[][]).findIndex((c) =>
        (c[0] as TemplateStringsArray).join('').includes('step_batches'),
      );
      expect(lockCallOrder).toBeLessThan(prisma.$queryRaw.mock.invocationCallOrder[rawIdx]);
    });

    it('ném NotFoundException nếu PI không tồn tại', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(null);

      await expect(
        service.submitStepBundle('999', '30', ProcessStep.UON, 'user-phoi', '1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('syncIssueStatusFromBundles', () => {
    // P1 (AC54): chạy trong 1 transaction ngắn - khoá advisory, rồi FOR UPDATE dòng steel_issues, rồi mới đọc các đợt.
    it('P1: khoá advisory steel-issue-rollup:{id} và FOR UPDATE dòng steel_issues TRƯỚC khi đọc cut_bundles', async () => {
      prisma.cutBundle.findMany.mockResolvedValue([
        { status: CutBundleStatus.AWAITING_QC, completedAt: null },
      ]);

      await service.syncIssueStatusFromBundles(100n);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(String((prisma.$executeRaw.mock.calls[0] as unknown[])[1])).toBe(
        'steel-issue-rollup:100',
      );
      const rowLockIdx = (prisma.$queryRaw.mock.calls as unknown[][]).findIndex((c) => {
        const sql = (c[0] as TemplateStringsArray).join('');
        return sql.includes('steel_issues') && sql.includes('FOR UPDATE');
      });
      expect(rowLockIdx).toBeGreaterThanOrEqual(0);
      const advisory = prisma.$executeRaw.mock.invocationCallOrder[0];
      const rowLock = prisma.$queryRaw.mock.invocationCallOrder[rowLockIdx];
      const read = prisma.cutBundle.findMany.mock.invocationCallOrder[0];
      expect(advisory).toBeLessThan(rowLock);
      expect(rowLock).toBeLessThan(read);
      expect(prisma.steelIssue.update).toHaveBeenCalledWith({
        where: { id: 100n },
        data: { status: SteelIssueStatus.AWAITING_QC, completedAt: null },
      });
    });

    it('không làm gì nếu lô chưa có đợt cắt nào', async () => {
      prisma.cutBundle.findMany.mockResolvedValue([]);

      await service.syncIssueStatusFromBundles(100n);

      expect(prisma.steelIssue.update).not.toHaveBeenCalled();
    });

    it('còn ÍT NHẤT 1 đợt AWAITING_QC → issue = AWAITING_QC (kể cả khi có đợt khác đã QC_PASSED)', async () => {
      prisma.cutBundle.findMany.mockResolvedValue([
        { status: CutBundleStatus.QC_PASSED, completedAt: new Date('2026-09-01T00:00:00.000Z') },
        { status: CutBundleStatus.AWAITING_QC, completedAt: null },
      ]);

      await service.syncIssueStatusFromBundles(100n);

      expect(prisma.steelIssue.update).toHaveBeenCalledWith({
        where: { id: 100n },
        data: { status: SteelIssueStatus.AWAITING_QC, completedAt: null },
      });
    });

    it('MỌI đợt đều QC_PASSED → issue = QC_PASSED, completedAt = MỚI NHẤT trong các đợt', async () => {
      prisma.cutBundle.findMany.mockResolvedValue([
        { status: CutBundleStatus.QC_PASSED, completedAt: new Date('2026-09-01T00:00:00.000Z') },
        { status: CutBundleStatus.QC_PASSED, completedAt: new Date('2026-09-03T00:00:00.000Z') },
      ]);

      await service.syncIssueStatusFromBundles(100n);

      expect(prisma.steelIssue.update).toHaveBeenCalledWith({
        where: { id: 100n },
        data: {
          status: SteelIssueStatus.QC_PASSED,
          completedAt: new Date('2026-09-03T00:00:00.000Z'),
        },
      });
    });

    it('còn đợt đang CUTTING, không đợt nào AWAITING_QC → issue giữ RECEIVED', async () => {
      prisma.cutBundle.findMany.mockResolvedValue([
        { status: CutBundleStatus.QC_PASSED, completedAt: new Date() },
        { status: CutBundleStatus.CUTTING, completedAt: null },
      ]);

      await service.syncIssueStatusFromBundles(100n);

      expect(prisma.steelIssue.update).toHaveBeenCalledWith({
        where: { id: 100n },
        data: { status: SteelIssueStatus.RECEIVED, completedAt: null },
      });
    });
  });
});

describe('SteelIssuesService.assertStepsWithinCutAfterReduceInTx (X3 16/11)', () => {
  const make = () => {
    const tx = {
      $executeRaw: jest.fn(),
      cutBundle: {
        findUnique: jest.fn().mockResolvedValue({
          productionOrderId: 41n,
          steelIssue: { productionInvoiceId: 45n, materialId: 7n },
        }),
      },
      productionOrder: {
        findMany: jest.fn().mockResolvedValue([
          { id: 41n, bomRevisionId: 5n, quantity: 100 },
          { id: 42n, bomRevisionId: 5n, quantity: 100 },
        ]),
      },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([{ bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 1 }]),
      },
      pieceBom: {
        findMany: jest.fn().mockResolvedValue([
          {
            bomRevisionId: 5n,
            pieceId: 20n,
            segmentSpecId: 52n,
            qtyPerPiece: 1,
            processSteps: ['CAT', 'UON', 'DAP'],
          },
        ]),
      },
      // SKU 41 đã cắt 10 đoạn cỡ 52 (2 đợt), đã Uốn 8, Dập 5.
      cutPatternSegment: {
        findMany: jest.fn().mockResolvedValue([
          { segmentSpecId: 52n, qty: 6, cutBundle: { productionOrderId: 41n } },
          { segmentSpecId: 52n, qty: 4, cutBundle: { productionOrderId: 41n } },
        ]),
      },
      stepBatchSegment: {
        findMany: jest.fn().mockResolvedValue([
          { segmentSpecId: 52n, qty: 8, stepBatch: { productionOrderId: 41n, step: 'UON' } },
          { segmentSpecId: 52n, qty: 5, stepBatch: { productionOrderId: 41n, step: 'DAP' } },
        ]),
      },
      // Lần gọi 1: lỗi / thiếu của Cắt; lần gọi 2: của công đoạn phụ (mặc định chưa chấm gì).
      qcReviewSegment: { findMany: jest.fn().mockResolvedValue([]) },
      segmentSpec: { findMany: jest.fn().mockResolvedValue([{ id: 52n, cutLengthMm: 450 }]) },
    };
    const service = new SteelIssuesService(
      {} as unknown as PrismaServiceType,
      {} as unknown as StockLedgerService,
      {} as unknown as StockReservationsService,
      {} as unknown as NotificationsService,
      {} as unknown as RealtimeService,
    );
    return { tx, service };
  };

  it('trừ 2 (còn 8 ≥ Uốn 8, Dập 5) -> cho qua; khoá step-batch mọi công đoạn trừ Cắt, đúng SKU', async () => {
    const { tx, service } = make();
    await expect(
      service.assertStepsWithinCutAfterReduceInTx(tx as never, 53n, [
        { segmentSpecId: 52n, qty: 2 },
      ]),
    ).resolves.toBeUndefined();
    const lockCount = Object.values(ProcessStep).filter((s) => s !== ProcessStep.CAT).length;
    expect(tx.$executeRaw).toHaveBeenCalledTimes(lockCount);
    expect(tx.cutPatternSegment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cutBundle: expect.objectContaining({ OR: [{ productionOrderId: 41n }] }) as unknown,
        }) as unknown,
      }),
    );
  });

  it('trừ 3 (còn 7 < Uốn 8) -> 400, nêu cỡ đoạn và công đoạn', async () => {
    const { tx, service } = make();
    await expect(
      service.assertStepsWithinCutAfterReduceInTx(tx as never, 53n, [
        { segmentSpecId: 52n, qty: 3 },
      ]),
    ).rejects.toThrow(/450mm.*còn 7.*8 đoạn đã báo Uốn/);
  });

  // P1 (AC33): vế vật lý dùng số đã DÙNG (thô - thiếu - (lỗi - bỏ)). Cắt 10, Uốn thô 8 trong đó KCS cho làm lại 3 -> dùng 5.
  it('P1 AC33: Uốn làm lại 3 nên chỉ dùng 5 đoạn cắt - hủy 5 đoạn cắt qua (cắt còn 5 ≥ 5), hủy 6 bị chặn (còn 4 < 5)', async () => {
    const { tx, service } = make();
    const uonQc = [
      {
        segmentSpecId: 52n,
        failedQty: 3,
        shortQty: 0,
        scrapQty: 0,
        qcReview: { stepBundle: { productionOrderId: 41n, step: 'UON' } },
      },
    ];
    tx.qcReviewSegment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(uonQc)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(uonQc);

    await expect(
      service.assertStepsWithinCutAfterReduceInTx(tx as never, 53n, [
        { segmentSpecId: 52n, qty: 5 },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      service.assertStepsWithinCutAfterReduceInTx(tx as never, 53n, [
        { segmentSpecId: 52n, qty: 6 },
      ]),
    ).rejects.toThrow(/450mm.*chỉ còn 4 đoạn đã cắt, ít hơn 5 đoạn đã báo Uốn/);
  });

  it('P1: KCS ghi thiếu ở Cắt trừ khỏi số cắt thực có - cắt thô 10, thiếu 2, Uốn dùng 8: hủy 1 đã bị chặn (còn 7 < 8)', async () => {
    const { tx, service } = make();
    tx.qcReviewSegment.findMany.mockResolvedValueOnce([
      {
        segmentSpecId: 52n,
        failedQty: 0,
        shortQty: 2,
        qcReview: { cutBundle: { productionOrderId: 41n } },
      },
    ]);

    await expect(
      service.assertStepsWithinCutAfterReduceInTx(tx as never, 53n, [
        { segmentSpecId: 52n, qty: 1 },
      ]),
    ).rejects.toThrow(/chỉ còn 7 đoạn đã cắt, ít hơn 8 đoạn đã báo Uốn/);
  });

  it('đợt chưa gắn SKU ở PI nhiều SKU -> không thuộc SKU nào, không kiểm; số trừ 0 -> không đọc gì', async () => {
    const { tx, service } = make();
    tx.cutBundle.findUnique.mockResolvedValue({
      productionOrderId: null,
      steelIssue: { productionInvoiceId: 45n, materialId: 7n },
    });
    await service.assertStepsWithinCutAfterReduceInTx(tx as never, 53n, [
      { segmentSpecId: 52n, qty: 9 },
    ]);
    expect(tx.stepBatchSegment.findMany).not.toHaveBeenCalled();

    const fresh = make();
    await fresh.service.assertStepsWithinCutAfterReduceInTx(fresh.tx as never, 53n, [
      { segmentSpecId: 52n, qty: 0 },
    ]);
    expect(fresh.tx.cutBundle.findUnique).not.toHaveBeenCalled();
  });
});
