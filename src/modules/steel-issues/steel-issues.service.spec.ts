import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { CutBundleStatus, ProcessStep, SteelIssueStatus } from '../../generated/prisma/client';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { SteelIssuesService } from './steel-issues.service';

// Prisma trả Decimal cho cutLengthMm/solverBladeWidthMm (vd Decimal(7,1) = 452.7). Service gọi
// cả .toNumber() lẫn .toString() nên mock phải có đủ 2, không dùng number trần.
const decimal = (n: number) => ({ toNumber: () => n, toString: () => String(n) });

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
    };
    productionInvoice: { findUnique: jest.Mock };
    productionOrder: { findMany: jest.Mock; findFirst: jest.Mock };
    pieceBom: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    material: { findMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    cuttingProposalLine: { findFirst: jest.Mock; findMany: jest.Mock };
    cutBundle: {
      create: jest.Mock;
      aggregate: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
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
    };
    stepBatchSegment: { findMany: jest.Mock };
    stepBundle: {
      findMany: jest.Mock;
      create: jest.Mock;
    };
    systemConfig: { findUnique: jest.Mock };
    stockReservation: { update: jest.Mock; findMany: jest.Mock };
    stockQuant: { findMany: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let stockReservationsService: { drainPool: jest.Mock };

  const invoice = { id: 1n, code: 'PI-31' };
  // floorStage ACTIVE mặc định (2026-08-31) - đa số test không quan tâm gate
  // assertPiHasActiveFloor(), xem mục riêng "QLSX Bắt đầu" bên dưới mới override.
  const order = { id: 1n, bomRevisionId: 5n, quantity: 10, floorStage: 'ACTIVE' as const };
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

  beforeEach(() => {
    physicalStockQty = 100;
    prisma = {
      steelIssue: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
      },
      productionInvoice: { findUnique: jest.fn().mockResolvedValue(invoice) },
      // findFirst dùng bởi assertPiHasActiveFloor() (floor-gate.util.ts) - gọi từ receive/
      // recordCutBatch/finishCutting/recordStepBatch/completeStep (2026-09-01, vá lỗ hổng gate chỉ
      // che create()). Mặc định trả `order` (floorStage ACTIVE) để không phá các test hiện có.
      productionOrder: {
        findMany: jest.fn().mockResolvedValue([order]),
        findFirst: jest.fn().mockResolvedValue(order),
      },
      pieceBom: { findMany: jest.fn().mockResolvedValue([pieceBomRow]) },
      bomPiece: { findMany: jest.fn().mockResolvedValue([]) },
      material: { findMany: jest.fn().mockResolvedValue([]), findUniqueOrThrow: jest.fn() },
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
        updateMany: jest.fn(),
      },
      stepBatchSegment: { findMany: jest.fn().mockResolvedValue([]) },
      stepBundle: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      // trim 10mm + lưỡi cưa 1mm = mặc định SystemConfig, dùng số thật để phép cân bằng khớp.
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue({
          solverTrimStartMm: 10,
          solverBladeWidthMm: decimal(1),
        }),
      },
      stockReservation: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      stockQuant: { findMany: jest.fn().mockResolvedValue([]) },
      warehouse: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 950n }) },
      // 2026-09-03: assertPiHasActiveFloorLocked() (vá race TOCTOU) giờ cũng dùng $queryRaw
      // (FOR UPDATE lên production_orders) ngay dòng đầu transaction create() - phải phân nhánh
      // theo nội dung câu SQL, không còn chỉ có 1 loại câu raw duy nhất như trước.
      $queryRaw: jest.fn((strings: TemplateStringsArray) =>
        strings.join('').includes('production_orders')
          ? Promise.resolve([{ floorStage: 'ACTIVE' }])
          : Promise.resolve([{ qty: { toNumber: () => physicalStockQty } }]),
      ),
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
    service = new SteelIssuesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
      stockReservationsService as unknown as StockReservationsService,
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

    it('2026-09-03: cho phép caller thuộc kho phoi-son-han PHỤ (trước đây chỉ đúng literal kho gốc mới qua được)', async () => {
      prisma.steelIssue.create.mockResolvedValue(issue);
      await expect(
        service.create(
          '1',
          { materialId: '30', barLengthMm: 6000, barCount: 20 },
          'user-1',
          'phoi-son-han-2',
        ),
      ).resolves.toBeDefined();
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

      const stockQuantCalls = (prisma.$queryRaw.mock.calls as [TemplateStringsArray][]).filter(
        ([strings]) => Array.isArray(strings) && strings.join('').includes('stock_quant'),
      );
      expect(stockQuantCalls.length).toBeGreaterThan(0);
      for (const [, ...values] of stockQuantCalls) {
        expect(values).toContain(5900);
      }
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ stockLengthMm: 5900 }),
        expect.anything(),
      );
    });

    it('drainPool trả warehouseId khác (nhiều SKU, kho khác nhau về lý thuyết) - postEntry dùng ĐÚNG kho đó', async () => {
      setPostCutover();
      stockReservationsService.drainPool.mockResolvedValue({ warehouseId: 801n });
      prisma.steelIssue.create.mockResolvedValue(issue);

      await service.create(
        '1',
        { materialId: '30', barLengthMm: 6000, barCount: 8 },
        'user-1',
        null,
      );

      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ fromWarehouseId: 801n }),
        expect.anything(),
      );
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
    it('ISSUED -> RECEIVED', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue);
      prisma.steelIssue.update.mockResolvedValue({ ...issue, status: SteelIssueStatus.RECEIVED });

      const result = await service.receive('100');

      expect(prisma.steelIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: SteelIssueStatus.RECEIVED } }),
      );
      expect(result.status).toBe(SteelIssueStatus.RECEIVED);
    });

    it('ném ConflictException nếu không phải ISSUED', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue({
        ...issue,
        status: SteelIssueStatus.RECEIVED,
      });

      await expect(service.receive('100')).rejects.toThrow(ConflictException);
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc" (assertPiHasActiveFloor, 2026-09-01)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue);
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.receive('100')).rejects.toThrow(ConflictException);
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

      await service.recordCutBatch('100', {
        segments: [{ segmentSpecId: '30', qty: 8 }],
      });

      expect(prisma.cutBundle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            steelIssueId: 100n,
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

      // 9 đoạn 745mm từ 1 cây 6000mm - trước 2026-09-05 bị chặn cứng, giờ cho qua.
      await expect(
        service.recordCutBatch('100', {
          segments: [{ segmentSpecId: '30', qty: 9999 }],
        }),
      ).resolves.toBeDefined();
      expect(prisma.cutBundle.create).toHaveBeenCalled();
    });

    // 2026-09-06: "Lưu đợt cắt" nhiều lần trong ngày cho tới khi "Báo cắt xong" giờ CỘNG DỒN vào
    // cùng 1 đợt (CutBundle) thay vì mỗi lần lưu tạo 1 đợt rời rạc - xem doc comment trên hàm.
    it('còn đợt đang CUTTING của lô → CỘNG DỒN vào đợt đó (upsert qty), KHÔNG tạo đợt mới', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      const openBundle = { id: 5n, steelIssueId: 100n, status: CutBundleStatus.CUTTING };
      prisma.cutBundle.findFirst.mockResolvedValue(openBundle);

      await service.recordCutBatch('100', {
        segments: [{ segmentSpecId: '30', qty: 3 }],
      });

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

    it('không còn đợt nào đang mở (đợt trước đã Báo cắt xong) → TẠO đợt mới như bình thường', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      prisma.cutBundle.findFirst.mockResolvedValue(null); // đợt trước đã AWAITING_QC/QC_PASSED

      await service.recordCutBatch('100', {
        segments: [{ segmentSpecId: '30', qty: 4 }],
      });

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
        service.recordCutBatch('100', {
          barCount: 1,
          segments: [{ segmentSpecId: '31', qty: 2 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('CHẶN cỡ đoạn thuộc LOẠI SẮT KHÁC - khai lẫn vật tư làm hỏng cả tiến độ lẫn cân bằng', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      prisma.segmentSpec.findMany.mockResolvedValue([
        { id: 30n, materialId: 999n, cutLengthMm: decimal(745) },
      ]);

      await expect(
        service.recordCutBatch('100', {
          barCount: 1,
          segments: [{ segmentSpecId: '30', qty: 2 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ném ConflictException nếu CHƯA xác nhận nhận (còn ISSUED)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue); // vẫn ISSUED

      await expect(
        service.recordCutBatch('100', {
          barCount: 1,
          segments: [{ segmentSpecId: '30', qty: 8 }],
        }),
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
        service.recordCutBatch('100', {
          segments: [{ segmentSpecId: '30', qty: 8 }],
        }),
      ).resolves.toBeDefined();
      expect(prisma.cutBundle.create).toHaveBeenCalled();
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc" (assertPiHasActiveFloor, 2026-09-01)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.recordCutBatch('100', {
          barCount: 1,
          segments: [{ segmentSpecId: '30', qty: 8 }],
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.cutBundle.create).not.toHaveBeenCalled();
    });
  });

  // 2026-09-07: hoàn tác ĐÚNG lần "Lưu đợt cắt" gần nhất - FE gửi lại chính xác delta vừa submit,
  // hàm chỉ trừ đối xứng lại (không đọc lịch sử để suy luận).
  describe('undoLastCutBatch', () => {
    const cuttingBundleWithSegments = {
      id: 1n,
      status: CutBundleStatus.CUTTING,
      segments: [
        { id: 900n, segmentSpecId: 30n, qty: 5 },
        { id: 901n, segmentSpecId: 31n, qty: 2 },
      ],
    };

    it('trừ đúng qty đã gửi cho từng segment (còn dư thì update, không xoá)', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(cuttingBundleWithSegments);

      await service.undoLastCutBatch('1', [{ segmentSpecId: '30', qty: 3 }]);

      expect(prisma.cutPatternSegment.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: { qty: 2 },
      });
      expect(prisma.cutPatternSegment.delete).not.toHaveBeenCalled();
      expect(prisma.cutBundle.delete).not.toHaveBeenCalled();
    });

    it('trừ hết sạch 1 segment (qty còn lại <= 0) - XOÁ dòng segment đó, không phải update về 0', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(cuttingBundleWithSegments);
      prisma.cutPatternSegment.count.mockResolvedValue(1); // vẫn còn segment 31n khác

      await service.undoLastCutBatch('1', [{ segmentSpecId: '30', qty: 5 }]);

      expect(prisma.cutPatternSegment.delete).toHaveBeenCalledWith({ where: { id: 900n } });
      expect(prisma.cutPatternSegment.update).not.toHaveBeenCalled();
      expect(prisma.cutBundle.delete).not.toHaveBeenCalled();
    });

    it('hoàn tác lần lưu ĐẦU TIÊN (trừ hết MỌI segment) - xoá luôn cả đợt cắt rỗng', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(cuttingBundleWithSegments);
      prisma.cutPatternSegment.count.mockResolvedValue(0); // hết sạch segment sau khi trừ

      await service.undoLastCutBatch('1', [
        { segmentSpecId: '30', qty: 5 },
        { segmentSpecId: '31', qty: 2 },
      ]);

      expect(prisma.cutPatternSegment.delete).toHaveBeenCalledTimes(2);
      expect(prisma.cutBundle.delete).toHaveBeenCalledWith({ where: { id: 1n } });
    });

    it('bỏ qua an toàn nếu segmentSpecId gửi lên không còn khớp dòng nào (đã bị xoá/khác)', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(cuttingBundleWithSegments);

      await service.undoLastCutBatch('1', [{ segmentSpecId: '999', qty: 1 }]);

      expect(prisma.cutPatternSegment.update).not.toHaveBeenCalled();
      expect(prisma.cutPatternSegment.delete).not.toHaveBeenCalled();
    });

    it('ném ConflictException nếu đợt không còn ở trạng thái CUTTING (đã báo cắt xong/qua KCS)', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue({
        ...cuttingBundleWithSegments,
        status: CutBundleStatus.AWAITING_QC,
      });

      await expect(
        service.undoLastCutBatch('1', [{ segmentSpecId: '30', qty: 1 }]),
      ).rejects.toThrow(ConflictException);
      expect(prisma.cutPatternSegment.update).not.toHaveBeenCalled();
    });

    it('ném NotFoundException nếu đợt cắt không tồn tại', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(null);

      await expect(
        service.undoLastCutBatch('999', [{ segmentSpecId: '30', qty: 1 }]),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPhoiProgress', () => {
    beforeEach(() => {
      // pieceBomRow (mặc định top-level) đã khớp bomRevisionId 5n/pieceId 20n/segmentSpecId 30n -
      // chỉ còn thiếu qtyPerUnit (mặc định bomPiece.findMany trả rỗng).
      prisma.bomPiece.findMany.mockResolvedValue([
        { bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 3 },
      ]);
      prisma.steelIssue.findMany.mockResolvedValue([{ materialId: 30n, barCount: 2 }]);
    });

    it('done trả số THÔ (không trừ lỗi), failed = Σ failedQty CỘNG DỒN LỊCH SỬ (2026-09-07 lần 2, bỏ resolvedQty)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([{ segmentSpecId: 30n, qty: 8 }]);
      prisma.qcReviewSegment.findMany.mockResolvedValue([{ segmentSpecId: 30n, failedQty: 3 }]);

      const result = await service.getPhoiProgress('1');

      // required = qtyPerPiece(4) x qtyPerUnit(3) x order.quantity(10) = 120
      expect(result[0].segments[0]).toEqual(
        expect.objectContaining({ required: 120, done: 8, failed: 3 }),
      );
    });

    it('failed = 0 khi chưa có lỗi nào (qcReviewSegment rỗng)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([{ segmentSpecId: 30n, qty: 8 }]);

      const result = await service.getPhoiProgress('1');

      expect(result[0].segments[0]).toEqual(expect.objectContaining({ done: 8, failed: 0 }));
    });

    it('failed CỘNG DỒN nhiều lần chấm (không tự giảm dù đã bù đủ bằng đợt mới)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([{ segmentSpecId: 30n, qty: 8 }]);
      prisma.qcReviewSegment.findMany.mockResolvedValue([
        { segmentSpecId: 30n, failedQty: 3 },
        { segmentSpecId: 30n, failedQty: 1 },
      ]);

      const result = await service.getPhoiProgress('1');

      expect(result[0].segments[0]).toEqual(expect.objectContaining({ done: 8, failed: 4 }));
    });
  });

  // Sửa 2026-09-05: getIssuePlan() giờ lấy "Cần" từ CuttingProposalLine (kết quả phần mềm tính cắt
  // sắt đã duyệt: totalBars/bestStockLengthMm) THAY VÌ định mức BOM - Mua hàng cũng mua theo đúng
  // số này nên "Cần" phải khớp. bomPiece/pieceBom không còn được getIssuePlan() dùng nữa.
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
          poNumber: 'PO-47',
          quantity: 20,
          mfgProduct: { name: 'Ghế tình yêu' },
          productionInvoiceItem: {
            salesOrder: { orderCode: 'SO-47' },
            stages: [{ deadline: new Date('2026-06-20') }],
          },
        },
        {
          poNumber: 'PO-48',
          quantity: 8,
          mfgProduct: { name: 'Ghế J55' },
          productionInvoiceItem: { salesOrder: null, stages: [] },
        },
      ]);

      const result = await service.getOrderSummary('1');

      expect(result).toEqual([
        {
          poNumber: 'PO-47',
          salesOrderCode: 'SO-47',
          productName: 'Ghế tình yêu',
          quantity: 20,
          phoiDeadline: new Date('2026-06-20'),
        },
        {
          poNumber: 'PO-48',
          salesOrderCode: null,
          productName: 'Ghế J55',
          quantity: 8,
          phoiDeadline: null,
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

    it('CUTTING -> AWAITING_QC khi đã đủ mọi công đoạn bắt buộc, và ROLL-UP SteelIssue.status', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue(cuttingBundle);
      prisma.cutBundle.update.mockResolvedValue({
        ...cuttingBundle,
        status: CutBundleStatus.AWAITING_QC,
      });
      // Roll-up: chỉ đúng 1 bundle của lô này, đang AWAITING_QC sau update -> issue phải thành
      // AWAITING_QC (xem syncIssueStatusFromBundles bên dưới đọc lại từ DB, không phải đọc biến
      // cục bộ - nên mock findMany trả bundle đã ở trạng thái mới).
      prisma.cutBundle.findMany.mockResolvedValue([
        { ...cuttingBundle, status: CutBundleStatus.AWAITING_QC },
      ]);

      await service.finishCutBundle('1');

      expect(prisma.cutBundle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1n },
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
      prisma.cutBundle.update.mockResolvedValue({
        ...cuttingBundle,
        status: CutBundleStatus.AWAITING_QC,
      });
      prisma.cutBundle.findMany.mockResolvedValue([
        { ...cuttingBundle, status: CutBundleStatus.AWAITING_QC },
      ]);

      await expect(service.finishCutBundle('1')).resolves.toBeDefined();
      expect(prisma.cutBundle.update).toHaveBeenCalled();
    });

    it('ném ConflictException nếu đợt không còn ở trạng thái CUTTING', async () => {
      prisma.cutBundle.findUnique.mockResolvedValue({
        ...cuttingBundle,
        status: CutBundleStatus.AWAITING_QC,
      });

      await expect(service.finishCutBundle('1')).rejects.toThrow(ConflictException);
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
      prisma.cutPatternSegment.findMany.mockResolvedValue([{ segmentSpecId: 30n, qty: 8 }]);
    });

    it('happy path - tạo StepBatch scope PI + vật tư, catDone tính TỔNG cả PI', async () => {
      prisma.stepBatch.create.mockResolvedValue(createdRow);

      const result = await service.recordStepBatch('1', dto);

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

    it('ném BadRequestException nếu báo vượt tổng đã cắt CẢ PI (catDone=8)', async () => {
      await expect(
        service.recordStepBatch('1', { ...dto, segments: [{ segmentSpecId: '30', qty: 9 }] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
    });

    it('ném BadRequestException nếu cỡ đoạn không thuộc loại sắt này (lọc theo materialId)', async () => {
      prisma.segmentSpec.findMany.mockResolvedValue([]); // materialId filter loại bỏ hết

      await expect(service.recordStepBatch('1', dto)).rejects.toThrow(BadRequestException);
    });

    it('ném BadRequestException nếu step không thuộc processSteps đã khai của vật tư này', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([pieceBomRow]); // chỉ có CAT

      await expect(service.recordStepBatch('1', dto)).rejects.toThrow(BadRequestException);
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
    });

    it('ném BadRequestException nếu step=CAT (dùng route cut-batches riêng)', async () => {
      await expect(service.recordStepBatch('1', { ...dto, step: ProcessStep.CAT })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc"', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.recordStepBatch('1', dto)).rejects.toThrow(ConflictException);
      expect(prisma.stepBatch.create).not.toHaveBeenCalled();
    });

    // Nghiêm trọng #6 (đính chính audit độc lập 09/09): trước đây `stepDoneRows` đọc NGOÀI
    // transaction, không khoá - 2 request báo công đoạn gần đồng thời cho cùng (invoice, material,
    // step) đều đọc cùng `stepDoneSoFar` cũ, đều pass check, đều tạo dòng -> tổng vượt số thực đã
    // cắt. Giờ bọc $transaction + lockBusinessKey(`step-batch:...`) TRƯỚC khi đọc lại
    // stepDoneRows, mirror ProductionBatchesService.recordPieceStepBatch() (VTTP, đã làm đúng).
    it('khoá advisory theo (invoice, material, step) TRƯỚC khi đọc lại stepDoneRows - chặn race giữa 2 lượt báo gần đồng thời', async () => {
      prisma.stepBatch.create.mockResolvedValue(createdRow);

      await service.recordStepBatch('1', dto);

      expect(prisma.$executeRaw).toHaveBeenCalled();
      const lockCallOrder = prisma.$executeRaw.mock.invocationCallOrder[0];
      const readStepDoneCallOrder = prisma.stepBatchSegment.findMany.mock.invocationCallOrder[0];
      expect(lockCallOrder).toBeLessThan(readStepDoneCallOrder);
    });

    it('ném NotFoundException nếu PI không tồn tại', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(null);

      await expect(service.recordStepBatch('999', dto)).rejects.toThrow(NotFoundException);
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

    it('happy path - gom StepBatch CHƯA gửi (PI, vật tư, step), tạo StepBundle, gán lại stepBundleId', async () => {
      prisma.stepBatch.findMany.mockResolvedValue(pendingBatches);
      prisma.stepBundle.create.mockResolvedValue(createdStepBundle);

      const result = await service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi');

      expect(prisma.stepBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            productionInvoiceId: 1n,
            materialId: 30n,
            step: ProcessStep.UON,
            stepBundleId: null,
          },
        }),
      );
      expect(prisma.stepBundle.create).toHaveBeenCalledWith({
        data: {
          productionInvoiceId: 1n,
          materialId: 30n,
          step: ProcessStep.UON,
          submittedById: 'user-phoi',
        },
      });
      expect(prisma.stepBatch.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [500n] } },
        data: { stepBundleId: 700n },
      });
      expect(result.id).toBe('700');
      expect(result.segments[0]).toEqual(
        expect.objectContaining({ segmentSpecId: '30', qty: 5, cutLengthMm: 745 }),
      );
    });

    it('ném BadRequestException nếu chưa có StepBatch nào để gửi (chưa báo gì)', async () => {
      prisma.stepBatch.findMany.mockResolvedValue([]);

      await expect(
        service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.stepBundle.create).not.toHaveBeenCalled();
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc"', async () => {
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.stepBundle.create).not.toHaveBeenCalled();
    });

    // Đính chính audit toàn diện 09/09 (mục Thấp): trước đây không khoá - 2 lượt "Gửi KCS" gần
    // đồng thời cho cùng (invoice, material, step) đều đọc cùng danh sách pending, đều tạo
    // StepBundle riêng, rồi updateMany gán stepBundleId không kiểm tra lại -> đợt commit sau ghi
    // đè đợt commit trước, để lại 1 StepBundle rỗng. Vá bằng lockBusinessKey, mirror
    // ProductionBatchesService.submitPieceStep() (VTTP, đã làm đúng từ trước).
    it('khoá advisory theo (invoice, material, step) TRƯỚC khi đọc lại danh sách pending - chặn race giữa 2 lượt gửi KCS gần đồng thời', async () => {
      prisma.stepBatch.findMany.mockResolvedValue(pendingBatches);
      prisma.stepBundle.create.mockResolvedValue(createdStepBundle);

      await service.submitStepBundle('1', '30', ProcessStep.UON, 'user-phoi');

      expect(prisma.$executeRaw).toHaveBeenCalled();
      const lockCallOrder = prisma.$executeRaw.mock.invocationCallOrder[0];
      const readPendingCallOrder = prisma.stepBatch.findMany.mock.invocationCallOrder[0];
      expect(lockCallOrder).toBeLessThan(readPendingCallOrder);
    });

    it('ném NotFoundException nếu PI không tồn tại', async () => {
      prisma.productionInvoice.findUnique.mockResolvedValue(null);

      await expect(
        service.submitStepBundle('999', '30', ProcessStep.UON, 'user-phoi'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('syncIssueStatusFromBundles', () => {
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
