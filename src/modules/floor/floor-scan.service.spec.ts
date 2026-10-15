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

describe('FloorScanService', () => {
  let prisma: {
    workstation: { findUnique: jest.Mock };
    floorQueueEntry: { findMany: jest.Mock };
    productionOrder: { findMany: jest.Mock; findFirst: jest.Mock };
    steelIssue: { findMany: jest.Mock };
  };
  let steelIssues: { recordCutBatch: jest.Mock; recordStepBatch: jest.Mock; receive: jest.Mock };
  let productionBatches: { recordProductionBatch: jest.Mock };
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
      steelIssue: { findMany: jest.fn() },
    };
    steelIssues = {
      recordCutBatch: jest.fn().mockResolvedValue({ id: '52' }),
      recordStepBatch: jest.fn(),
      receive: jest.fn(),
    };
    productionBatches = { recordProductionBatch: jest.fn().mockResolvedValue({ id: '106' }) };
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
});
