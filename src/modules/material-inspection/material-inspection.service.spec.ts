import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InspectionKhoStatus } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { SkusService } from '../skus/skus.service';
import { MaterialInspectionService } from './material-inspection.service';

const decimal = (n: number) => ({ toNumber: () => n });

describe('MaterialInspectionService', () => {
  let service: MaterialInspectionService;
  let skusService: { findOne: jest.Mock };
  let prisma: {
    materialInspectionRequest: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    planForm: { findUnique: jest.Mock };
    productionOrder: { findFirst: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    stockQuant: { findMany: jest.Mock };
    inspectionKhoResultItem: { update: jest.Mock };
    inspectionKhoResult: { update: jest.Mock };
    $transaction: jest.Mock;
  };

  const mfgProduct = { factoryCode: 'JSE-55', name: 'Ghế J55' };
  const productionOrder = (overrides: Record<string, unknown> = {}) => ({
    id: 99n,
    poNumber: 'PO-9',
    quantity: 10,
    mfgProductId: 2n,
    mfgProduct,
    productionInvoiceItem: { deliveryDeadline: null },
    ...overrides,
  });

  const khoResultItem = (overrides: Record<string, unknown> = {}) => ({
    id: 700n,
    khoResultId: 500n,
    materialId: 30n,
    materialName: 'Sắt hộp 25x25',
    materialUnit: 'cây',
    required: decimal(20),
    actualStock: null,
    ...overrides,
  });

  const khoResult = (overrides: Record<string, unknown> = {}) => ({
    id: 500n,
    requestId: 600n,
    warehouseCode: 'phoi-son-han',
    status: InspectionKhoStatus.PENDING,
    submittedAt: null,
    submittedById: null,
    purchaseProposal: null,
    items: [khoResultItem()],
    ...overrides,
  });

  const request = (overrides: Record<string, unknown> = {}) => ({
    id: 600n,
    planFormId: 5n,
    productionOrderId: 99n,
    productionStarted: false,
    productionStartedAt: null,
    createdById: 'user-khsx',
    createdAt: new Date(),
    productionOrder: productionOrder(),
    khoResults: [
      khoResult({ id: 500n, warehouseCode: 'phoi-son-han' }),
      khoResult({ id: 501n, warehouseCode: 'vat-tu-tp' }),
      khoResult({ id: 502n, warehouseCode: 'thanh-pham' }),
    ],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      materialInspectionRequest: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
      },
      planForm: { findUnique: jest.fn() },
      productionOrder: { findFirst: jest.fn() },
      warehouse: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 800n, code: 'phoi-son-han' }),
      },
      stockQuant: { findMany: jest.fn().mockResolvedValue([]) },
      inspectionKhoResultItem: { update: jest.fn() },
      inspectionKhoResult: { update: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    };
    skusService = { findOne: jest.fn() };
    service = new MaterialInspectionService(
      prisma as unknown as PrismaServiceType,
      skusService as unknown as SkusService,
    );
  });

  describe('create', () => {
    it('is idempotent on planFormId - returns the existing request without re-deriving anything', async () => {
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(request());

      const result = await service.create({ planFormId: '5' }, 'user-khsx');

      expect(prisma.planForm.findUnique).not.toHaveBeenCalled();
      expect(skusService.findOne).not.toHaveBeenCalled();
      expect(prisma.materialInspectionRequest.create).not.toHaveBeenCalled();
      expect(result.id).toBe('600');
    });

    it('throws NotFoundException when the PlanForm does not exist', async () => {
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(null);
      prisma.planForm.findUnique.mockResolvedValue(null);

      await expect(service.create({ planFormId: '999' }, 'user-khsx')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a PlanForm that is not origin=PRODUCTION_CONFIRM', async () => {
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(null);
      prisma.planForm.findUnique.mockResolvedValue({
        id: 5n,
        mfgProductId: 2n,
        productionInvoiceId: 7n,
        origin: null,
      });

      await expect(service.create({ planFormId: '5' }, 'user-khsx')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.productionOrder.findFirst).not.toHaveBeenCalled();
    });

    it('rejects when the PlanForm has no ProductionOrder yet (chưa được Sếp duyệt)', async () => {
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(null);
      prisma.planForm.findUnique.mockResolvedValue({
        id: 5n,
        mfgProductId: 2n,
        productionInvoiceId: 7n,
        origin: 'PRODUCTION_CONFIRM',
      });
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(service.create({ planFormId: '5' }, 'user-khsx')).rejects.toThrow(
        ConflictException,
      );
      expect(skusService.findOne).not.toHaveBeenCalled();
    });

    it('rejects when the SKU has no BOM quota reconstructed (manhData/detailQuota null)', async () => {
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(null);
      prisma.planForm.findUnique.mockResolvedValue({
        id: 5n,
        mfgProductId: 2n,
        productionInvoiceId: 7n,
        origin: 'PRODUCTION_CONFIRM',
      });
      prisma.productionOrder.findFirst.mockResolvedValue(productionOrder());
      skusService.findOne.mockResolvedValue({ manhData: null, detailQuota: null });

      await expect(service.create({ planFormId: '5' }, 'user-khsx')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.materialInspectionRequest.create).not.toHaveBeenCalled();
    });

    it('routes piece-scoped and flat lines into the correct kho with required = rate × qty', async () => {
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(null);
      prisma.planForm.findUnique.mockResolvedValue({
        id: 5n,
        mfgProductId: 2n,
        productionInvoiceId: 7n,
        origin: 'PRODUCTION_CONFIRM',
      });
      prisma.productionOrder.findFirst.mockResolvedValue(productionOrder({ quantity: 10 }));
      skusService.findOne.mockResolvedValue({
        manhData: {
          pieces: [
            {
              qtyPerUnit: 2,
              steel: [
                {
                  materialId: '30',
                  materialName: 'Sắt hộp 25x25',
                  materialUnit: 'cây',
                  qtyPerPiece: 1,
                },
              ],
              wire: [
                {
                  materialId: '31',
                  materialName: 'Dây buộc',
                  materialUnit: 'cuộn',
                  qtyPerPiece: 0.5,
                },
              ],
              nail: [],
              rivet: [],
              plasticButton: [],
            },
          ],
        },
        detailQuota: {
          daySon: [
            { materialId: '40', materialName: 'Sơn đen', materialUnit: 'kg', qtyPerUnit: 1.2 },
          ],
          vatTuPhuKien: [
            { materialId: '41', materialName: 'Ốc vít', materialUnit: 'cái', qtyPerUnit: 4 },
          ],
          baoBiDongGoi: [
            { materialId: '42', materialName: 'Thùng carton', materialUnit: 'cái', qtyPerUnit: 1 },
          ],
        },
      });
      prisma.materialInspectionRequest.create.mockResolvedValue(request());

      await service.create({ planFormId: '5' }, 'user-khsx');

      // qtyPerPiece(1) × piece.qtyPerUnit(2) × order.quantity(10) = 20 (thép, piece-scoped)
      // qtyPerUnit(1.2) × order.quantity(10) = 12 (sơn, phẳng)
      expect(prisma.materialInspectionRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          planFormId: 5n,
          productionOrderId: 99n,
          createdById: 'user-khsx',
          khoResults: {
            create: [
              expect.objectContaining({
                warehouseCode: 'phoi-son-han',
                items: {
                  create: [
                    expect.objectContaining({ materialId: 30n, required: 20 }),
                    expect.objectContaining({ materialId: 40n, required: 12 }),
                  ],
                },
              }),
              expect.objectContaining({
                warehouseCode: 'vat-tu-tp',
                items: {
                  create: [
                    expect.objectContaining({ materialId: 31n, required: 10 }), // 0.5×2×10
                    expect.objectContaining({ materialId: 41n, required: 40 }), // 4×10
                  ],
                },
              }),
              expect.objectContaining({
                warehouseCode: 'thanh-pham',
                items: {
                  create: [expect.objectContaining({ materialId: 42n, required: 10 })], // 1×10
                },
              }),
            ],
          },
        }) as unknown,
        include: expect.anything() as unknown,
      });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the request does not exist', async () => {
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('submitKho', () => {
    it('rejects an unknown warehouseCode', async () => {
      await expect(service.submitKho('600', 'kho-la', {}, 'user-kho', null)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.materialInspectionRequest.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a caller scoped to a different warehouse', async () => {
      await expect(
        service.submitKho('600', 'phoi-son-han', {}, 'user-kho', 'vat-tu-tp'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the kho is not PENDING anymore', async () => {
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(
        request({
          khoResults: [khoResult({ status: InspectionKhoStatus.SUBMITTED })],
        }),
      );

      await expect(service.submitKho('600', 'phoi-son-han', {}, 'user-kho', null)).rejects.toThrow(
        ConflictException,
      );
    });

    it('reads actualStock from real StockQuant for a materialId-bearing item, defaulting to 0 when no quant row exists', async () => {
      prisma.materialInspectionRequest.findUnique
        .mockResolvedValueOnce(
          request({ khoResults: [khoResult({ items: [khoResultItem({ materialId: 30n })] })] }),
        )
        .mockResolvedValueOnce(request());
      prisma.stockQuant.findMany.mockResolvedValue([]);

      await service.submitKho('600', 'phoi-son-han', {}, 'user-kho', null);

      expect(prisma.inspectionKhoResultItem.update).toHaveBeenCalledWith({
        where: { id: 700n },
        data: { actualStock: 0 },
      });
      expect(prisma.inspectionKhoResult.update).toHaveBeenCalledWith({
        where: { id: 500n },
        data: expect.objectContaining({
          status: InspectionKhoStatus.SUBMITTED,
          submittedById: 'user-kho',
        }) as unknown,
      });
    });

    it('uses the matched StockQuant qty when a quant row exists for the material', async () => {
      prisma.materialInspectionRequest.findUnique
        .mockResolvedValueOnce(
          request({ khoResults: [khoResult({ items: [khoResultItem({ materialId: 30n })] })] }),
        )
        .mockResolvedValueOnce(request());
      prisma.stockQuant.findMany.mockResolvedValue([{ materialId: 30n, qty: decimal(17) }]);

      await service.submitKho('600', 'phoi-son-han', {}, 'user-kho', null);

      expect(prisma.inspectionKhoResultItem.update).toHaveBeenCalledWith({
        where: { id: 700n },
        data: { actualStock: 17 },
      });
    });

    it('rejects an override submitted for an item that already has a materialId', async () => {
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(
        request({ khoResults: [khoResult({ items: [khoResultItem({ materialId: 30n })] })] }),
      );

      await expect(
        service.submitKho(
          '600',
          'phoi-son-han',
          { overrides: [{ itemId: '700', actualStock: 5 }] },
          'user-kho',
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires an override for an item with no materialId, and rejects when missing', async () => {
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(
        request({ khoResults: [khoResult({ items: [khoResultItem({ materialId: null })] })] }),
      );

      await expect(service.submitKho('600', 'phoi-son-han', {}, 'user-kho', null)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('accepts an override for an item with no materialId', async () => {
      prisma.materialInspectionRequest.findUnique
        .mockResolvedValueOnce(
          request({ khoResults: [khoResult({ items: [khoResultItem({ materialId: null })] })] }),
        )
        .mockResolvedValueOnce(request());

      await service.submitKho(
        '600',
        'phoi-son-han',
        { overrides: [{ itemId: '700', actualStock: 9 }] },
        'user-kho',
        null,
      );

      expect(prisma.inspectionKhoResultItem.update).toHaveBeenCalledWith({
        where: { id: 700n },
        data: { actualStock: 9 },
      });
    });
  });

  describe('startProduction', () => {
    it('rejects when not all 3 kho are SUBMITTED yet', async () => {
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(
        request({
          khoResults: [
            khoResult({
              id: 500n,
              warehouseCode: 'phoi-son-han',
              status: InspectionKhoStatus.SUBMITTED,
            }),
            khoResult({
              id: 501n,
              warehouseCode: 'vat-tu-tp',
              status: InspectionKhoStatus.PENDING,
            }),
            khoResult({
              id: 502n,
              warehouseCode: 'thanh-pham',
              status: InspectionKhoStatus.SUBMITTED,
            }),
          ],
        }),
      );

      await expect(service.startProduction('600')).rejects.toThrow(ConflictException);
      expect(prisma.materialInspectionRequest.update).not.toHaveBeenCalled();
    });

    it('flips productionStarted when all 3 kho are SUBMITTED', async () => {
      const allSubmitted = request({
        khoResults: [
          khoResult({
            id: 500n,
            warehouseCode: 'phoi-son-han',
            status: InspectionKhoStatus.SUBMITTED,
          }),
          khoResult({
            id: 501n,
            warehouseCode: 'vat-tu-tp',
            status: InspectionKhoStatus.SUBMITTED,
          }),
          khoResult({
            id: 502n,
            warehouseCode: 'thanh-pham',
            status: InspectionKhoStatus.SUBMITTED,
          }),
        ],
      });
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(allSubmitted);
      prisma.materialInspectionRequest.update.mockResolvedValue(
        request({ productionStarted: true, productionStartedAt: new Date() }),
      );

      const result = await service.startProduction('600');

      expect(prisma.materialInspectionRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 600n },
          data: expect.objectContaining({ productionStarted: true }) as unknown,
        }),
      );
      expect(result.productionStarted).toBe(true);
    });

    it('is a no-op when production has already started (does not bump the timestamp again)', async () => {
      prisma.materialInspectionRequest.findUnique.mockResolvedValue(
        request({ productionStarted: true, productionStartedAt: new Date('2026-01-01') }),
      );

      await service.startProduction('600');

      expect(prisma.materialInspectionRequest.update).not.toHaveBeenCalled();
    });
  });
});
