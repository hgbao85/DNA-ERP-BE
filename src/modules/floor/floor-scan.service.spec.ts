import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { ProductionBatchesService } from '../production-batches/production-batches.service';
import { SteelIssuesService } from '../steel-issues/steel-issues.service';
import { FloorScanService } from './floor-scan.service';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';

const worker = (mfgRole: string): AuthenticatedUser => ({
  id: 'cn-1',
  username: 'phoi.a',
  email: null,
  roles: ['FLOOR_WORKER'],
  permissions: [],
  mfgRole,
  warehouseScope: 'phoi-son-han',
});

const laser = {
  id: 1n,
  code: 'LASER-01',
  name: 'Máy laser 1',
  stage: 'PHOI',
  kind: 'CUT',
  processStep: null,
  qrToken: 'tok',
  isActive: true,
};

const running = {
  status: 'RUNNING',
  productionInvoiceId: 45n,
  productionInvoice: { code: 'PI-45' },
};

/** Đối số đầu tiên của lần gọi đầu tiên của một jest.Mock - có kiểu rõ ràng để assert không phải dùng `any`. */
const firstArg = <T = unknown>(mock: jest.Mock): T => (mock.mock.calls as unknown[][])[0][0] as T;

describe('FloorScanService', () => {
  let prisma: {
    workstation: { findUnique: jest.Mock };
    floorQueueEntry: { findMany: jest.Mock };
    productionOrder: { findMany: jest.Mock; findFirst: jest.Mock };
    productionInvoice: { findUniqueOrThrow: jest.Mock };
    productionBatch: { groupBy: jest.Mock };
    steelIssue: { findMany: jest.Mock; groupBy: jest.Mock };
    floorReport: { findMany: jest.Mock };
  };
  let steelIssues: {
    recordCutBatch: jest.Mock;
    recordStepBatch: jest.Mock;
    receive: jest.Mock;
    getPhoiProgress: jest.Mock;
    getStepProgress: jest.Mock;
  };
  let productionBatches: { recordProductionBatch: jest.Mock; getBatchPlanBatch: jest.Mock };
  let service: FloorScanService;

  const cutDto = {
    productionInvoiceId: '45',
    productionOrderId: '41',
    materialId: '7',
    segments: [{ segmentSpecId: '63', qty: 5 }],
  };

  beforeEach(() => {
    prisma = {
      workstation: { findUnique: jest.fn().mockResolvedValue(laser) },
      floorQueueEntry: { findMany: jest.fn().mockResolvedValue([running]) },
      productionOrder: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      productionInvoice: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 45n, code: 'PI-45' }),
      },
      productionBatch: { groupBy: jest.fn().mockResolvedValue([]) },
      steelIssue: { findMany: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
      floorReport: { findMany: jest.fn().mockResolvedValue([]) },
    };
    steelIssues = {
      recordCutBatch: jest.fn().mockResolvedValue({ id: '52' }),
      recordStepBatch: jest.fn().mockResolvedValue({ id: '9' }),
      receive: jest.fn(),
      getPhoiProgress: jest.fn().mockResolvedValue([]),
      getStepProgress: jest.fn().mockResolvedValue([]),
    };
    productionBatches = {
      recordProductionBatch: jest.fn().mockResolvedValue({ id: '106' }),
      getBatchPlanBatch: jest.fn().mockResolvedValue({}),
    };
    service = new FloorScanService(
      prisma as unknown as PrismaServiceType,
      steelIssues as unknown as SteelIssuesService,
      productionBatches as unknown as ProductionBatchesService,
    );
  });

  it('mã không tồn tại / đã tắt -> 404 "Mã QR không còn dùng"', async () => {
    prisma.workstation.findUnique.mockResolvedValue({ ...laser, isActive: false });
    await expect(service.getContext('tok', worker('PHOI'))).rejects.toThrow(NotFoundException);
  });

  it('công nhân tổ khác quét mã máy Phôi -> 403', async () => {
    await expect(service.getContext('tok', worker('HAN'))).rejects.toThrow(ForbiddenException);
  });

  it('báo bắt buộc có Idempotency-Key (điện thoại gửi lại khi mất sóng)', async () => {
    await expect(service.report('tok', worker('PHOI'), cutDto, undefined)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('PI không phải PI tổ đang chạy, cũng không phải PI cũ còn bù lỗi -> 409, không gọi hàm báo', async () => {
    await expect(
      service.report('tok', worker('PHOI'), { ...cutDto, productionInvoiceId: '99' }, 'k'),
    ).rejects.toThrow(ConflictException);
    expect(steelIssues.recordCutBatch).not.toHaveBeenCalled();
  });

  it('PI tổ đã chuyển qua nhưng còn SKU đang chạy -> vẫn báo được (Bù lỗi)', async () => {
    prisma.floorQueueEntry.findMany.mockResolvedValue([
      { status: 'DONE', productionInvoiceId: 30n, productionInvoice: { code: 'PI-30' } },
      running,
    ]);
    prisma.productionOrder.findMany.mockResolvedValue([
      { productionInvoiceItem: { productionInvoiceId: 30n } },
    ]);
    prisma.steelIssue.findMany.mockResolvedValue([{ id: 7n, bundles: [] }]);

    await service.report('tok', worker('PHOI'), { ...cutDto, productionInvoiceId: '30' }, 'k');

    expect(steelIssues.recordCutBatch).toHaveBeenCalled();
  });

  it('CUT: ưu tiên lần giao đang giữ đợt CUTTING của mình, ghi máy vào sổ', async () => {
    prisma.steelIssue.findMany.mockResolvedValue([
      { id: 40n, bundles: [] },
      { id: 43n, bundles: [{ id: 52n }] },
    ]);

    await service.report('tok', worker('PHOI'), cutDto, 'k-1');

    expect(steelIssues.recordCutBatch).toHaveBeenCalledWith(
      '43',
      { productionOrderId: '41', segments: cutDto.segments },
      'cn-1',
      'k-1',
      { workstationId: 1n },
    );
  });

  it('CUT: loại sắt chưa có lần giao nào đã nhận -> 409, nhắc quét mã khu nhận sắt', async () => {
    prisma.steelIssue.findMany.mockResolvedValue([]);
    await expect(service.report('tok', worker('PHOI'), cutDto, 'k')).rejects.toThrow(
      /khu nhận sắt/,
    );
  });

  it('PIECE (Hàn): báo số mảnh qua recordProductionBatch với stage của máy', async () => {
    prisma.workstation.findUnique.mockResolvedValue({
      ...laser,
      id: 2n,
      stage: 'HAN',
      kind: 'PIECE',
    });
    prisma.productionOrder.findFirst.mockResolvedValue({ id: 41n });

    await service.report(
      'tok',
      worker('HAN'),
      { productionInvoiceId: '45', productionOrderId: '41', pieceId: '73', qty: 4 },
      'k-h',
    );

    expect(productionBatches.recordProductionBatch).toHaveBeenCalledWith(
      '41',
      { pieceId: '73', qty: 4, stage: 'HAN' },
      'cn-1',
      'HAN',
      'k-h',
      { workstationId: 2n },
    );
  });

  it('mã khu nhận sắt không dùng để báo cắt; mã máy cắt không dùng để nhận sắt', async () => {
    prisma.workstation.findUnique.mockResolvedValue({ ...laser, kind: 'STEEL_RECEIVE' });
    await expect(service.report('tok', worker('PHOI'), cutDto, 'k')).rejects.toThrow(
      BadRequestException,
    );
    prisma.workstation.findUnique.mockResolvedValue(laser);
    await expect(service.receiveSteel('tok', worker('PHOI'), '43', 11)).rejects.toThrow(
      BadRequestException,
    );
    expect(steelIssues.receive).not.toHaveBeenCalled();
  });

  // ─── báo: các nhánh còn lại ───────────────────────────────────────────────────

  describe('report() - nhánh công đoạn phụ, kiểm đầu vào, chọn lần giao sắt', () => {
    type ReportDto = Parameters<FloorScanService['report']>[2];
    const dtoOf = (o: object) => o as ReportDto;
    const stepWs = { ...laser, id: 3n, kind: 'STEP', processStep: 'UON' };
    const pieceWs = { ...laser, id: 2n, stage: 'HAN', kind: 'PIECE' };

    it('STEP: báo qua recordStepBatch với công đoạn của máy, ghi máy vào sổ, không đụng đợt cắt', async () => {
      prisma.workstation.findUnique.mockResolvedValue(stepWs);

      const res = await service.report('tok', worker('PHOI'), cutDto, 'k-s');

      expect(steelIssues.recordStepBatch).toHaveBeenCalledWith(
        '45',
        { materialId: '7', step: 'UON', productionOrderId: '41', segments: cutDto.segments },
        'cn-1',
        'k-s',
        { workstationId: 3n },
      );
      expect(res).toEqual({ kind: 'STEP', stepBatch: { id: '9' } });
      expect(steelIssues.recordCutBatch).not.toHaveBeenCalled();
    });

    it.each([
      ['thiếu loại sắt', { ...cutDto, materialId: undefined }],
      ['không có đoạn nào', { ...cutDto, segments: [] }],
      ['không gửi danh sách đoạn', { ...cutDto, segments: undefined }],
    ])('CUT: %s -> 400, không gọi hàm báo', async (_label, dto) => {
      await expect(service.report('tok', worker('PHOI'), dtoOf(dto), 'k')).rejects.toThrow(
        BadRequestException,
      );
      expect(steelIssues.recordCutBatch).not.toHaveBeenCalled();
    });

    it('STEP cũng bị chặn khi thiếu đoạn (cùng kiểm với CUT)', async () => {
      prisma.workstation.findUnique.mockResolvedValue(stepWs);
      await expect(
        service.report('tok', worker('PHOI'), dtoOf({ ...cutDto, segments: [] }), 'k'),
      ).rejects.toThrow(BadRequestException);
      expect(steelIssues.recordStepBatch).not.toHaveBeenCalled();
    });

    it.each([
      ['thiếu mảnh', { productionInvoiceId: '45', productionOrderId: '41', qty: 4 }],
      ['thiếu số mảnh', { productionInvoiceId: '45', productionOrderId: '41', pieceId: '73' }],
      [
        'số mảnh bằng 0',
        { productionInvoiceId: '45', productionOrderId: '41', pieceId: '73', qty: 0 },
      ],
    ])('PIECE: %s -> 400, không gọi hàm báo', async (_label, dto) => {
      prisma.workstation.findUnique.mockResolvedValue(pieceWs);
      await expect(service.report('tok', worker('HAN'), dtoOf(dto), 'k')).rejects.toThrow(
        BadRequestException,
      );
      expect(productionBatches.recordProductionBatch).not.toHaveBeenCalled();
    });

    it('PIECE: SKU không thuộc PI đang báo -> 400 "SKU không thuộc PI này", không gọi hàm báo', async () => {
      prisma.workstation.findUnique.mockResolvedValue(pieceWs);
      prisma.productionOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.report(
          'tok',
          worker('HAN'),
          dtoOf({ productionInvoiceId: '45', productionOrderId: '41', pieceId: '73', qty: 4 }),
          'k',
        ),
      ).rejects.toThrow(/SKU không thuộc PI này/);
      expect(productionBatches.recordProductionBatch).not.toHaveBeenCalled();
      expect(prisma.productionOrder.findFirst).toHaveBeenCalledWith({
        where: { id: 41n, productionInvoiceItem: { productionInvoiceId: 45n } },
        select: { id: true },
      });
    });

    it('CUT: không lần giao nào đang giữ đợt CUTTING của mình -> chọn lần giao đã nhận sớm nhất (id nhỏ nhất)', async () => {
      prisma.steelIssue.findMany.mockResolvedValue([
        { id: 40n, bundles: [] },
        { id: 43n, bundles: [] },
      ]);

      await service.report('tok', worker('PHOI'), cutDto, 'k');

      expect(firstArg<string>(steelIssues.recordCutBatch)).toBe('40');
    });

    it('CUT: chỉ xét lần giao ĐÃ NHẬN của đúng PI + loại sắt; đợt đang cắt phải của SKU này và của mình hoặc chưa ai mở', async () => {
      prisma.steelIssue.findMany.mockResolvedValue([{ id: 40n, bundles: [] }]);

      await service.report('tok', worker('PHOI'), cutDto, 'k');

      expect(prisma.steelIssue.findMany).toHaveBeenCalledWith({
        where: { productionInvoiceId: 45n, materialId: 7n, status: { not: 'ISSUED' } },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          bundles: {
            where: {
              status: 'CUTTING',
              productionOrderId: 41n,
              OR: [{ openedById: 'cn-1' }, { openedById: null }],
            },
            select: { id: true },
          },
        },
      });
    });

    it('id PI/loại sắt/SKU không phải số -> bị chặn trước khi chạm DB (không báo nhầm bằng id rác)', async () => {
      await expect(
        service.report('tok', worker('PHOI'), dtoOf({ ...cutDto, materialId: 'abc' }), 'k'),
      ).rejects.toThrow();
      expect(prisma.steelIssue.findMany).not.toHaveBeenCalled();
      expect(steelIssues.recordCutBatch).not.toHaveBeenCalled();
    });
  });

  describe('receiveSteel()', () => {
    it('mã khu nhận sắt: nhận đúng lần giao với số cây công nhân đếm, id công nhân lấy từ token', async () => {
      prisma.workstation.findUnique.mockResolvedValue({ ...laser, kind: 'STEEL_RECEIVE' });
      steelIssues.receive.mockResolvedValue({ id: '43', status: 'RECEIVED' });

      const res = await service.receiveSteel('tok', worker('PHOI'), '43', 11);

      expect(steelIssues.receive).toHaveBeenCalledWith('43', 'cn-1', 11);
      expect(res).toEqual({ id: '43', status: 'RECEIVED' });
    });

    it('tổ khác quét mã khu nhận sắt của Phôi -> 403, không nhận', async () => {
      prisma.workstation.findUnique.mockResolvedValue({ ...laser, kind: 'STEEL_RECEIVE' });
      await expect(service.receiveSteel('tok', worker('HAN'), '43', 11)).rejects.toThrow(
        ForbiddenException,
      );
      expect(steelIssues.receive).not.toHaveBeenCalled();
    });
  });

  // ─── quét mã: dữ liệu màn hình công nhân ──────────────────────────────────────

  describe('getContext()', () => {
    const order = {
      id: 41n,
      poNumber: 'PO-1',
      quantity: 10,
      floorStage: 'ACTIVE',
      mfgProduct: { name: 'Khung A', factoryCode: 'SKU-A' },
    };
    const progress = (extra: object = {}) => [
      {
        materialId: '7',
        materialCode: 'S7',
        materialName: 'Sắt 7',
        segments: [
          {
            segmentSpecId: '63',
            cutLengthMm: 500,
            required: 20,
            done: 5,
            byOrder: [{ productionOrderId: '41', required: 20, done: 5, ignored: 'x' }],
            ...extra,
          },
        ],
      },
      { materialId: '8', materialCode: 'S8', materialName: 'Sắt 8', segments: [] },
    ];

    it('mã khu nhận sắt: trả danh sách đợt kho đã xuất chưa ai nhận (đã đổi kiểu số/tên), không trả PI', async () => {
      prisma.workstation.findUnique.mockResolvedValue({ ...laser, kind: 'STEEL_RECEIVE' });
      const issuedAt = new Date('2026-10-15T01:00:00Z');
      prisma.steelIssue.findMany.mockResolvedValue([
        {
          id: 43n,
          barCount: 10,
          barLengthMm: '6000',
          issuedAt,
          productionInvoice: { id: 45n, code: 'PI-45' },
          material: { code: 'S7', name: 'Sắt 7' },
          issuedBy: { firstName: 'An', lastName: 'Nguyễn', username: 'kho' },
        },
      ]);

      const res = await service.getContext('tok', worker('PHOI'));

      expect(res).toEqual({
        workstation: {
          id: '1',
          code: 'LASER-01',
          name: 'Máy laser 1',
          stage: 'PHOI',
          kind: 'STEEL_RECEIVE',
          processStep: null,
        },
        steelToReceive: [
          {
            steelIssueId: '43',
            productionInvoiceId: '45',
            piCode: 'PI-45',
            materialCode: 'S7',
            materialName: 'Sắt 7',
            barCount: 10,
            barLengthMm: 6000,
            issuedAt,
            issuedByName: 'Nguyễn An',
          },
        ],
      });
      expect(firstArg<{ where: unknown }>(prisma.steelIssue.findMany).where).toEqual({
        status: 'ISSUED',
        productionInvoice: { items: { some: { productionOrder: { floorStage: 'ACTIVE' } } } },
      });
      expect(prisma.floorQueueEntry.findMany).not.toHaveBeenCalled();
    });

    it('tổ chưa chạy PI nào và không chọn PI -> pi: null (màn "chờ QLSX chuyển PI")', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([]);

      const res = await service.getContext('tok', worker('PHOI'));

      expect(res).toMatchObject({ runningPi: null, reworkPis: [], pi: null });
      expect(prisma.productionInvoice.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('chọn PI không báo được (không chạy, không bù lỗi) -> 409 trước khi tải dữ liệu PI', async () => {
      await expect(service.getContext('tok', worker('PHOI'), '99')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.productionInvoice.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('PI đang chạy: tự chọn PI đó; máy CUT lấy tiến độ theo loại sắt và đánh dấu loại đã/chưa nhận sắt', async () => {
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      steelIssues.getPhoiProgress.mockResolvedValue(progress());
      prisma.steelIssue.groupBy.mockResolvedValue([{ materialId: 7n }]);

      const res = await service.getContext('tok', worker('PHOI'));

      expect(steelIssues.getPhoiProgress).toHaveBeenCalledWith('45');
      expect(steelIssues.getStepProgress).not.toHaveBeenCalled();
      expect(res).toMatchObject({
        runningPi: { productionInvoiceId: '45', code: 'PI-45' },
        reworkPis: [],
        pi: {
          productionInvoiceId: '45',
          code: 'PI-45',
          orders: [
            {
              productionOrderId: '41',
              poNumber: 'PO-1',
              sku: 'SKU-A',
              productName: 'Khung A',
              quantity: 10,
              floorStage: 'ACTIVE',
            },
          ],
          materials: [
            {
              materialId: '7',
              materialCode: 'S7',
              materialName: 'Sắt 7',
              hasReceivedSteel: true,
              segments: [
                {
                  segmentSpecId: '63',
                  cutLengthMm: 500,
                  required: 20,
                  done: 5,
                  byOrder: [{ productionOrderId: '41', required: 20, done: 5 }],
                },
              ],
            },
            { materialId: '8', hasReceivedSteel: false, segments: [] },
          ],
        },
      });
      // chỉ lọc lần giao ĐÃ NHẬN của PI này (ISSUED = kho xuất chưa ai nhận thì chưa tính)
      expect(prisma.steelIssue.groupBy).toHaveBeenCalledWith({
        by: ['materialId'],
        where: { productionInvoiceId: 45n, status: { not: 'ISSUED' } },
        _count: { _all: true },
      });
    });

    it('máy công đoạn phụ (STEP): tiến độ lấy theo công đoạn của máy', async () => {
      prisma.workstation.findUnique.mockResolvedValue({
        ...laser,
        kind: 'STEP',
        processStep: 'DAP',
      });
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      steelIssues.getStepProgress.mockResolvedValue(progress());

      await service.getContext('tok', worker('PHOI'));

      expect(steelIssues.getStepProgress).toHaveBeenCalledWith('45', 'DAP');
      expect(steelIssues.getPhoiProgress).not.toHaveBeenCalled();
    });

    it('máy PIECE (Hàn): kế hoạch mảnh cộng thêm số đã báo ở đợt chưa gửi KCS (openQty), mảnh chưa báo = 0', async () => {
      prisma.workstation.findUnique.mockResolvedValue({ ...laser, stage: 'HAN', kind: 'PIECE' });
      prisma.productionOrder.findMany.mockResolvedValue([order]);
      productionBatches.getBatchPlanBatch.mockResolvedValue({
        '41': {
          orderId: '41',
          items: [
            { pieceId: '73', required: 10 },
            { pieceId: '74', required: 5 },
            { pieceId: '75', required: 5 },
          ],
        },
      });
      prisma.productionBatch.groupBy.mockResolvedValue([
        { productionOrderId: 41n, pieceId: 73n, _sum: { reportedQty: 6 } },
        { productionOrderId: 41n, pieceId: 74n, _sum: { reportedQty: null } },
      ]);

      const res = await service.getContext('tok', worker('HAN'));

      expect(productionBatches.getBatchPlanBatch).toHaveBeenCalledWith(['41'], 'HAN');
      expect(prisma.productionBatch.groupBy).toHaveBeenCalledWith({
        by: ['productionOrderId', 'pieceId'],
        where: { stage: 'HAN', status: 'OPEN', productionOrderId: { in: [41n] } },
        _sum: { reportedQty: true },
      });
      expect(res).toMatchObject({
        pi: {
          piecePlans: {
            '41': {
              items: [
                { pieceId: '73', required: 10, openQty: 6 },
                { pieceId: '74', required: 5, openQty: 0 },
                { pieceId: '75', required: 5, openQty: 0 },
              ],
            },
          },
        },
      });
      expect(steelIssues.getPhoiProgress).not.toHaveBeenCalled();
    });

    it('PI tổ đã chuyển qua nhưng còn SKU đang chạy hiện ở reworkPis (kèm giờ chuyển), chọn được để bù lỗi', async () => {
      const endedAt = new Date('2026-10-14T09:00:00Z');
      prisma.floorQueueEntry.findMany.mockResolvedValue([
        { status: 'DONE', productionInvoiceId: 30n, productionInvoice: { code: 'PI-30' }, endedAt },
        running,
      ]);
      prisma.productionOrder.findMany
        .mockResolvedValueOnce([{ productionInvoiceItem: { productionInvoiceId: 30n } }]) // còn SKU ACTIVE
        .mockResolvedValueOnce([order]); // danh sách SKU của PI đang xem
      prisma.productionInvoice.findUniqueOrThrow.mockResolvedValue({ id: 30n, code: 'PI-30' });

      const res = await service.getContext('tok', worker('PHOI'), '30');

      expect(res).toMatchObject({
        runningPi: { productionInvoiceId: '45', code: 'PI-45' },
        reworkPis: [{ productionInvoiceId: '30', code: 'PI-30', endedAt }],
        pi: { productionInvoiceId: '30', code: 'PI-30' },
      });
    });

    it('PI đã xong hẳn (không còn SKU nào đang chạy) KHÔNG nằm trong reworkPis và không chọn được', async () => {
      prisma.floorQueueEntry.findMany.mockResolvedValue([
        {
          status: 'DONE',
          productionInvoiceId: 30n,
          productionInvoice: { code: 'PI-30' },
          endedAt: new Date(),
        },
        running,
      ]);
      prisma.productionOrder.findMany.mockResolvedValue([]); // không SKU ACTIVE nào

      await expect(service.getContext('tok', worker('PHOI'), '30')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── "Sản lượng của tôi" ──────────────────────────────────────────────────────

  describe('myOutput()', () => {
    const at = new Date('2026-10-15T01:00:00Z');
    const row = (o: object = {}) => ({
      id: 1n,
      kind: 'CUT',
      createdAt: at,
      productionInvoice: null,
      workstation: { code: 'LASER-01', name: 'Máy laser 1' },
      lines: [],
      reversedBy: null,
      cutBundle: null,
      stepBatch: null,
      productionBatch: null,
      ...o,
    });
    const cutBundle = (status: string) => ({
      status,
      steelIssue: { productionInvoice: { code: 'PI-45' } },
    });
    const stepBatch = (stepBundle: { status: string } | null) => ({
      step: 'UON',
      stepBundle,
      productionInvoice: { code: 'PI-46' },
    });
    const prodBatch = (status: string) => ({
      stage: 'HAN',
      status,
      productionOrder: { productionInvoiceItem: { productionInvoice: { code: 'PI-47' } } },
    });
    const one = async (o: object) => {
      prisma.floorReport.findMany.mockResolvedValue([row(o)]);
      const [r] = await service.myOutput('cn-1');
      return r;
    };

    it.each([
      ['đợt cắt đang mở (chưa gửi KCS)', 'OPEN', 'PI-45', { cutBundle: cutBundle('CUTTING') }],
      ['đợt cắt chờ KCS', 'AWAITING_QC', 'PI-45', { cutBundle: cutBundle('AWAITING_QC') }],
      ['đợt cắt KCS đã duyệt', 'QC_DONE', 'PI-45', { cutBundle: cutBundle('QC_PASSED') }],
      ['công đoạn phụ chưa vào đợt', 'OPEN', 'PI-46', { stepBatch: stepBatch(null) }],
      [
        'công đoạn phụ chờ KCS',
        'AWAITING_QC',
        'PI-46',
        { stepBatch: stepBatch({ status: 'AWAITING_QC' }) },
      ],
      [
        'công đoạn phụ KCS đã duyệt',
        'QC_DONE',
        'PI-46',
        { stepBatch: stepBatch({ status: 'QC_PASSED' }) },
      ],
      ['lô mảnh đang mở', 'OPEN', 'PI-47', { productionBatch: prodBatch('OPEN') }],
      ['lô mảnh chờ KCS', 'AWAITING_QC', 'PI-47', { productionBatch: prodBatch('AWAITING_QC') }],
      ['lô mảnh KCS đã duyệt', 'QC_DONE', 'PI-47', { productionBatch: prodBatch('QC_DONE') }],
      ['lần báo không còn gắn đợt nào (đợt đã bị xoá)', 'REMOVED', null, {}],
    ])('trạng thái: %s -> %s', async (_label, state, piCode, o) => {
      const r = await one(o);
      expect(r.state).toBe(state);
      expect(r.piCode).toBe(piCode);
    });

    it('mã PI ghi trên chính lần báo được ưu tiên hơn mã PI suy ra từ đợt', async () => {
      const r = await one({
        productionInvoice: { code: 'PI-99' },
        cutBundle: cutBundle('CUTTING'),
      });
      expect(r.piCode).toBe('PI-99');
    });

    it('lô mảnh không có PI -> piCode null; công đoạn phụ trả kèm công đoạn', async () => {
      const noPi = await one({
        productionBatch: {
          ...prodBatch('OPEN'),
          productionOrder: { productionInvoiceItem: { productionInvoice: null } },
        },
      });
      expect(noPi.piCode).toBeNull();
      const step = await one({ stepBatch: stepBatch(null) });
      expect(step.step).toBe('UON');
    });

    it('các dòng: đoạn đổi cỡ sang số + mã sắt, mảnh giữ mã/tên; lần bị QLSX đảo kèm lý do + người đảo', async () => {
      const reversedAt = new Date('2026-10-15T02:00:00Z');
      const r = await one({
        lines: [
          { qty: 5, segmentSpec: { cutLengthMm: '650.5', material: { code: 'S7' } }, piece: null },
          { qty: 3, segmentSpec: null, piece: { code: 'M1', name: 'Mảnh 1' } },
        ],
        reversedBy: {
          reason: 'nhập nhầm số',
          createdAt: reversedAt,
          reportedBy: { firstName: 'Bình', lastName: 'Trần', username: 'qlsx' },
        },
      });
      expect(r.lines).toEqual([
        { qty: 5, segment: { cutLengthMm: 650.5, materialCode: 'S7' }, piece: null },
        { qty: 3, segment: null, piece: { code: 'M1', name: 'Mảnh 1' } },
      ]);
      expect(r.reversed).toEqual({ reason: 'nhập nhầm số', at: reversedAt, byName: 'Trần Bình' });
    });

    it('người đảo không có họ tên -> hiện tên đăng nhập; chưa bị đảo -> reversed: null', async () => {
      const named = await one({
        reversedBy: {
          reason: 'x',
          createdAt: at,
          reportedBy: { firstName: '', lastName: '', username: 'qlsx' },
        },
      });
      expect(named.reversed?.byName).toBe('qlsx');
      expect((await one({})).reversed).toBeNull();
    });

    it('chỉ lấy lần báo CỦA MÌNH, bỏ các dòng đảo (reversalOfId), mới nhất trước, tối đa 500; id/kind/giờ/máy giữ nguyên', async () => {
      prisma.floorReport.findMany.mockResolvedValue([row({ id: 77n })]);

      const [r] = await service.myOutput(
        'cn-1',
        '2026-10-01T00:00:00.000Z',
        '2026-10-15T10:00:00.000Z',
      );

      const arg = firstArg<{ where: unknown; orderBy: unknown; take: unknown }>(
        prisma.floorReport.findMany,
      );
      expect(arg.where).toEqual({
        reportedById: 'cn-1',
        reversalOfId: null,
        createdAt: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lte: new Date('2026-10-15T10:00:00.000Z'),
        },
      });
      expect(arg.orderBy).toEqual({ createdAt: 'desc' });
      expect(arg.take).toBe(500);
      expect(r).toMatchObject({
        id: '77',
        kind: 'CUT',
        createdAt: at,
        workstation: { code: 'LASER-01', name: 'Máy laser 1' },
      });
    });

    it('không truyền from/to -> 7 ngày gần nhất tính đến bây giờ', async () => {
      const before = Date.now();
      await service.myOutput('cn-1');
      const { gte, lte } = firstArg<{ where: { createdAt: { gte: Date; lte: Date } } }>(
        prisma.floorReport.findMany,
      ).where.createdAt;
      expect(lte.getTime()).toBeGreaterThanOrEqual(before);
      expect(lte.getTime() - gte.getTime()).toBe(7 * 24 * 3600 * 1000);
    });

    it.each([
      ['from', 'không-phải-ngày', undefined],
      ['to', undefined, 'không-phải-ngày'],
    ])('%s không hợp lệ -> 400, không truy vấn', async (_label, from, to) => {
      await expect(service.myOutput('cn-1', from, to)).rejects.toThrow(BadRequestException);
      expect(prisma.floorReport.findMany).not.toHaveBeenCalled();
    });
  });
});
