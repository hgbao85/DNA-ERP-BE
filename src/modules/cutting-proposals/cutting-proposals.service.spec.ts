import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { CuttingProposalStatus } from '../../generated/prisma/client';
import { AppConfig } from '../../config/configuration';
import { ExternalApiHttpError, ExternalApiService } from '../external/external-api.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { CuttingProposalsService } from './cutting-proposals.service';

describe('CuttingProposalsService', () => {
  let service: CuttingProposalsService;
  let prisma: {
    cuttingProposal: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
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
  let stockReservationsService: {
    reserve: jest.Mock;
    getAvailableQty: jest.Mock;
    releaseByRef: jest.Mock;
  };

  /** Mô phỏng `Prisma.Decimal` tối thiểu - đủ cho `.toNumber()` mà approve() gọi. */
  const qtyRow = (n: number) => [{ qty: { toNumber: () => n } }];
  /** Như trên, nhưng đủ CẢ cho `Number(x)` ép kiểu (dùng .valueOf) - cutLengthMm giờ Decimal(7,1)
   *  (2026-08-19) và code service dùng cả 2 cách gọi tuỳ chỗ. */
  const mockDecimal = (n: number) => ({
    toNumber: () => n,
    valueOf: () => n,
    toString: () => String(n),
  });

  // approve() dùng $queryRaw cho HAI việc khác nhau (xem cutting-proposals.service.ts):
  //   1. khoá dòng phương án rồi đọc lại status  -> trả [{ status }]
  //   2. khoá dòng stock_quant để tính tồn khả dụng -> trả [{ qty }]
  // Một `mockResolvedValue` duy nhất không phục vụ được cả hai (đã từng làm 9 test đỏ với
  // "trạng thái undefined"), nên mock phân nhánh theo chính câu SQL. Test điều khiển qua 2 biến
  // dưới đây thay vì override `$queryRaw` - override lại sẽ phá nhánh còn lại.
  let stockQty: number;
  /** null = dòng phương án đã biến mất giữa chừng (mô phỏng ca NotFound trong transaction). */
  let lockedProposalStatus: CuttingProposalStatus | null;

  /** LIST_INCLUDE (productionOrder.mfgProduct) - mọi mock đi qua toResponseDto() cần có. */
  const productionOrderRelation = () => ({
    productionOrder: {
      poNumber: 'PO-31-1',
      mfgProduct: { factoryCode: 'SKU-1', name: 'Ghế test' },
      productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
    },
  });

  const productionOrder = {
    id: 1n,
    poNumber: 'PO-31-1',
    bomRevisionId: 5n,
    quantity: 500,
    productionInvoiceItem: { salesOrder: { code: 'PO-31' } },
  };
  const systemConfig = {
    solverStockLengths: [5850, 6000],
    solverTrimStartMm: 10,
    solverBladeWidthMm: mockDecimal(1.0),
    solverMaxWastePercentage: mockDecimal(1.0),
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
    segmentSpec: { materialId: 200n, cutLengthMm: mockDecimal(660) },
  };

  beforeEach(() => {
    stockQty = 0; // mặc định "hết tồn" - test nào cần tồn > 0 tự gán lại
    lockedProposalStatus = CuttingProposalStatus.DRAFT;
    prisma = {
      cuttingProposal: {
        findUnique: jest.fn(),
        // Cổng chặn auto-duyệt (autoApproveBlockReason) đọc lại chính phương án để biết nó neo
        // vào lệnh SX hay đợt gộp; mặc định "neo vào PO-1, chưa từng có phương án nào được duyệt"
        // = ca bình thường được phép tự duyệt. Test nào cần ca bị chặn tự override.
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ productionOrderId: 1n, productionInvoiceId: null }),
        // Mặc định "không có anh em nào" (findMany tìm phương án bị supersede, B4 Đợt 3b) - test
        // nào thật sự cần mô phỏng supersede tự override bằng mockResolvedValueOnce.
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
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
      // Phân nhánh theo câu SQL - xem ghi chú ở stockQty/lockedProposalStatus phía trên.
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = Array.isArray(strings) ? strings.join('') : String(strings);
        if (sql.includes('cutting_proposals')) {
          return Promise.resolve(lockedProposalStatus ? [{ status: lockedProposalStatus }] : []);
        }
        return Promise.resolve(qtyRow(stockQty));
      }),
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
    // Mặc định "không có gì đang giữ chỗ" -> available = onHand nguyên vẹn, giữ đúng hành vi cũ
    // cho MỌI test không nói riêng về giữ chỗ (đa số). Test cần mô phỏng có giữ chỗ tự override
    // bằng mockResolvedValueOnce.
    stockReservationsService = {
      reserve: jest.fn(),
      getAvailableQty: jest.fn((_tx: unknown, _wId: unknown, _mId: unknown, onHand: number) =>
        Promise.resolve(onHand),
      ),
      releaseByRef: jest.fn(),
    };
    service = new CuttingProposalsService(
      prisma as unknown as PrismaServiceType,
      externalApiService as unknown as ExternalApiService,
      configService as unknown as ConfigService<AppConfig, true>,
      stockReservationsService as unknown as StockReservationsService,
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
          productionOrder: {
            include: {
              mfgProduct: true,
              productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } },
            },
          },
          // Nhánh phương án cấp nhóm - null với đề xuất neo vào 1 lệnh SX như ca này.
          productionInvoice: {
            include: {
              items: { include: { mfgProduct: true, salesOrder: { select: { code: true } } } },
            },
          },
        },
      });
    });
  });

  describe('requestForInvoice', () => {
    // Đối xứng với requestForOrder ở trên - thêm idempotencyKey 2026-08-19 để nút "Tính lại" cho
    // phiếu GỘP (route mới production-invoices/:id/cutting-proposals) chặn được double-click tạo
    // trùng, giống hệt lý do route production-orders/:id/cutting-proposals có sẵn từ trước.
    it('short-circuits and returns the existing proposal when the idempotency key already exists', async () => {
      const existing = {
        id: 1n,
        productionOrderId: null,
        productionInvoiceId: 5n,
        status: CuttingProposalStatus.DRAFT,
        totalBarsAll: 10,
        totalWasteMm: 100,
        wastePercentage: null,
        errorMessage: null,
        requestedAt: new Date(),
        completedAt: new Date(),
        approvedAt: null,
        productionOrder: null,
        productionInvoice: { code: 'PI-2026-020', items: [] },
      };
      prisma.cuttingProposal.findUnique.mockResolvedValue(existing);

      const result = await service.requestForInvoice(5n, { idempotencyKey: 'retry-abc' });

      expect(result.id).toBe('1');
      expect(prisma.cuttingProposal.create).not.toHaveBeenCalled();
    });

    it('creates a CALCULATING row anchored to productionInvoiceId and returns immediately without awaiting the solver call', async () => {
      prisma.cuttingProposal.create.mockResolvedValue({
        id: 2n,
        productionOrderId: null,
        productionInvoiceId: 5n,
        status: CuttingProposalStatus.CALCULATING,
        totalBarsAll: null,
        totalWasteMm: null,
        wastePercentage: null,
        errorMessage: null,
        requestedAt: new Date(),
        completedAt: null,
        approvedAt: null,
        productionOrder: null,
        productionInvoice: { code: 'PI-2026-020', items: [] },
      });
      externalApiService.post.mockReturnValue(new Promise(() => {})); // never resolves

      const result = await service.requestForInvoice(5n);

      expect(result.status).toBe(CuttingProposalStatus.CALCULATING);
      expect(prisma.cuttingProposal.create).toHaveBeenCalledWith({
        data: { productionInvoiceId: 5n, idempotencyKey: undefined, requestedById: undefined },
        include: expect.anything() as unknown,
      });
    });
  });

  describe('runSolverAndSave (private, invoked directly)', () => {
    // runSolverAndSave nhận callback dựng đầu vào (không nhận thẳng productionOrderId) từ khi có
    // thêm đường cắt chung cả nhóm - nối lại qua buildOrderJob để giữ nguyên ý nghĩa các test dưới.
    type PrivateParts = {
      runSolverAndSave: (
        p: bigint,
        buildJob: () => Promise<unknown>,
        requestedById?: string,
      ) => Promise<void>;
      buildOrderJob: (o: bigint) => Promise<unknown>;
    };
    const invoke = (proposalId: bigint, productionOrderId: bigint, requestedById?: string) => {
      const priv = service as unknown as PrivateParts;
      return priv.runSolverAndSave(
        proposalId,
        () => priv.buildOrderJob(productionOrderId),
        requestedById,
      );
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
      // Nhãn thông báo ưu tiên mã đơn Sales gốc (PO-31) thay vì poNumber nội bộ (xem buildOrderJob).
      expect(notifyCall[0].data.title).toContain('PO-31');
    });

    /** Đọc `data` của lần cuttingProposalLine.create thứ `index` - dùng chung cho nhóm test
     *  pieceSummary bên dưới. */
    const lineData = (index = 0) =>
      (
        prisma.cuttingProposalLine.create.mock.calls[index] as unknown as [
          { data: { pieceSummary?: unknown } },
        ]
      )[0].data;

    it('lưu pieceSummary: ghép pieces[] của solver với tên mảnh, sort cỡ đoạn giảm dần', async () => {
      // 2 mảnh khác nhau cùng dùng cỡ 660 (tên phải gộp lại), thêm 1 cỡ 930 để kiểm thứ tự sort.
      prisma.pieceBom.findMany.mockResolvedValue([
        pieceBomRow,
        { ...pieceBomRow, pieceId: 11n, piece: { name: 'chân ghế' } },
        {
          ...pieceBomRow,
          pieceId: 12n,
          segmentSpecId: 101n,
          piece: { name: 'đoạn dài' },
          segmentSpec: { materialId: 200n, cutLengthMm: mockDecimal(930) },
        },
      ]);
      prisma.bomPiece.findMany.mockResolvedValue([
        { pieceId: 10n, qtyPerUnit: 4 },
        { pieceId: 11n, qtyPerUnit: 4 },
        { pieceId: 12n, qtyPerUnit: 2 },
      ]);
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
            total_bars: 223,
            // Cố tình gửi cỡ NHỎ trước để chứng minh service tự sort giảm dần (bản in phải cùng
            // chiều với bảng cắt chi tiết ở FE - cỡ dài trước).
            pieces: [
              { size: 660, demand: 2000, produced: 2007, surplus: 7 },
              { size: 930, demand: 1000, produced: 1000, surplus: 0 },
            ],
            cutting_patterns: [],
          },
        ],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });

      await invoke(2n, 1n);

      expect(lineData().pieceSummary).toEqual([
        { size: 930, demand: 1000, produced: 1000, names: ['đoạn dài'] },
        { size: 660, demand: 2000, produced: 2007, names: ['chân bàn', 'chân ghế'] },
      ]);
    });

    it('pieceSummary = undefined khi solver không trả pieces (dòng infeasible) - để Prisma bỏ qua cột', async () => {
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: {
          total_bars_all: 0,
          total_waste_mm: 0,
          waste_percentage: 0,
          any_over_threshold: false,
        },
        purchase_plan: [{ material: '200', feasible: false, reason: 'Không xếp nổi' }],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });

      await invoke(2n, 1n);

      expect(lineData().pieceSummary).toBeUndefined();
    });

    it('tự động duyệt ngay sau khi tính thành công - không cần gọi approve() riêng (Sếp chốt 2026-08-15)', async () => {
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: {
          total_bars_all: 8,
          total_waste_mm: 100,
          waste_percentage: 1,
          any_over_threshold: false,
        },
        purchase_plan: [{ material: '200', feasible: true, total_bars: 8, cutting_patterns: [] }],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });
      // approve() bên trong runSolverAndSave tự đọc lại bản ghi vừa lưu - mock đúng shape lines
      // khớp với response solver ở trên (feasible/totalBars).
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT,
        lines: [{ materialId: 200n, feasible: true, totalBars: 8 }],
      });
      prisma.cuttingProposal.update.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.APPROVED,
        ...productionOrderRelation(),
      });
      // $queryRaw mặc định (beforeEach) trả tồn = 0 -> buyQty = 8 nguyên vẹn.
      // material.findMany dùng chung mock cho 2 việc theo ĐÚNG thứ tự gọi: (1) tra ngưỡng hao hụt
      // riêng trong runSolverAndSave (rỗng - không vật tư nào có ngưỡng riêng), (2) tra Kho của
      // từng vật tư trong approve() (mới thêm 2026-08-15, xem cutting-proposals.service.ts).
      prisma.material.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 200n, code: 'SAT-200', warehouseId: 800n, warehouse: { code: 'phoi-son-han' } },
        ]);

      await invoke(2n, 1n, 'user-boss');

      // update() bị gọi 2 lần: saveSuccess() ghi DRAFT trước, approve() ghi APPROVED sau - không
      // có ai bấm nút nào ở giữa.
      expect(prisma.cuttingProposal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 2n },
          data: expect.objectContaining({
            status: CuttingProposalStatus.APPROVED,
            approvedById: 'user-boss',
          }) as unknown,
        }),
      );
      expect(prisma.purchaseProposal.create).toHaveBeenCalledWith({
        data: {
          cuttingProposalId: 2n,
          warehouseCode: 'phoi-son-han',
          items: { create: [{ materialId: 200n, buyQty: 8, actualStock: 0 }] },
        },
      });
      const notifyCall = prisma.notification.create.mock.calls[0] as unknown as [
        { data: { title: string } },
      ];
      expect(notifyCall[0].data.title).toContain('tự động duyệt');
    });

    it('auto-duyệt lỗi không được đè kết quả DRAFT vừa lưu thành FAILED - chỉ log + báo QLSX duyệt tay', async () => {
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: {
          total_bars_all: 8,
          total_waste_mm: 100,
          waste_percentage: 1,
          any_over_threshold: false,
        },
        purchase_plan: [{ material: '200', feasible: true, total_bars: 8, cutting_patterns: [] }],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });
      // findUnique không mock riêng -> mặc định trả undefined -> approve() bên trong tự throw
      // NotFoundException, mô phỏng ca hiếm auto-duyệt lỗi.

      await invoke(2n, 1n);

      const updateCalls = prisma.cuttingProposal.update.mock.calls as unknown as [
        { data: { status?: CuttingProposalStatus } },
      ][];
      const draftCall = updateCalls.find((c) => c[0].data.status === CuttingProposalStatus.DRAFT);
      expect(draftCall).toBeDefined();
      expect(prisma.cuttingProposal.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CuttingProposalStatus.FAILED }) as unknown,
        }),
      );
      const notifyCall = prisma.notification.create.mock.calls[0] as unknown as [
        { data: { title: string } },
      ];
      expect(notifyCall[0].data.title).toContain('tự động duyệt thất bại');
    });

    it('KHÔNG tự duyệt khi còn vật tư feasible=false - không trừ kho, không tạo đề xuất mua, báo QLSX duyệt tay', async () => {
      // approve() lọc buyableLines theo `feasible && totalBars>0`, nên dòng infeasible bị loại
      // khỏi đề xuất mua KHÔNG một lời cảnh báo. Ca hỗn hợp (1 vật tư ra, 1 vật tư không) là ca
      // nguy hiểm nhất: đề xuất mua trông vẫn bình thường, tới lúc Phôi ra xưởng mới lòi ra thiếu.
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: {
          total_bars_all: 8,
          total_waste_mm: 100,
          waste_percentage: 1,
          // any_over_threshold=false nhưng có dòng infeasible -> vẫn trip retry auto_scan (đã có
          // test riêng); ở đây quan tâm chuyện SAU retry vẫn còn infeasible thì xử lý thế nào.
          any_over_threshold: false,
        },
        purchase_plan: [
          { material: '200', feasible: true, total_bars: 8, cutting_patterns: [] },
          { material: '201', feasible: false, cutting_patterns: [] },
        ],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });
      // Chỉ 2 lần gọi: (1) tra ngưỡng hao hụt riêng trước khi gọi solver - retry auto_scan dùng
      // lại baseRequestBody nên KHÔNG tra lại; (2) đổi id vật tư -> mã cho thông báo QLSX.
      prisma.material.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ code: 'SAT-201' }]);

      await invoke(2n, 1n, 'user-boss');

      // Kết quả tính vẫn được lưu DRAFT bình thường - chặn duyệt KHÁC với đánh hỏng lần tính.
      const updateCalls = prisma.cuttingProposal.update.mock.calls as unknown as [
        { data: { status?: CuttingProposalStatus } },
      ][];
      expect(
        updateCalls.find((c) => c[0].data.status === CuttingProposalStatus.DRAFT),
      ).toBeDefined();
      expect(
        updateCalls.find((c) => c[0].data.status === CuttingProposalStatus.APPROVED),
      ).toBeUndefined();
      expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
      expect(stockReservationsService.reserve).not.toHaveBeenCalled();

      const notify = prisma.notification.create.mock.calls[0] as unknown as [
        { data: { title: string; message: string } },
      ];
      expect(notify[0].data.title).toContain('CẦN DUYỆT TAY');
      // Thông báo phải gọi đúng MÃ vật tư ("SAT-201"), không phải id thô - QLSX đọc cái này.
      expect(notify[0].data.message).toContain('SAT-201');
      expect(notify[0].data.message).toContain('Chưa trừ tồn kho');
    });

    it('KHÔNG tự duyệt khi vật tư feasible=true nhưng over_threshold=true - không trừ kho, không mua', async () => {
      // Phát hiện khi review sau khi bỏ auto_scan (2026-08-18): over_threshold trước đây bị bỏ
      // qua hoàn toàn ở cổng chặn - hệ thống ĐÃ VÀ ĐANG tự duyệt/trừ kho/tạo đề xuất mua cho các
      // phương án vượt ngưỡng hao hụt, không một lời cảnh báo. Đây là test khẳng định lỗ đã vá.
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: {
          total_bars_all: 8,
          total_waste_mm: 400,
          waste_percentage: 2.4,
          any_over_threshold: true,
        },
        purchase_plan: [
          {
            material: '200',
            feasible: true,
            over_threshold: true,
            total_bars: 8,
            cutting_patterns: [],
          },
        ],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });
      // 2 lần gọi material.findMany, ĐÚNG thứ tự: (1) tra ngưỡng riêng trước khi gọi solver -
      // rỗng, không vật tư nào có ngưỡng riêng; (2) đổi id -> mã trong autoApproveBlockReason().
      prisma.material.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ code: 'SAT-200' }]);

      await invoke(2n, 1n, 'user-boss');

      const updateCalls = prisma.cuttingProposal.update.mock.calls as unknown as [
        { data: { status?: CuttingProposalStatus } },
      ][];
      expect(
        updateCalls.find((c) => c[0].data.status === CuttingProposalStatus.DRAFT),
      ).toBeDefined();
      expect(
        updateCalls.find((c) => c[0].data.status === CuttingProposalStatus.APPROVED),
      ).toBeUndefined();
      expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
      expect(stockReservationsService.reserve).not.toHaveBeenCalled();

      const notify = prisma.notification.create.mock.calls[0] as unknown as [
        { data: { title: string; message: string } },
      ];
      expect(notify[0].data.title).toContain('CẦN DUYỆT TAY');
      expect(notify[0].data.message).toContain('SAT-200');
      expect(notify[0].data.message).toContain('KHÔNG tự nới ngưỡng');
    });

    it('vẫn tự duyệt bình thường khi over_threshold=false trên mọi dòng feasible', async () => {
      // Không được quá tay chặn cả ca hợp lệ - đối trọng với 2 test chặn ở trên, tránh regression
      // kiểu "chặn nhầm mọi thứ". Mirror đúng mock của test "tự động duyệt ngay sau khi tính
      // thành công" ở trên, chỉ thêm over_threshold: false tường minh.
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: {
          total_bars_all: 8,
          total_waste_mm: 50,
          waste_percentage: 0.3,
          any_over_threshold: false,
        },
        purchase_plan: [
          {
            material: '200',
            feasible: true,
            over_threshold: false,
            total_bars: 8,
            cutting_patterns: [],
          },
        ],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT,
        lines: [{ materialId: 200n, feasible: true, totalBars: 8 }],
      });
      prisma.cuttingProposal.update.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.APPROVED,
        ...productionOrderRelation(),
      });
      prisma.material.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 200n, code: 'SAT-200', warehouseId: 800n, warehouse: { code: 'phoi-son-han' } },
        ]);

      await invoke(2n, 1n, 'user-boss');

      const updateCalls = prisma.cuttingProposal.update.mock.calls as unknown as [
        { data: { status?: CuttingProposalStatus } },
      ][];
      expect(
        updateCalls.find((c) => c[0].data.status === CuttingProposalStatus.APPROVED),
      ).toBeDefined();
      expect(prisma.purchaseProposal.create).toHaveBeenCalled();
    });

    it('KHÔNG tự duyệt lần 2 cho cùng một nhu cầu đã có phương án APPROVED (chặn "Tính lại" trừ kho + mua trùng)', async () => {
      // Nút "Tính lại" gửi Idempotency-Key mới mỗi lần bấm -> luôn sinh CuttingProposal MỚI. Tự
      // duyệt tiếp sẽ trừ tồn lần 2 (idempotencyKey bút toán khoá theo id phương án) và tạo
      // PurchaseProposal trùng, trong khi phương án cũ chỉ bị đánh SUPERSEDED - trạng thái đó
      // KHÔNG huỷ đề xuất mua cũ và KHÔNG hoàn tồn.
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: {
          total_bars_all: 8,
          total_waste_mm: 100,
          waste_percentage: 1,
          any_over_threshold: false,
        },
        purchase_plan: [{ material: '200', feasible: true, total_bars: 8, cutting_patterns: [] }],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });
      // Cùng lệnh SX đã có 1 phương án APPROVED từ lần tính trước.
      prisma.cuttingProposal.count.mockResolvedValue(1);

      await invoke(3n, 1n, 'user-khsx');

      expect(prisma.cuttingProposal.count).toHaveBeenCalledWith({
        where: {
          productionOrderId: 1n,
          id: { not: 3n },
          status: CuttingProposalStatus.APPROVED,
        },
      });
      expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
      expect(stockReservationsService.reserve).not.toHaveBeenCalled();
      const notify = prisma.notification.create.mock.calls[0] as unknown as [
        { data: { title: string; message: string } },
      ];
      expect(notify[0].data.title).toContain('CẦN DUYỆT TAY');
      expect(notify[0].data.message).toContain('đã có phương án được duyệt trước đó');
    });

    it('gửi max_waste_percentage_by_material khi vật tư có ngưỡng riêng, bỏ qua vật tư null/<=0 (D.hao-hut-sat)', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        pieceBomRow, // materialId 200n
        {
          pieceId: 11n,
          segmentSpecId: 101n,
          qtyPerPiece: 2,
          piece: { name: 'mảnh tựa' },
          segmentSpec: { materialId: 300n, cutLengthMm: mockDecimal(840) },
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

    // ── Bỏ auto_scan (Sếp chốt 2026-08-18) ────────────────────────────────────────
    // Trước đây vượt ngưỡng / infeasible sẽ trip 1 lần gọi solver THỨ HAI với auto_scan=true để
    // dò chiều dài cây đặt riêng. Bỏ hẳn vì cỡ tìm ra không mua được (NCC chỉ bán 6000mm) và
    // chiều dài đó cũng không chảy tới Mua hàng - xem comment tại nơi gọi solver. Cách xử lý
    // đúng cho ca vượt ngưỡng giờ là GỘP đợt cắt với SKU khác (getBatchSuggestions).
    it('LUÔN gửi auto_scan=false và chỉ gọi solver ĐÚNG 1 LẦN, kể cả khi vượt ngưỡng', async () => {
      prisma.material.findMany.mockResolvedValue([
        { id: 200n, maxCuttingWastePercentage: { toNumber: () => 0.3 } },
      ]);
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: {
          total_bars_all: 227,
          total_waste_mm: 20000,
          waste_percentage: 9.61,
          any_over_threshold: true, // vượt ngưỡng -> TRƯỚC ĐÂY sẽ retry, giờ thì không
        },
        purchase_plan: [
          { material: '200', feasible: true, over_threshold: true, cutting_patterns: [] },
        ],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });

      await invoke(2n, 1n);

      expect(externalApiService.post).toHaveBeenCalledTimes(1);
      const [url, body] = externalApiService.post.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
      ];
      expect(url).toBe('http://solver.local/api/v1/de_xuat/propose/');
      expect(body.auto_scan).toBe(false);
      // Ngưỡng riêng theo vật tư vẫn phải gửi đúng (D.hao-hut-sat) - không mất khi bỏ retry.
      expect(body.max_waste_percentage_by_material).toEqual({ '200': 0.3 });
      // Lưu ĐÚNG kết quả lần gọi duy nhất, không còn khái niệm "kết quả lần 2".
      const updateCall = prisma.cuttingProposal.update.mock.calls[0] as unknown as [
        { data: { wastePercentage: number } },
      ];
      expect(updateCall[0].data.wastePercentage).toBe(9.61);
    });

    it('KHÔNG gọi lại solver khi có dòng feasible=false - lưu nguyên kết quả rồi để cổng chặn tự-duyệt xử lý', async () => {
      externalApiService.post.mockResolvedValue({
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
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });

      await invoke(2n, 1n);

      expect(externalApiService.post).toHaveBeenCalledTimes(1);
      // Dòng infeasible vẫn được lưu (không đánh cả phương án thành FAILED) - và
      // autoApproveBlockReason() sẽ chặn tự duyệt, báo QLSX đi gộp đợt cắt.
      const updateCalls = prisma.cuttingProposal.update.mock.calls as unknown as [
        { data: { status?: CuttingProposalStatus } },
      ][];
      expect(
        updateCalls.find((c) => c[0].data.status === CuttingProposalStatus.DRAFT),
      ).toBeDefined();
      expect(
        updateCalls.find((c) => c[0].data.status === CuttingProposalStatus.APPROVED),
      ).toBeUndefined();
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
          segmentSpec: { materialId: 300n, cutLengthMm: mockDecimal(840) },
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

    it('chặn TRƯỚC khi gọi solver khi ngân sách thời gian xấu nhất vượt timeout HTTP client - đánh FAILED có lý do rõ, không để timeout mạng chung chung', async () => {
      // Review 2026-08-18: time_limit_seconds là ngân sách CHO MỖI LOẠI SẮT (api/views.py truyền
      // vào bên trong vòng lặp material_groups), không phải cho cả request. 2 loại sắt × 200s =
      // 400s > timeout client 300s (mock mặc định) -> phải chặn TRƯỚC khi gọi, không để axios tự
      // ngắt giữa chừng rồi báo lỗi mạng không ai hiểu vì sao.
      prisma.pieceBom.findMany.mockResolvedValue([
        pieceBomRow,
        {
          pieceId: 11n,
          segmentSpecId: 101n,
          qtyPerPiece: 2,
          piece: { name: 'mảnh tựa' },
          segmentSpec: { materialId: 300n, cutLengthMm: mockDecimal(840) },
        },
      ]);
      prisma.bomPiece.findMany.mockResolvedValue([
        { pieceId: 10n, qtyPerUnit: 4 },
        { pieceId: 11n, qtyPerUnit: 1 },
      ]);
      prisma.systemConfig.findUniqueOrThrow.mockResolvedValueOnce({
        ...systemConfig,
        solverTimeLimitSeconds: 200,
      });

      await invoke(2n, 1n);

      expect(externalApiService.post).not.toHaveBeenCalled();
      const failCall = prisma.cuttingProposal.update.mock.calls[0] as unknown as [
        { where: { id: bigint }; data: { status: CuttingProposalStatus; errorMessage: string } },
      ];
      expect(failCall[0].data.status).toBe(CuttingProposalStatus.FAILED);
      expect(failCall[0].data.errorMessage).toContain('2 loại sắt');
      expect(failCall[0].data.errorMessage).toContain('400s');
      expect(failCall[0].data.errorMessage).toContain('300s');
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

    it('lưu NGUYÊN VĂN reason/best_achievable/timed_out/max_waste_pct_threshold cho dòng infeasible - và tính đúng hasInfeasibleLine (2026-08-19)', async () => {
      // Trước 2026-08-19, 4 field này bị vứt bỏ hoàn toàn - FE chỉ hiện được "Không khả thi" trơ
      // trọi, không nói được vì sao. Test này khẳng định đường lưu đã được nối.
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: { total_bars_all: 0, total_waste_mm: 0, waste_percentage: 0 },
        purchase_plan: [
          {
            material: '200',
            feasible: false,
            timed_out: true,
            best_achievable: { length: 6000, waste_pct: 2.4, bars: 5 },
            reason: 'Hết 30s mà chưa liệt kê xong các kiểu cắt',
            max_waste_pct_threshold: 1,
          },
        ],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });

      await invoke(2n, 1n);

      const lineCall = prisma.cuttingProposalLine.create.mock.calls[0] as unknown as [
        {
          data: {
            reason?: string;
            bestAchievable?: unknown;
            timedOut?: boolean;
            maxWastePctThreshold?: number;
            overThreshold?: boolean;
          };
        },
      ];
      expect(lineCall[0].data.reason).toBe('Hết 30s mà chưa liệt kê xong các kiểu cắt');
      expect(lineCall[0].data.bestAchievable).toEqual({ length: 6000, waste_pct: 2.4, bars: 5 });
      expect(lineCall[0].data.timedOut).toBe(true);
      expect(lineCall[0].data.maxWastePctThreshold).toBe(1);
      expect(lineCall[0].data.overThreshold).toBeUndefined();

      const proposalUpdateCall = prisma.cuttingProposal.update.mock.calls[0] as unknown as [
        { data: { hasInfeasibleLine?: boolean; hasOverThreshold?: boolean } },
      ];
      expect(proposalUpdateCall[0].data.hasInfeasibleLine).toBe(true);
      expect(proposalUpdateCall[0].data.hasOverThreshold).toBe(false);
    });

    it('lưu overThreshold/maxWastePctThreshold cho dòng feasible vượt ngưỡng - và tính đúng hasOverThreshold, KHÔNG lẫn với hasInfeasibleLine', async () => {
      externalApiService.post.mockResolvedValue({
        status: 'success',
        summary: { total_bars_all: 8, total_waste_mm: 400, waste_percentage: 2.4 },
        purchase_plan: [
          {
            material: '200',
            feasible: true,
            over_threshold: true,
            max_waste_pct_threshold: 1,
            total_bars: 8,
            cutting_patterns: [],
          },
        ],
      });
      prisma.cuttingProposalLine.create.mockResolvedValue({ id: 50n });

      await invoke(2n, 1n);

      const lineCall = prisma.cuttingProposalLine.create.mock.calls[0] as unknown as [
        { data: { overThreshold?: boolean; maxWastePctThreshold?: number; reason?: string } },
      ];
      expect(lineCall[0].data.overThreshold).toBe(true);
      expect(lineCall[0].data.maxWastePctThreshold).toBe(1);
      expect(lineCall[0].data.reason).toBeUndefined();

      const proposalUpdateCall = prisma.cuttingProposal.update.mock.calls[0] as unknown as [
        { data: { hasInfeasibleLine?: boolean; hasOverThreshold?: boolean } },
      ];
      expect(proposalUpdateCall[0].data.hasInfeasibleLine).toBe(false);
      expect(proposalUpdateCall[0].data.hasOverThreshold).toBe(true);
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
      // Anh em bị supersede - 1 dòng, id=99n.
      prisma.cuttingProposal.findMany.mockResolvedValue([{ id: 99n }]);
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

      expect(prisma.cuttingProposal.findMany).toHaveBeenCalledWith({
        where: {
          productionOrderId: 1n,
          id: { not: 2n },
          status: { in: [CuttingProposalStatus.DRAFT, CuttingProposalStatus.APPROVED] },
        },
        select: { id: true },
      });
      expect(prisma.cuttingProposal.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [99n] } },
        data: { status: CuttingProposalStatus.SUPERSEDED },
      });
      // B4 Đợt 3b (lỗ #4): phải giải phóng giữ chỗ của ĐÚNG phương án bị supersede, không phải
      // của chính phương án vừa duyệt.
      expect(stockReservationsService.releaseByRef).toHaveBeenCalledWith(expect.anything(), {
        refType: 'CUTTING_PROPOSAL',
        refId: '99',
      });
      expect(result.status).toBe(CuttingProposalStatus.APPROVED);
    });

    it('không gọi updateMany/releaseByRef nào khi không có anh em nào bị supersede', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT,
        lines: [],
      });
      prisma.cuttingProposal.findMany.mockResolvedValue([]); // không anh em nào (mặc định)
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

      await service.approve('2', 'user-1');

      expect(prisma.cuttingProposal.updateMany).not.toHaveBeenCalled();
      expect(stockReservationsService.releaseByRef).not.toHaveBeenCalled();
    });

    it('phương án của đợt gộp chỉ supersede anh em CÙNG đợt, không quét mọi phương án gộp khác', async () => {
      // Regression: `where` cũ lọc thẳng `productionOrderId: proposal.productionOrderId`, mà
      // phương án của PI gộp luôn có trường đó = null -> Prisma dịch thành
      // `WHERE "productionOrderId" IS NULL`, khớp MỌI phương án gộp trong hệ thống. Duyệt nhóm A
      // đá bay phương án đang chờ của nhóm B (tái hiện thật bằng 2 đợt gộp độc lập chạy song song).
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: null,
        productionInvoiceId: 7n,
        status: CuttingProposalStatus.DRAFT,
        lines: [],
      });
      prisma.cuttingProposal.findMany.mockResolvedValue([]); // không anh em nào trong test này
      prisma.cuttingProposal.update.mockResolvedValue({
        id: 2n,
        productionOrderId: null,
        productionInvoiceId: 7n,
        status: CuttingProposalStatus.APPROVED,
        totalBarsAll: null,
        totalWasteMm: null,
        wastePercentage: null,
        errorMessage: null,
        requestedAt: new Date(),
        completedAt: null,
        approvedAt: new Date(),
        productionOrder: null,
        productionInvoice: { code: 'PI-2026-015', items: [] },
      });

      await service.approve('2', 'user-1');

      // B4 Đợt 3b tách bước lọc "anh em" ra findMany() (cần biết id cụ thể để release giữ chỗ) -
      // regression này giờ nằm ở where của findMany(), không phải updateMany() nữa.
      expect(prisma.cuttingProposal.findMany).toHaveBeenCalledWith({
        where: {
          productionInvoiceId: 7n,
          id: { not: 2n },
          status: { in: [CuttingProposalStatus.DRAFT, CuttingProposalStatus.APPROVED] },
        },
        select: { id: true },
      });
      // Điều kiện quyết định: KHÔNG được lọt `productionOrderId` vào where - đó chính là chỗ
      // biến bộ lọc thành "IS NULL" quét cả bảng.
      const findManyCall = prisma.cuttingProposal.findMany.mock.calls[0] as unknown as [
        { where: Record<string, unknown> },
      ];
      expect(findManyCall[0].where).not.toHaveProperty('productionOrderId');
    });

    it('không supersede gì cả khi phương án không neo vào PO lẫn PI (dữ liệu hỏng, thà bỏ qua còn hơn quét cả bảng)', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: null,
        productionInvoiceId: null,
        status: CuttingProposalStatus.DRAFT,
        lines: [],
      });
      prisma.cuttingProposal.update.mockResolvedValue({
        id: 2n,
        productionOrderId: null,
        productionInvoiceId: null,
        status: CuttingProposalStatus.APPROVED,
        productionOrder: null,
        productionInvoice: null,
      });

      await service.approve('2', 'user-1');

      expect(prisma.cuttingProposal.updateMany).not.toHaveBeenCalled();
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
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, code: 'SAT-30', warehouseId: 800n, warehouse: { code: 'phoi-son-han' } },
      ]);

      await service.approve('2', 'user-1');

      expect(prisma.purchaseProposal.create).toHaveBeenCalledWith({
        data: {
          cuttingProposalId: 2n,
          warehouseCode: 'phoi-son-han',
          items: { create: [{ materialId: 30n, buyQty: 8, actualStock: 0 }] },
        },
      });
      // Không có gì để giữ chỗ (consumeQty=0) -> không gọi reserve().
      expect(stockReservationsService.reserve).not.toHaveBeenCalled();
    });

    it('giữ chỗ tự động (B4 Đợt 2): đủ tồn thì buyQty=0 và giữ chỗ đúng số lượng (Phase 8.1)', async () => {
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
      stockQty = 20; // tồn 20 >= nhu cầu 8
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, code: 'SAT-30', warehouseId: 800n, warehouse: { code: 'phoi-son-han' } },
      ]);

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
      // Tham số thứ 2 là `tx` của chính transaction duyệt (Lỗ 5) - giữ chỗ PHẢI nằm trong đó,
      // nếu không thì khoá stock_quant ở trên nhả trước khi số dư kịp đổi. Khẳng định nó tồn tại
      // thay vì so khớp nguyên đối tượng tx (là chính prisma mock, không có giá trị kiểm chứng).
      // B4 Đợt 2: KHÔNG còn gọi stockLedgerService.postEntry() ở approve() nữa - chỉ giữ chỗ,
      // tồn vật lý chỉ giảm thật lúc SteelIssuesService.create() (xem file spec đó).
      expect(stockReservationsService.reserve).toHaveBeenCalledWith(
        {
          warehouseId: 800n,
          materialId: 30n,
          qty: 8,
          refType: 'CUTTING_PROPOSAL',
          refId: '2',
          createdById: 'user-1',
        },
        expect.anything(),
      );
    });

    it('giữ chỗ tự động (B4 Đợt 2): thiếu 1 phần thì split đúng giữa tồn giữ chỗ và buyQty (Phase 8.1)', async () => {
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
      stockQty = 3; // tồn 3 < nhu cầu 8 -> thiếu 5
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, code: 'SAT-30', warehouseId: 800n, warehouse: { code: 'phoi-son-han' } },
      ]);

      await service.approve('2', 'user-1');

      expect(prisma.purchaseProposal.create).toHaveBeenCalledWith({
        data: {
          cuttingProposalId: 2n,
          warehouseCode: 'phoi-son-han',
          items: { create: [{ materialId: 30n, buyQty: 5, actualStock: 3 }] },
        },
      });
      expect(stockReservationsService.reserve).toHaveBeenCalledWith(
        expect.objectContaining({ qty: 3, refType: 'CUTTING_PROPOSAL' }),
        expect.anything(),
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

    it('mỗi vật tư trừ tồn/xuất kho theo ĐÚNG kho riêng của nó (Material.warehouseId), không còn dùng chung 1 kho (Sếp chốt 2026-08-15)', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT,
        lines: [
          { materialId: 30n, feasible: true, totalBars: 8 },
          { materialId: 40n, feasible: true, totalBars: 5 },
        ],
      });
      prisma.cuttingProposal.update.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.APPROVED,
        ...productionOrderRelation(),
      });
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, code: 'SAT-30', warehouseId: 800n, warehouse: { code: 'phoi-son-han' } },
        { id: 40n, code: 'VTP-40', warehouseId: 810n, warehouse: { code: 'vat-tu-tp' } },
      ]);
      // Cả 2 vật tư đều có sẵn tồn đủ dùng (consumeQty > 0) để lộ ra kho xuất khác nhau.
      stockQty = 20;

      await service.approve('2', 'user-1');

      // Tóm tắt cấp cả đề xuất lấy theo dòng ĐẦU TIÊN (materialId 30n -> phoi-son-han) - không
      // còn là hằng số cố định.
      expect(prisma.purchaseProposal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ warehouseCode: 'phoi-son-han' }) as unknown,
        }),
      );
      expect(stockReservationsService.reserve).toHaveBeenCalledWith(
        expect.objectContaining({ materialId: 30n, warehouseId: 800n, qty: 8 }),
        expect.anything(),
      );
      expect(stockReservationsService.reserve).toHaveBeenCalledWith(
        expect.objectContaining({ materialId: 40n, warehouseId: 810n, qty: 5 }),
        expect.anything(),
      );
    });

    it('chặn duyệt (409/400) nếu 1 vật tư khả thi chưa được gán Kho (Material.warehouseId null)', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT,
        lines: [{ materialId: 30n, feasible: true, totalBars: 8 }],
      });
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, code: 'SAT-30', warehouseId: null, warehouse: null },
      ]);

      await expect(service.approve('2', 'user-1')).rejects.toThrow(BadRequestException);
      expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
    });

    // ── Lỗ 5: khoá dòng + đọc lại trạng thái BÊN TRONG transaction ────────────────
    // Kiểm tra DRAFT ở đầu approve() nằm ngoài transaction nên là đọc-rồi-ghi kinh điển. Hai
    // test dưới mô phỏng đúng ca mà nó bỏ lọt: lượt duyệt thứ hai đi qua được cổng ngoài (vẫn
    // đọc thấy DRAFT) rồi mới bị chặn ở lần đọc lại sau khi khoá.
    it('chặn (409) khi lượt duyệt khác đã đổi trạng thái giữa cổng ngoài và lúc khoá được dòng', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT, // cổng NGOÀI transaction vẫn thấy DRAFT
        lines: [{ materialId: 30n, feasible: true, totalBars: 8 }],
      });
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, code: 'SAT-30', warehouseId: 800n, warehouse: { code: 'phoi-son-han' } },
      ]);
      // ...nhưng khi khoá được dòng thì lượt duyệt kia đã APPROVED xong rồi.
      lockedProposalStatus = CuttingProposalStatus.APPROVED;

      await expect(service.approve('2', 'user-1')).rejects.toThrow(ConflictException);
      // Đây mới là điều quan trọng: không đẻ đề xuất mua thứ 2 và không trừ kho lần 2.
      expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
      expect(stockReservationsService.reserve).not.toHaveBeenCalled();
      expect(prisma.cuttingProposal.update).not.toHaveBeenCalled();
    });

    it('chặn (404) khi dòng phương án biến mất trước lúc khoá được', async () => {
      prisma.cuttingProposal.findUnique.mockResolvedValue({
        id: 2n,
        productionOrderId: 1n,
        status: CuttingProposalStatus.DRAFT,
        lines: [{ materialId: 30n, feasible: true, totalBars: 8 }],
      });
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, code: 'SAT-30', warehouseId: 800n, warehouse: { code: 'phoi-son-han' } },
      ]);
      lockedProposalStatus = null; // SELECT ... FOR UPDATE không trả dòng nào

      await expect(service.approve('2', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.purchaseProposal.create).not.toHaveBeenCalled();
      expect(stockReservationsService.reserve).not.toHaveBeenCalled();
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
            productionOrder: {
              include: {
                mfgProduct: true,
                productionInvoiceItem: { select: { salesOrder: { select: { code: true } } } },
              },
            },
            productionInvoice: {
              include: {
                items: { include: { mfgProduct: true, salesOrder: { select: { code: true } } } },
              },
            },
          },
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].poNumber).toBe('PO-31-1');
      expect(result.data[0].salesOrderCode).toBe('PO-31');
      expect(result.data[0].mfgProductCode).toBe('SKU-1');
    });
  });

  describe('computeDisplayStatus + lineDisplayReason (2026-08-19 - màn Cắt sắt hiển thị)', () => {
    type DisplayParts = {
      computeDisplayStatus: (proposal: {
        status: CuttingProposalStatus;
        hasInfeasibleLine: boolean;
        hasOverThreshold: boolean;
        completedAt: Date | null;
        errorMessage: string | null;
        requestedAt: Date;
      }) => { displayStatus: string; displayReason: string | null };
      lineDisplayReason: (line: {
        feasible: boolean;
        timedOut: boolean | null;
        bestAchievable: unknown;
        reason: string | null;
        overThreshold: boolean | null;
        maxWastePctThreshold: unknown;
      }) => string | null;
    };
    const priv = () => service as unknown as DisplayParts;
    const base = {
      hasInfeasibleLine: false,
      hasOverThreshold: false,
      completedAt: null as Date | null,
      errorMessage: null as string | null,
      requestedAt: new Date(),
    };

    it('CALCULATING - status CALCULATING bất kể 2 cờ (còn trong TTL)', () => {
      const r = priv().computeDisplayStatus({
        ...base,
        status: CuttingProposalStatus.CALCULATING,
      });
      expect(r).toEqual({ displayStatus: 'CALCULATING', displayReason: null });
    });

    it('NEEDS_ACTION - CALCULATING quá TTL (solver.timeoutSeconds=300 mock + 60s biên) -> nghi treo, KHÔNG chờ mãi', () => {
      const r = priv().computeDisplayStatus({
        ...base,
        status: CuttingProposalStatus.CALCULATING,
        requestedAt: new Date(Date.now() - 400_000), // > (300+60)s
      });
      expect(r.displayStatus).toBe('NEEDS_ACTION');
      expect(r.displayReason).toContain('Nghi treo');
    });

    it('SUPERSEDED - giữ nguyên, không có displayReason', () => {
      const r = priv().computeDisplayStatus({
        ...base,
        status: CuttingProposalStatus.SUPERSEDED,
      });
      expect(r.displayStatus).toBe('SUPERSEDED');
    });

    it('NEEDS_ACTION - FAILED dùng errorMessage đã lưu làm displayReason', () => {
      const r = priv().computeDisplayStatus({
        ...base,
        status: CuttingProposalStatus.FAILED,
        errorMessage: 'Solver timeout',
      });
      expect(r).toEqual({ displayStatus: 'NEEDS_ACTION', displayReason: 'Solver timeout' });
    });

    it('OK - APPROVED bất kể completedAt xa hay gần', () => {
      const r = priv().computeDisplayStatus({
        ...base,
        status: CuttingProposalStatus.APPROVED,
        completedAt: new Date(Date.now() - 999_000),
      });
      expect(r).toEqual({ displayStatus: 'OK', displayReason: null });
    });

    it('NEEDS_ACTION - DRAFT + hasInfeasibleLine, kể cả completedAt vừa xong (không lẫn với "đang hoàn tất")', () => {
      const r = priv().computeDisplayStatus({
        ...base,
        status: CuttingProposalStatus.DRAFT,
        hasInfeasibleLine: true,
        completedAt: new Date(),
      });
      expect(r.displayStatus).toBe('NEEDS_ACTION');
      expect(r.displayReason).toContain('không cắt được');
    });

    it('NEEDS_ACTION - DRAFT + hasOverThreshold (ưu tiên sau hasInfeasibleLine)', () => {
      const r = priv().computeDisplayStatus({
        ...base,
        status: CuttingProposalStatus.DRAFT,
        hasOverThreshold: true,
        completedAt: new Date(),
      });
      expect(r.displayStatus).toBe('NEEDS_ACTION');
      expect(r.displayReason).toContain('vượt ngưỡng');
    });

    it('CALCULATING - DRAFT, 2 cờ đều false, vừa hoàn tất <60s -> gộp vào CALCULATING chống nháy', () => {
      const r = priv().computeDisplayStatus({
        ...base,
        status: CuttingProposalStatus.DRAFT,
        completedAt: new Date(Date.now() - 5_000),
      });
      expect(r).toEqual({ displayStatus: 'CALCULATING', displayReason: null });
    });

    it('NEEDS_ACTION - DRAFT, 2 cờ đều false, hoàn tất đã lâu (>60s) -> ca priorApproved hiếm', () => {
      const r = priv().computeDisplayStatus({
        ...base,
        status: CuttingProposalStatus.DRAFT,
        completedAt: new Date(Date.now() - 120_000),
      });
      expect(r.displayStatus).toBe('NEEDS_ACTION');
      expect(r.displayReason).toContain('đã có phương án khác được duyệt trước đó');
    });

    it('lineDisplayReason - timedOut ưu tiên trước best_achievable, KHÔNG gộp chung câu (15.5-b)', () => {
      const msg = priv().lineDisplayReason({
        feasible: false,
        timedOut: true,
        bestAchievable: { length: 6000, waste_pct: 2.4, bars: 5 },
        reason: 'Hết giờ',
        overThreshold: null,
        maxWastePctThreshold: null,
      });
      expect(msg).toContain('Chưa kết luận được');
      expect(msg).not.toContain('2.4');
    });

    it('lineDisplayReason - infeasible thật kèm best_achievable -> nêu con số cụ thể', () => {
      const msg = priv().lineDisplayReason({
        feasible: false,
        timedOut: false,
        bestAchievable: { length: 6000, waste_pct: 2.4, bars: 5 },
        reason: 'Không đạt ngưỡng',
        overThreshold: null,
        maxWastePctThreshold: null,
      });
      expect(msg).toContain('2.40%');
      expect(msg).toContain('6000mm');
      expect(msg).toContain('5 cây');
    });

    it('lineDisplayReason - infeasible thật KHÔNG có best_achievable -> rơi về reason thô của solver', () => {
      const msg = priv().lineDisplayReason({
        feasible: false,
        timedOut: false,
        bestAchievable: null,
        reason: 'Có đoạn dài hơn cây sắt',
        overThreshold: null,
        maxWastePctThreshold: null,
      });
      expect(msg).toBe('Có đoạn dài hơn cây sắt');
    });

    it('lineDisplayReason - feasible + overThreshold -> nêu ngưỡng, KHÔNG gợi ý nới ngưỡng', () => {
      const msg = priv().lineDisplayReason({
        feasible: true,
        timedOut: null,
        bestAchievable: null,
        reason: null,
        overThreshold: true,
        maxWastePctThreshold: 1,
      });
      expect(msg).toContain('vượt ngưỡng hao hụt (1%)');
      expect(msg).toContain('KHÔNG tự nới ngưỡng');
    });

    it('lineDisplayReason - feasible bình thường -> null (không cần xử lý)', () => {
      const msg = priv().lineDisplayReason({
        feasible: true,
        timedOut: null,
        bestAchievable: null,
        reason: null,
        overThreshold: false,
        maxWastePctThreshold: 1,
      });
      expect(msg).toBeNull();
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
            bomRows: {
              part: string;
              qty_per_set: number;
              material: string;
              cut_length: number;
              qty_per_part: number;
            }[];
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
