import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProcessStep, SteelIssueStatus } from '../../generated/prisma/client';
import { SteelIssuesService } from './steel-issues.service';

describe('SteelIssuesService', () => {
  let service: SteelIssuesService;
  let prisma: {
    steelIssue: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    productionOrder: { findUnique: jest.Mock };
    piece: { findUnique: jest.Mock };
    pieceBom: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    cuttingProposalLine: { findFirst: jest.Mock };
    cutBundle: { create: jest.Mock };
    $transaction: jest.Mock;
  };

  const order = { id: 1n, poNumber: 'PO-1', bomRevisionId: 5n, quantity: 10 };
  const piece = { id: 20n, code: 'MANH-TUA', name: 'Mảnh Tựa' };
  // processSteps mặc định chỉ [CAT] - piece "đơn giản" chỉ cần cắt là đủ điều kiện KCS ngay,
  // đúng hành vi cũ (test step-gating multi-step override riêng ở describe('completeStep')).
  const pieceBomRow = {
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
    productionOrderId: 1n,
    pieceId: 20n,
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
    productionOrder: order,
    piece,
    material: { id: 30n, code: 'ST-18', name: 'Sắt vuông 18x18' },
  };

  beforeEach(() => {
    prisma = {
      steelIssue: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
      },
      productionOrder: { findUnique: jest.fn().mockResolvedValue(order) },
      piece: { findUnique: jest.fn().mockResolvedValue(piece) },
      pieceBom: { findMany: jest.fn().mockResolvedValue([pieceBomRow]) },
      bomPiece: { findMany: jest.fn().mockResolvedValue([]) },
      cuttingProposalLine: { findFirst: jest.fn().mockResolvedValue({ id: 1n }) },
      cutBundle: { create: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    service = new SteelIssuesService(prisma as unknown as PrismaServiceType);
  });

  describe('create', () => {
    it('resolves materialId từ piece BOM và tạo đợt xuất mới', async () => {
      prisma.steelIssue.create.mockResolvedValue(issue);

      const result = await service.create(
        '1',
        { pieceId: '20', barLengthMm: 6000, barCount: 20 },
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
            productionOrderId: 1n,
            pieceId: 20n,
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
        { pieceId: '20', barLengthMm: 6000, barCount: 20 },
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
          { pieceId: '20', barLengthMm: 6000, barCount: 20 },
          'user-1',
          'thanh-pham',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.steelIssue.create).not.toHaveBeenCalled();
    });

    it('cho phép caller không có warehouseScope (tổng kho)', async () => {
      prisma.steelIssue.create.mockResolvedValue(issue);
      await expect(
        service.create('1', { pieceId: '20', barLengthMm: 6000, barCount: 20 }, 'user-1', null),
      ).resolves.toBeDefined();
    });

    it('ném BadRequestException khi mảnh dùng nhiều hơn 1 loại sắt', async () => {
      prisma.pieceBom.findMany.mockResolvedValue([
        pieceBomRow,
        { ...pieceBomRow, segmentSpec: { ...pieceBomRow.segmentSpec, materialId: 999n } },
      ]);

      await expect(
        service.create('1', { pieceId: '20', barLengthMm: 6000, barCount: 20 }, 'user-1', null),
      ).rejects.toThrow(BadRequestException);
    });

    it('ném ConflictException khi chưa có CuttingProposal APPROVED cho vật tư này', async () => {
      prisma.cuttingProposalLine.findFirst.mockResolvedValue(null);

      await expect(
        service.create('1', { pieceId: '20', barLengthMm: 6000, barCount: 20 }, 'user-1', null),
      ).rejects.toThrow(ConflictException);
    });

    it('chỉ chấp nhận dòng phương án CẮT ĐƯỢC - không cho xuất sắt theo dòng feasible=false', async () => {
      // saveSuccess() tạo CuttingProposalLine cho MỌI vật tư solver trả về, kể cả loại nó báo
      // không cắt được (không có pattern nào để làm theo). Loại đó cũng bị approve() lọc khỏi đề
      // xuất mua, nên còn chẳng có sắt để xuất - phải chặn ngay ở guard này.
      prisma.steelIssue.create.mockResolvedValue(issue);

      await service.create('1', { pieceId: '20', barLengthMm: 6000, barCount: 20 }, 'user-1', null);

      expect(prisma.cuttingProposalLine.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest mock typing
          where: expect.objectContaining({ feasible: true }),
        }),
      );
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

    it('RECEIVED -> IN_PROCESS khi piece có công đoạn khác ngoài CAT (vd UON) chưa xong', async () => {
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

    it('ném BadRequestException nếu step không thuộc requiredSteps của piece', async () => {
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

      // Fixture chỉ cần đúng field scalar mà createReworkIssue() thực dùng (productionOrderId/
      // pieceId/materialId/barLengthMm/issuedById/id) - material/piece/productionOrder lồng
      // nhau (SteelIssueRow đầy đủ) không cần thiết cho test này.
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

      // Fixture chỉ cần đúng field scalar mà createReworkIssue() thực dùng (productionOrderId/
      // pieceId/materialId/barLengthMm/issuedById/id) - material/piece/productionOrder lồng
      // nhau (SteelIssueRow đầy đủ) không cần thiết cho test này.
      await service.createReworkIssue(
        issue as unknown as Parameters<typeof service.createReworkIssue>[0],
        5,
      );

      expect(prisma.steelIssue.create).not.toHaveBeenCalled();
    });
  });
});
