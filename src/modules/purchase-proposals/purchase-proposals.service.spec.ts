import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PurchaseProposalSource, PurchaseProposalStatus } from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
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
      findMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    warehouse: { findUniqueOrThrow: jest.Mock };
    systemConfig: { findUnique: jest.Mock };
    auditLog: { create: jest.Mock };
    cuttingProposalLine: { findFirst: jest.Mock };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let stockLedgerService: { postEntry: jest.Mock };
  let stockReservationsService: { creditPool: jest.Mock };
  let cls: { isActive: jest.Mock; get: jest.Mock; getId: jest.Mock };

  const material = (overrides: Record<string, unknown> = {}) => ({
    code: 'SAT-25',
    name: 'Sắt hộp 25x25',
    unit: 'cây',
    warehouseId: 800n,
    warehouse: { code: 'phoi-son-han' },
    buyerId: null as string | null,
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

  // status mặc định NEW (2026-08-25, "duyệt riêng từng người mua hàng") - state machine THẬT giờ
  // nằm ở CẤP ITEM, không còn ở proposal. material() mặc định buyerId=null (chưa gán ai) - mọi
  // actor đều coi là "của mình" theo đúng luật assertActorMayHandle, trừ khi test tự override
  // buyerId để kiểm tra phân quyền.
  const item = (overrides: Record<string, unknown> = {}) => ({
    id: 400n,
    proposalId: 300n,
    materialId: 30n,
    actualStock: decimal(0),
    buyQty: decimal(8),
    receivedQty: decimal(0),
    status: PurchaseProposalStatus.NEW,
    submittedAt: null,
    approvedAt: null,
    approvedById: null,
    rejectedAt: null,
    rejectionReason: null,
    purchasedAt: null,
    approvalFileUrl: null,
    material: material(),
    // Luồng cũ (gỡ 2026-08-27) - giữ mảng rỗng vì toItemResponseDto vẫn map field này để tra cứu
    // lịch sử; không còn đường nào ghi thêm báo giá mới.
    quotes: [],
    ...overrides,
  });

  const proposal = (overrides: Record<string, unknown> = {}) => ({
    id: 300n,
    cuttingProposalId: 200n,
    idempotencyKey: null,
    warehouseCode: 'phoi-son-han',
    // ROLLUP (2026-08-25) - phần lớn test không còn đọc field này để quyết định hành vi (đã
    // chuyển xuống item.status), chỉ còn dùng cho findAll()/toResponseDto() mapping thuần.
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
          // code này lên field piCode của DTO (2026-08-18) - productionOrder.poNumber (dòng 97)
          // vẫn giữ nguyên vai trò tra cứu nội bộ, không còn là mã hiển thị.
          productionInvoice: { code: 'PI-2026-014', deadline: null },
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
        // recomputeProposalStatus() (purchase-proposal-status.util.ts) đọc TƯƠI status của mọi
        // item trong proposal sau MỌI thao tác ghi - mặc định 1 dòng PURCHASING (chưa xong hẳn),
        // test nào cần kiểm đúng giá trị rollup cuối cùng (vd "flips to PURCHASED") tự override.
        findMany: jest.fn().mockResolvedValue([{ status: PurchaseProposalStatus.PURCHASING }]),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        // D.p12-item-status-race (2026-08-26): bossApprove() đọc `count` trả về từ updateMany để
        // phát hiện race (item đã bị đổi trạng thái bởi thao tác khác giữa lúc đọc snapshot và lúc
        // ghi). Mặc định coi MỌI id trong where đều khớp status
        // mong đợi (đúng "happy path" - không có race) bằng cách đếm chính số id được truyền vào;
        // test nào cần mô phỏng race (count lệch) tự override bằng mockResolvedValueOnce({count:...}).
        updateMany: jest.fn().mockImplementation((args: { where?: { id?: unknown } }) => {
          const idWhere = args?.where?.id;
          const count =
            idWhere && typeof idWhere === 'object' && idWhere !== null && 'in' in idWhere
              ? ((idWhere as { in?: unknown[] }).in?.length ?? 0)
              : 1;
          return Promise.resolve({ count });
        }),
      },
      // Sau khi kho nhận hàng chuyển sang đọc thẳng item.material.warehouseId (không qua lookup),
      // chỗ này chỉ còn phục vụ đúng 1 việc: tra kho ảo SUPPLIER trong receiveItem().
      warehouse: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 700n }),
      },
      // Dung sai giao thừa - mặc định 0 (không cho nhận thừa), test nào cần nới tự override.
      systemConfig: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ purchaseOverReceiptTolerancePercent: decimal(0) }),
      },
      // Audit ghi tay ở bossApprove() - xem auditProposalDecision().
      auditLog: { create: jest.fn() },
      // receiveItem() soi CuttingProposalLine để biết dòng đang nhận có phải sắt của ĐÚNG phương
      // án cắt gắn trên đề xuất không (2026-08-25, thay cho check cấp-đề-xuất cũ theo sourceType -
      // 1 đề xuất giờ có thể gộp cả sắt lẫn vật tư khác của cùng PI). Mặc định trả về 1 dòng khớp
      // (coi là sắt) - khớp với `proposal()`/`item()` factory mặc định (cuttingProposalId=200n,
      // materialId=30n) vốn đại diện cho ca sắt ở phần lớn test cũ; test nào cần mô phỏng "dòng
      // này KHÔNG phải sắt của phương án đó" (đề xuất gộp) tự override bằng mockResolvedValueOnce(null).
      cuttingProposalLine: { findFirst: jest.fn().mockResolvedValue({ id: 1n }) },
      // receiveItem() khoá dòng item rồi đọc lại receivedQty MỚI NHẤT bên trong transaction (C3,
      // xem receiveItem() và ghi chú D.c3-receive-race-not-atomic) - mặc định "chưa nhận gì" (0),
      // test nào cần giá trị khác (đã nhận 1 phần/đủ) tự override bằng mockResolvedValueOnce.
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ receivedQty: decimal(0), receivedQtyPurchaseUnit: null }]),
      // lockBusinessKey() (khoá chung "purchase-proposal-mutate:<id>" cho MỌI method ghi status,
      // 2026-08-25) dùng $executeRaw - no-op ở test.
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    stockLedgerService = { postEntry: jest.fn() };
    stockReservationsService = { creditPool: jest.fn() };
    cls = { isActive: jest.fn().mockReturnValue(false), get: jest.fn(), getId: jest.fn() };
    service = new PurchaseProposalsService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
      stockReservationsService as unknown as StockReservationsService,
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
      // 2026-08-25: status THẬT giờ ở cấp item (rollup cấp proposal không còn dùng để gate).
      expect(result.data[0].items?.[0].status).toBe(PurchaseProposalStatus.NEW);
    });

    // Audit 2026-08-20 (Medium "FE hard-code limit=100"): activeOnly phải lọc where ở tầng DB
    // (không phải client-side) để phiếu PURCHASED tích luỹ không đẩy phiếu đang xử lý khỏi trang.
    it('activeOnly=true loại PURCHASED khỏi where, không truyền activeOnly giữ nguyên hành vi cũ', async () => {
      prisma.purchaseProposal.findMany.mockResolvedValue([]);
      prisma.purchaseProposal.count.mockResolvedValue(0);

      const query = new PaginationQueryDto() as PaginationQueryDto & { activeOnly?: boolean };
      query.activeOnly = true;
      await service.findAll(query);

      expect(prisma.purchaseProposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: { not: PurchaseProposalStatus.PURCHASED } } }),
      );
      expect(prisma.purchaseProposal.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: { not: PurchaseProposalStatus.PURCHASED } } }),
      );

      await service.findAll(new PaginationQueryDto());

      expect(prisma.purchaseProposal.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });
  });

  describe('findOne', () => {
    it('maps a detail row into the response dto with nested items/quotes', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ items: [item({ quotes: [quote()] })] }),
      );

      const result = await service.findOne('300');

      expect(result.id).toBe('300');
      // 2026-08-18: poNumber quay về mã nội bộ (tra cứu), piCode mới là mã PI hiển thị - xem
      // trao đổi cùng ngày, DTO comment tại purchase-proposal-response.dto.ts.
      expect(result.poNumber).toBe('PO-9');
      expect(result.piCode).toBe('PI-2026-014');
      expect(result.mfgProductCode).toBe('JSE-55');
      expect(result.items?.[0].materialCode).toBe('SAT-25');
      expect(result.items?.[0].quotes[0].unitPrice).toBe(45000);
    });

    it('cuttingProposal=null (CuttingProposal gốc đã bị xóa, FK ON DELETE SET NULL) - trả về "—" thay vì crash 500', async () => {
      // Phát hiện 2026-08-19 khi dọn CuttingProposal test cho J55/Ghế tình yêu: `row.cuttingProposal!`
      // giả định luôn tồn tại, nhưng schema cho phép NULL (PurchaseProposal.cuttingProposalId
      // BigInt?) - hồ sơ mua hàng vẫn là dữ liệu THẬT (đã đặt/đã mua), chỉ mất dấu vết ngược.
      prisma.purchaseProposal.findUnique.mockResolvedValue(proposal({ cuttingProposal: null }));

      const result = await service.findOne('300');

      expect(result.poNumber).toBe('—');
      expect(result.piCode).toBe('—');
      expect(result.salesOrderCode).toBeNull();
      expect(result.deadline).toBeNull();
      expect(result.mfgProductName).toBeNull();
    });

    it('throws NotFoundException when the proposal does not exist', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });

    // 2026-08-22: sourceType=PIECE_MATERIAL_YIELD không đi qua CuttingProposal nào (cuttingProposal
    // null CỐ Ý, không phải "dữ liệu hỏng" như test ở trên) nhưng vẫn ghim thẳng productionInvoiceId
    // - Mua hàng phải vẫn thấy piCode/poNumber thay vì "—" trống trơn không biết đề xuất thuộc PI nào.
    it('sourceType=PIECE_MATERIAL_YIELD (cuttingProposal null CỐ Ý) - lấy piCode/poNumber từ row.productionInvoice trực tiếp', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ cuttingProposal: null, productionInvoice: { code: 'PI-2026-099' } }),
      );

      const result = await service.findOne('300');

      expect(result.poNumber).toBe('PI-2026-099');
      expect(result.piCode).toBe('PI-2026-099');
      expect(result.mfgProductName).toBe('Vật tư thành phẩm');
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
                productionInvoice: { code: 'PI-2026-014', deadline: new Date('2026-08-30') },
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
                productionInvoice: { code: 'PI-2026-014', deadline: new Date('2026-08-30') },
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

  // ── 2026-08-27: "Sếp duyệt ngoài hệ thống" - bỏ báo giá nhiều NCC + màn So sánh giá ──────────
  // acknowledge/addQuote/submit/approve/reject/requote đã gỡ khỏi service; toàn bộ chặng giữa gộp
  // vào đúng 1 thao tác này.
  describe('bossApprove', () => {
    const FILE = 'https://res.cloudinary.com/x/image/upload/v1/dna-erp/approvals/ky.jpg';

    /** Danh sách id item mà lượt updateMany đầu tiên thật sự đụng tới. */
    const approvedItemIds = (): bigint[] => {
      const calls = prisma.purchaseProposalItem.updateMany.mock.calls as {
        where: { id: { in: bigint[] } };
      }[][];
      return calls[0][0].where.id.in;
    };

    it('chuyển NEW -> PURCHASING cho đúng dòng của actor, ghi đủ file duyệt + người duyệt', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          items: [
            item({ id: 400n, material: material({ buyerId: 'user-1' }) }),
            item({ id: 401n, material: material({ buyerId: 'user-2' }) }),
          ],
        }),
      );

      await service.bossApprove('300', 'user-1', ['PURCHASER'], { approvalFileUrl: FILE });

      expect(prisma.purchaseProposalItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: [400n] },
          status: {
            in: [
              PurchaseProposalStatus.NEW,
              PurchaseProposalStatus.QUOTING,
              PurchaseProposalStatus.SUBMITTED,
              PurchaseProposalStatus.REJECTED,
            ],
          },
        },
        data: {
          status: PurchaseProposalStatus.PURCHASING,
          approvedAt: expect.any(Date) as Date,
          approvedById: 'user-1',
          approvalFileUrl: FILE,
        },
      });
    });

    // Ca sống-còn của đợt cắt luồng: lúc gỡ màn duyệt của Sếp, production còn 36 dòng nằm ở
    // QUOTING/SUBMITTED (đã bấm Tiếp nhận, hoặc đã gửi Sếp theo luồng cũ). bossApprove() là đường
    // ra DUY NHẤT của chúng - siết lại chỉ nhận NEW là treo vĩnh viễn 36 dòng hàng thật.
    it('nhận LUÔN dòng đang QUOTING/SUBMITTED/REJECTED của luồng cũ, không chỉ NEW', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          items: [
            item({ id: 400n, status: PurchaseProposalStatus.QUOTING }),
            item({ id: 401n, status: PurchaseProposalStatus.SUBMITTED }),
            item({ id: 402n, status: PurchaseProposalStatus.REJECTED }),
            item({ id: 403n, status: PurchaseProposalStatus.NEW }),
          ],
        }),
      );

      await service.bossApprove('300', 'user-1', ['PURCHASER'], { approvalFileUrl: FILE });

      expect(approvedItemIds()).toEqual([400n, 401n, 402n, 403n]);
    });

    it('KHÔNG đụng dòng đã PURCHASING/PURCHASED (đã duyệt rồi, duyệt lại là sai)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          items: [
            item({ id: 400n, status: PurchaseProposalStatus.NEW }),
            item({ id: 401n, status: PurchaseProposalStatus.PURCHASING }),
            item({ id: 402n, status: PurchaseProposalStatus.PURCHASED }),
          ],
        }),
      );

      await service.bossApprove('300', 'user-1', ['PURCHASER'], { approvalFileUrl: FILE });

      expect(approvedItemIds()).toEqual([400n]);
    });

    it('báo lỗi rõ ràng khi actor không còn dòng nào chờ duyệt trong đề xuất', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ items: [item({ status: PurchaseProposalStatus.PURCHASING })] }),
      );

      await expect(
        service.bossApprove('300', 'user-1', ['PURCHASER'], { approvalFileUrl: FILE }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.purchaseProposalItem.updateMany).not.toHaveBeenCalled();
    });

    // A4: cổng VÀO ĐỀ XUẤT (assertActorMayHandle) giữ nguyên như luồng cũ - actor phải sở hữu >=1
    // dòng vật tư hoặc dòng đó chưa gán ai; BOSS/ADMIN qua hết.
    it('chặn PURCHASER không được phân công mua vật tư nào trong đề xuất', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ items: [item({ material: material({ buyerId: 'user-2' }) })] }),
      );

      await expect(
        service.bossApprove('300', 'user-1', ['PURCHASER'], { approvalFileUrl: FILE }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.purchaseProposalItem.updateMany).not.toHaveBeenCalled();
    });

    it('cho phép BOSS duyệt hộ MỌI dòng của bất kỳ ai (isPrivilegedActor)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ items: [item({ material: material({ buyerId: 'user-2' }) })] }),
      );

      await expect(
        service.bossApprove('300', 'boss-1', ['BOSS'], { approvalFileUrl: FILE }),
      ).resolves.toBeDefined();
      expect(approvedItemIds()).toEqual([400n]);
    });

    // D.p12-item-status-race (2026-08-26): snapshot đọc NGOÀI transaction có thể đã cũ nếu thao tác
    // khác vừa đổi status giữa lúc đọc và lúc transaction kịp khoá + ghi.
    it('ném ConflictException nếu item vừa bị đổi trạng thái bởi thao tác khác (race)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ items: [item({ status: PurchaseProposalStatus.NEW })] }),
      );
      prisma.purchaseProposalItem.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.bossApprove('300', 'user-1', ['PURCHASER'], { approvalFileUrl: FILE }),
      ).rejects.toThrow(ConflictException);
    });

    // Bắt buộc: updateMany KHÔNG được extension audit tự ghi, nên nếu không ghi tay thì quyết định
    // "đẩy lô hàng sang mua" không để lại dấu vết nào. Trước đây phần này do approve() của Sếp ghi.
    it('ghi audit tay kèm file duyệt và trạng thái cũ của từng dòng', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ items: [item({ id: 400n, status: PurchaseProposalStatus.SUBMITTED })] }),
      );

      await service.bossApprove('300', 'user-1', ['PURCHASER'], { approvalFileUrl: FILE });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tableName: 'PurchaseProposalItem',
          recordId: '300',
          newValue: expect.objectContaining({
            event: 'boss-approve',
            approvalFileUrl: FILE,
            items: [
              {
                itemId: '400',
                materialCode: 'SAT-25',
                buyQty: 8,
                previousStatus: PurchaseProposalStatus.SUBMITTED,
              },
            ],
          }) as unknown,
        }) as unknown,
      });
    });
  });

  describe('receiveItem', () => {
    // 2026-08-25: kiểm ở CẤP ITEM (item.status), không còn assertStatus(proposal, PURCHASING) -
    // rollup cấp proposal có thể vẫn "quoting" nếu vật tư khác trong cùng đề xuất gộp chưa được
    // duyệt, trong khi ĐÚNG DÒNG này đã PURCHASING và nhận hàng được bình thường.
    it('rejects receiving when the item is not PURCHASING', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ items: [item({ status: PurchaseProposalStatus.QUOTING })] }),
      );

      await expect(
        service.receiveItem('300', '400', { receivedQty: 1 }, 'user-1', 'key-1'),
      ).rejects.toThrow(ConflictException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the item does not belong to this proposal', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({ items: [item({ id: 400n, status: PurchaseProposalStatus.PURCHASING })] }),
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
          items: [
            item({
              status: PurchaseProposalStatus.PURCHASING,
              materialId: 30n,
              buyQty: decimal(8),
              receivedQty: decimal(3),
            }),
          ],
        }),
      );
      // Số MỚI NHẤT tại thời điểm khoá dòng (đã nhận 3 từ đợt trước) - xem C3.
      prisma.$queryRaw.mockResolvedValue([
        { receivedQty: decimal(3), receivedQtyPurchaseUnit: null },
      ]);
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(8), quotes: [] }),
      );

      const result = await service.receiveItem('300', '400', { receivedQty: 5 }, 'user-1', 'key-1');

      expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ receivedQty: 8 }) as unknown }),
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

    // B4 Đợt 3 (lỗ #3, mục 13.4 changelog) / L5 (2026-08-26): hàng về phải "có chủ" ngay - cộng
    // vào ĐÚNG pool giữ chỗ của (PI, vật tư), không phải 1 cuttingProposalId cụ thể (đã ĐỔI Ở L5:
    // proposal.cuttingProposalId bị ghi đè khi merge nên không còn tin cậy được - nguồn xác thực
    // giờ là proposal.productionInvoiceId, KHÔNG đổi sau khi tạo).
    it('B4 Đợt 3 / L5: hàng về gọi creditPool() đúng (PI, vật tư, kho), đúng số tăng', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          cuttingProposalId: 200n,
          productionInvoiceId: 50n,
          items: [
            item({
              status: PurchaseProposalStatus.PURCHASING,
              materialId: 30n,
              buyQty: decimal(8),
              receivedQty: decimal(3),
            }),
          ],
        }),
      );
      prisma.$queryRaw.mockResolvedValue([
        { receivedQty: decimal(3), receivedQtyPurchaseUnit: null },
      ]);
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(8), quotes: [] }),
      );

      await service.receiveItem('300', '400', { receivedQty: 5 }, 'user-1', 'key-1');

      expect(stockReservationsService.creditPool).toHaveBeenCalledWith(expect.anything(), {
        productionInvoiceId: 50n,
        materialId: 30n,
        warehouseId: 800n,
        qty: 5,
      });
    });

    it('B4 Đợt 3 / L5: không gọi creditPool() khi không có gì tăng thật (incrementQty=0, ca hiếm nhận trùng)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          productionInvoiceId: 50n,
          items: [
            item({
              status: PurchaseProposalStatus.PURCHASING,
              materialId: 30n,
              buyQty: decimal(8),
              receivedQty: decimal(8),
            }),
          ],
        }),
      );
      // Khoá được: đã nhận đủ 8 từ đợt trước, lần nhập này báo 0 -> incrementQty=0.
      prisma.$queryRaw.mockResolvedValue([
        { receivedQty: decimal(8), receivedQtyPurchaseUnit: null },
      ]);
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(8), quotes: [] }),
      );

      await service.receiveItem('300', '400', { receivedQty: 0 }, 'user-1', 'key-1');

      expect(stockReservationsService.creditPool).not.toHaveBeenCalled();
    });

    // 2026-08-25: trước đây thiếu cuttingProposalId + sourceType khác PIECE_MATERIAL_YIELD bị coi
    // là "dữ liệu hỏng" -> throw (BUG THẬT: mọi đề xuất CONSUMABLE_AUTO_CALC luôn có
    // cuttingProposalId=null nhưng KHÔNG phải PIECE_MATERIAL_YIELD, nên receiveItem() cho đề xuất
    // vật tư tiêu hao luôn throw, không ai từng nhận hàng được qua đường này). Từ khi 1 đề xuất có
    // thể GỘP cả sắt lẫn vật tư khác của cùng PI (CuttingProposalsService.approve()), sourceType
    // cấp đề xuất không còn mô tả đúng nguồn của từng dòng nữa - bỏ hẳn check này, cứ thiếu
    // cuttingProposalId (hoặc có nhưng dòng đang nhận không phải sắt của đúng phương án đó) là bỏ
    // qua bước cộng giữ chỗ, nhập kho bình thường.
    it('không neo PI nào (dữ liệu hỏng, ca cực hiếm) - vẫn nhập kho thành công, không gọi creditPool', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          cuttingProposalId: null,
          productionInvoiceId: null,
          items: [
            item({
              status: PurchaseProposalStatus.PURCHASING,
              materialId: 30n,
              buyQty: decimal(8),
              receivedQty: decimal(0),
            }),
          ],
        }),
      );
      prisma.$queryRaw.mockResolvedValue([
        { receivedQty: decimal(0), receivedQtyPurchaseUnit: null },
      ]);
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(5), quotes: [] }),
      );

      const result = await service.receiveItem('300', '400', { receivedQty: 5 }, 'user-1', 'key-1');

      expect(result.receivedQty).toBe(5);
      // Short-circuit trên targetProductionInvoiceId - không có PI thì không có pool nào để soi,
      // khỏi cần query cuttingProposalLine.
      expect(prisma.cuttingProposalLine.findFirst).not.toHaveBeenCalled();
      expect(stockReservationsService.creditPool).not.toHaveBeenCalled();
    });

    // Đề xuất GỘP (2026-08-25): proposal neo đúng 1 PI (từ nguồn sắt) NHƯNG dòng đang nhận là vật
    // tư KHÁC của cùng PI (VTTP/tiêu hao), không nằm trong CuttingProposalLine của bất kỳ phương
    // án cắt nào thuộc PI đó. Nhận nhầm theo cấp-đề-xuất (cứ có PI là creditPool) sẽ tạo
    // StockReservation MỒ CÔI cho vật tư không phải sắt (xem StockReservationsService.creditPool
    // - pool rỗng thì TỰ TẠO MỚI).
    it('đề xuất gộp: dòng đang nhận KHÔNG phải sắt của phương án cắt nào thuộc PI này - không gọi creditPool', async () => {
      prisma.cuttingProposalLine.findFirst.mockResolvedValueOnce(null);
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          cuttingProposalId: 200n,
          productionInvoiceId: 50n,
          items: [
            item({
              status: PurchaseProposalStatus.PURCHASING,
              materialId: 99n,
              buyQty: decimal(8),
              receivedQty: decimal(0),
            }),
          ],
        }),
      );
      prisma.$queryRaw.mockResolvedValue([
        { receivedQty: decimal(0), receivedQtyPurchaseUnit: null },
      ]);
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ materialId: 99n, buyQty: decimal(8), receivedQty: decimal(5), quotes: [] }),
      );

      const result = await service.receiveItem('300', '400', { receivedQty: 5 }, 'user-1', 'key-1');

      expect(result.receivedQty).toBe(5);
      expect(prisma.cuttingProposalLine.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            materialId: 99n,
            cuttingProposal: {
              OR: [
                { productionInvoiceId: 50n },
                { productionOrder: { productionInvoiceItem: { productionInvoiceId: 50n } } },
              ],
            },
          },
        }),
      );
      expect(stockReservationsService.creditPool).not.toHaveBeenCalled();
    });

    // 2026-08-22: sourceType=PIECE_MATERIAL_YIELD (đề xuất mua thanh nhôm theo PieceMaterialYield,
    // xem PieceMaterialYieldPurchaseService) CỐ Ý luôn có cuttingProposalId null - khác hẳn ca
    // "dữ liệu hỏng" ở trên (không có sourceType, mặc định coi như CUTTING_PROPOSAL). PI thì VẪN
    // có (PieceMaterialYieldPurchaseService cũng set productionInvoiceId, xem "gộp 1 PI = 1 form")
    // nhưng vật tư thanh nhôm này không nằm trong CuttingProposalLine nào của PI - hàng về vẫn
    // phải nhập kho thành công, chỉ bỏ qua bước cộng vào pool giữ chỗ (không có pool nào để cộng).
    it('sourceType=PIECE_MATERIAL_YIELD, vật tư không qua CuttingProposal - vẫn nhập kho thành công, không gọi creditPool', async () => {
      prisma.cuttingProposalLine.findFirst.mockResolvedValueOnce(null);
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          cuttingProposalId: null,
          productionInvoiceId: 50n,
          sourceType: PurchaseProposalSource.PIECE_MATERIAL_YIELD,
          items: [
            item({
              status: PurchaseProposalStatus.PURCHASING,
              materialId: 30n,
              buyQty: decimal(8),
              receivedQty: decimal(0),
            }),
          ],
        }),
      );
      prisma.$queryRaw.mockResolvedValue([
        { receivedQty: decimal(0), receivedQtyPurchaseUnit: null },
      ]);
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(5), quotes: [] }),
      );

      const result = await service.receiveItem('300', '400', { receivedQty: 5 }, 'user-1', 'key-1');

      expect(result.receivedQty).toBe(5);
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ materialId: 30n, qty: 5, refType: 'PURCHASE' }),
        expect.anything(),
      );
      expect(stockReservationsService.creditPool).not.toHaveBeenCalled();
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
          items: [
            item({
              status: PurchaseProposalStatus.PURCHASING,
              materialId: 30n,
              buyQty: decimal(8),
              receivedQty: decimal(0),
            }),
          ], // snapshot CŨ
        }),
      );
      // Nhưng khi khoá được dòng, DB thật đã là 3 (lượt nhận khác vừa commit song song).
      prisma.$queryRaw.mockResolvedValue([
        { receivedQty: decimal(3), receivedQtyPurchaseUnit: null },
      ]);
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(5), quotes: [] }),
      );

      await service.receiveItem('300', '400', { receivedQty: 2 }, 'user-1', 'key-1');

      // 3 (khoá được) + 2 (nhập lần này) = 5, KHÔNG PHẢI 0 + 2 = 2 (nếu lỡ dùng snapshot cũ).
      expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ receivedQty: 5 }) as unknown }),
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
          items: [
            item({
              status: PurchaseProposalStatus.PURCHASING,
              materialId: 30n,
              buyQty: decimal(8),
              receivedQty: decimal(3),
            }),
          ],
        }),
      );
      prisma.$queryRaw.mockResolvedValue([
        { receivedQty: decimal(3), receivedQtyPurchaseUnit: null },
      ]);

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
          items: [
            item({
              status: PurchaseProposalStatus.PURCHASING,
              buyQty: decimal(8),
              receivedQty: decimal(8),
            }),
          ],
        }),
      );
      prisma.$queryRaw.mockResolvedValue([
        { receivedQty: decimal(8), receivedQtyPurchaseUnit: null },
      ]);

      await expect(
        service.receiveItem('300', '400', { receivedQty: 5 }, 'user-1', 'key-1'),
      ).rejects.toThrow(BadRequestException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('CHO nhận thừa trong dung sai và ghi ĐÚNG số thật (không cắt về buyQty)', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({
        purchaseOverReceiptTolerancePercent: decimal(25), // đặt 8 -> cho tới 10
      });
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          items: [
            item({
              status: PurchaseProposalStatus.PURCHASING,
              materialId: 30n,
              buyQty: decimal(8),
              receivedQty: decimal(0),
            }),
          ],
        }),
      );
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(10), quotes: [] }),
      );

      await service.receiveItem('300', '400', { receivedQty: 10 }, 'user-1', 'key-1');

      // Sổ ghi 10 - đúng số vật lý trong kho, KHÔNG phải 8.
      expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ receivedQty: 10 }) as unknown }),
      );
      expect(stockLedgerService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({ qty: 10 }),
        expect.anything(),
      );
    });

    // 2026-08-25: item nhận đủ (>=buyQty) tự chuyển PURCHASED NGAY trong data của chính update()
    // này (không còn 1 vòng riêng đọc lại "freshItems" như code cũ) - recomputeProposalStatus()
    // (đọc TƯƠI status mọi item qua purchaseProposalItem.findMany) mới suy ra rollup cấp proposal.
    it('item nhận đủ -> tự chuyển status=PURCHASED ngay trong update(), và rollup cấp proposal PURCHASED khi MỌI item đã vậy', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          items: [
            item({
              id: 400n,
              status: PurchaseProposalStatus.PURCHASING,
              buyQty: decimal(8),
              receivedQty: decimal(0),
            }),
          ],
        }),
      );
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ buyQty: decimal(8), receivedQty: decimal(8), quotes: [] }),
      );
      // recomputeProposalStatus() đọc TƯƠI - mô phỏng đúng dòng vừa PURCHASED ở trên.
      prisma.purchaseProposalItem.findMany.mockResolvedValue([
        { status: PurchaseProposalStatus.PURCHASED },
      ]);

      await service.receiveItem('300', '400', { receivedQty: 8 }, 'user-1', 'key-1');

      expect(prisma.purchaseProposalItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PurchaseProposalStatus.PURCHASED,
            purchasedAt: expect.any(Date) as Date,
          }) as unknown,
        }),
      );
      expect(prisma.purchaseProposal.update).toHaveBeenCalledWith({
        where: { id: 300n },
        data: { status: PurchaseProposalStatus.PURCHASED },
      });
    });

    it('rollup KHÔNG lên PURCHASED khi item khác trong cùng đề xuất vẫn còn PURCHASING (chưa nhận đủ)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          items: [
            item({
              id: 400n,
              status: PurchaseProposalStatus.PURCHASING,
              buyQty: decimal(8),
              receivedQty: decimal(0),
            }),
          ],
        }),
      );
      prisma.purchaseProposalItem.update.mockResolvedValue(
        item({ id: 400n, buyQty: decimal(8), receivedQty: decimal(8), quotes: [] }),
      );
      // item 401n (không nằm trong lượt nhận này) vẫn PURCHASING - rollup không nên nhảy PURCHASED.
      prisma.purchaseProposalItem.findMany.mockResolvedValue([
        { status: PurchaseProposalStatus.PURCHASED },
        { status: PurchaseProposalStatus.PURCHASING },
      ]);

      await service.receiveItem('300', '400', { receivedQty: 8 }, 'user-1', 'key-1');

      expect(prisma.purchaseProposal.update).toHaveBeenCalledWith({
        where: { id: 300n },
        data: { status: PurchaseProposalStatus.PURCHASING },
      });
    });

    it('nhập đúng vào kho RIÊNG của vật tư đang nhận (Material.warehouseId), không phải proposal.warehouseCode (Sếp chốt 2026-08-15)', async () => {
      prisma.purchaseProposal.findUnique.mockResolvedValue(
        proposal({
          // Kho tóm tắt cấp cả đề xuất cố tình khác kho thật của vật tư dưới đây, để chứng minh
          // receiveItem() không còn đọc field này.
          warehouseCode: 'phoi-son-han',
          items: [
            item({
              id: 400n,
              status: PurchaseProposalStatus.PURCHASING,
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
          items: [
            item({
              status: PurchaseProposalStatus.PURCHASING,
              material: material({ warehouseId: null, warehouse: null }),
            }),
          ],
        }),
      );

      await expect(
        service.receiveItem('300', '400', { receivedQty: 1 }, 'user-1', 'key-1'),
      ).rejects.toThrow(BadRequestException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });
  });
});
