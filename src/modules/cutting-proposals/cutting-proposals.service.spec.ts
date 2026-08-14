import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { CuttingProposalStatus } from '../../generated/prisma/client';
import { AppConfig } from '../../config/configuration';
import { ExternalApiHttpError, ExternalApiService } from '../external/external-api.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { CuttingProposalsService } from './cutting-proposals.service';

describe('CuttingProposalsService', () => {
  let service: CuttingProposalsService;
  let prisma: {
    cuttingProposal: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    cuttingProposalLine: { create: jest.Mock };
    cuttingProposalPattern: { create: jest.Mock };
    cuttingProposalPatternSegment: { create: jest.Mock };
    purchaseProposal: { create: jest.Mock };
    productionOrder: { findUniqueOrThrow: jest.Mock };
    productionInvoice: { findUniqueOrThrow: jest.Mock };
    systemConfig: { findUniqueOrThrow: jest.Mock };
    pieceBom: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    material: { findMany: jest.Mock };
    productionInvoiceItem: { findMany: jest.Mock };
    bomRevision: { findMany: jest.Mock };
    notification: { create: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let externalApiService: { post: jest.Mock };
  let configService: { get: jest.Mock };
  let stockLedgerService: { postEntry: jest.Mock };

  /** Mô phỏng `Prisma.Decimal` tối thiểu - đủ cho `.toNumber()` mà approve() gọi. */
  const qtyRow = (n: number) => [{ qty: { toNumber: () => n } }];

  /** LIST_INCLUDE (productionOrder.mfgProduct) - mọi mock đi qua toResponseDto() cần có. */
  const productionOrderRelation = () => ({
    productionOrder: { poNumber: 'PO-1', mfgProduct: { factoryCode: 'SKU-1', name: 'Ghế test' } },
  });

  const productionOrder = { id: 1n, poNumber: 'PO-1', bomRevisionId: 5n, quantity: 500 };
  const systemConfig = {
    solverStockLengths: [5850, 6000],
    solverTrimStartMm: 10,
    solverBladeWidthMm: 1.0,
    solverMaxWastePercentage: 1.0,
    solverMaxSurplus: 10,
    solverMinLengthMm: 5000,
    solverMaxLengthMm: 6000,
    solverLengthStepMm: 10,
    solverTimeLimitSeconds: 20,
  };
  const pieceBomRow = {
    pieceId: 10n,
    segmentSpecId: 100n,
    qtyPerPiece: 1,
    piece: { name: 'chân bàn' },
    segmentSpec: { materialId: 200n, cutLengthMm: 660 },
  };

  beforeEach(() => {
    prisma = {
      cuttingProposal: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      cuttingProposalLine: { create: jest.fn() },
      cuttingProposalPattern: { create: jest.fn() },
      cuttingProposalPatternSegment: { create: jest.fn() },
      purchaseProposal: { create: jest.fn() },
      productionOrder: { findUniqueOrThrow: jest.fn().mockResolvedValue(productionOrder) },
      productionInvoice: { findUniqueOrThrow: jest.fn() },
      systemConfig: { findUniqueOrThrow: jest.fn().mockResolvedValue(systemConfig) },
      pieceBom: { findMany: jest.fn().mockResolvedValue([pieceBomRow]) },
      bomPiece: { findMany: jest.fn().mockResolvedValue([{ pieceId: 10n, qtyPerUnit: 4 }]) },
      // Mặc định không vật tư nào có ngưỡng riêng -> request body không có
      // max_waste_percentage_by_material (test riêng cho việc có ngưỡng riêng ở dưới).
      material: { findMany: jest.fn().mockResolvedValue([]) },
      // Mặc định "không có đơn nào đang chờ" -> getBatchSuggestions trả [] mà không đụng bảng
      // khác; các test gộp đợt cắt tự override.
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([]) },
      bomRevision: { findMany: jest.fn().mockResolvedValue([]) },
      notification: { create: jest.fn() },
      warehouse: {
        findUniqueOrThrow: jest.fn(({ where }: { where: { code: string } }) =>
          Promise.resolve(where.code === 'PRODUCTION' ? { id: 900n } : { id: 800n }),
        ),
      },
      // approve() lock tồn - mặc định "hết tồn" (0), test nào cần tồn > 0 tự override.
      $queryRaw: jest.fn().mockResolvedValue(qtyRow(0)),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    externalApiService = { post: jest.fn() };
    configService = {
      get: jest.fn((key: string) => {
        const map: Record<string, unknown> = {
          'solver.baseUrl': 'http://solver.local',
          'solver.apiKey': 'test-key',
          'solver.timeoutSeconds': 300,
        };
        return map[key];
      }),
    };
    stockLedgerService = { postEntry: jest.fn() };
    service = new CuttingProposalsService(
      prisma as unknown as PrismaServiceType,
      externalApiService as unknown as ExternalApiService,
      configService as unknown as ConfigService<AppConfig, true>,
      stockLedgerService as unknown as StockLedgerService,
    );
  });

  describe('requestForOrder', () => {
    it('short-circuits and returns the existing proposal when the idempotency key already exists', async () => {
      const existing = {
        id: 1n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT,
        totalBarsAll: 10,
        totalWasteMm: 100,
        wastePercentage: null,
        errorMessage: null,
        requestedAt: new Date(),
        completedAt: new Date(),
        approvedAt: null,
        ...productionOrderRelation(),
      };
      prisma.cuttingProposal.findUnique.mockResolvedValue(existing);

      const result = await service.requestForOrder(1n, { idempotencyKey: 'abc-123' });

      expect(result.id).toBe('1');
      expect(prisma.cuttingProposal.create).not.toHaveBeenCalled();
    });

    it('creates a CALCULATING row and returns immediately without awaiting the solver call', async () => {
      prisma.cuttingProposal.create.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.CALCULATING,
        totalBarsAll: null,
        totalWasteMm: null,
        wastePercentage: null,
        errorMessage: null,
        requestedAt: new Date(),
        completedAt: null,
        approvedAt: null,
        ...productionOrderRelation(),
      });
      externalApiService.post.mockReturnValue(new Promise(() => {})); // never resolves

      const result = await service.requestForOrder(1n);

      expect(result.status).toBe(CuttingProposalStatus.CALCULATING);
      expect(prisma.cuttingProposal.create).toHaveBeenCalledWith({
        data: { productionOrderId: 1n, idempotencyKey: undefined, requestedById: undefined },
        include: {
          productionOrder: { include: { mfgProduct: true } },
          // Nhánh phương án cấp nhóm - null với đề xuất neo vào 1 lệnh SX như ca này.
          productionInvoice: { include: { items: { include: { mfgProduct: true } } } },
        },
      });
    });
  });

  describe('runSolverAndSave (private, invoked directly)', () => {
    // runSolverAndSave nhận callback dựng đầu vào (không nhận thẳng productionOrderId) từ khi có
    // thêm đường cắt chung cả nhóm - nối lại qua buildOrderJob để giữ nguyên ý nghĩa các test dưới.
    type PrivateParts = {
      runSolverAndSave: (p: bigint, buildJob: () => Promise<unknown>) => Promise<void>;
      buildOrderJob: (o: bigint) => Promise<unknown>;
    };
    const invoke = (proposalId: bigint, productionOrderId: bigint) => {
      const priv = service as unknown as PrivateParts;
      return priv.runSolverAndSave(proposalId, () => priv.buildOrderJob(productionOrderId));
    };

    it('builds the bom[] payload from pieceBom/bomPiece and saves the mapped result on success', async () => {
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: {
          total_bars_all: 223,
          total_waste_mm: 11373,
          waste_percentage: 0.85,
          any_over_threshold: false,
        },
        purchase_plan: [
          {
            material: '200',
            feasible: true,
            best_stock_length: 6000,
            total_bars: 223,
            total_waste_mm: 11373,
            waste_percentage: 0.85,
            mau_nguyen_mm: 1351,
            length_comparison: [{ length: 6000, bars: 223, waste_pct: 0.85 }],
            cutting_patterns: [
              {
                pattern_id: 1,
                bars: 223,
                waste_per_bar: 51,
                mau_nguyen_mm: 1351,
                pieces_breakdown: [{ size: 660, count: 9 }],
              },
            ],
          },
        ],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });
      prisma.cuttingProposalPattern.create.mockResolvedValue({ id: 500n });

      await invoke(2n, 1n);

      expect(prisma.pieceBom.findMany).toHaveBeenCalledWith({
        where: { bomRevisionId: 5n },
        include: { piece: true, segmentSpec: true },
      });
      expect(externalApiService.post).toHaveBeenCalledWith(
        'http://solver.local/api/v1/de_xuat/propose/',
        expect.objectContaining({
          num_sets: 500,
          bom: [
            {
              part: 'chân bàn',
              qty_per_set: 4,
              material: '200',
              spec: '',
              cut_length: 660,
              qty_per_part: 1,
            },
          ],
          stock_lengths: '5850 6000',
          auto_scan: false,
          stop_on_first: false,
        }),
        { headers: { Authorization: 'Bearer test-key' } },
        300_000,
      );
      expect(externalApiService.post).toHaveBeenCalledTimes(1); // any_over_threshold=false -> no retry
      // Không vật tư nào có ngưỡng riêng -> KHÔNG gửi key này (giống hệt request trước khi có
      // tính năng ngưỡng-theo-vật-tư), không phải gửi object rỗng.
      const bodySent = (
        externalApiService.post.mock.calls[0] as unknown as [string, Record<string, unknown>]
      )[1];
      expect(bodySent).not.toHaveProperty('max_waste_percentage_by_material');
      const updateCall = prisma.cuttingProposal.update.mock.calls[0] as unknown as [
        { where: { id: bigint }; data: { status: CuttingProposalStatus } },
      ];
      expect(updateCall[0].where).toEqual({ id: 2n });
      expect(updateCall[0].data.status).toBe(CuttingProposalStatus.DRAFT);

      const lineCall = prisma.cuttingProposalLine.create.mock.calls[0] as unknown as [
        {
          data: {
            cuttingProposalId: bigint;
            materialId: bigint;
            mauNguyenMm: number;
            lengthComparison: unknown;
          };
        },
      ];
      expect(lineCall[0].data.cuttingProposalId).toBe(2n);
      expect(lineCall[0].data.materialId).toBe(200n);
      expect(lineCall[0].data.mauNguyenMm).toBe(1351);
      expect(lineCall[0].data.lengthComparison).toEqual([
        { length: 6000, bars: 223, waste_pct: 0.85 },
      ]);

      const patternCall = prisma.cuttingProposalPattern.create.mock.calls[0] as unknown as [
        { data: { mauNguyenMm: number } },
      ];
      expect(patternCall[0].data.mauNguyenMm).toBe(1351);
      expect(prisma.cuttingProposalPatternSegment.create).toHaveBeenCalledWith({
        data: { patternId: 500n, segmentSpecId: 100n, countPerBar: 9 },
      });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ audience: 'PRODUCTION_MANAGER' }) as unknown,
      });
      const notifyCall = prisma.notification.create.mock.calls[0] as unknown as [
        { data: { title: string } },
      ];
      expect(notifyCall[0].data.title).toContain('PO-1');
    });

    it('gửi max_waste_percentage_by_material khi vật tư có ngưỡng riêng, bỏ qua vật tư null/<=0 (D.hao-hut-sat)', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        pieceBomRow, // materialId 200n
        {
          pieceId: 11n,
          segmentSpecId: 101n,
          qtyPerPiece: 2,
          piece: { name: 'mảnh tựa' },
          segmentSpec: { materialId: 300n, cutLengthMm: 840 },
        },
      ]);
      prisma.bomPiece.findMany.mockResolvedValue([
        { pieceId: 10n, qtyPerUnit: 4 },
        { pieceId: 11n, qtyPerUnit: 1 },
      ]);
      // 200n: Sếp cấp riêng 2%. 300n: có set nhưng = 0 (bẫy vô nghiệm) -> phải bị loại, KHÔNG
      // gửi xuống solver. 400n: không nằm trong BOM, không ảnh hưởng gì (kiểm tra where đúng).
      prisma.material.findMany.mockResolvedValue([
        { id: 200n, maxCuttingWastePercentage: { toNumber: () => 2 } },
        { id: 300n, maxCuttingWastePercentage: { toNumber: () => 0 } },
      ]);
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: {
          total_bars_all: 10,
          total_waste_mm: 100,
          waste_percentage: 1,
          any_over_threshold: false,
        },
        purchase_plan: [
          { material: '200', feasible: true, cutting_patterns: [] },
          { material: '300', feasible: true, cutting_patterns: [] },
        ],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });

      await invoke(2n, 1n);

      expect(prisma.material.findMany).toHaveBeenCalledWith({
        where: { id: { in: [200n, 300n] } },
        select: { id: true, maxCuttingWastePercentage: true },
      });
      const bodySent = (
        externalApiService.post.mock.calls[0] as unknown as [string, Record<string, unknown>]
      )[1];
      expect(bodySent.max_waste_percentage_by_material).toEqual({ '200': 2 });
    });

    it('retry auto_scan mang theo đúng max_waste_percentage_by_material của lần gọi đầu (D.hao-hut-sat)', async () => {
      prisma.material.findMany.mockResolvedValue([
        { id: 200n, maxCuttingWastePercentage: { toNumber: () => 0.3 } },
      ]);
      const overThreshold = {
        status: 'success',
        summary: {
          total_bars_all: 227,
          total_waste_mm: 20000,
          waste_percentage: 9.61,
          any_over_threshold: true,
        },
        purchase_plan: [
          { material: '200', feasible: true, over_threshold: true, cutting_patterns: [] },
        ],
      };
      const scanned = {
        status: 'success',
        summary: {
          total_bars_all: 223,
          total_waste_mm: 11373,
          waste_percentage: 0.85,
          any_over_threshold: false,
        },
        purchase_plan: [{ material: '200', feasible: true, cutting_patterns: [] }],
      };
      externalApiService.post.mockResolvedValueOnce(overThreshold).mockResolvedValueOnce(scanned);
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });

      await invoke(2n, 1n);

      expect(externalApiService.post).toHaveBeenCalledTimes(2);
      const [firstBody, secondBody] = externalApiService.post.mock.calls.map(
        (call) => (call as unknown as [string, Record<string, unknown>])[1],
      );
      expect(firstBody.max_waste_percentage_by_material).toEqual({ '200': 0.3 });
      expect(secondBody.max_waste_percentage_by_material).toEqual({ '200': 0.3 });
      expect(secondBody.auto_scan).toBe(true);
    });

    it('retries with auto_scan enabled when the first (fixed-length) call reports any_over_threshold', async () => {
      const overThreshold = {
        status: 'success',
        summary: {
          total_bars_all: 227,
          total_waste_mm: 20000,
          waste_percentage: 9.61,
          any_over_threshold: true,
        },
        purchase_plan: [{ material: '200', feasible: true, cutting_patterns: [] }],
      };
      const scanned = {
        status: 'success',
        summary: {
          total_bars_all: 223,
          total_waste_mm: 11373,
          waste_percentage: 0.85,
          any_over_threshold: false,
        },
        purchase_plan: [{ material: '200', feasible: true, cutting_patterns: [] }],
      };
      externalApiService.post.mockResolvedValueOnce(overThreshold).mockResolvedValueOnce(scanned);
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });

      await invoke(2n, 1n);

      expect(externalApiService.post).toHaveBeenCalledTimes(2);
      const [firstCall, secondCall] = externalApiService.post.mock.calls as unknown as Array<
        [
          string,
          { auto_scan: boolean; min_length: number; max_length: number; length_step: number },
        ]
      >;
      expect(firstCall[0]).toBe('http://solver.local/api/v1/de_xuat/propose/');
      expect(firstCall[1]).toMatchObject({ auto_scan: false });
      expect(secondCall[0]).toBe('http://solver.local/api/v1/de_xuat/propose/');
      expect(secondCall[1]).toMatchObject({
        auto_scan: true,
        min_length: 5000,
        max_length: 6000,
        length_step: 10,
      });

      // Kết quả LƯU phải là của lần gọi thứ 2 (đã vét cạn), không phải lần 1.
      const updateCall = prisma.cuttingProposal.update.mock.calls[0] as unknown as [
        { data: { wastePercentage: number } },
      ];
      expect(updateCall[0].data.wastePercentage).toBe(0.85);
    });

    it('retries with auto_scan enabled when a line is feasible=false even though any_over_threshold=false (bug fix D1)', async () => {
      // Solver chỉ set any_over_threshold=true cho vật tư "feasible nhưng vượt ngưỡng" - vật tư
      // HOÀN TOÀN infeasible (như dưới đây) không được cờ này phủ tới (xem api/views.py) - service
      // phải tự kiểm tra purchase_plan[].feasible để không bỏ sót ca này.
      const infeasibleFixed = {
        status: 'success',
        summary: {
          total_bars_all: 0,
          total_waste_mm: 0,
          waste_percentage: 0,
          any_over_threshold: false,
        },
        purchase_plan: [
          { material: '200', feasible: false, reason: 'Không có cách cắt nào đạt ngưỡng' },
        ],
      };
      const scanned = {
        status: 'success',
        summary: {
          total_bars_all: 34,
          total_waste_mm: 472,
          waste_percentage: 0.25,
          any_over_threshold: false,
        },
        purchase_plan: [{ material: '200', feasible: true, cutting_patterns: [] }],
      };
      externalApiService.post.mockResolvedValueOnce(infeasibleFixed).mockResolvedValueOnce(scanned);
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });

      await invoke(2n, 1n);

      expect(externalApiService.post).toHaveBeenCalledTimes(2);
      const [firstCall, secondCall] = externalApiService.post.mock.calls as unknown as Array<
        [string, { auto_scan: boolean }]
      >;
      expect(firstCall[1]).toMatchObject({ auto_scan: false });
      expect(secondCall[1]).toMatchObject({ auto_scan: true });

      const updateCall = prisma.cuttingProposal.update.mock.calls[0] as unknown as [
        { data: { wastePercentage: number } },
      ];
      expect(updateCall[0].data.wastePercentage).toBe(0.25);
    });

    it('marks the proposal FAILED with the solver error message when solver returns NO_FEASIBLE_SOLUTION', async () => {
      externalApiService.post.mockRejectedValue(
        new ExternalApiHttpError(422, {
          code: 'NO_FEASIBLE_SOLUTION',
          message: 'Không có cách cắt nào đạt hao hụt <= 1.0%',
          failing_materials: ['sắt vuông 20x20'],
        }),
      );

      await invoke(2n, 1n);

      const failCall = prisma.cuttingProposal.update.mock.calls[0] as unknown as [
        { where: { id: bigint }; data: { status: CuttingProposalStatus; errorMessage: string } },
      ];
      expect(failCall[0].where).toEqual({ id: 2n });
      expect(failCall[0].data.status).toBe(CuttingProposalStatus.FAILED);
      expect(failCall[0].data.errorMessage).toContain('sắt vuông 20x20');
      expect(prisma.cuttingProposalLine.create).not.toHaveBeenCalled();

      const notifyCall = prisma.notification.create.mock.calls[0] as unknown as [
        { data: { title: string; message: string; audience: string } },
      ];
      expect(notifyCall[0].data.audience).toBe('PRODUCTION_MANAGER');
      expect(notifyCall[0].data.title).toContain('thất bại');
      expect(notifyCall[0].data.message).toContain('sắt vuông 20x20');
    });

    it('maps multiple purchase_plan materials into separate CuttingProposalLine rows', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        pieceBomRow,
        {
          pieceId: 11n,
          segmentSpecId: 101n,
          qtyPerPiece: 2,
          piece: { name: 'mảnh tựa' },
          segmentSpec: { materialId: 300n, cutLengthMm: 840 },
        },
      ]);
      prisma.bomPiece.findMany.mockResolvedValue([
        { pieceId: 10n, qtyPerUnit: 4 },
        { pieceId: 11n, qtyPerUnit: 1 },
      ]);
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: { total_bars_all: 286, total_waste_mm: 12129, waste_percentage: 0.61 },
        purchase_plan: [
          { material: '200', feasible: true, cutting_patterns: [] },
          { material: '300', feasible: true, cutting_patterns: [] },
        ],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });

      await invoke(2n, 1n);

      expect(prisma.cuttingProposalLine.create).toHaveBeenCalledTimes(2);
      const materialIds = prisma.cuttingProposalLine.create.mock.calls.map(
        (call) => (call as unknown as [{ data: { materialId: bigint } }])[0].data.materialId,
      );
      expect(materialIds).toEqual([200n, 300n]);
    });

    it('stores an infeasible material line without touching cutting_patterns', async () => {
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: { total_bars_all: 0, total_waste_mm: 0, waste_percentage: 0 },
        purchase_plan: [{ material: '200', feasible: false }],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });

      await invoke(2n, 1n);

      const lineCall = prisma.cuttingProposalLine.create.mock.calls[0] as unknown as [
        { data: { feasible: boolean } },
      ];
      expect(lineCall[0].data.feasible).toBe(false);
      expect(prisma.cuttingProposalPattern.create).not.toHaveBeenCalled();
    });

    it('skips a pieces_breakdown segment whose size has no matching segmentSpec, without failing the rest', async () => {
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: { total_bars_all: 223, total_waste_mm: 11373, waste_percentage: 0.85 },
        purchase_plan: [
          {
            material: '200',
            feasible: true,
            cutting_patterns: [
              {
                pattern_id: 1,
                bars: 223,
                pieces_breakdown: [
                  { size: 660, count: 9 },
                  { size: 999, count: 3 }, // solver echoed a size we never sent
                ],
              },
            ],
          },
        ],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });
      prisma.cuttingProposalPattern.create.mockResolvedValue({ id: 500n });

      await invoke(2n, 1n);

      expect(prisma.cuttingProposalPatternSegment.create).toHaveBeenCalledTimes(1);
      expect(prisma.cuttingProposalPatternSegment.create).toHaveBeenCalledWith({
        data: { patternId: 500n, segmentSpecId: 100n, countPerBar: 9 },
      });
    });
  });

  describe('buildBomRows (private, invoked directly)', () => {
    const invokeBuildBomRows = (bomRevisionId: bigint) =>
      (
        service as unknown as {
          buildBomRows: (id: bigint) => Promise<{
            bomRows: Array<{ qty_per_set: number }>;
            segmentSpecLookup: Map<string, bigint>;
          }>;
        }
      ).buildBomRows(bomRevisionId);

    it('defaults qty_per_set to 0 when no bom_piece row matches the piece (defensive - should always exist in practice)', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([]); // no qtyPerUnit for pieceId 10n

      const { bomRows } = await invokeBuildBomRows(5n);

      expect(bomRows[0].qty_per_set).toBe(0);
    });

    it('throws NotFoundException when the bom revision has no piece_bom rows at all', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([]);

      await expect(invokeBuildBomRows(5n)).rejects.toThrow(NotFoundException);
    });
  });

  describe('approve', () => {
    it('rejects approving a proposal that is not DRAFT', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.CALCULATING,
        lines: [],
      });

      await expect(service.approve('2', 'user-1')).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the proposal does not exist', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue(null);

      await expect(service.approve('999', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('supersedes sibling proposals and marks this one APPROVED', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT,
        lines: [],
      });
      prisma.cuttingProposal.update.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.APPROVED,
        totalBarsAll: null,
        totalWasteMm: null,
        wastePercentage: null,
        errorMessage: null,
        requestedAt: new Date(),
        completedAt: null,
        approvedAt: new Date(),
        ...productionOrderRelation(),
      });

      const result = await service.approve('2', 'user-1');

      expect(prisma.cuttingProposal.updateMany).toHaveBeenCalledWith({
        where: {
          productionOrderId: 1n,
          id: { not: 2n },
          status: { in: [CuttingProposalStatus.DRAFT, CuttingProposalStatus.APPROVED] },
        },
        data: { status: CuttingProposalStatus.SUPERSEDED },
      });
      expect(result.status).toBe(CuttingProposalStatus.APPROVED);
    });

    it('auto-creates a PurchaseProposal for feasible lines with bars to buy, no stock on hand (Phase 8)', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT,
        lines: [
          { materialId: 30n, feasible: true, totalBars: 8 },
          { materialId: 31n, feasible: true, totalBars: 0 },
          { materialId: 32n, feasible: false, totalBars: 5 },
          { materialId: 33n, feasible: true, totalBars: null },
        ],
      });
      prisma.cuttingProposal.update.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.APPROVED,
        ...productionOrderRelation(),
      });
      // $queryRaw mặc định (beforeEach) trả tồn = 0 -> buyQty giữ nguyên = totalBars.

      await service.approve('2', 'user-1');

      expect(prisma.purchaseProposal.create).toHaveBeenCalledWith({
        data: {
          cuttingProposalId: 2n,
          warehouseCode: 'phoi-son-han',
          items: { create: [{ materialId: 30n, buyQty: 8, actualStock: 0 }] },
        },
      });
      // Không có gì để trừ (consumeQty=0) -> không post bút toán kho.
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('trừ tồn tự động: đủ tồn thì buyQty=0 và post STEEL_ISSUE đúng số lượng (Phase 8.1)', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT,
        lines: [{ materialId: 30n, feasible: true, totalBars: 8 }],
      });
      prisma.cuttingProposal.update.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.APPROVED,
        ...productionOrderRelation(),
      });
      prisma.$queryRaw.mockResolvedValue(qtyRow(20)); // tồn 20 >= nhu cầu 8

      await service.approve('2', 'user-1');

      // Mọi dòng buyQty=0 (tồn đã đủ, không có gì để mua) -> tạo thẳng PURCHASED, không phải NEW -
      // nếu không đề xuất sẽ kẹt vĩnh viễn ở PURCHASING vì cờ "mọi item đã nhận đủ" chỉ được kiểm
      // tra bên trong receiveItem(), không bao giờ được gọi khi chẳng có gì cần nhận
      // (D.p7-zero-buyqty-stuck, phát hiện qua e2e/golden-path.spec.ts).
      expect(prisma.purchaseProposal.create).toHaveBeenCalledWith({
        data: {
          cuttingProposalId: 2n,
          warehouseCode: 'phoi-son-han',
          items: { create: [{ materialId: 30n, buyQty: 0, actualStock: 20 }] },
          status: 'PURCHASED',
          purchasedAt: expect.any(Date) as Date,
        },
      });
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith({
        fromWarehouseId: 800n,
        toWarehouseId: 900n,
        materialId: 30n,
        qty: 8,
        refType: 'STEEL_ISSUE',
        refId: '2',
        createdById: 'user-1',
        idempotencyKey: 'cutting-proposal:2:steel-issue:30',
      });
    });

    it('trừ tồn tự động: thiếu 1 phần thì split đúng giữa tồn dùng ngay và buyQty (Phase 8.1)', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT,
        lines: [{ materialId: 30n, feasible: true, totalBars: 8 }],
      });
      prisma.cuttingProposal.update.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.APPROVED,
        ...productionOrderRelation(),
      });
      prisma.$queryRaw.mockResolvedValue(qtyRow(3)); // tồn 3 < nhu cầu 8 -> thiếu 5

      await service.approve('2', 'user-1');

      expect(prisma.purchaseProposal.create).toHaveBeenCalledWith({
        data: {
          cuttingProposalId: 2n,
          warehouseCode: 'phoi-son-han',
          items: { create: [{ materialId: 30n, buyQty: 5, actualStock: 3 }] },
        },
      });
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ qty: 3, refType: 'STEEL_ISSUE' }),
      );
    });

    it('does not create a PurchaseProposal when no line has bars to buy', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT,
        lines: [{ materialId: 30n, feasible: true, totalBars: 0 }],
      });
      prisma.cuttingProposal.update.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.APPROVED,
        ...productionOrderRelation(),
      });

      await service.approve('2', 'user-1');

      expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('lists across every production order (no where filter) with poNumber/mfgProduct joined', async () => {
      prisma.cuttingProposal.findMany.mockResolvedValue([
        {
          id: 2n,
          productionOrderId: 1n,
          status: CuttingProposalStatus.DRAFT,
          totalBarsAll: 34,
          totalWasteMm: 472,
          wastePercentage: 0.25,
          errorMessage: null,
          requestedAt: new Date(),
          completedAt: new Date(),
          approvedAt: null,
          ...productionOrderRelation(),
        },
      ]);
      prisma.cuttingProposal.count.mockResolvedValue(1);

      const result = await service.findAll({
        page: 1,
        limit: 20,
        sortOrder: 'desc' as never,
        skip: 0,
      });

      expect(prisma.cuttingProposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: undefined,
          include: {
            productionOrder: { include: { mfgProduct: true } },
            productionInvoice: { include: { items: { include: { mfgProduct: true } } } },
          },
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].poNumber).toBe('PO-1');
      expect(result.data[0].mfgProductCode).toBe('SKU-1');
    });
  });

  /**
   * Phần toán cốt lõi của việc gộp. `num_sets` của solver là hệ số nhân DÙNG CHUNG cho cả bom[]
   * nên không diễn tả được "SKU A làm 10 bộ, SKU B làm 25 bộ" - phải quy về nhu cầu tuyệt đối rồi
   * gửi num_sets=1. Sai chỗ này thì solver vẫn chạy và vẫn trả kết quả, chỉ là SAI SỐ LƯỢNG một
   * cách im lặng - không có gì báo lỗi, nên phải ghim bằng test.
   */
  describe('buildInvoiceJob (gộp nhu cầu nhiều SKU vào 1 bài toán)', () => {
    const buildJob = (piId: bigint) =>
      (
        service as unknown as {
          buildInvoiceJob: (id: bigint) => Promise<{
            label: string;
            numSets: number;
            bomRows: { part: string; qty_per_set: number; material: string; cut_length: number; qty_per_part: number }[];
          }>;
        }
      ).buildInvoiceJob(piId);

    /** 2 SKU, số lượng KHÁC nhau, dùng CHUNG cỡ đoạn 660mm của cùng loại sắt. */
    const twoSkuInvoice = () => {
      prisma.productionInvoice.findUniqueOrThrow.mockResolvedValue({
        id: 50n,
        code: 'PI-50',
        items: [
          {
            productionOrder: { id: 1n, bomRevisionId: 5n, quantity: 10 },
            mfgProduct: { factoryCode: 'BAN-J55' },
          },
          {
            productionOrder: { id: 2n, bomRevisionId: 6n, quantity: 25 },
            mfgProduct: { factoryCode: 'GHE-TY' },
          },
        ],
      });
      prisma.bomPiece.findMany.mockResolvedValue([{ pieceId: 10n, qtyPerUnit: 4 }]);
      prisma.pieceBom.findMany.mockResolvedValue([pieceBomRow]);
    };

    it('cộng dồn cùng (loại sắt, cỡ đoạn) của các SKU khác nhau thành MỘT nhu cầu', async () => {
      twoSkuInvoice();

      const job = await buildJob(50n);

      // 4 mảnh/bộ × 1 đoạn/mảnh × 10 bộ = 40; SKU kia = 4 × 1 × 25 = 100 -> gộp thành 140.
      expect(job.bomRows).toHaveLength(1);
      expect(job.bomRows[0].qty_per_part).toBe(140);
      expect(job.bomRows[0].material).toBe('200');
      expect(job.bomRows[0].cut_length).toBe(660);
      // Đã nhân sẵn số lượng vào từng dòng -> solver KHÔNG được nhân thêm lần nữa.
      expect(job.numSets).toBe(1);
      expect(job.bomRows[0].qty_per_set).toBe(1);
      expect(job.label).toBe('PI-50');
    });

    it('giữ dấu vết SKU trong tên đoạn để đọc lại log/rawResponse còn lần ra được', async () => {
      twoSkuInvoice();
      const job = await buildJob(50n);
      expect(job.bomRows[0].part).toContain('BAN-J55');
    });

    it('báo lỗi rõ khi đợt gộp chưa có lệnh sản xuất nào (SKU chưa được duyệt)', async () => {
      prisma.productionInvoice.findUniqueOrThrow.mockResolvedValue({
        id: 50n,
        code: 'PI-50',
        items: [{ productionOrder: null, mfgProduct: { factoryCode: 'BAN-J55' } }],
      });

      await expect(buildJob(50n)).rejects.toThrow(NotFoundException);
    });
  });
});
