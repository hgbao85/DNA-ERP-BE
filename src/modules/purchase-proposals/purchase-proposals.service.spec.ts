import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PurchaseProposalStatus } from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
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
    warehouse: { findUniqueOrThrow: jest.Mock };
    systemConfig: { findUnique: jest.Mock };
    auditLog: { create: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let stockLedgerService: { postEntry: jest.Mock };
  let cls: { isActive: jest.Mock; get: jest.Mock; getId: jest.Mock };

  const material = (overrides: Record<string, unknown> = {}) => ({
    code: 'SAT-25',
    name: 'Sắt hộp 25x25',
    unit: 'cây',
    warehouseId: 800n,
    warehouse: { code: 'phoi-son-han' },
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

  const proposal = (overrides: Record<string, unknown> = {}) => ({
    id: 300n,
    cuttingProposalId: 200n,
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
        // A3: nguồn deadline (frameDeadlineOf) - mặc định "không SKU nào có hạn nào" để giữ
        // hành vi cũ (deadline null) ở mọi test không nói riêng về A3.
        productionInvoiceItem: {
          materialDeadline: null,
          stages: [],
          productionInvoice: { deadline: null },
        },
      },
    },
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
      // Sau khi kho nhận hàng chuyển sang đọc thẳng item.material.warehouseId (không qua lookup),
      // chỗ này chỉ còn phục vụ đúng 1 việc: tra kho ảo SUPPLIER trong receiveItem().
      warehouse: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 700n }),
      },
      // Dung sai giao thừa - mặc định 0 (không cho nhận thừa), test nào cần nới tự override.
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue({ purchaseOverReceiptTolerancePercent: 0 }),
      },
      // Audit ghi tay ở approve()/requote() - xem auditQuoteDecision().
      auditLog: { create: jest.fn() },
      // receiveItem() khoá dòng item rồi đọc lại receivedQty MỚI NHẤT bên trong transaction (C3,
      // xem receiveItem() và ghi chú D.c3-receive-race-not-atomic) - mặc định "chưa nhận gì" (0),
      // test nào cần giá trị khác (đã nhận 1 phần/đủ) tự override bằng mockResolvedValueOnce.
      $queryRaw: jest.fn().mockResolvedValue([{ receivedQty: decimal(0), receivedQtyPurchaseUnit: null }]),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    stockLedgerService = { postEntry: jest.fn() };
    cls = { isActive: jest.fn().mockReturnValue(false), get: jest.fn(), getId: jest.fn() };
    service = new PurchaseProposalsService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
      cls as unknown as ClsService<AppClsStore>,
    );
  });

  // A5: findAll() dùng DETAIL_INCLUDE (không phải LIST_INCLUDE) - trước 2026-08-15 danh sách
  // không mang items, FE phải gọi thêm 1 GET :id CHO MỖI dòng (limit 100 -> tối đa 101
  // request/lần tải), xem D.a5-n-plus-one.
  describe('findAll', () => {
    it('trả kèm items ngay trong danh sách, không cần GET :id riêng cho từng dòng', async () => {
      prisma.purchaseProposal.findMany.mockResolvedValue([
        proposal({ items: [item({ quotes: [quote()] })] }),
      ]);
      prisma.purchaseProposal.count.mockResolvedValue(1);

      const result = await service.findAll(new PaginationQueryDto());

      expect(result.data[0].items?.[0].materialCode).toBe('SAT-25');
      expect(result.data[0].items?.[0].quotes[0].unitPrice).toBe(45000);
    });
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

    // ── A3: deadline (frameDeadlineOf) ──────────────────────────────────────────
    it('deadline ưu tiên materialDeadline trước mốc FRAME và hạn cả PI (nhánh lệnh SX đơn)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          cuttingProposal: {
            productionOrder: {
              poNumber: 'PO-9',
              mfgProduct: { factoryCode: 'JSE-55', name: 'Ghế J55' },
              productionInvoiceItem: {
                materialDeadline: new Date('2026-08-20'),
                stages: [{ stageType: 'FRAME', deadline: new Date('2026-08-25') }],
                productionInvoice: { deadline: new Date('2026-08-30') },
              },
            },
          },
        }),
      );

      const result = await service.findOne('300');

      expect(result.deadline).toEqual(new Date('2026-08-20'));
    });

    it('deadline rơi về mốc FRAME khi không có materialDeadline riêng', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          cuttingProposal: {
            productionOrder: {
              poNumber: 'PO-9',
              mfgProduct: { factoryCode: 'JSE-55', name: 'Ghế J55' },
              productionInvoiceItem: {
                materialDeadline: null,
                stages: [{ stageType: 'FRAME', deadline: new Date('2026-08-25') }],
                productionInvoice: { deadline: new Date('2026-08-30') },
              },
            },
          },
        }),
      );

      const result = await service.findOne('300');

      expect(result.deadline).toEqual(new Date('2026-08-25'));
    });

    it('deadline = null khi không SKU nào trong đề xuất có hạn nào', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(proposal()); // factory mặc định: mọi hạn null

      const result = await service.findOne('300');

      expect(result.deadline).toBeNull();
    });

    it('nhánh PI gộp: deadline = hạn SỚM NHẤT trong cả nhóm SKU, không phải SKU đầu tiên', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          cuttingProposal: {
            productionOrder: null, // PI gộp không có 1 lệnh SX đơn lẻ nào
            productionInvoice: {
              code: 'PI-2026-015',
              items: [
                {
                  mfgProduct: { factoryCode: 'JSE-55' },
                  materialDeadline: new Date('2026-09-10'), // muộn hơn
                  stages: [],
                },
                {
                  mfgProduct: { factoryCode: 'JSE-56' },
                  materialDeadline: new Date('2026-08-15'), // gấp nhất trong nhóm
                  stages: [],
                },
              ],
              deadline: new Date('2026-09-30'),
            },
          },
        }),
      );

      const result = await service.findOne('300');

      expect(result.deadline).toEqual(new Date('2026-08-15'));
    });
  });

  describe('acknowledge', () => {
    it('moves NEW -> QUOTING', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(proposal());
      prisma.purchaseProposal.update.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );

      const result = await service.acknowledge('300', 'user-1', []);

      expect(prisma.purchaseProposal.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: PurchaseProposalStatus.QUOTING } }),
      );
      expect(result.status).toBe(PurchaseProposalStatus.QUOTING);
    });

    it('rejects when the proposal is not NEW', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );

      await expect(service.acknowledge('300', 'user-1', [])).rejects.toThrow(ConflictException);
    });

    // A4: mirror đúng luật FE (purchasingRouting.ts) - actor phải sở hữu >=1 dòng vật tư, hoặc
    // dòng đó chưa gán ai. BOSS/ADMIN qua hết.
    it('chặn PURCHASER không được phân công mua vật tư nào trong đề xuất', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ items: [item({ material: material({ buyerId: 'user-2' }) })] }),
      );

      await expect(service.acknowledge('300', 'user-1', ['PURCHASER'])).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.purchaseProposal.update).not.toHaveBeenCalled();
    });

    it('cho phép actor đúng người được gán mua', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ items: [item({ material: material({ buyerId: 'user-1' }) })] }),
      );
      prisma.purchaseProposal.update.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );

      await expect(
        service.acknowledge('300', 'user-1', ['PURCHASER']),
      ).resolves.toBeDefined();
    });

    it('cho phép BOSS xử lý đề xuất của bất kỳ ai', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ items: [item({ material: material({ buyerId: 'user-2' }) })] }),
      );
      prisma.purchaseProposal.update.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );

      await expect(service.acknowledge('300', 'boss-1', ['BOSS'])).resolves.toBeDefined();
    });
  });

  describe('addQuote', () => {
    it('creates a quote row under the item and returns it mapped', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );
      prisma.purchaseProposalItem.findUniqueOrThrow.mockResolvedValue(item({ quotes: [quote()] }));

      const result = await service.addQuote(
        '300',
        '400',
        { supplierName: 'Minh Thành', unitPrice: 45000 },
        'user-1',
        [],
      );

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

      await expect(
        service.addQuote('300', '400', { supplierName: 'X' }, 'user-1', []),
      ).rejects.toThrow(ConflictException);
    });

    // item() giờ tra thẳng trong proposal.items (findDetailOrThrow, không còn findFirst riêng) -
    // item 999 không có trong danh sách mặc định [item()] (id 400n) nên rơi vào NotFoundException.
    it('throws NotFoundException when the item does not belong to this proposal', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );

      await expect(
        service.addQuote('300', '999', { supplierName: 'X' }, 'user-1', []),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.purchaseProposalQuote.create).not.toHaveBeenCalled();
    });

    it('chặn actor không được phân công mua vật tư nào trong đề xuất', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.QUOTING,
          items: [item({ material: material({ buyerId: 'user-2' }) })],
        }),
      );

      await expect(
        service.addQuote('300', '400', { supplierName: 'X' }, 'user-1', ['PURCHASER']),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.purchaseProposalQuote.create).not.toHaveBeenCalled();
    });
  });

  describe('submit', () => {
    it('rejects when some item has no quote with a positive unitPrice', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING, items: [item({ quotes: [] })] }),
      );

      await expect(service.submit('300', 'user-1', [])).rejects.toThrow(BadRequestException);
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

      const result = await service.submit('300', 'user-1', []);

      expect(result.status).toBe(PurchaseProposalStatus.SUBMITTED);
    });

    it('chặn actor không được phân công mua vật tư nào trong đề xuất', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.QUOTING,
          items: [item({ quotes: [quote()], material: material({ buyerId: 'user-2' }) })],
        }),
      );

      await expect(service.submit('300', 'user-1', ['PURCHASER'])).rejects.toThrow(
        ForbiddenException,
      );
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

    // C2: submit() chỉ đòi mỗi vật tư có ÍT NHẤT 1 báo giá có giá, không đòi cái ĐƯỢC CHỌN phải
    // là cái đó - nên vẫn duyệt được một lệnh mua không có giá nếu Sếp bấm nhầm dòng để trống.
    it('chặn khi báo giá được chọn chưa có đơn giá (dù vật tư có báo giá khác đã điền giá)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.SUBMITTED,
          items: [
            item({
              quotes: [
                quote({ id: 900n, supplierName: 'Minh Thành' }), // có giá -> qua được submit()
                quote({ id: 901n, supplierName: 'Hoà Phát', unitPrice: null }), // để trống
              ],
            }),
          ],
        }),
      );

      await expect(
        service.approve('300', 'user-1', { chosenQuoteIdByItemId: { '400': '901' } }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.purchaseProposalQuote.update).not.toHaveBeenCalled();
      expect(prisma.purchaseProposal.update).not.toHaveBeenCalled();
    });

    it('chặn khi báo giá được chọn có đơn giá = 0', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.SUBMITTED,
          items: [item({ quotes: [quote({ id: 900n, unitPrice: { toNumber: () => 0 } })] })],
        }),
      );

      await expect(
        service.approve('300', 'user-1', { chosenQuoteIdByItemId: { '400': '900' } }),
      ).rejects.toThrow(BadRequestException);
    });

    // C1: chuyển trạng thái được extension tự audit, nhưng quote là bảng con (không auto-audit)
    // nên "mua của ai, giá bao nhiêu" phải ghi tay - đó mới là thứ cần khi đối chiếu với NCC.
    it('ghi audit quyết định chọn NCC/giá khi duyệt', async () => {
      const detail = proposal({
        status: PurchaseProposalStatus.SUBMITTED,
        items: [item({ quotes: [quote()] })],
      });
      prisma.purchaseProposal.findUnique
        .mockResolvedValueOnce(detail)
        .mockResolvedValueOnce(proposal({ status: PurchaseProposalStatus.PURCHASING }));

      await service.approve('300', 'user-1', { chosenQuoteIdByItemId: { '400': '900' } });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'UPDATE',
          tableName: 'PurchaseProposalQuote',
          recordId: '300',
          newValue: {
            event: 'approve',
            chosen: [
              {
                itemId: '400',
                materialCode: 'SAT-25',
                quoteId: '900',
                supplierName: 'Minh Thành',
                supplierId: null,
                unitPrice: 45000,
                buyQty: 8,
              },
            ],
          },
        }) as unknown,
      });
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

    it('moves REJECTED -> QUOTING on requote, wipes old quotes first, và CHỤP LẠI trước khi xoá (D.p3-requote-dedup, D.c1-no-audit-on-money-path)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.REJECTED,
          rejectionReason: 'Giá cao hơn thị trường',
          items: [item({ quotes: [quote()] })],
        }),
      );
      prisma.purchaseProposal.update.mockResolvedValue(
        proposal({ status: PurchaseProposalStatus.QUOTING }),
      );

      const result = await service.requote('300', 'user-1', []);

      expect(result.status).toBe(PurchaseProposalStatus.QUOTING);
      // Xoá TRƯỚC khi mở QUOTING - addQuote() sau đó chỉ create() mới, không có cách sửa/xoá,
      // nên phải dọn sạch báo giá cũ ở đây để tránh nhân đôi khi FE submit lại toàn bộ form.
      expect(prisma.purchaseProposalQuote.deleteMany).toHaveBeenCalledWith({
        where: { item: { proposalId: 300n } },
      });
      // C1: deleteMany xoá SẠCH, không giữ lịch sử (đổi 2026-08-11) - nếu không chụp lại trước
      // đó thì sau vòng từ chối/báo giá lại này, giá NCC đã từng chào biến mất không dấu vết.
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'DELETE',
          tableName: 'PurchaseProposalQuote',
          recordId: '300',
          oldValue: {
            event: 'requote',
            rejectionReason: 'Giá cao hơn thị trường',
            deletedQuotes: [
              {
                itemId: '400',
                materialCode: 'SAT-25',
                quoteId: '900',
                supplierName: 'Minh Thành',
                unitPrice: 45000,
                expectedDate: null,
                isChosen: false,
              },
            ],
          },
        }) as unknown,
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

      await expect(service.requote('300', 'user-1', [])).rejects.toThrow(ConflictException);
    });

    it('chặn actor không được phân công mua vật tư nào trong đề xuất khi báo giá lại', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.REJECTED,
          items: [item({ material: material({ buyerId: 'user-2' }) })],
        }),
      );

      await expect(service.requote('300', 'user-1', ['PURCHASER'])).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.purchaseProposalQuote.deleteMany).not.toHaveBeenCalled();
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

    it('cộng dồn receivedQty qua nhiều đợt và ghi đúng phần tăng (increment) vào StockLedger (PURCHASE)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.PURCHASING,
          items: [item({ materialId: 30n, buyQty: decimal(8), receivedQty: decimal(3) })],
        }),
      );
      // Số MỚI NHẤT tại thời điểm khoá dòng (đã nhận 3 từ đợt trước) - xem C3.
      prisma.$queryRaw.mockResolvedValue([{ receivedQty: decimal(3), receivedQtyPurchaseUnit: null }]);
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(8), quotes: [] }),
      );

      const result = await service.receiveItem('300', '400', { receivedQty: 5 }, 'user-1', 'key-1');

      expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { receivedQty: 8 } }),
      );
      expect(result.receivedQty).toBe(8);
      // Chỉ ghi đúng phần MỚI của đợt này (5), không ghi lại 3 cây đã nhận đợt trước.
      // Tham số thứ 2 là `tx` của chính transaction receiveItem() đang giữ khoá (C3) - bút toán
      // PHẢI nằm trong đó, không post trước rồi mới mở transaction cập nhật receivedQty như cũ.
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        {
          fromWarehouseId: 700n,
          toWarehouseId: 800n,
          materialId: 30n,
          qty: 5,
          refType: 'PURCHASE',
          refId: '300',
          createdById: 'user-1',
          idempotencyKey: 'key-1',
        },
        expect.anything(),
      );
    });

    // C3: dùng receivedQty KHOÁ ĐƯỢC bên trong transaction, KHÔNG dùng giá trị đọc trước đó ở
    // findDetailOrThrow (có thể đã cũ nếu 1 lượt nhận khác vừa commit xong trong lúc request này
    // đang xử lý). Mô phỏng đúng race mà D.c3-receive-race-not-atomic mô tả: proposal.findUnique
    // (đọc TRƯỚC tx) vẫn thấy 0, nhưng dòng thật trong DB (đọc SAU KHI khoá) đã là 3 vì một lượt
    // nhận khác vừa commit. Trước fix, code cũ dùng thẳng snapshot 0 -> tính tăng SAI (5 thay vì
    // 2) và đè mất 3 cây đã ghi trước đó.
    it('dùng receivedQty KHOÁ ĐƯỢC trong tx, không dùng snapshot cũ đọc trước transaction', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.PURCHASING,
          items: [item({ materialId: 30n, buyQty: decimal(8), receivedQty: decimal(0) })], // snapshot CŨ
        }),
      );
      // Nhưng khi khoá được dòng, DB thật đã là 3 (lượt nhận khác vừa commit song song).
      prisma.$queryRaw.mockResolvedValue([{ receivedQty: decimal(3), receivedQtyPurchaseUnit: null }]);
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(5), quotes: [] }),
      );

      await service.receiveItem('300', '400', { receivedQty: 2 }, 'user-1', 'key-1');

      // 3 (khoá được) + 2 (nhập lần này) = 5, KHÔNG PHẢI 0 + 2 = 2 (nếu lỡ dùng snapshot cũ).
      expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { receivedQty: 5 } }),
      );
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ qty: 2 }), // tăng đúng 2 (lần nhập này), không phải 5
        expect.anything(),
      );
    });

    // ── B3: nhận thừa ─────────────────────────────────────────────────────────────
    // Trước 2026-08-15: Math.min(buyQty, ...) cắt âm thầm - đặt 10, giao 12, nhập 12 thì sổ ghi
    // 10 và 2 cây kia biến mất khỏi sổ dù vẫn nằm trong kho thật. Nay: trong dung sai thì ghi
    // đúng số thật, vượt dung sai thì chặn hẳn. Không bao giờ cắt im lặng.
    it('CHẶN khi tổng nhận vượt buyQty và dung sai = 0 (không cắt âm thầm về buyQty)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.PURCHASING,
          items: [item({ materialId: 30n, buyQty: decimal(8), receivedQty: decimal(3) })],
        }),
      );
      prisma.$queryRaw.mockResolvedValue([{ receivedQty: decimal(3), receivedQtyPurchaseUnit: null }]);

      // 3 đã nhận + 10 nhập thêm = 13 > 8 -> chặn, KHÔNG ghi 8 rồi nuốt 5 cây còn lại.
      await expect(
        service.receiveItem('300', '400', { receivedQty: 10 }, 'user-1', 'key-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.purchaseProposalItem.update).not.toHaveBeenCalled();
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('CHẶN cả khi item đã nhận đủ mà vẫn nhập thêm (trước đây lặng lẽ bỏ qua)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.PURCHASING,
          items: [item({ buyQty: decimal(8), receivedQty: decimal(8) })],
        }),
      );
      prisma.$queryRaw.mockResolvedValue([{ receivedQty: decimal(8), receivedQtyPurchaseUnit: null }]);

      await expect(
        service.receiveItem('300', '400', { receivedQty: 5 }, 'user-1', 'key-1'),
      ).rejects.toThrow(BadRequestException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('CHO nhận thừa trong dung sai và ghi ĐÚNG số thật (không cắt về buyQty)', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({
        purchaseOverReceiptTolerancePercent: 25, // đặt 8 -> cho tới 10
      });
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.PURCHASING,
          items: [item({ materialId: 30n, buyQty: decimal(8), receivedQty: decimal(0) })],
        }),
      );
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(10), quotes: [] }),
      );

      await service.receiveItem('300', '400', { receivedQty: 10 }, 'user-1', 'key-1');

      // Sổ ghi 10 - đúng số vật lý trong kho, KHÔNG phải 8.
      expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { receivedQty: 10 } }),
      );
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ qty: 10 }),
        expect.anything(),
      );
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

    it('nhập đúng vào kho RIÊNG của vật tư đang nhận (Material.warehouseId), không phải proposal.warehouseCode (Sếp chốt 2026-08-15)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          // Kho tóm tắt cấp cả đề xuất cố tình khác kho thật của vật tư dưới đây, để chứng minh
          // receiveItem() không còn đọc field này.
          warehouseCode: 'phoi-son-han',
          status: PurchaseProposalStatus.PURCHASING,
          items: [
            item({
              id: 400n,
              materialId: 40n,
              buyQty: decimal(5),
              receivedQty: decimal(0),
              material: material({
                code: 'VTP-40',
                warehouseId: 810n,
                warehouse: { code: 'vat-tu-tp' },
              }),
            }),
          ],
        }),
      );
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ materialId: 40n, buyQty: decimal(5), receivedQty: decimal(5), quotes: [] }),
      );

      await service.receiveItem('300', '400', { receivedQty: 5 }, 'user-1', 'key-1');

      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ toWarehouseId: 810n, materialId: 40n, qty: 5 }),
        expect.anything(),
      );
    });

    it('chặn nhận hàng (400) nếu vật tư của dòng đó chưa được gán Kho', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          status: PurchaseProposalStatus.PURCHASING,
          items: [item({ material: material({ warehouseId: null, warehouse: null }) })],
        }),
      );

      await expect(
        service.receiveItem('300', '400', { receivedQty: 1 }, 'user-1', 'key-1'),
      ).rejects.toThrow(BadRequestException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });
  });
});
