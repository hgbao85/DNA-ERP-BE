import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { CuttingProposalStatus } from '../../generated/prisma/client';
import { AppConfig } from '../../config/configuration';
import { ExternalApiHttpError, ExternalApiService } from '../external/external-api.service';
import { CuttingProposalsService } from './cutting-proposals.service';

describe('CuttingProposalsService', () => {
  let service: CuttingProposalsService;
  let prisma: {
    cuttingProposal: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    cuttingProposalLine: { create: jest.Mock };
    cuttingProposalPattern: { create: jest.Mock };
    cuttingProposalPatternSegment: { create: jest.Mock };
    productionOrder: { findUniqueOrThrow: jest.Mock };
    systemConfig: { findUniqueOrThrow: jest.Mock };
    pieceBom: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    notification: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let externalApiService: { post: jest.Mock };
  let configService: { get: jest.Mock };

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
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      cuttingProposalLine: { create: jest.fn() },
      cuttingProposalPattern: { create: jest.fn() },
      cuttingProposalPatternSegment: { create: jest.fn() },
      productionOrder: { findUniqueOrThrow: jest.fn().mockResolvedValue(productionOrder) },
      systemConfig: { findUniqueOrThrow: jest.fn().mockResolvedValue(systemConfig) },
      pieceBom: { findMany: jest.fn().mockResolvedValue([pieceBomRow]) },
      bomPiece: { findMany: jest.fn().mockResolvedValue([{ pieceId: 10n, qtyPerUnit: 4 }]) },
      notification: { create: jest.fn() },
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
    service = new CuttingProposalsService(
      prisma as unknown as PrismaServiceType,
      externalApiService as unknown as ExternalApiService,
      configService as unknown as ConfigService<AppConfig, true>,
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
      });
      externalApiService.post.mockReturnValue(new Promise(() => {})); // never resolves

      const result = await service.requestForOrder(1n);

      expect(result.status).toBe(CuttingProposalStatus.CALCULATING);
      expect(prisma.cuttingProposal.create).toHaveBeenCalledWith({
        data: { productionOrderId: 1n, idempotencyKey: undefined, requestedById: undefined },
      });
    });
  });

  describe('runSolverAndSave (private, invoked directly)', () => {
    const invoke = (proposalId: bigint, productionOrderId: bigint) =>
      (
        service as unknown as {
          runSolverAndSave: (p: bigint, o: bigint) => Promise<void>;
        }
      ).runSolverAndSave(proposalId, productionOrderId);

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
  });
});
