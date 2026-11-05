import { DailyOutputService } from './daily-output.service';
import type { CapacityItemInput } from './production-capacity.ranges';

const DAY = '2026-11-03';
// 10:00 VN ngày 03/11 (03:00 UTC) và 02/11 giờ VN.
const at = (iso: string) => new Date(iso);

const item = (over: Partial<CapacityItemInput> = {}): CapacityItemInput => ({
  itemId: '1',
  piId: '7',
  displayCode: 'MY-313',
  skuCode: 'SKU-1',
  quantity: 100,
  loadCont: 100, // 1 cont
  workshop: {
    code: 'PHU_AN',
    name: 'Xưởng Phú An',
    capacityMode: 'CONT_PER_DAY',
    paint: null,
  },
  warehouse: null,
  stages: {
    PHOI_START: '2026-11-03',
    FRAME_PHOI: '2026-11-03',
    FRAME_HAN: '2026-11-04',
    FRAME_SON: '2026-11-05',
  },
  ...over,
});

describe('DailyOutputService.alertsForDay', () => {
  let prisma: Record<string, { findMany: jest.Mock }>;
  let capacity: { loadParams: jest.Mock; loadCapacityItems: jest.Mock };
  let steel: { getPhoiProgressBatch: jest.Mock };
  let batches: { getBatchPlanBatch: jest.Mock };
  let weaving: { getIssuePlanBatch: jest.Mock };
  let invoices: { listTransferCheckPiecesBatch: jest.Mock };
  let service: DailyOutputService;

  beforeEach(() => {
    prisma = {
      productionOrder: {
        findMany: jest.fn().mockResolvedValue([{ id: 10n, productionInvoiceItemId: 1n }]),
      },
      floorReport: { findMany: jest.fn().mockResolvedValue([]) },
      weavingReceipt: { findMany: jest.fn().mockResolvedValue([]) },
      transferCheckResult: { findMany: jest.fn().mockResolvedValue([]) },
      packagingRecord: { findMany: jest.fn().mockResolvedValue([]) },
    };
    capacity = {
      loadParams: jest.fn().mockResolvedValue({ capacityContPerDay: 1.3, daysPerContPhuocAn: 4 }),
      loadCapacityItems: jest.fn().mockResolvedValue({ items: [item()], missingLoadCont: [] }),
    };
    steel = {
      getPhoiProgressBatch: jest.fn().mockResolvedValue({
        '7': [
          // Σ required đoạn cắt = 100; công đoạn phụ (steps) không tính.
          {
            segments: [{ required: 60 }, { required: 40 }],
            steps: [{ segments: [{ required: 999 }] }],
          },
        ],
      }),
    };
    batches = {
      getBatchPlanBatch: jest.fn().mockResolvedValue({ '10': { items: [{ plannedQty: 100 }] } }),
    };
    weaving = { getIssuePlanBatch: jest.fn().mockResolvedValue({ '10': [{ totalQty: 100 }] }) };
    invoices = {
      listTransferCheckPiecesBatch: jest.fn().mockResolvedValue({ '1': [{ totalQty: 100 }] }),
    };
    service = new DailyOutputService(
      prisma as never,
      capacity as never,
      steel as never,
      batches as never,
      weaving as never,
      invoices as never,
    );
  });

  const report = (createdAt: string, qty: number, orderId = 10n, piId = 7n) => ({
    createdAt: at(createdAt),
    productionInvoiceId: piId,
    productionBatch: { productionOrderId: orderId },
    lines: [{ qty }],
  });

  it('chỉ lấy dòng đã có PHOI_START; không khoảng nào phủ ngày -> [] và không truy vấn thêm', async () => {
    const out = await service.alertsForDay('2026-12-20');
    expect(out).toEqual([]);
    expect(capacity.loadCapacityItems).toHaveBeenCalledWith({ onlyWithPhoiStart: true });
    expect(prisma.productionOrder.findMany).not.toHaveBeenCalled();
    expect(prisma.floorReport.findMany).not.toHaveBeenCalled();
  });

  it('Phôi ước tính theo tỷ lệ đoạn cắt: cắt 60/100 đoạn của PI 1 cont -> 0,6 cont, báo "ước tính"', async () => {
    prisma.floorReport.findMany.mockResolvedValue([report('2026-11-03T03:00:00.000Z', 60)]);
    const out = await service.alertsForDay(DAY);
    const phoi = out.find((a) => a.stage === 'PHOI')!;
    expect(phoi).toMatchObject({ estimated: true, doneCont: expect.closeTo(0.6) as unknown });
    expect(phoi.message).toBe(
      'Phôi · Xưởng Phú An 03/11: làm 0,6/1 cont (ước tính theo đoạn cắt) - MY-313',
    );
    const where = (
      prisma.floorReport.findMany.mock.calls[0] as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where).toMatchObject({ kind: 'CUT', reversalOfId: null, reversedBy: { is: null } });
  });

  it('ngày tính theo giờ VN: báo cáo 17:30 UTC ngày 02/11 = 00:30 ngày 03/11 VN', async () => {
    prisma.floorReport.findMany.mockResolvedValue([report('2026-11-02T17:30:00.000Z', 100)]);
    const out = await service.alertsForDay(DAY);
    expect(out.find((a) => a.stage === 'PHOI')).toBeUndefined(); // 1 cont đủ
  });

  it('truy vấn lần huỷ bị loại ở where (lần báo đã bị đảo và dòng đảo không tính); lọc theo hết ngày D giờ VN', async () => {
    await service.alertsForDay(DAY);
    const calls = prisma.floorReport.findMany.mock.calls as [{ where: Record<string, unknown> }][];
    expect(calls.length).toBeGreaterThan(0);
    for (const [{ where }] of calls) {
      expect(where).toMatchObject({ reversalOfId: null, reversedBy: { is: null } });
      // < 00:00 VN ngày 04/11 = 17:00 UTC ngày 03/11
      expect((where.createdAt as { lt: Date }).lt.toISOString()).toBe('2026-11-03T17:00:00.000Z');
    }
  });

  it('Hàn: FloorReport PIECE theo lệnh ÷ Σ plannedQty × cont dòng', async () => {
    capacity.loadCapacityItems.mockResolvedValue({
      items: [
        item({
          stages: { PHOI_START: '2026-11-01', FRAME_PHOI: '2026-11-02', FRAME_HAN: '2026-11-05' },
        }),
      ],
      missingLoadCont: [],
    });
    prisma.floorReport.findMany.mockImplementation((args: { where: { kind: string } }) =>
      Promise.resolve(args.where.kind === 'PIECE' ? [report('2026-11-03T03:00:00.000Z', 50)] : []),
    );
    const out = await service.alertsForDay(DAY);
    const han = out.find((a) => a.stage === 'HAN')!;
    expect(han.doneCont).toBeCloseTo(0.5);
    expect(han.message).toBe('Hàn · Xưởng Phú An 03/11: làm 0,5/1 cont - MY-313');
    expect(batches.getBatchPlanBatch).toHaveBeenCalledWith(['10'], 'HAN');
  });

  it('tổng cần = 0 hoặc nguồn lỗi -> bỏ công đoạn đó, không báo oan', async () => {
    batches.getBatchPlanBatch.mockResolvedValue({ '10': { items: [] } });
    steel.getPhoiProgressBatch.mockRejectedValue(new Error('timeout'));
    capacity.loadCapacityItems.mockResolvedValue({
      items: [
        item({
          stages: { PHOI_START: '2026-11-03', FRAME_PHOI: '2026-11-03', FRAME_HAN: '2026-11-03' },
        }),
      ],
      missingLoadCont: [],
    });
    expect(await service.alertsForDay(DAY)).toEqual([]);
  });

  it('Nhập đan / Chuyền kiểm / Đóng gói theo kho; Đóng gói tính bộ ÷ loadCont (không chia số thùng/bộ)', async () => {
    capacity.loadCapacityItems.mockResolvedValue({
      items: [
        item({
          workshop: null,
          warehouse: { code: 'KHO1', name: 'Kho TP 1' },
          stages: {
            PHOI_START: '2026-11-01',
            WEAVING: '2026-11-03',
            TRANSFER_CHECK: '2026-11-03',
            PACKAGING_START: '2026-11-03',
            PACKAGING: '2026-11-03',
          },
        }),
      ],
      missingLoadCont: [],
    });
    prisma.weavingReceipt.findMany.mockResolvedValue([
      { productionOrderId: 10n, receivedAt: at('2026-11-03T03:00:00.000Z'), qty: 40 },
    ]);
    prisma.transferCheckResult.findMany.mockResolvedValue([
      { productionInvoiceItemId: 1n, checkedAt: at('2026-11-03T03:00:00.000Z'), checkedQty: 70 },
    ]);
    prisma.packagingRecord.findMany.mockResolvedValue([
      { productionInvoiceItemId: 1n, packedAt: at('2026-11-03T03:00:00.000Z'), boxesPacked: 25 },
    ]);
    const out = await service.alertsForDay(DAY);
    const by = (s: string) => out.find((a) => a.stage === s)!;
    expect(by('NHAP_DAN').doneCont).toBeCloseTo(0.4);
    expect(by('CHUYEN_KIEM').doneCont).toBeCloseTo(0.7);
    expect(by('DONG_GOI').doneCont).toBeCloseTo(0.25);
    expect(by('DONG_GOI').groupKind).toBe('WAREHOUSE');
  });

  it('Phước An: Hàn luỹ kế cuối khối 4 ngày', async () => {
    capacity.loadCapacityItems.mockResolvedValue({
      items: [
        item({
          quantity: 200,
          workshop: {
            code: 'PHUOC_AN',
            name: 'Xưởng Phước An',
            capacityMode: 'DAYS_PER_CONT',
            paint: null,
          },
          stages: { PHOI_START: '2026-11-03', FRAME_PHOI: '2026-11-06' },
        }),
      ],
      missingLoadCont: [],
    });
    prisma.floorReport.findMany.mockImplementation((args: { where: { kind: string } }) =>
      Promise.resolve(args.where.kind === 'PIECE' ? [report('2026-11-04T03:00:00.000Z', 25)] : []),
    );
    batches.getBatchPlanBatch.mockResolvedValue({ '10': { items: [{ plannedQty: 100 }] } });
    const out = await service.alertsForDay('2026-11-07');
    const han = out.find((a) => a.stage === 'HAN');
    expect(han).toBeDefined();
    expect(han!.mode).toBe('DAYS_PER_CONT');
    expect(han!.doneCont).toBeCloseTo(0.5); // 25/100 × 2 cont
  });
});
