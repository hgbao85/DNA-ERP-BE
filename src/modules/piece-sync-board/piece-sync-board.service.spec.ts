import { Prisma } from '../../generated/prisma/client';
import { WorkshopScopeService } from '../../common/workshop-scope/workshop-scope.service';
import { PieceSyncBoardService } from './piece-sync-board.service';
import { computePieceSync } from './piece-sync.util';

jest.mock('./piece-sync.util');

const mockedCompute = computePieceSync as jest.MockedFunction<typeof computePieceSync>;
const dec = (n: number) => new Prisma.Decimal(n);

// Lấy đối số `where` của lần gọi findMany thứ n (mock trả any nên gói lại 1 chỗ cho eslint).
const whereOf = (mock: jest.Mock, n = 0) =>
  (mock.mock.calls[n] as [{ where: Record<string, unknown> }])[0].where;

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

describe('PieceSyncBoardService', () => {
  // 09:00 sáng 04/11 giờ VN.
  const NOW = new Date('2026-11-04T02:00:00.000Z');
  let prisma: {
    productionInvoiceItem: { findMany: jest.Mock };
    floorReport: { findMany: jest.Mock };
    bomPiece: { findMany: jest.Mock };
    pieceBom: { findMany: jest.Mock };
    pieceMaterialYield: { findMany: jest.Mock };
  };
  let steelIssues: { getPhoiProgressBatch: jest.Mock };
  let batches: { getBatchPlanBatch: jest.Mock };
  let service: PieceSyncBoardService;
  // Số Phôi đồng bộ mà util giả trả về cho mọi mảnh.
  let phoiSynced: number | null;

  const item = (id: bigint, piId = 7n) => ({
    id,
    productionInvoiceId: piId,
    productionInvoice: { code: `PI-${piId}` },
    mfgProduct: { factoryCode: `SKU-${id}`, name: `Ghế ${id}` },
    productionOrder: { id: id * 10n, quantity: 10, bomRevisionId: id * 100n },
  });

  const bomPiece = (
    rev: bigint,
    pieceId: bigint,
    groupNumber: number,
    pieceNumber: number | null,
    code: string,
  ) => ({
    bomRevisionId: rev,
    pieceId,
    qtyPerUnit: 2,
    needsHan: true,
    piece: { id: pieceId, code, name: `Mảnh ${code}`, groupNumber, pieceNumber },
  });

  const pieceBom = (id: bigint, rev: bigint, pieceId: bigint, spec: bigint) => ({
    id,
    bomRevisionId: rev,
    pieceId,
    segmentSpecId: spec,
    qtyPerPiece: 2,
    processSteps: ['UON'],
    segmentSpec: {
      cutLengthMm: dec(452.7),
      material: { code: 'S1', name: 'Sắt hộp', spec: id === 12n ? null : '10x20' },
    },
  });

  beforeEach(() => {
    phoiSynced = 12;
    mockedCompute.mockReset();
    mockedCompute.mockImplementation((input) =>
      input.pieces.map((p) => ({
        pieceId: p.pieceId,
        requiredQty: p.qtyPerUnit * input.orderQuantity,
        phoiSyncedQty: phoiSynced,
        lines: input.lines
          .filter((l) => l.pieceId === p.pieceId)
          .map((l) => ({
            lineKey: l.lineKey,
            steps: ['CAT', 'UON'] as never,
            usableQty: 24,
            makeablePieces: 12,
            limitingStep: null,
          })),
      })),
    );
    prisma = {
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([item(1n)]) },
      floorReport: { findMany: jest.fn().mockResolvedValue([]) },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([
          // Cố ý xếp lộn: pieceNumber null phải về sau cùng nhóm, nhóm nhỏ trước.
          bomPiece(100n, 5n, 1, null, 'C'),
          bomPiece(100n, 4n, 2, 1, 'B'),
          bomPiece(100n, 3n, 1, 2, 'A2'),
          bomPiece(100n, 2n, 1, 1, 'A1'),
        ]),
      },
      pieceBom: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            pieceBom(11n, 100n, 2n, 900n),
            pieceBom(12n, 100n, 4n, 901n),
            pieceBom(13n, 100n, 99n, 902n),
          ]),
      },
      pieceMaterialYield: { findMany: jest.fn().mockResolvedValue([]) },
    };
    steelIssues = {
      getPhoiProgressBatch: jest.fn().mockResolvedValue({
        '7': [
          {
            segments: [
              {
                segmentSpecId: '900',
                byOrder: [
                  { productionOrderId: '10', done: 30, failed: 5 },
                  { productionOrderId: '20', done: 99, failed: 0 },
                ],
              },
              { segmentSpecId: '901', byOrder: [{ productionOrderId: '10', done: 2, failed: 9 }] },
            ],
            steps: [
              {
                step: 'UON',
                segments: [
                  {
                    segmentSpecId: '900',
                    byOrder: [{ productionOrderId: '10', done: 8, failed: 0 }],
                  },
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
              stage === 'HAN'
                ? [
                    { pieceId: '2', plannedQty: 20, passedQty: 5, awaitingQcQty: 3, openQty: 2 },
                    { pieceId: '4', plannedQty: 20, passedQty: 30, awaitingQcQty: 0, openQty: 0 },
                  ]
                : [{ pieceId: '2', plannedQty: 20, passedQty: 4, awaitingQcQty: 3, openQty: 1 }],
          },
        }),
      ),
    };
    service = new PieceSyncBoardService(
      prisma as never,
      steelIssues as never,
      batches as never,
      makeScope(),
    );
  });

  it('không có dòng -> bảng rỗng, không gọi nguồn tiến độ', async () => {
    prisma.productionInvoiceItem.findMany.mockResolvedValue([]);
    const board = await service.getBoard(undefined, NOW);
    expect(board).toMatchObject({ today: '2026-11-04', failedSources: [], rows: [] });
    expect(steelIssues.getPhoiProgressBatch).not.toHaveBeenCalled();
  });

  it('productionInvoiceIds đi vào where; không có thì chỉ đòi có PI', async () => {
    await service.getBoard(['7', '8'], NOW);
    expect(whereOf(prisma.productionInvoiceItem.findMany)).toMatchObject({
      prodApprovalStatus: 'APPROVED',
      productionInvoiceId: { in: [7n, 8n] },
    });
    await service.getBoard(undefined, NOW);
    expect(whereOf(prisma.productionInvoiceItem.findMany, 1).productionInvoiceId).toEqual({
      not: null,
    });
  });

  it('goodBySpecStep: Cắt + công đoạn phụ, trừ lỗi, không âm, đúng SKU; processSteps là của định mức', async () => {
    await service.getBoard(undefined, NOW);
    const input = mockedCompute.mock.calls[0][0];
    expect(Object.fromEntries(input.goodBySpecStep)).toEqual({
      '900:CAT': 25,
      '901:CAT': 0,
      '900:UON': 8,
    });
    expect(input.lines.length).toBeGreaterThan(0);
    expect(input.lines.every((l) => l.processSteps.join() === 'UON')).toBe(true);
  });

  it('PASSED_QC: chưa gửi / đang chờ KCS không vào số chính, chạy thêm lần "đã báo" cho phoiPendingQcQty', async () => {
    steelIssues.getPhoiProgressBatch.mockResolvedValue({
      '7': [
        {
          segments: [
            {
              segmentSpecId: '900',
              byOrder: [
                { productionOrderId: '10', done: 30, failed: 5, openQty: 6, awaitingQcQty: 4 },
              ],
            },
          ],
          steps: [
            {
              step: 'UON',
              segments: [
                {
                  segmentSpecId: '900',
                  byOrder: [
                    { productionOrderId: '10', done: 8, failed: 0, openQty: 2, awaitingQcQty: 1 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    // Util giả: số đồng bộ = nhỏ nhất của Cắt và Uốn.
    mockedCompute.mockImplementation((input) =>
      input.pieces.map((p) => ({
        pieceId: p.pieceId,
        requiredQty: 20,
        phoiSyncedQty: Math.min(
          input.goodBySpecStep.get('900:CAT') ?? 0,
          input.goodBySpecStep.get('900:UON') ?? 0,
        ),
        lines: [],
      })),
    );
    const board = await service.getBoard(undefined, NOW);
    expect(mockedCompute).toHaveBeenCalledTimes(2);
    // Lần 1 (số chính): chỉ đạt KCS. Lần 2: đã báo.
    expect(Object.fromEntries(mockedCompute.mock.calls[0][0].goodBySpecStep)).toMatchObject({
      '900:CAT': 15,
      '900:UON': 5,
    });
    expect(Object.fromEntries(mockedCompute.mock.calls[1][0].goodBySpecStep)).toMatchObject({
      '900:CAT': 25,
      '900:UON': 8,
    });
    expect(board.rows[0]).toMatchObject({ phoiSyncedQty: 5, phoiPendingQcQty: 3 });
  });

  it('dòng trả về có steps + limitingStep của util; dòng chỉ Cắt vẫn đúng', async () => {
    prisma.pieceBom.findMany.mockResolvedValue([
      { ...pieceBom(11n, 100n, 2n, 900n), processSteps: [] },
      pieceBom(12n, 100n, 4n, 901n),
    ]);
    mockedCompute.mockImplementation((input) =>
      input.pieces.map((p) => ({
        pieceId: p.pieceId,
        requiredQty: 20,
        phoiSyncedQty: 6,
        lines: input.lines
          .filter((l) => l.pieceId === p.pieceId)
          .map((l) =>
            l.processSteps.length === 0
              ? {
                  lineKey: l.lineKey,
                  steps: ['CAT'] as never,
                  usableQty: 12,
                  makeablePieces: 6,
                  limitingStep: null,
                }
              : {
                  lineKey: l.lineKey,
                  steps: ['CAT', 'UON'] as never,
                  usableQty: 12,
                  makeablePieces: 6,
                  limitingStep: 'UON' as never,
                },
          ),
      })),
    );
    const board = await service.getBoard(undefined, NOW);
    const a1 = board.rows.find((r) => r.pieceId === '2')!;
    const b = board.rows.find((r) => r.pieceId === '4')!;
    expect(a1.lines[0]).toMatchObject({ steps: ['CAT'], limitingStep: null, usableQty: 12 });
    expect(b.lines[0]).toMatchObject({ steps: ['CAT', 'UON'], limitingStep: 'UON' });
  });

  it('2 dòng cùng cỡ đoạn khác công đoạn: processSteps đúng từng dòng, bảng đoạn có khoá riêng từng công đoạn', async () => {
    prisma.pieceBom.findMany.mockResolvedValue([
      { ...pieceBom(11n, 100n, 2n, 900n), processSteps: [] },
      pieceBom(12n, 100n, 4n, 900n),
    ]);
    await service.getBoard(undefined, NOW);
    const input = mockedCompute.mock.calls[0][0];
    expect(input.lines.map((l) => [l.lineKey, l.segmentSpecId, l.processSteps])).toEqual([
      ['11', '900', []],
      ['12', '900', ['UON']],
    ]);
    expect(input.goodBySpecStep.get('900:CAT')).toBe(25);
    expect(input.goodBySpecStep.get('900:UON')).toBe(8);
  });

  it('hai lần chạy cho cùng kết quả thì phoiPendingQcQty = 0', async () => {
    const board = await service.getBoard(undefined, NOW);
    expect(board.rows[0].phoiPendingQcQty).toBe(0);
  });

  it('đợt chưa gắn SKU: không cộng, ghi PI vào unassignedPhoiPiIds (không trùng)', async () => {
    steelIssues.getPhoiProgressBatch.mockResolvedValue({
      '7': [
        {
          segments: [
            {
              segmentSpecId: '900',
              byOrder: [
                { productionOrderId: null, done: 6, failed: 0 },
                { productionOrderId: null, done: 0, failed: 0 },
                { productionOrderId: '10', done: 4, failed: 0 },
              ],
            },
          ],
          steps: [
            {
              step: 'UON',
              segments: [
                {
                  segmentSpecId: '900',
                  byOrder: [{ productionOrderId: null, done: 3, failed: 0 }],
                },
              ],
            },
          ],
        },
      ],
    });
    prisma.productionInvoiceItem.findMany.mockResolvedValue([item(1n), item(2n)]);
    prisma.bomPiece.findMany.mockResolvedValue([bomPiece(100n, 2n, 1, 1, 'A1')]);
    const board = await service.getBoard(undefined, NOW);
    expect(board.unassignedPhoiPiIds).toEqual(['7']);
    expect(Object.fromEntries(mockedCompute.mock.calls[0][0].goodBySpecStep)).toEqual({
      '900:CAT': 4,
    });
  });

  it('chỉ công đoạn phụ của đợt cũ chưa gắn SKU có số đã báo -> vẫn vào unassignedPhoiPiIds', async () => {
    steelIssues.getPhoiProgressBatch.mockResolvedValue({
      '7': [
        {
          segments: [],
          steps: [
            {
              step: 'UON',
              segments: [
                {
                  segmentSpecId: '900',
                  byOrder: [{ productionOrderId: null, done: 3, failed: 0 }],
                },
              ],
            },
          ],
        },
      ],
    });
    const board = await service.getBoard(undefined, NOW);
    expect(board.unassignedPhoiPiIds).toEqual(['7']);
    expect(mockedCompute.mock.calls[0][0].goodBySpecStep.size).toBe(0);
  });

  it('mảnh needsHan=false vẫn được chia đoạn nhưng không lên bảng; sắp theo nhóm, số mảnh (null sau), id', async () => {
    prisma.bomPiece.findMany.mockResolvedValue([
      bomPiece(100n, 5n, 1, null, 'C'),
      bomPiece(100n, 4n, 2, 1, 'B'),
      bomPiece(100n, 3n, 1, 2, 'A2'),
      bomPiece(100n, 2n, 1, 1, 'A1'),
      { ...bomPiece(100n, 99n, 3, 1, 'VTTP'), needsHan: false },
    ]);
    const board = await service.getBoard(undefined, NOW);
    expect(whereOf(prisma.bomPiece.findMany)).not.toHaveProperty('needsHan');
    expect(board.rows.map((r) => r.pieceCode)).toEqual(['A1', 'A2', 'C', 'B']);
    // Mảnh không qua Hàn (99) dùng chung cỡ đoạn thì phải được chia phần -> có trong đầu vào util.
    const input = mockedCompute.mock.calls[0][0];
    expect(input.pieces.map((p) => p.pieceId)).toContain('99');
    expect(input.lines.map((l) => l.lineKey)).toEqual(['11', '12', '13']);
  });

  it('SKU chỉ có mảnh không qua Hàn thì không lên bảng', async () => {
    prisma.bomPiece.findMany.mockResolvedValue([
      { ...bomPiece(100n, 99n, 1, 1, 'VTTP'), needsHan: false },
    ]);
    const board = await service.getBoard(undefined, NOW);
    expect(board.rows).toEqual([]);
  });

  it('selfCalc: số chính chỉ đếm đạt KCS, lần chạy "đã báo" cộng cả chờ KCS + chưa gửi; mảnh khác null', async () => {
    prisma.pieceMaterialYield.findMany.mockResolvedValue([{ bomRevisionId: 100n, pieceId: 2n }]);
    const board = await service.getBoard(undefined, NOW);
    expect(mockedCompute.mock.calls[0][0].pieces.map((p) => p.selfCalcPieceQty)).toEqual([
      4,
      null,
      null,
      null,
    ]);
    expect(mockedCompute.mock.calls[1][0].pieces.map((p) => p.selfCalcPieceQty)).toEqual([
      8,
      null,
      null,
      null,
    ]);
    expect(board.rows[0].selfCalcPieceQty).toBe(4);
    expect(board.rows[1].selfCalcPieceQty).toBeNull();
  });

  it('plan PHOI lỗi: mảnh có Sắt tự tính thành null, mảnh khác vẫn tính', async () => {
    prisma.pieceMaterialYield.findMany.mockResolvedValue([{ bomRevisionId: 100n, pieceId: 2n }]);
    batches.getBatchPlanBatch.mockImplementation((_ids: string[], stage: string) =>
      stage === 'PHOI'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ '10': { items: [] } }),
    );
    const board = await service.getBoard(undefined, NOW);
    expect(board.failedSources).toEqual(['production-batch-plan(PHOI)']);
    expect(board.rows[0]).toMatchObject({
      pieceCode: 'A1',
      phoiSyncedQty: null,
      syncPercent: null,
      notWeldedQty: null,
      phoiNotSyncedQty: null,
      hanAheadOfPhoi: false,
      selfCalcPieceQty: null,
      lines: [],
    });
    expect(board.rows[1].phoiSyncedQty).toBe(12);
  });

  it('hanDone chặn trần ở số cần và suy ra các trường', async () => {
    const board = await service.getBoard(undefined, NOW);
    // Mảnh 2 (A1): cần 20, Hàn 5+3+2=10, Phôi 12.
    expect(board.rows[0]).toMatchObject({
      pieceId: '2',
      requiredQty: 20,
      phoiSyncedQty: 12,
      syncPercent: 60,
      hanDoneQty: 10,
      notWeldedQty: 2,
      phoiNotSyncedQty: 8,
      hanAheadOfPhoi: false,
      lines: [
        {
          segmentSpecId: '900',
          materialCode: 'S1',
          materialName: 'Sắt hộp',
          materialSpec: '10x20',
          cutLengthMm: 452.7,
          qtyPerPiece: 2,
          steps: ['CAT', 'UON'],
          usableQty: 24,
          makeablePieces: 12,
          limitingStep: null,
        },
      ],
    });
    // Vật tư không khai spec (PieceBom 12 của mảnh 4) -> materialSpec null.
    expect(board.rows.find((r) => r.pieceId === '4')!.lines[0].materialSpec).toBeNull();
    // Mảnh 4 (B): Hàn báo 30 > cần 20 -> chặn 20, hơn Phôi 12 -> hanAheadOfPhoi.
    const b = board.rows.find((r) => r.pieceId === '4')!;
    expect(b).toMatchObject({ hanDoneQty: 20, notWeldedQty: 0, hanAheadOfPhoi: true });
  });

  it('hanToday cộng theo (SKU, mảnh), không âm, where loại lần báo bị huỷ', async () => {
    prisma.floorReport.findMany.mockResolvedValue([
      {
        productionBatch: { productionOrderId: 10n },
        lines: [
          { pieceId: 2n, qty: 4 },
          { pieceId: 4n, qty: 1 },
        ],
      },
      { productionBatch: { productionOrderId: 10n }, lines: [{ pieceId: 2n, qty: 3 }] },
      { productionBatch: { productionOrderId: 10n }, lines: [{ pieceId: 4n, qty: -5 }] },
    ]);
    const board = await service.getBoard(undefined, NOW);
    const today = (id: string) => board.rows.find((r) => r.pieceId === id)!.hanTodayQty;
    expect(today('2')).toBe(7);
    expect(today('4')).toBe(0);
    const where = whereOf(prisma.floorReport.findMany);
    expect(where).toMatchObject({
      kind: 'PIECE',
      reversalOfId: null,
      reversedBy: { is: null },
      productionBatch: { stage: 'HAN', productionOrderId: { in: [10n] } },
    });
    // 00:00 ngày 04/11 giờ VN = 17:00 UTC ngày 03/11.
    expect((where.createdAt as { gte: Date }).gte.toISOString()).toBe('2026-11-03T17:00:00.000Z');
  });

  it('nguồn Phôi lỗi: Phôi null, hanAheadOfPhoi=false, lines=[], các nguồn khác vẫn tính', async () => {
    steelIssues.getPhoiProgressBatch.mockRejectedValue(new Error('boom'));
    const board = await service.getBoard(undefined, NOW);
    expect(board.failedSources).toEqual(['phoi-progress']);
    expect(mockedCompute).not.toHaveBeenCalled();
    expect(board.rows[0]).toMatchObject({
      phoiSyncedQty: null,
      syncPercent: null,
      notWeldedQty: null,
      phoiNotSyncedQty: null,
      hanAheadOfPhoi: false,
      lines: [],
      hanDoneQty: 10,
    });
  });

  it('kết quả Phôi thiếu khoá PI -> coi như lỗi nguồn (không trùng nhãn)', async () => {
    steelIssues.getPhoiProgressBatch.mockResolvedValue({});
    const board = await service.getBoard(undefined, NOW);
    expect(board.failedSources).toEqual(['phoi-progress']);
    expect(board.rows[0].phoiSyncedQty).toBeNull();
  });

  it('nguồn Hàn / báo cáo lỗi: hanDone 0, hanToday 0, bảng vẫn trả', async () => {
    batches.getBatchPlanBatch.mockImplementation((_ids: string[], stage: string) =>
      stage === 'HAN'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ '10': { items: [] } }),
    );
    prisma.floorReport.findMany.mockRejectedValue(new Error('boom'));
    const board = await service.getBoard(undefined, NOW);
    expect(board.failedSources.sort()).toEqual(['floor-reports', 'production-batch-plan(HAN)']);
    expect(board.rows[0]).toMatchObject({ hanDoneQty: 0, hanTodayQty: 0, notWeldedQty: 12 });
  });

  it('sắp rows theo PI tăng rồi SKU tăng', async () => {
    prisma.productionInvoiceItem.findMany.mockResolvedValue([
      item(3n, 8n),
      item(2n, 7n),
      item(1n, 7n),
    ]);
    prisma.bomPiece.findMany.mockResolvedValue([
      bomPiece(100n, 2n, 1, 1, 'A1'),
      bomPiece(200n, 2n, 1, 1, 'A1'),
      bomPiece(300n, 2n, 1, 1, 'A1'),
    ]);
    steelIssues.getPhoiProgressBatch.mockResolvedValue({ '7': [], '8': [] });
    const board = await service.getBoard(undefined, NOW);
    expect(board.rows.map((r) => r.productionOrderId)).toEqual(['10', '20', '30']);
  });

  describe('QLSX theo xưởng (2026-11-12)', () => {
    const whereOf = () =>
      (
        prisma.productionInvoiceItem.findMany.mock.calls[0] as [{ where: Record<string, unknown> }]
      )[0].where;

    it('QLSX Phước An: chỉ lấy lệnh trong phạm vi XEM', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([]);
      await service.getBoard(undefined, NOW, 'qlsx-pa');

      expect(whereOf().AND).toEqual([{ OR: [{ workshopId: null }, { workshopId: { in: [2n] } }] }]);
    });

    it('QLSX Phú An: thêm lệnh Phước An; user chưa gắn xưởng: không lọc', async () => {
      prisma.productionInvoiceItem.findMany.mockResolvedValue([]);
      await service.getBoard(undefined, NOW, 'qlsx-phu');
      expect(whereOf().AND).toEqual([
        { OR: [{ workshopId: null }, { workshopId: { in: [1n, 2n] } }] },
      ]);

      prisma.productionInvoiceItem.findMany.mockClear();
      await service.getBoard(undefined, NOW, 'khsx');
      expect(whereOf()).not.toHaveProperty('AND');
    });
  });
});
