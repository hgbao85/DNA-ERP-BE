import { Prisma } from '../../generated/prisma/client';
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { MilestoneBoardService } from './milestone-board.service';

const d = (day: string) => new Date(`${day}T00:00:00.000Z`);
const dec = (n: number) => new Prisma.Decimal(n);

/** WorkshopScopeService thật, chỉ giả lập bảng users: 'qlsx-pa' = Phước An (id 2), 'qlsx-phu' = Phú An (id 1, sơn cho Phước An). */
const makeScope = () => {
  const users: Record<string, unknown> = {
    'qlsx-pa': { workshopId: 2n, workshop: { name: 'Xưởng Phước An', paintsFor: [] } },
    'qlsx-phu': { workshopId: 1n, workshop: { name: 'Xưởng Phú An', paintsFor: [{ id: 2n }] } },
  };
  return new WorkshopScopeService({
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(users[where.id] ?? null),
      ),
    },
  } as never);
};

describe('MilestoneBoardService', () => {
  // 09:00 sáng 29/10 giờ VN.
  const NOW = new Date('2026-10-29T02:00:00.000Z');
  let prisma: {
    productionInvoiceItem: { findMany: jest.Mock };
    productionInvoice: { findMany: jest.Mock };
    purchaseProposalItem: { findMany: jest.Mock };
    deadlineChangeRequest: { findMany: jest.Mock }; // Phần A – Đợt 9
  };
  let steelIssues: { getPhoiProgressBatch: jest.Mock };
  let batches: { getBatchPlanBatch: jest.Mock };
  let weaving: { getIssuePlanBatch: jest.Mock };
  let invoices: { getPackagingBatch: jest.Mock; listTransferCheckPiecesBatch: jest.Mock };
  let service: MilestoneBoardService;

  const item = (id: bigint, extra: Record<string, unknown> = {}) => ({
    id,
    productionInvoiceId: 7n,
    quantity: 50,
    materialDeadline: d('2026-10-27'),
    finishedMaterialDeadline: null,
    deliveryDeadline: d('2026-10-30'),
    wireMaterialId: null,
    cushionMaterialId: null,
    productionInvoice: { code: 'PI-2026-001', deadline: d('2026-11-15') },
    mfgProduct: { factoryCode: `SKU-${id}`, name: null },
    stages: [
      { stageType: 'FRAME_PHOI', deadline: d('2026-10-28') },
      { stageType: 'FRAME_HAN', deadline: d('2026-10-31') },
      { stageType: 'PACKAGING', deadline: d('2026-11-20') },
    ],
    productionOrder: { id: id * 10n, floorStage: 'ACTIVE' },
    ...extra,
  });

  const purchase = (
    materialId: bigint,
    name: string,
    buy: number,
    received: number,
    detailKind: string | null = null,
    receiveWarehouseCode: string | null = null,
    stockLengthMm: number | null = null,
  ) => ({
    id: materialId * 100n,
    materialId,
    buyQty: dec(buy),
    receivedQty: dec(received),
    receiveWarehouseCode,
    stockLengthMm,
    spec: null,
    proposal: { productionInvoiceId: 7n },
    material: {
      name,
      unit: 'kg',
      detailKind,
      buyerId: 'buyer-1',
      warehouse: { code: 'phoi-son-han' },
    },
  });

  beforeEach(() => {
    prisma = {
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([item(1n)]) },
      productionInvoice: {
        findMany: jest.fn().mockResolvedValue([{ id: 7n, code: 'PI-2026-001' }]),
      },
      deadlineChangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
      purchaseProposalItem: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            purchase(30n, 'Sắt hộp', 60, 60),
            purchase(31n, 'Sơn tĩnh điện', 100, 40),
            purchase(32n, 'Thùng carton', 50, 0, 'PACKAGING'),
          ]),
      },
    };
    steelIssues = {
      getPhoiProgressBatch: jest.fn().mockResolvedValue({
        '7': [
          {
            materialId: '30',
            segments: [
              {
                required: 200,
                done: 200,
                failed: 0,
                byOrder: [{ productionOrderId: '10', required: 200, done: 150, failed: 10 }],
              },
            ],
            steps: [
              {
                step: 'UON',
                segments: [
                  { byOrder: [{ productionOrderId: '10', required: 200, done: 0, failed: 0 }] },
                ],
              },
            ],
          },
        ],
      }),
    };
    batches = {
      getBatchPlanBatch: jest.fn().mockImplementation((_ids: string[], stage: string) =>
        Promise.resolve({
          '10': {
            items:
              stage === 'PHOI'
                ? []
                : [{ plannedQty: 50, passedQty: 20, awaitingQcQty: 5, openQty: 5 }],
            materialYieldItems: [],
          },
        }),
      ),
    };
    weaving = { getIssuePlanBatch: jest.fn().mockResolvedValue({ '10': [] }) };
    invoices = {
      getPackagingBatch: jest
        .fn()
        .mockResolvedValue({ '1': { totalQty: 50, packedQty: 10, remainingQty: 40 } }),
      // Phần A – Đợt 3: Chuyền kiểm - 2 mảnh tổng 100, đã kiểm 50 (mảnh 2 kiểm lố 20 -> chặn trần 30).
      listTransferCheckPiecesBatch: jest.fn().mockResolvedValue({
        '1': [
          { pieceId: '1', totalQty: 50, checkedQty: 20 },
          { pieceId: '2', totalQty: 50, checkedQty: 60 },
        ],
      }),
    };
    service = new MilestoneBoardService(
      prisma as never,
      steelIssues as never,
      batches as never,
      weaving as never,
      invoices as never,
      makeScope(),
    );
  });

  const cell = (
    rows: Awaited<ReturnType<MilestoneBoardService['getBoard']>>['rows'],
    key: string,
  ) => rows[0].milestones.find((m) => m.key === key)!;

  it('không có dòng đang chạy -> bảng rỗng, không gọi nguồn tiến độ', async () => {
    prisma.productionInvoiceItem.findMany.mockResolvedValue([]);
    const board = await service.getBoard(NOW);
    expect(board).toMatchObject({ today: '2026-10-29', rows: [] });
    expect(steelIssues.getPhoiProgressBatch).not.toHaveBeenCalled();
  });

  it('tính đúng từng mốc so với hạn đã lưu', async () => {
    const { rows, failedSources } = await service.getBoard(NOW);
    expect(failedSources).toEqual([]);
    // Mua VT khung: sơn mới về 40/100, hạn 27/10 -> trễ 2 ngày, lý do nêu vật tư thiếu.
    expect(cell(rows, 'MUA_VT_KHUNG')).toMatchObject({ status: 'LATE', daysLeft: -2 });
    expect(cell(rows, 'MUA_VT_KHUNG').reason).toContain('Sơn tĩnh điện 40/100 kg');
    expect(rows[0].missing.MUA_VT_KHUNG.map((m) => m.name)).toEqual(['Sơn tĩnh điện']);
    // Thùng (bao bì) thuộc "VT còn lại" - chưa lưu hạn riêng nên theo hạn Đóng gói 20/11 (cùng `purchaseDeadlineOf` với
    // "Theo dõi mua hàng", 32.27) -> còn xa, đúng hạn.
    expect(cell(rows, 'MUA_VT_CON_LAI')).toMatchObject({
      status: 'ON_TRACK',
      deadline: '2026-11-20',
    });
    // Phôi theo SKU: cắt 140/200 (150 − lỗi 10) + Uốn 0/200 -> 140/400, hạn 28/10 -> trễ.
    expect(cell(rows, 'PHOI')).toMatchObject({ status: 'LATE', need: 400, done: 140 });
    // Hàn: đạt 20 + chờ KCS 5 + chưa gửi 5 = 30/50, hạn 31/10 -> sắp tới hạn (2 ngày).
    expect(cell(rows, 'HAN')).toMatchObject({
      status: 'DUE_SOON',
      daysLeft: 2,
      done: 30,
      need: 50,
    });
    // Khung CK: % = trung bình 3 tổ như "Theo lệnh" (Phôi 35, Hàn 60, Sơn 60 -> 51), không cộng dồn 200/500 = 40 (Q1, 32.27).
    expect(cell(rows, 'KHUNG')).toMatchObject({ percent: 51 });
    expect(cell(rows, 'KHUNG').reason).toBe('Đã làm 51% (trung bình Phôi 35%, Hàn 60%, Sơn 60%)');
    // Sơn không có hạn; Đan không có mảnh đan -> Không cần.
    expect(cell(rows, 'SON').status).toBe('NO_DEADLINE');
    expect(cell(rows, 'DAN').status).toBe('NA');
    // Hạn giao 30/10, đóng gói 10/50 -> sắp tới hạn.
    expect(cell(rows, 'HAN_GIAO')).toMatchObject({
      status: 'DUE_SOON',
      daysLeft: 1,
      done: 10,
      need: 50,
    });
    expect(rows[0].worst).toBe('LATE');
  });

  // Phần A – Đợt 3
  it('nhãn Nhập đan + ô Chuyền kiểm đứng ngay sau Nhập đan (10 mốc)', async () => {
    const { rows } = await service.getBoard(NOW);
    expect(rows[0].milestones).toHaveLength(10);
    const keys = rows[0].milestones.map((m) => m.key);
    expect(keys.indexOf('CHUYEN_KIEM')).toBe(keys.indexOf('DAN') + 1);
    expect(cell(rows, 'DAN').label).toBe('Nhập đan');
    expect(cell(rows, 'CHUYEN_KIEM').label).toBe('Chuyền kiểm');
  });

  it('Chuyền kiểm: tiến độ theo mảnh, đã kiểm chặn trần từng mảnh; chấm theo hạn TRANSFER_CHECK', async () => {
    prisma.productionInvoiceItem.findMany.mockResolvedValue([
      item(1n, {
        stages: [{ stageType: 'TRANSFER_CHECK', deadline: d('2026-11-03') }],
      }),
    ]);
    let { rows } = await service.getBoard(NOW);
    expect(cell(rows, 'CHUYEN_KIEM')).toMatchObject({
      need: 100,
      done: 70,
      status: 'ON_TRACK',
      deadline: '2026-11-03',
      reason: 'Đã kiểm 70/100 mảnh',
    });
    prisma.productionInvoiceItem.findMany.mockResolvedValue([
      item(1n, {
        stages: [{ stageType: 'TRANSFER_CHECK', deadline: d('2026-10-27') }],
      }),
    ]);
    rows = (await service.getBoard(NOW)).rows;
    expect(cell(rows, 'CHUYEN_KIEM')).toMatchObject({ status: 'LATE', daysLeft: -2 });
  });

  it('Chuyền kiểm: nguồn lỗi -> "Chưa biết"; không có mảnh -> "Không cần"', async () => {
    invoices.listTransferCheckPiecesBatch.mockRejectedValue(new Error('timeout'));
    let res = await service.getBoard(NOW);
    expect(res.failedSources).toEqual(['transfer-check']);
    expect(cell(res.rows, 'CHUYEN_KIEM').status).toBe('UNKNOWN');
    invoices.listTransferCheckPiecesBatch.mockResolvedValue({ '1': [] });
    res = await service.getBoard(NOW);
    expect(cell(res.rows, 'CHUYEN_KIEM').status).toBe('NA');
  });

  it('phoiStart / packagingStart = ngày đã lưu của PHOI_START / PACKAGING_START (null khi chưa có)', async () => {
    let { rows } = await service.getBoard(NOW);
    expect(rows[0]).toMatchObject({ phoiStart: null, packagingStart: null });
    prisma.productionInvoiceItem.findMany.mockResolvedValue([
      item(1n, {
        stages: [
          { stageType: 'PHOI_START', deadline: d('2026-10-26') },
          { stageType: 'PACKAGING_START', deadline: d('2026-11-18') },
        ],
      }),
    ]);
    rows = (await service.getBoard(NOW)).rows;
    expect(rows[0]).toMatchObject({ phoiStart: '2026-10-26', packagingStart: '2026-11-18' });
  });

  it('hạn mua VT khung chưa lưu thì theo hạn Khung (cùng chuỗi đề xuất mua đang dùng)', async () => {
    prisma.productionInvoiceItem.findMany.mockResolvedValue([
      item(1n, {
        materialDeadline: null,
        stages: [{ stageType: 'FRAME', deadline: d('2026-11-05') }],
      }),
    ]);
    const { rows } = await service.getBoard(NOW);
    expect(cell(rows, 'MUA_VT_KHUNG')).toMatchObject({
      deadline: '2026-11-05',
      status: 'ON_TRACK',
    });
  });

  it('chưa lưu hạn mua VT khung và không có mốc Khung -> theo hạn PI', async () => {
    prisma.productionInvoiceItem.findMany.mockResolvedValue([
      item(1n, { materialDeadline: null, stages: [] }),
    ]);
    const { rows } = await service.getBoard(NOW);
    expect(cell(rows, 'MUA_VT_KHUNG')).toMatchObject({
      deadline: '2026-11-15',
      status: 'ON_TRACK',
    });
  });

  it('dòng sắt mua theo cây: lý do ghi "cây" + chiều dài, không dùng đơn vị "Mm" của danh mục; tin sáng gộp theo id dòng mua', async () => {
    prisma.purchaseProposalItem.findMany.mockResolvedValue([
      purchase(30n, 'Sắt hộp 6zem', 32, 12, null, null, 5020),
    ]);
    const { rows } = await service.getBoard(NOW);
    expect(cell(rows, 'MUA_VT_KHUNG').reason).toBe('Sắt hộp 6zem (5.020 mm) 12/32 cây');
    expect(rows[0].missing.MUA_VT_KHUNG).toEqual([
      expect.objectContaining({ lineId: '3000', unit: 'cây' }),
    ]);
  });

  it('dây/nệm của dòng khác trong cùng PI không tính cho dòng này', async () => {
    prisma.productionInvoiceItem.findMany.mockResolvedValue([
      item(1n, { wireMaterialId: 40n }),
      item(2n, { wireMaterialId: 41n }),
    ]);
    weaving.getIssuePlanBatch.mockResolvedValue({ '10': [], '20': [] });
    batches.getBatchPlanBatch.mockResolvedValue({});
    prisma.purchaseProposalItem.findMany.mockResolvedValue([
      purchase(40n, 'Dây xám', 10, 10),
      purchase(41n, 'Dây nâu', 10, 0),
    ]);
    const { rows } = await service.getBoard(NOW);
    const sku1 = rows.find((r) => r.itemId === '1')!;
    const sku2 = rows.find((r) => r.itemId === '2')!;
    expect(sku1.milestones.find((m) => m.key === 'MUA_VT_KHUNG')!.status).toBe('DONE');
    expect(sku2.missing.MUA_VT_KHUNG.map((m) => m.name)).toEqual(['Dây nâu']);
  });

  it('bỏ PI đã huỷ và dòng của đơn bán đã ngừng / xoá', async () => {
    await service.getBoard(NOW);
    expect(
      (prisma.productionInvoiceItem.findMany.mock.calls[0] as [{ where: unknown }])[0].where,
    ).toMatchObject({
      productionInvoice: { status: { not: 'CANCELLED' } },
      OR: [{ salesOrderId: null }, { salesOrder: { isActive: true, deletedAt: null } }],
    });
  });

  it('dây riêng của dòng đã Kết thúc (không còn trên bảng) không tính sang dòng đang chạy', async () => {
    prisma.productionInvoiceItem.findMany.mockResolvedValueOnce([item(1n)]).mockResolvedValueOnce([
      { id: 1n, productionInvoiceId: 7n, wireMaterialId: null, cushionMaterialId: null },
      { id: 2n, productionInvoiceId: 7n, wireMaterialId: 41n, cushionMaterialId: null },
    ]);
    prisma.purchaseProposalItem.findMany.mockResolvedValue([
      purchase(30n, 'Sắt hộp', 60, 60),
      purchase(41n, 'Dây nâu', 10, 0),
    ]);
    const { rows } = await service.getBoard(NOW);
    expect(cell(rows, 'MUA_VT_KHUNG').status).toBe('DONE');
    expect(rows[0].missing.MUA_VT_KHUNG).toEqual([]);
  });

  it('kho nhận ghi đè trên dòng mua (bao bì về kho thành phẩm) thắng kho mặc định của vật tư', async () => {
    prisma.productionInvoiceItem.findMany.mockResolvedValue([
      item(1n, { finishedMaterialDeadline: d('2026-10-28') }),
    ]);
    prisma.purchaseProposalItem.findMany.mockResolvedValue([
      purchase(32n, 'Thùng carton', 50, 0, 'PACKAGING', 'kho-thanh-pham'),
    ]);
    const { rows } = await service.getBoard(NOW);
    expect(rows[0].missing.MUA_VT_CON_LAI).toEqual([
      expect.objectContaining({ name: 'Thùng carton', warehouseCode: 'kho-thanh-pham' }),
    ]);
  });

  it('PI thiếu trong kết quả tiến độ Phôi (hàm batch nuốt lỗi từng PI) -> báo nguồn lỗi, mốc Phôi "Chưa biết"', async () => {
    steelIssues.getPhoiProgressBatch.mockResolvedValue({});
    const { rows, failedSources } = await service.getBoard(NOW);
    expect(failedSources).toEqual(['phoi-progress']);
    expect(cell(rows, 'PHOI').status).toBe('UNKNOWN');
    expect(cell(rows, 'HAN').status).toBe('DUE_SOON');
  });

  it('1 nguồn lỗi chỉ làm mốc dựa vào nó thành "Chưa biết"', async () => {
    invoices.getPackagingBatch.mockRejectedValue(new Error('timeout'));
    const { rows, failedSources } = await service.getBoard(NOW);
    expect(failedSources).toEqual(['packaging']);
    expect(cell(rows, 'DONG_GOI').status).toBe('UNKNOWN');
    expect(cell(rows, 'HAN_GIAO').status).toBe('UNKNOWN');
    expect(cell(rows, 'PHOI').status).toBe('LATE');
  });

  // Phần A – Đợt 2: số LSX trên bảng mốc.
  describe('số LSX / mã lệnh hiển thị', () => {
    /** findMany của dòng SKU: truy vấn của loadLenhDisplayCodes (có where.lsxCode) trả `lsxRows`, còn lại trả `items`. */
    const mockItems = (
      items: unknown[],
      lsxRows: { productionInvoiceId: bigint; lsxCode: string }[],
    ) =>
      prisma.productionInvoiceItem.findMany.mockImplementation(
        (args: { where: Record<string, unknown> }) =>
          Promise.resolve('lsxCode' in args.where ? lsxRows : items),
      );

    it('dòng có lsxCode; displayCode của PI gộp = các LSX khác nhau nối " + " (1 lần đọc cho cả bảng)', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([{ id: 7n, code: 'PI-2026-001' }]);
      mockItems(
        [item(1n, { lsxCode: 'MY-313' }), item(2n, { lsxCode: 'GP-176' })],
        [
          { productionInvoiceId: 7n, lsxCode: 'MY-313' },
          { productionInvoiceId: 7n, lsxCode: 'GP-176' },
        ],
      );
      const { rows } = await service.getBoard(NOW);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.lsxCode).sort()).toEqual(['GP-176', 'MY-313']);
      expect(rows.every((r) => r.displayCode === 'MY-313 + GP-176')).toBe(true);
      expect(rows.every((r) => r.piCode === 'PI-2026-001')).toBe(true);
      expect(prisma.productionInvoice.findMany).toHaveBeenCalledTimes(1);
    });

    it('dòng chưa có LSX: lsxCode = null, displayCode = mã PI', async () => {
      prisma.productionInvoice.findMany.mockResolvedValue([{ id: 7n, code: 'PI-2026-001' }]);
      mockItems([item(1n, { lsxCode: null })], []);
      const { rows } = await service.getBoard(NOW);
      expect(rows[0]).toMatchObject({ lsxCode: null, displayCode: 'PI-2026-001' });
    });

    it('đọc số LSX lỗi thì bảng vẫn ra, displayCode rơi về mã PI', async () => {
      prisma.productionInvoice.findMany.mockRejectedValue(new Error('db'));
      const { rows } = await service.getBoard(NOW);
      expect(rows[0].displayCode).toBe('PI-2026-001');
    });
  });

  // Phần A – Đợt 9 (YC2)
  describe('pendingDeadlineChange', () => {
    it('dòng có yêu cầu đổi mốc chờ Sếp → true (1 truy vấn cho cả bảng), dòng khác → false', async () => {
      prisma.deadlineChangeRequest.findMany.mockResolvedValue([{ productionInvoiceItemId: 2n }]);
      prisma.productionInvoiceItem.findMany.mockResolvedValue([item(1n), item(2n)]);
      const { rows } = await service.getBoard(NOW);
      expect(rows.find((r) => r.itemId === '1')?.pendingDeadlineChange).toBe(false);
      expect(rows.find((r) => r.itemId === '2')?.pendingDeadlineChange).toBe(true);
      expect(prisma.deadlineChangeRequest.findMany).toHaveBeenCalledTimes(1);
    });

    it('đọc yêu cầu chờ lỗi thì bảng vẫn ra, coi như không có', async () => {
      prisma.deadlineChangeRequest.findMany.mockRejectedValue(new Error('db'));
      const { rows } = await service.getBoard(NOW);
      expect(rows[0].pendingDeadlineChange).toBe(false);
    });
  });

  describe('QLSX theo xưởng (2026-11-12)', () => {
    const whereOf = () =>
      (
        prisma.productionInvoiceItem.findMany.mock.calls[0] as [{ where: Record<string, unknown> }]
      )[0].where;

    it('QLSX Phước An: where có phạm vi XEM (xưởng mình + SKU chưa có xưởng); Phước An không sơn nhờ nên không thấy lệnh xưởng khác', async () => {
      await service.getBoard(NOW, 'qlsx-pa');

      expect(whereOf().AND).toEqual([{ OR: [{ workshopId: null }, { workshopId: { in: [2n] } }] }]);
    });

    it('QLSX Phú An: thấy thêm lệnh Phước An (sơn nhờ)', async () => {
      await service.getBoard(NOW, 'qlsx-phu');

      expect(whereOf().AND).toEqual([
        { OR: [{ workshopId: null }, { workshopId: { in: [1n, 2n] } }] },
      ]);
    });

    it('không có userId (tin sáng) hoặc user chưa gắn xưởng: không lọc', async () => {
      await service.getBoard(NOW);
      await service.getBoard(NOW, 'khsx');

      for (const call of prisma.productionInvoiceItem.findMany.mock.calls as [
        { where: Record<string, unknown> },
      ][]) {
        expect(call[0].where).not.toHaveProperty('AND');
      }
    });
  });
});
