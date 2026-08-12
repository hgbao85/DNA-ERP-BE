import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import {
  InspectionKhoStatus,
  PurchaseProposalSource,
  PurchaseProposalStatus,
} from '../../generated/prisma/client';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { PurchaseProposalsService } from './purchase-proposals.service';

const decimal = (n: number) => ({ toNumber: () => n });

describe('PurchaseProposalsService', () => {
  let service: PurchaseProposalsService;
  let prisma: {
    purchaseProposal: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
    purchaseProposalItem: {
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    purchaseProposalQuote: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    inspectionKhoResult: { findUnique: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };
  let stockLedgerService: { postEntry: jest.Mock };

  const material = (overrides: Record<string, unknown> = {}) => ({
    code: 'SAT-25',
    name: 'Sắt hộp 25x25',
    unit: 'cây',
    ...overrides,
  });

  const quote = (overrides: Record<string, unknown> = {}) => ({
    id: 900n,
    itemId: 400n,
    supplierId: null,
    supplierName: 'Minh Thành',
    unitPrice: { toNumber: () => 45000 },
    expectedDate: null,
    note: null,
    isChosen: false,
    ...overrides,
  });

  const item = (overrides: Record<string, unknown> = {}) => ({
    id: 400n,
    proposalId: 300n,
    materialId: 30n,
    actualStock: decimal(0),
    buyQty: decimal(8),
    receivedQty: decimal(0),
    material: material(),
    quotes: [],
    ...overrides,
  });

  const khoResultItem = (overrides: Record<string, unknown> = {}) => ({
    id: 700n,
    khoResultId: 500n,
    materialId: 30n,
    materialName: 'Sơn đen',
    materialUnit: 'kg',
    required: decimal(50),
    actualStock: decimal(10),
    ...overrides,
  });

  const khoResult = (overrides: Record<string, unknown> = {}) => ({
    id: 500n,
    requestId: 600n,
    warehouseCode: 'vat-tu-tp',
    status: InspectionKhoStatus.SUBMITTED,
    purchaseProposal: null,
    items: [khoResultItem()],
    ...overrides,
  });

  const proposal = (overrides: Record<string, unknown> = {}) => ({
    id: 300n,
    cuttingProposalId: 200n,
    inspectionKhoResultId: null,
    sourceType: PurchaseProposalSource.CUTTING_PROPOSAL,
    idempotencyKey: null,
    warehouseCode: 'phoi-son-han',
    status: PurchaseProposalStatus.NEW,
    createdAt: new Date(),
    submittedAt: null,
    approvedAt: null,
    approvedById: null,
    rejectedAt: null,
    rejectionReason: null,
    purchasedAt: null,
    cuttingProposal: {
      productionOrder: {
        poNumber: 'PO-9',
        mfgProduct: { factoryCode: 'JSE-55', name: 'Ghế J55' },
      },
    },
    inspectionKhoResult: null,
    items: [item()],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      purchaseProposal: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      purchaseProposalItem: {
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      purchaseProposalQuote: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      inspectionKhoResult: { findUnique: jest.fn() },
      warehouse: {
        findUniqueOrThrow: jest.fn(({ where }: { where: { code: string } }) =>
          Promise.resolve(where.code === 'SUPPLIER' ? { id: 700n } : { id: 800n }),
        ),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    stockLedgerService = { postEntry: jest.fn() };
    service = new PurchaseProposalsService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
    );
  });

  describe('findOne', () => {
    it('maps a detail row into the response dto with nested items/quotes', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ items: [item({ quotes: [quote()] })] }),
      );

      const result = await service.findOne('300');

      expect(result.id).toBe('300');
      expect(result.poNumber).toBe('PO-9');
      expect(result.mfgProductCode).toBe('JSE-55');
      expect(result.items?.[0].materialCode).toBe('SAT-25');
      expect(result.items?.[0].quotes[0].unitPrice).toBe(45000);
    });

    it('throws NotFoundException when the proposal does not exist', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('acknowledge', () => {
    it('moves NEW -> QUOTING', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(proposal());
      prisma.purchaseProposal.update.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );

      const result = await service.acknowledge('300');

      expect(prisma.purchaseProposal.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: PurchaseProposalStatus.QUOTING } }),
      );
      expect(result.status).toBe(PurchaseProposalStatus.QUOTING);
    });

    it('rejects when the proposal is not NEW', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );

      await expect(service.acknowledge('300')).rejects.toThrow(ConflictException);
    });
  });

  describe('addQuote', () => {
    it('creates a quote row under the item and returns it mapped', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );
      prisma.purchaseProposalItem.findFirst.mockResolvedValue(item());
      prisma.purchaseProposalItem.findUniqueOrThrow.mockResolvedValue(item({ quotes: [quote()] }));

      const result = await service.addQuote('300', '400', {
        supplierName: 'Minh Thành',
        unitPrice: 45000,
      });

      expect(prisma.purchaseProposalQuote.create).toHaveBeenCalledWith({
        data: {
          itemId: 400n,
          supplierId: undefined,
          supplierName: 'Minh Thành',
          unitPrice: 45000,
          expectedDate: undefined,
          note: undefined,
        },
      });
      expect(result.quotes).toHaveLength(1);
    });

    it('rejects when the proposal is not QUOTING', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(proposal());

      await expect(service.addQuote('300', '400', { supplierName: 'X' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when the item does not belong to this proposal', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );
      prisma.purchaseProposalItem.findFirst.mockResolvedValue(null);

      await expect(service.addQuote('300', '999', { supplierName: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.purchaseProposalQuote.create).not.toHaveBeenCalled();
    });
  });

  describe('submit', () => {
    it('rejects when some item has no quote with a positive unitPrice', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING, items: [item({ quotes: [] })] }),
      );

      await expect(service.submit('300')).rejects.toThrow(BadRequestException);
    });

    it('moves QUOTING -> SUBMITTED when every item has a valid quote', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.QUOTING,
          items: [item({ quotes: [quote()] })],
        }),
      );
      prisma.purchaseProposal.update.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.SUBMITTED, submittedAt: new Date() }),
      );

      const result = await service.submit('300');

      expect(result.status).toBe(PurchaseProposalStatus.SUBMITTED);
    });
  });

  describe('approve', () => {
    it('rejects when a chosen quote is missing for an item', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.SUBMITTED,
          items: [item({ quotes: [quote()] })],
        }),
      );

      await expect(service.approve('300', 'user-1', { chosenQuoteIdByItemId: {} })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when the chosen quote id does not belong to the item', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.SUBMITTED,
          items: [item({ quotes: [quote({ id: 900n })] })],
        }),
      );

      await expect(
        service.approve('300', 'user-1', { chosenQuoteIdByItemId: { '400': '999' } }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.purchaseProposalQuote.update).not.toHaveBeenCalled();
    });

    it('sets isChosen on the selected quote and moves SUBMITTED -> PURCHASING', async () => {
      const detail = proposal({
        status: PurchaseProposalStatus.SUBMITTED,
        items: [item({ quotes: [quote()] })],
      });
      prisma.purchaseProposal.findUnique
        .mockResolvedValueOnce(detail)
        .mockResolvedValueOnce(proposal({ status: PurchaseProposalStatus.PURCHASING }));

      await service.approve('300', 'user-1', { chosenQuoteIdByItemId: { '400': '900' } });

      expect(prisma.purchaseProposalQuote.updateMany).toHaveBeenCalledWith({
        where: { itemId: 400n },
        data: { isChosen: false },
      });
      expect(prisma.purchaseProposalQuote.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: { isChosen: true },
      });
      expect(prisma.purchaseProposal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PurchaseProposalStatus.PURCHASING }) as unknown,
        }),
      );
    });
  });

  describe('reject / requote', () => {
    it('rejects a SUBMITTED proposal with a reason', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.SUBMITTED }),
      );
      prisma.purchaseProposal.update.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.REJECTED, rejectionReason: 'Giá quá cao' }),
      );

      const result = await service.reject('300', { rejectionReason: 'Giá quá cao' });

      expect(result.status).toBe(PurchaseProposalStatus.REJECTED);
      expect(result.rejectionReason).toBe('Giá quá cao');
    });

    it('moves REJECTED -> QUOTING on requote and wipes old quotes first (D.p3-requote-dedup)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.REJECTED }),
      );
      prisma.purchaseProposal.update.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );

      const result = await service.requote('300');

      expect(result.status).toBe(PurchaseProposalStatus.QUOTING);
      // Xoá TRƯỚC khi mở QUOTING - addQuote() sau đó chỉ create() mới, không có cách sửa/xoá,
      // nên phải dọn sạch báo giá cũ ở đây để tránh nhân đôi khi FE submit lại toàn bộ form.
      expect(prisma.purchaseProposalQuote.deleteMany).toHaveBeenCalledWith({
        where: { item: { proposalId: 300n } },
      });
    });

    it('rejects rejecting a proposal that is not SUBMITTED', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.NEW }),
      );

      await expect(service.reject('300', { rejectionReason: 'x' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects requoting a proposal that is not REJECTED', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );

      await expect(service.requote('300')).rejects.toThrow(ConflictException);
    });
  });

  describe('receiveItem', () => {
    it('rejects receiving when the proposal is not PURCHASING', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.SUBMITTED }),
      );

      await expect(
        service.receiveItem('300', '400', { receivedQty: 1 }, 'user-1', 'key-1'),
      ).rejects.toThrow(ConflictException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the item does not belong to this proposal', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.PURCHASING, items: [item({ id: 400n })] }),
      );

      await expect(
        service.receiveItem('300', '999', { receivedQty: 1 }, 'user-1', 'key-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.purchaseProposalItem.update).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('accumulates receivedQty, clamps at buyQty, và ghi đúng phần tăng (increment) vào StockLedger (PURCHASE)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.PURCHASING,
          items: [item({ materialId: 30n, buyQty: decimal(8), receivedQty: decimal(3) })],
        }),
      );
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(8), quotes: [] }),
      );

      const result = await service.receiveItem(
        '300',
        '400',
        { receivedQty: 10 },
        'user-1',
        'key-1',
      );

      expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { receivedQty: 8 } }),
      );
      expect(result.receivedQty).toBe(8);
      // Chỉ ghi đúng phần MỚI thật sự nhận (8-3=5), không phải dto.receivedQty (10) thô.
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith({
        fromWarehouseId: 700n,
        toWarehouseId: 800n,
        materialId: 30n,
        qty: 5,
        refType: 'PURCHASE',
        refId: '300',
        createdById: 'user-1',
        idempotencyKey: 'key-1',
      });
    });

    it('không ghi StockLedger khi item đã nhận đủ (increment = 0)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.PURCHASING,
          items: [item({ buyQty: decimal(8), receivedQty: decimal(8) })],
        }),
      );
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(8), quotes: [] }),
      );

      await service.receiveItem('300', '400', { receivedQty: 5 }, 'user-1', 'key-1');

      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('flips the proposal to PURCHASED once every item is fully received', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.PURCHASING,
          items: [item({ id: 400n, buyQty: decimal(8), receivedQty: decimal(0) })],
        }),
      );
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(8), quotes: [] }),
      );

      await service.receiveItem('300', '400', { receivedQty: 8 }, 'user-1', 'key-1');

      expect(prisma.purchaseProposal.update).toHaveBeenCalledWith({
        where: { id: 300n },
        data: expect.objectContaining({ status: PurchaseProposalStatus.PURCHASED }) as unknown,
      });
    });

    it('does not flip to PURCHASED while another item is still short', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.PURCHASING,
          items: [
            item({ id: 400n, buyQty: decimal(8), receivedQty: decimal(0) }),
            item({ id: 401n, buyQty: decimal(5), receivedQty: decimal(0) }),
          ],
        }),
      );
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ id: 400n, buyQty: decimal(8), receivedQty: decimal(8), quotes: [] }),
      );

      await service.receiveItem('300', '400', { receivedQty: 8 }, 'user-1', 'key-1');

      expect(prisma.purchaseProposal.update).not.toHaveBeenCalled();
    });
  });

  describe('createFromInspection', () => {
    it('creates a MATERIAL_INSPECTION proposal from a SUBMITTED kho-result and returns it mapped', async () => {
      prisma.inspectionKhoResult.findUnique.mockResolvedValue(khoResult());
      prisma.purchaseProposal.create.mockResolvedValue({ id: 900n });
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          id: 900n,
          cuttingProposalId: null,
          inspectionKhoResultId: 500n,
          sourceType: PurchaseProposalSource.MATERIAL_INSPECTION,
          warehouseCode: 'vat-tu-tp',
          cuttingProposal: null,
          inspectionKhoResult: {
            request: {
              id: 600n,
              productionOrder: {
                poNumber: 'PO-9',
                mfgProduct: { factoryCode: 'JSE-55', name: 'Ghế J55' },
              },
            },
          },
          items: [item({ materialId: 30n })],
        }),
      );

      const result = await service.createFromInspection(
        { inspectionKhoResultId: '500', items: [{ itemId: '700', buyQty: 40 }] },
        undefined,
      );

      expect(prisma.purchaseProposal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceType: PurchaseProposalSource.MATERIAL_INSPECTION,
            inspectionKhoResultId: 500n,
            warehouseCode: 'vat-tu-tp',
            idempotencyKey: undefined,
            items: { create: [expect.objectContaining({ materialId: 30n, buyQty: 40 })] },
          }) as unknown,
        }),
      );
      expect(result.sourceType).toBe(PurchaseProposalSource.MATERIAL_INSPECTION);
      expect(result.cuttingProposalId).toBeNull();
      expect(result.poNumber).toBe('PO-9');
    });

    it('replays the existing proposal on idempotency-key retry, without creating a new one', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValueOnce({ id: 900n }).mockResolvedValueOnce(
        proposal({
          id: 900n,
          cuttingProposalId: null,
          inspectionKhoResultId: 500n,
          sourceType: PurchaseProposalSource.MATERIAL_INSPECTION,
          cuttingProposal: null,
          inspectionKhoResult: {
            request: {
              id: 600n,
              productionOrder: {
                poNumber: 'PO-9',
                mfgProduct: { factoryCode: 'JSE-55', name: 'Ghế J55' },
              },
            },
          },
        }),
      );

      const result = await service.createFromInspection(
        { inspectionKhoResultId: '500', items: [{ itemId: '700', buyQty: 40 }] },
        'insp-key-1',
      );

      expect(prisma.inspectionKhoResult.findUnique).not.toHaveBeenCalled();
      expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
      expect(result.id).toBe('900');
    });

    it('rejects when the kho-result does not exist', async () => {
      prisma.inspectionKhoResult.findUnique.mockResolvedValue(null);

      await expect(
        service.createFromInspection(
          { inspectionKhoResultId: '999', items: [{ itemId: '700', buyQty: 40 }] },
          undefined,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the kho-result is not SUBMITTED yet', async () => {
      prisma.inspectionKhoResult.findUnique.mockResolvedValue(
        khoResult({ status: InspectionKhoStatus.PENDING }),
      );

      await expect(
        service.createFromInspection(
          { inspectionKhoResultId: '500', items: [{ itemId: '700', buyQty: 40 }] },
          undefined,
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
    });

    it('rejects when the kho-result already has a purchase proposal', async () => {
      prisma.inspectionKhoResult.findUnique.mockResolvedValue(
        khoResult({ purchaseProposal: { id: 800n } }),
      );

      await expect(
        service.createFromInspection(
          { inspectionKhoResultId: '500', items: [{ itemId: '700', buyQty: 40 }] },
          undefined,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects an itemId that does not belong to this kho-result', async () => {
      prisma.inspectionKhoResult.findUnique.mockResolvedValue(khoResult());

      await expect(
        service.createFromInspection(
          { inspectionKhoResultId: '500', items: [{ itemId: '999', buyQty: 40 }] },
          undefined,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a line whose InspectionKhoResultItem has no materialId', async () => {
      prisma.inspectionKhoResult.findUnique.mockResolvedValue(
        khoResult({
          items: [khoResultItem({ materialId: null, materialName: 'Bao bì lạ chưa gắn vật tư' })],
        }),
      );

      await expect(
        service.createFromInspection(
          { inspectionKhoResultId: '500', items: [{ itemId: '700', buyQty: 4 }] },
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
