import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProcessStep, SteelIssueStatus } from '../../generated/prisma/client';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { SteelIssuesService } from './steel-issues.service';

const decimal = (n: number) => ({ toNumber: () => n });

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
    productionOrder: { findMany: jest.Mock };
    pieceBom: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    material: { findMany: jest.Mock };
    cuttingProposalLine: { findFirst: jest.Mock; findMany: jest.Mock };
    cutBundle: { create: jest.Mock };
    stockReservation: { update: jest.Mock; findMany: jest.Mock };
    stockQuant: { findMany: jest.Mock };
    warehouse: { findUniqueOrThrow: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  const invoice = { id: 1n, code: 'PI-31' };
  const order = { id: 1n, bomRevisionId: 5n, quantity: 10 };
  // processSteps mặc định chỉ [CAT] - piece "đơn giản" chỉ cần cắt là đủ điều kiện KCS ngay,
  // đúng hành vi cũ (test step-gating multi-step override riêng ở describe('completeStep')).
  const pieceBomRow = {
    bomRevisionId: 5n,
    pieceId: 20n,
    qtyPerPiece: 4,
    processSteps: [ProcessStep.CAT],
    segmentSpec: {
      materialId: 30n,
      cutLengthMm: 745,
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

  // B4 Đợt 2: reservationRow/stockQty điều khiển 2 câu $queryRaw khác nhau mà
  // consumeReservationAndDeduct() gọi (khoá stock_reservations, rồi khoá stock_quant) - phân
  // nhánh theo SQL, cùng idiom đã dùng ở cutting-proposals.service.spec.ts. Chỉ có tác dụng cho
  // test nào set `approvedAt` của cuttingProposal SAU cutover (mặc định TRƯỚC cutover, không đụng
  // 2 câu này - xem default cuttingProposalLine.findFirst dưới).
  let reservationRow: {
    id: bigint;
    warehouseId: bigint;
    quantity: number;
    consumedQty: number;
  } | null;
  let physicalStockQty: number;

  beforeEach(() => {
    reservationRow = { id: 900n, warehouseId: 800n, quantity: 20, consumedQty: 0 };
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
      productionOrder: { findMany: jest.fn().mockResolvedValue([order]) },
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
      cutBundle: { create: jest.fn() },
      stockReservation: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      stockQuant: { findMany: jest.fn().mockResolvedValue([]) },
      warehouse: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 950n }) },
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = Array.isArray(strings) ? strings.join('') : String(strings);
        if (sql.includes('stock_reservations')) {
          return Promise.resolve(
            reservationRow
              ? [
                  {
                    id: reservationRow.id,
                    warehouseId: reservationRow.warehouseId,
                    quantity: { toNumber: () => reservationRow!.quantity },
                    consumedQty: { toNumber: () => reservationRow!.consumedQty },
                  },
                ]
              : [],
          );
        }
        return Promise.resolve([{ qty: { toNumber: () => physicalStockQty } }]);
      }),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    stockLedgerService = { postEntry: jest.fn() };
    service = new SteelIssuesService(
      prisma as unknown as PrismaServiceType,
      stockLedgerService as unknown as StockLedgerService,
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

  // B4 Đợt 2 (changelog mục 13) - phương án cắt duyệt SAU STEEL_ISSUE_RESERVATION_CUTOVER
  // (2026-08-18) không còn bị trừ tồn ở approve() nữa, create() ở đây mới là nơi trừ thật + tiêu
  // giữ chỗ tương ứng. approvedAt SAU mốc bật nhánh mới - set riêng ở từng test dưới.
  describe('create - B4 Đợt 2 (trừ tồn thật + tiêu giữ chỗ, phương án duyệt SAU cutover)', () => {
    const setPostCutover = () => {
      prisma.cuttingProposalLine.findFirst.mockResolvedValue({
        cuttingProposal: { id: 1n, approvedAt: new Date('2026-08-19T00:00:00.000Z') },
      });
    };

    it('đủ giữ chỗ, tiêu 1 phần: postEntry đúng tham số, consumedQty tăng, giữ chỗ vẫn ACTIVE', async () => {
      setPostCutover();
      reservationRow = { id: 900n, warehouseId: 800n, quantity: 20, consumedQty: 0 };
      prisma.steelIssue.create.mockResolvedValue(issue); // barCount=20 trong fixture `issue`... dùng lại dto riêng dưới

      await service.create(
        '1',
        { materialId: '30', barLengthMm: 6000, barCount: 12 },
        'user-1',
        null,
      );

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
        },
        expect.anything(),
      );
      expect(prisma.stockReservation.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: { consumedQty: 12 },
      });
    });

    // RELEASED chỉ dành cho "đã huỷ/bị thay thế" (Đợt 3b) - tiêu hết KHÔNG đổi status, vẫn
    // ACTIVE, để hàng về đợt sau (topUpFromReceipt) còn tìm thấy dòng mà cộng vào. Trước đây đánh
    // RELEASED ở đây gây bug P2002 khi nhận hàng nhiều đợt - xem comment ở
    // consumeReservationAndDeduct().
    it('xuất hết phần còn lại: consumedQty cập nhật đúng, status VẪN ACTIVE (không tự RELEASED)', async () => {
      setPostCutover();
      reservationRow = { id: 900n, warehouseId: 800n, quantity: 20, consumedQty: 12 };
      prisma.steelIssue.create.mockResolvedValue(issue);

      await service.create(
        '1',
        { materialId: '30', barLengthMm: 6000, barCount: 8 },
        'user-1',
        null,
      );

      expect(prisma.stockReservation.update).toHaveBeenCalledWith({
        where: { id: 900n },
        data: { consumedQty: 20 },
      });
    });

    it('chặn xuất thừa - barCount vượt phần giữ chỗ còn lại (mặc định chặn cứng, chưa có dung sai)', async () => {
      setPostCutover();
      reservationRow = { id: 900n, warehouseId: 800n, quantity: 20, consumedQty: 15 }; // còn 5
      prisma.steelIssue.create.mockResolvedValue(issue);

      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 6 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
      expect(prisma.stockReservation.update).not.toHaveBeenCalled();
    });

    it('chặn tồn âm cục bộ - tồn vật lý bị điều chỉnh tay lệch khỏi giữ chỗ', async () => {
      setPostCutover();
      reservationRow = { id: 900n, warehouseId: 800n, quantity: 20, consumedQty: 0 }; // giữ chỗ đủ 20
      physicalStockQty = 5; // nhưng tồn vật lý thật chỉ còn 5 (bị chỉnh tay)
      prisma.steelIssue.create.mockResolvedValue(issue);

      await expect(
        service.create('1', { materialId: '30', barLengthMm: 6000, barCount: 10 }, 'user-1', null),
      ).rejects.toThrow(ConflictException);
      expect(stockLedgerService.postEntry).not.toHaveBeenCalled();
    });

    it('không tìm thấy giữ chỗ ACTIVE (đã supersede/huỷ hoặc đã tiêu hết) - ConflictException', async () => {
      setPostCutover();
      reservationRow = null;
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
  });

  describe('completeCutting', () => {
    const receivedIssue = { ...issue, status: SteelIssueStatus.RECEIVED };

    it('RECEIVED -> AWAITING_QC, tạo bundles + segments', async () => {
      // findOneOrThrow() gọi 2 lần: guard đầu (RECEIVED) rồi re-fetch cuối để trả response
      // (đã AWAITING_QC) - mock tuần tự đúng 2 lần đọc đó.
      prisma.steelIssue.findUnique.mockResolvedValueOnce(receivedIssue).mockResolvedValueOnce({
        ...receivedIssue,
        status: SteelIssueStatus.AWAITING_QC,
        actualBarCount: 19,
        completedAt: new Date(),
      });

      const result = await service.completeCutting('100', {
        actualBarCount: 19,
        bundles: [
          {
            proposalPatternId: '5',
            barCount: 19,
            segments: [{ segmentSpecId: '30', countPerBar: 8 }],
          },
        ],
      });

      expect(prisma.cutBundle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          data: expect.objectContaining({ steelIssueId: 100n, proposalPatternId: 5n }),
        }),
      );
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

    it('ném ConflictException nếu không phải RECEIVED', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(issue); // vẫn ISSUED

      await expect(
        service.completeCutting('100', { bundles: [{ barCount: 1, segments: [] }] }),
      ).rejects.toThrow(ConflictException);
    });

    it('ném BadRequestException nếu bundles rỗng', async () => {
      prisma.steelIssue.findUnique.mockResolvedValue(receivedIssue);

      await expect(service.completeCutting('100', { bundles: [] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('RECEIVED -> IN_PROCESS khi PI có mảnh nào đó cần công đoạn khác ngoài CAT (vd UON) cho loại sắt này', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        { ...pieceBomRow, processSteps: [ProcessStep.CAT, ProcessStep.UON] },
      ]);
      prisma.steelIssue.findUnique.mockResolvedValueOnce(receivedIssue).mockResolvedValueOnce({
        ...receivedIssue,
        status: SteelIssueStatus.IN_PROCESS,
        completedSteps: [ProcessStep.CAT],
      });

      const result = await service.completeCutting('100', {
        bundles: [{ barCount: 20, segments: [{ segmentSpecId: '30', countPerBar: 8 }] }],
      });

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

  // B4 Đợt 3d (2026-08-19) - getIssuePlan() giờ gộp theo cả PI: 1 dòng kế hoạch/loại sắt, cộng
  // dồn requiredSegments qua MỌI ProductionOrder (SKU) thuộc PI, không còn breakdown theo mảnh.
  describe('getIssuePlan', () => {
    const bomPieceRow = {
      bomRevisionId: 5n,
      pieceId: 20n,
      qtyPerUnit: 2,
      piece: { code: 'MANH-TUA', name: 'Mảnh Tựa' },
    };

    beforeEach(() => {
      prisma.bomPiece.findMany.mockResolvedValue([bomPieceRow]);
    });

    it('trả remainingToIssue/physicalStockQty đúng khi có phương án duyệt + giữ chỗ ACTIVE', async () => {
      prisma.material.findMany.mockResolvedValue([{ id: 30n, warehouseId: 800n }]);
      prisma.cuttingProposalLine.findMany.mockResolvedValue([
        { materialId: 30n, cuttingProposalId: 22n },
      ]);
      prisma.stockReservation.findMany.mockResolvedValue([
        { refId: '22', materialId: 30n, quantity: decimal(20), consumedQty: decimal(12) },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 800n, materialId: 30n, qty: decimal(50) },
      ]);

      const [result] = await service.getIssuePlan('1');

      expect(result.remainingToIssue).toBe(8); // 20 - 12
      expect(result.physicalStockQty).toBe(50);
    });

    it('remainingToIssue = null khi chưa có phương án cắt đã duyệt nào cho vật tư này', async () => {
      prisma.material.findMany.mockResolvedValue([{ id: 30n, warehouseId: 800n }]);
      prisma.cuttingProposalLine.findMany.mockResolvedValue([]); // không phương án nào
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 800n, materialId: 30n, qty: decimal(50) },
      ]);

      const [result] = await service.getIssuePlan('1');

      expect(result.remainingToIssue).toBeNull();
      expect(result.physicalStockQty).toBe(50); // tồn thật vẫn hiện được, độc lập với giữ chỗ
    });

    it('physicalStockQty = null khi vật tư chưa được gán Kho (Material.warehouseId trống)', async () => {
      prisma.material.findMany.mockResolvedValue([{ id: 30n, warehouseId: null }]);

      const [result] = await service.getIssuePlan('1');

      expect(result.physicalStockQty).toBeNull();
    });

    // Chốt điều kiện hiệu năng đã nói khi review: KHÔNG được query lặp theo từng mảnh dù nhiều
    // mảnh dùng chung 1 loại sắt - và 2 mảnh dùng chung vật tư phải GỘP THÀNH 1 dòng kế hoạch duy
    // nhất (khác trước đây tách theo mảnh).
    it('2 mảnh dùng chung 1 loại sắt: gộp thành đúng 1 dòng kế hoạch, cộng dồn requiredSegments', async () => {
      prisma.bomPiece.findMany.mockResolvedValue([
        bomPieceRow,
        {
          bomRevisionId: 5n,
          pieceId: 21n,
          qtyPerUnit: 1,
          piece: { code: 'MANH-KHAC', name: 'Mảnh khác' },
        },
      ]);
      prisma.pieceBom.findMany.mockResolvedValue([
        pieceBomRow,
        { ...pieceBomRow, pieceId: 21n }, // cùng materialId 30n
      ]);
      prisma.material.findMany.mockResolvedValue([{ id: 30n, warehouseId: 800n }]);
      prisma.cuttingProposalLine.findMany.mockResolvedValue([
        { materialId: 30n, cuttingProposalId: 22n },
      ]);
      prisma.stockReservation.findMany.mockResolvedValue([
        { refId: '22', materialId: 30n, quantity: decimal(20), consumedQty: decimal(0) },
      ]);
      prisma.stockQuant.findMany.mockResolvedValue([
        { warehouseId: 800n, materialId: 30n, qty: decimal(50) },
      ]);

      const result = await service.getIssuePlan('1');

      // Gộp theo PI: đúng 1 dòng cho material 30n, requiredSegments cộng dồn cả 2 mảnh.
      // Mảnh 20 (bomPieceRow): qtyPerPiece(4) × qtyPerUnit(2) × order.quantity(10) = 80.
      // Mảnh 21 (qtyPerUnit=1): qtyPerPiece(4) × qtyPerUnit(1) × order.quantity(10) = 40.
      expect(result).toHaveLength(1);
      expect(result[0].materialId).toBe('30');
      expect(result[0].requiredSegments).toBe(80 + 40);
      expect(result[0].remainingToIssue).toBe(20);
      // Đúng 1 vật tư duy nhất (30n) trong danh sách tra cứu - không lặp theo 2 mảnh.
      expect(prisma.material.findMany).toHaveBeenCalledWith({
        where: { id: { in: [30n] } },
        select: { id: true, warehouseId: true },
      });
    });

    // B4 hỗ trợ mảnh nhiều loại sắt - trước đây mảnh này bị loại bỏ hoàn toàn khỏi kế hoạch.
    it('1 mảnh dùng 2 loại sắt: sinh 2 dòng kế hoạch riêng, mỗi dòng đúng số liệu của loại đó', async () => {
      const otherMaterialRow = {
        bomRevisionId: 5n,
        pieceId: 20n,
        qtyPerPiece: 3,
        processSteps: [ProcessStep.CAT],
        segmentSpec: {
          materialId: 999n,
          cutLengthMm: 300,
          material: { id: 999n, code: 'ST-25', name: 'Sắt hộp 25x25' },
        },
      };
      prisma.pieceBom.findMany.mockResolvedValue([pieceBomRow, otherMaterialRow]);
      // Đã xuất 5 cây cho material 30n trong PI này - KHÔNG được lẫn sang dòng material 999n.
      prisma.steelIssue.findMany.mockResolvedValue([{ materialId: 30n, barCount: 5 }]);
      prisma.material.findMany.mockResolvedValue([
        { id: 30n, warehouseId: 800n },
        { id: 999n, warehouseId: null },
      ]);
      prisma.cuttingProposalLine.findMany.mockResolvedValue([]);
      prisma.stockQuant.findMany.mockResolvedValue([]);

      const result = await service.getIssuePlan('1');

      expect(result).toHaveLength(2);
      const line30 = result.find((r) => r.materialId === '30');
      const line999 = result.find((r) => r.materialId === '999');
      expect(line30?.materialCode).toBe('ST-18');
      expect(line30?.issuedBarCount).toBe(5);
      expect(line30?.requiredSegments).toBe(4 * 2 * 10); // qtyPerPiece(4) × qtyPerUnit(2) × order.quantity(10)
      expect(line999?.materialCode).toBe('ST-25');
      expect(line999?.issuedBarCount).toBe(0); // không lẫn từ material 30n
      expect(line999?.requiredSegments).toBe(3 * 2 * 10);
    });

    // 1 PI có thể có nhiều SKU/PO khác bomRevisionId (memory project_pi_multi_sku_multi_po) -
    // mỗi order đóng góp riêng theo ĐÚNG quantity của nó vào tổng requiredSegments.
    it('PI có 2 SKU (2 ProductionOrder khác bomRevisionId, cùng dùng 1 loại sắt): cộng dồn đúng theo quantity riêng từng order', async () => {
      const order2 = { id: 2n, bomRevisionId: 6n, quantity: 5 };
      prisma.productionOrder.findMany.mockResolvedValue([order, order2]);
      prisma.bomPiece.findMany.mockResolvedValue([
        bomPieceRow,
        {
          bomRevisionId: 6n,
          pieceId: 40n,
          qtyPerUnit: 1,
          piece: { code: 'MANH-B', name: 'Mảnh B' },
        },
      ]);
      prisma.pieceBom.findMany.mockResolvedValue([
        pieceBomRow,
        { ...pieceBomRow, bomRevisionId: 6n, pieceId: 40n },
      ]);
      prisma.material.findMany.mockResolvedValue([{ id: 30n, warehouseId: 800n }]);

      const result = await service.getIssuePlan('1');

      // order (bomRevisionId 5n): 4×2×10=80. order2 (bomRevisionId 6n): 4×1×5=20. Tổng 100.
      expect(result).toHaveLength(1);
      expect(result[0].requiredSegments).toBe(80 + 20);
    });
  });
});
