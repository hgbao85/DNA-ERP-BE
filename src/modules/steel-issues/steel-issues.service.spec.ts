import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProcessStep, SteelIssueStatus } from '../../generated/prisma/client';
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
    material: { findMany: jest.Mock };
    cuttingProposalLine: { findFirst: jest.Mock; findMany: jest.Mock };
    cutBundle: { create: jest.Mock; aggregate: jest.Mock };
    cutPatternSegment: { findMany: jest.Mock };
    qcReviewSegment: { findMany: jest.Mock };
    segmentSpec: { findMany: jest.Mock };
    systemConfig: { findUnique: jest.Mock };
    stockReservation: { update: jest.Mock; findMany: jest.Mock };
    stockQuant: { findMany: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    $queryRaw: jest.Mock;
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
    productionInvoice: { code: 'PI-31', salesOrder: { code: 'PO-31' } },
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
      material: { findMany: jest.fn().mockResolvedValue([]) },
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
          proposalPatternId: null,
          barCount: 1,
          mauNguyenMm: 0,
          scrapMm: 0,
          segments: [],
        }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { barCount: null } }),
      },
      cutPatternSegment: { findMany: jest.fn().mockResolvedValue([]) },
      qcReviewSegment: { findMany: jest.fn().mockResolvedValue([]) },
      segmentSpec: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 30n, materialId: 30n, cutLengthMm: decimal(745) }]),
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
    // Cân bằng vật chất: 1 cây 6000mm, tề đầu 10, 8 đoạn 745mm, mạch cưa 1mm/nhát
    //   6000 = 10 + 8×745 (5960) + 8×1 (8) + mẩu nguyên 0 + phế 22
    it('ghi 1 đợt cắt và TỰ TÍNH phế liệu từ phương trình cân bằng, không bắt người dùng gõ', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);

      await service.recordCutBatch('100', {
        barCount: 1,
        segments: [{ segmentSpecId: '30', qty: 8 }],
      });

      expect(prisma.cutBundle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({ steelIssueId: 100n, barCount: 1, scrapMm: 22 }),
        }),
      );
    });

    it('trừ mẩu nguyên ra khỏi phế liệu - mẩu nguyên là TÀI SẢN nhập lại kho, không phải hao hụt', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);

      await service.recordCutBatch('100', {
        barCount: 1,
        mauNguyenMm: 20,
        segments: [{ segmentSpecId: '30', qty: 8 }],
      });

      // phế 22 - mẩu nguyên 20 = 2, hai khoản tách bạch chứ không dồn chung vào "hao hụt"
      expect(prisma.cutBundle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({ mauNguyenMm: 20, scrapMm: 2 }),
        }),
      );
    });

    it('CHẶN khi cắt ra nhiều hơn lượng sắt đưa vào (bất khả về vật lý, chắc chắn gõ nhầm)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);

      // 9 × 745 + 9 nhát + 10 tề đầu = 6724 > 6000 của 1 cây
      await expect(
        service.recordCutBatch('100', {
          barCount: 1,
          segments: [{ segmentSpecId: '30', qty: 9 }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.cutBundle.create).not.toHaveBeenCalled();
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

    it('CHẶN khi tổng cây đã dùng vượt số cây kho đã giao', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue); // barCount = 20
      prisma.cutBundle.aggregate.mockResolvedValue({ _sum: { barCount: 20 } });

      await expect(
        service.recordCutBatch('100', {
          barCount: 1,
          segments: [{ segmentSpecId: '30', qty: 8 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ném ConflictException nếu không phải RECEIVED', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue); // vẫn ISSUED

      await expect(
        service.recordCutBatch('100', {
          barCount: 1,
          segments: [{ segmentSpecId: '30', qty: 8 }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('ném ConflictException nếu đã QC_PASSED - phần bù không đi qua đây nữa (2026-08-24 vòng 2)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue({
        ...receivedIssue,
        status: SteelIssueStatus.QC_PASSED,
      });

      await expect(
        service.recordCutBatch('100', {
          barCount: 1,
          segments: [{ segmentSpecId: '30', qty: 8 }],
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.cutBundle.create).not.toHaveBeenCalled();
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

  describe('finishCutting', () => {
    it('RECEIVED -> AWAITING_QC, actualBarCount SUY từ tổng các đợt đã nhập (không phải ô người dùng gõ)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValueOnce(receivedIssue).mockResolvedValueOnce({
        ...receivedIssue,
        status: SteelIssueStatus.AWAITING_QC,
        actualBarCount: 19,
        completedAt: new Date(),
      });
      prisma.cutBundle.aggregate.mockResolvedValue({ _sum: { barCount: 19 } });

      const result = await service.finishCutting('100');

      expect(prisma.steelIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            status: SteelIssueStatus.AWAITING_QC,
            actualBarCount: 19,
          }),
        }),
      );
      expect(result.status).toBe(SteelIssueStatus.AWAITING_QC);
    });

    it('CHẶN mời KCS khi chưa nhập đợt cắt nào - không có số liệu thì KCS duyệt cái gì', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      prisma.cutBundle.aggregate.mockResolvedValue({ _sum: { barCount: null } });

      await expect(service.finishCutting('100')).rejects.toThrow(BadRequestException);
      expect(prisma.steelIssue.update).not.toHaveBeenCalled();
    });

    it('RECEIVED -> IN_PROCESS khi PI có mảnh cần công đoạn khác ngoài CAT (vd UON)', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON] },
      ]);
      prisma.steelIssue.findUnique.mockResolvedValueOnce(receivedIssue).mockResolvedValueOnce({
        ...receivedIssue,
        status: SteelIssueStatus.IN_PROCESS,
        completedSteps: [ProcessStep.CAT],
      });
      prisma.cutBundle.aggregate.mockResolvedValue({ _sum: { barCount: 20 } });

      const result = await service.finishCutting('100');

      expect(prisma.steelIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            status: SteelIssueStatus.IN_PROCESS,
            completedSteps: [ProcessStep.CAT],
            completedAt: null,
          }),
        }),
      );
      expect(result.status).toBe(SteelIssueStatus.IN_PROCESS);
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc" (assertPiHasActiveFloor, 2026-09-01)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);
      prisma.cutBundle.aggregate.mockResolvedValue({ _sum: { barCount: 19 } });
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.finishCutting('100')).rejects.toThrow(ConflictException);
      expect(prisma.steelIssue.update).not.toHaveBeenCalled();
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

    it('done trả số THÔ (không trừ lỗi), failed = outstanding (failedQty - resolvedQty) - sửa lỗi ERP ghi đè "Đã cắt"', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([{ segmentSpecId: 30n, qty: 8 }]);
      prisma.qcReviewSegment.findMany.mockResolvedValue([
        { segmentSpecId: 30n, failedQty: 3, resolvedQty: 1 },
      ]);

      const result = await service.getPhoiProgress('1');

      // required = qtyPerPiece(4) x qtyPerUnit(3) x order.quantity(10) = 120
      expect(result[0].segments[0]).toEqual(
        expect.objectContaining({ required: 120, done: 8, failed: 2 }),
      );
    });

    it('failed = 0 khi chưa có lỗi nào (qcReviewSegment rỗng)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([{ segmentSpecId: 30n, qty: 8 }]);

      const result = await service.getPhoiProgress('1');

      expect(result[0].segments[0]).toEqual(expect.objectContaining({ done: 8, failed: 0 }));
    });

    it('failed = 0 khi KCS đã duyệt lại xác nhận đạt hết (resolvedQty = failedQty)', async () => {
      prisma.cutPatternSegment.findMany.mockResolvedValue([{ segmentSpecId: 30n, qty: 8 }]);
      prisma.qcReviewSegment.findMany.mockResolvedValue([
        { segmentSpecId: 30n, failedQty: 3, resolvedQty: 3 },
      ]);

      const result = await service.getPhoiProgress('1');

      expect(result[0].segments[0]).toEqual(expect.objectContaining({ done: 8, failed: 0 }));
    });
  });

  describe('completeStep', () => {
    const inProcessIssue = {
      ...issue,
      status: SteelIssueStatus.IN_PROCESS,
      completedSteps: [ProcessStep.CAT],
    };

    beforeEach(() => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON] },
      ]);
    });

    it('IN_PROCESS -> AWAITING_QC khi công đoạn cuối cùng còn thiếu (UON) được đánh dấu xong', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(inProcessIssue);
      prisma.steelIssue.update.mockResolvedValue({
        ...inProcessIssue,
        status: SteelIssueStatus.AWAITING_QC,
        completedSteps: [ProcessStep.CAT, ProcessStep.UON],
        completedAt: new Date(),
      });

      const result = await service.completeStep('100', { step: ProcessStep.UON });

      expect(prisma.steelIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            status: SteelIssueStatus.AWAITING_QC,
            completedSteps: [ProcessStep.CAT, ProcessStep.UON],
          }),
        }),
      );
      expect(result.status).toBe(SteelIssueStatus.AWAITING_QC);
    });

    it('ném ConflictException nếu không phải IN_PROCESS', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue({
        ...issue,
        status: SteelIssueStatus.RECEIVED,
      });

      await expect(service.completeStep('100', { step: ProcessStep.UON })).rejects.toThrow(
        ConflictException,
      );
    });

    it('ném BadRequestException nếu step không thuộc requiredSteps của vật tư này trong PI', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(inProcessIssue);

      await expect(service.completeStep('100', { step: ProcessStep.DAP })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.steelIssue.update).not.toHaveBeenCalled();
    });

    it('idempotent - đánh dấu lại step đã xong không lỗi, không gọi update', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(inProcessIssue);

      const result = await service.completeStep('100', { step: ProcessStep.CAT });

      expect(prisma.steelIssue.update).not.toHaveBeenCalled();
      expect(result.status).toBe(SteelIssueStatus.IN_PROCESS);
    });

    it('ném ConflictException khi PI đã bị QLSX "Tạm dừng"/"Kết thúc" (assertPiHasActiveFloor, 2026-09-01)', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(inProcessIssue);
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.completeStep('100', { step: ProcessStep.UON })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.steelIssue.update).not.toHaveBeenCalled();
    });
  });

  describe('createReworkIssue', () => {
    it('tạo đợt rework mới khi chưa có', async () => {
      prisma.steelIssue.findFirst.mockResolvedValue(null);

      // Fixture chỉ cần đúng field scalar mà createReworkIssue() thực dùng
      // (productionInvoiceId/materialId/barLengthMm/issuedById/id) - material/productionInvoice
      // lồng nhau (SteelIssueRow đầy đủ) không cần thiết cho test này.
      await service.createReworkIssue(
        issue as unknown as Parameters<typeof service.createReworkIssue>[0],
        5,
      );

      expect(prisma.steelIssue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({
            reworkOfId: 100n,
            barCount: 5,
            status: SteelIssueStatus.RECEIVED,
          }),
        }),
      );
    });

    it('bỏ qua (không tạo trùng) nếu đợt rework đã tồn tại - an toàn khi gọi lại', async () => {
      prisma.steelIssue.findFirst.mockResolvedValue({ id: 200n, reworkOfId: 100n });

      await service.createReworkIssue(
        issue as unknown as Parameters<typeof service.createReworkIssue>[0],
        5,
      );

      expect(prisma.steelIssue.create).not.toHaveBeenCalled();
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
          productionInvoiceItem: { salesOrder: { code: 'SO-47' } },
        },
        {
          poNumber: 'PO-48',
          quantity: 8,
          mfgProduct: { name: 'Ghế J55' },
          productionInvoiceItem: { salesOrder: null },
        },
      ]);

      const result = await service.getOrderSummary('1');

      expect(result).toEqual([
        { poNumber: 'PO-47', salesOrderCode: 'SO-47', productName: 'Ghế tình yêu', quantity: 20 },
        { poNumber: 'PO-48', salesOrderCode: null, productName: 'Ghế J55', quantity: 8 },
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
        productionInvoice: { code: 'PI-32', salesOrder: { code: 'PO-32' } },
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
});
