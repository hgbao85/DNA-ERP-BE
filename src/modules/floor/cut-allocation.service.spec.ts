import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type {
  WorkshopScope,
  WorkshopScopeService,
} from '../../common/workshop-scope/workshop-scope.service';
import type { PrismaServiceType } from '../../prisma/prisma.service';
import { CutAllocationService } from './cut-allocation.service';
import { CutSnapshotCache } from './cut-allocation-snapshot';

type Row = Record<string, unknown> & { id: bigint };

/** Ngày giờ UTC của 00:00 VN (UTC+7) ngày `ymd`. */
const vnDay = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);

describe('CutAllocationService', () => {
  const PHU_AN = { id: 5n, code: 'PHU_AN', name: 'Phú An', isActive: true };
  const unscoped: WorkshopScope = {
    workshopId: null,
    workshopName: null,
    visibleWorkshopIds: null,
  };

  let allocations: Row[];
  let nextId: bigint;
  let issued: number;
  let reserved: number;
  let machines: Array<Record<string, unknown>>;
  let scope: WorkshopScope;
  let db: Record<string, Record<string, jest.Mock> | jest.Mock>;
  let service: CutAllocationService;
  let guardRow: (id: bigint) => Row | null;
  /** true = kiểu cắt của phương án là kiểu cắt THEO BÓ (pattern.bundles != null, máy tự động). */
  let bundleOn: boolean;

  const m = (key: string): Record<string, jest.Mock> => db[key] as Record<string, jest.Mock>;

  const baseAllocation = (over: Partial<Row>): Row => ({
    id: nextId++,
    workshopId: 5n,
    workstationId: 2n,
    productionInvoiceId: 100n,
    cuttingProposalId: 70n,
    patternId: 200n,
    machineClass: 'TU_DONG',
    barCount: 5,
    punchedSegments: null,
    seq: 1,
    isManual: false,
    updatedById: null,
    ...over,
  });

  const createdData = () =>
    (
      m('cutAllocation').createManyAndReturn.mock.calls[0] as [
        { data: Array<Record<string, unknown>> },
      ]
    )[0].data;

  const callsCount = () =>
    Object.entries(db)
      .filter(([k]) => k !== '$transaction')
      .reduce(
        (s, [, v]) =>
          s +
          (jest.isMockFunction(v)
            ? v.mock.calls.length
            : Object.values(v).reduce((a, f) => a + f.mock.calls.length, 0)),
        0,
      );

  beforeEach(() => {
    allocations = [];
    bundleOn = false;
    nextId = 1n;
    issued = 6;
    reserved = 4;
    scope = unscoped;
    machines = [
      { id: 1n, code: 'L1', name: 'Laze 1', cutMachineType: 'laser' },
      { id: 2n, code: 'T1', name: 'Tự động 1', cutMachineType: 'tu_dong' },
    ];
    // Dòng + quan hệ dùng cho kiểm tra "dòng cũ" của PATCH/split/reorder.
    guardRow = (id) => {
      const r = allocations.find((x) => x.id === id);
      if (!r) return null;
      return {
        ...r,
        cuttingProposal: { status: 'APPROVED' },
        workstation: { isActive: true, kind: 'CUT', workshopId: r.workshopId },
        pattern: { barCount: 10, bundles: bundleOn ? { '16': 3, '1': 1 } : null },
        productionInvoice: { status: 'PRODUCING', floorQueueEntries: [], items: [{ id: 1n }] },
      };
    };

    const proposal = {
      id: 70n,
      productionInvoiceId: 100n,
      productionOrder: null,
      productionInvoice: { items: [{ productionOrder: { bomRevisionId: 5n, quantity: 2 } }] },
      items: [],
      lines: [
        {
          id: 1n,
          materialId: 7n,
          totalBars: 10,
          bestStockLengthMm: 6000,
          machine: 'laser',
          pieceSummary: [
            { size: 425, demand: 20, produced: 22, names: ['chân'] },
            { size: 300, demand: 5, produced: 5, names: ['thanh'] },
          ],
          material: { id: 7n, code: 'S1', name: 'Sắt hộp', spec: '25x50' },
          patterns: [
            {
              id: 200n,
              patternIndex: 0,
              barCount: 10,
              wastePerBarMm: 12.5,
              get bundles() {
                return bundleOn ? { '16': 3, '1': 1 } : null;
              },
              segments: [{ countPerBar: 2, segmentSpec: { cutLengthMm: 425 } }],
            },
          ],
        },
      ],
    };

    db = {
      // Khoá advisory (tagged template) + setSeqBulk (Prisma.Sql: UPDATE ... FROM (VALUES (id,
      // seq), ...)) - áp seq vào mảng giả.
      $executeRaw: jest.fn((q: unknown) => {
        const sql = q as { sql?: unknown; values?: unknown[] };
        if (typeof sql?.sql === 'string' && sql.sql.includes('UPDATE "cut_allocations"')) {
          const v = sql.values ?? [];
          for (let i = 0; i + 1 < v.length; i += 2) {
            const row = allocations.find((a) => a.id === v[i]);
            if (row) row.seq = Number(v[i + 1]);
          }
        }
        return Promise.resolve(0);
      }),
      $queryRaw: jest.fn().mockResolvedValue([
        {
          workstationId: 1n,
          productionInvoiceId: 100n,
          materialId: 7n,
          cutLengthMm: 425,
          qty: 30,
        },
      ]),
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(db)),
      workshop: { findUnique: jest.fn().mockResolvedValue(PHU_AN) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ solverMachineByWorkshop: {} }) },
      workstation: {
        findMany: jest.fn(() => Promise.resolve(machines)),
        findUnique: jest.fn(({ where }: { where: { id: bigint } }) =>
          Promise.resolve(
            where.id === 1n
              ? { workshopId: 5n, kind: 'CUT', isActive: true, cutMachineType: 'laser' }
              : where.id === 2n
                ? { workshopId: 5n, kind: 'CUT', isActive: true, cutMachineType: 'tu_dong' }
                : where.id === 3n
                  ? { workshopId: 9n, kind: 'CUT', isActive: true, cutMachineType: 'laser' }
                  : null,
          ),
        ),
        count: jest.fn().mockResolvedValue(1),
      },
      productionInvoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 100n,
            code: 'PI-100',
            deadline: vnDay('2026-11-30'),
            items: [
              {
                stages: [{ deadline: vnDay('2026-11-14') }],
                bookingLines: [
                  { booking: { pickupDate: new Date('2026-11-20T00:00:00Z'), cutOffAt: null } },
                ],
              },
            ],
          },
        ]),
      },
      cuttingProposal: { findMany: jest.fn().mockResolvedValue([proposal]) },
      steelIssue: {
        groupBy: jest.fn(() =>
          Promise.resolve([
            { productionInvoiceId: 100n, materialId: 7n, _sum: { barCount: issued } },
          ]),
        ),
      },
      stockReservation: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              productionInvoiceId: 100n,
              materialId: 7n,
              quantity: { toNumber: () => reserved + 1 },
              consumedQty: { toNumber: () => 1 },
              warehouse: { code: 'KHO-SAT' },
            },
          ]),
        ),
      },
      productionOrder: { findMany: jest.fn().mockResolvedValue([]) },
      cutAllocationLog: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      cuttingProposalPattern: { findMany: jest.fn().mockResolvedValue([]) },
      pieceBom: {
        findMany: jest.fn().mockResolvedValue([
          {
            bomRevisionId: 5n,
            pieceId: 1n,
            qtyPerPiece: 2,
            processSteps: ['UON', 'DAP'],
            segmentSpec: { materialId: 7n, cutLengthMm: { toNumber: () => 425 } },
          },
        ]),
      },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([{ bomRevisionId: 5n, pieceId: 1n, qtyPerUnit: 1 }]),
      },
      cutAllocation: {
        findMany: jest.fn((args: { where: { workstationId?: bigint } }) => {
          if (args.where.workstationId != null) {
            return Promise.resolve(
              allocations
                .filter((a) => a.workstationId === args.where.workstationId)
                .map((a) => guardRow(a.id)),
            );
          }
          return Promise.resolve(allocations.map((a) => ({ ...a })));
        }),
        findUnique: jest.fn((args: { where: { id: bigint }; include?: unknown }) =>
          Promise.resolve(
            args.include
              ? guardRow(args.where.id)
              : (allocations.find((a) => a.id === args.where.id) ?? null),
          ),
        ),
        deleteMany: jest.fn(({ where }: { where: { id: { in: bigint[] } | bigint } }) => {
          const ids = typeof where.id === 'bigint' ? [where.id] : where.id.in;
          allocations = allocations.filter((a) => !ids.includes(a.id));
          return Promise.resolve({ count: ids.length });
        }),
        createManyAndReturn: jest.fn(({ data }: { data: Array<Record<string, unknown>> }) => {
          const created = data.map((d) => ({ ...d, id: nextId++, updatedById: null }));
          allocations.push(...created);
          return Promise.resolve(created);
        }),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const row = { ...data, id: nextId++ } as Row;
          allocations.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn(
          ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
            const row = allocations.find((a) => a.id === where.id)!;
            Object.assign(row, data);
            return Promise.resolve(row);
          },
        ),
        aggregate: jest.fn().mockResolvedValue({ _max: { seq: 3 } }),
      },
    };

    service = new CutAllocationService(
      db as unknown as PrismaServiceType,
      { getScope: jest.fn(() => Promise.resolve(scope)) } as unknown as WorkshopScopeService,
    );
  });

  describe('getBoard', () => {
    it('dựng bảng: máy, dòng (đúng tên trường hợp đồng), chưa chia, tiến độ xấp xỉ', async () => {
      allocations = [
        baseAllocation({
          workstationId: 1n,
          machineClass: 'LASER',
          barCount: 2,
          punchedSegments: [{ cutLengthMm: 425, countPerBar: 2 }],
          seq: 1,
        }),
        baseAllocation({ workstationId: 2n, barCount: 5, seq: 1, isManual: true }),
      ];

      const board = await service.getBoard('u1', '5');

      expect(board.workshop).toEqual({
        id: '5',
        code: 'PHU_AN',
        name: 'Phú An',
        laserAllowed: true,
      });
      expect(board.machines).toEqual([
        {
          id: '1',
          code: 'L1',
          name: 'Laze 1',
          cutMachineType: 'laser',
          totalBars: 2,
          rowCount: 1,
          plannedSegments: 4,
          reportedSegments: 30,
          barsDoneEst: 2,
          barsLeftEst: 0,
          status: 'IDLE',
        },
        {
          id: '2',
          code: 'T1',
          name: 'Tự động 1',
          cutMachineType: 'tu_dong',
          totalBars: 5,
          rowCount: 1,
          plannedSegments: 10,
          reportedSegments: 0,
          barsDoneEst: 0,
          barsLeftEst: 5,
          status: 'LOW',
        },
      ]);
      expect(board.rows).toHaveLength(2);
      expect(board.rows[0]).toEqual({
        id: '1',
        workstationId: '1',
        seq: 1,
        isManual: false,
        productionInvoiceId: '100',
        piCode: 'PI-100',
        priority: { phoiStart: '2026-11-14', bookingDue: '2026-11-20', deadline: '2026-11-30' },
        cuttingProposalId: '70',
        patternId: '200',
        patternIndex: 0,
        patternBarCount: 10,
        materialId: '7',
        materialCode: 'S1',
        materialLabel: 'Sắt hộp · 25x50',
        barLengthMm: 6000,
        lineMachine: 'laser',
        machineClass: 'LASER',
        barCount: 2,
        segments: [
          { cutLengthMm: 425, countPerBar: 2, steps: ['UON', 'DAP'], pieceNames: ['chân'] },
        ],
        punchedSegments: [{ cutLengthMm: 425, countPerBar: 2 }],
        bundles: null,
        isBundle: false,
        wastePerBarMm: 12.5,
        lineSurplus: [{ cutLengthMm: 425, surplus: 2 }],
        hasBend: true,
        barsDoneEst: 2,
        allowedMachineIds: ['1'],
      });
      expect(board.rows[1].barsDoneEst).toBe(0);
      expect(board.rows[1].punchedSegments).toBeNull();
      expect(board.rows[1].isManual).toBe(true);
      // 10 cây của kiểu cắt − 7 đã chia
      expect(board.unallocated).toEqual([
        {
          productionInvoiceId: '100',
          piCode: 'PI-100',
          materialId: '7',
          materialLabel: 'Sắt hộp · 25x50',
          bars: 3,
        },
      ]);
      expect(board.waiting).toEqual([]);
      expect(board.staleCount).toBe(0);
      expect(board.warnings).toEqual([]);
    });

    it('không ghi gì và chỉ dùng <= 12 truy vấn', async () => {
      await service.getBoard('u1', '5');
      expect(m('cutAllocation').createManyAndReturn).not.toHaveBeenCalled();
      expect(m('cutAllocation').deleteMany).not.toHaveBeenCalled();
      expect(m('cutAllocation').update).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
      // +1 truy vấn phạm vi xưởng (WorkshopScopeService) nằm ngoài mock db
      expect(callsCount() + 1).toBeLessThanOrEqual(12);
    });

    it('chưa đủ sắt -> waiting, không vào chưa chia', async () => {
      issued = 3;
      reserved = 2; // 5 < 10
      const board = await service.getBoard('u1', '5');
      expect(board.unallocated).toEqual([]);
      expect(board.waiting).toEqual([
        {
          productionInvoiceId: '100',
          piCode: 'PI-100',
          materialId: '7',
          materialLabel: 'Sắt hộp · 25x50',
          requiredBars: 10,
          availableBars: 5,
          shortBars: 5,
          heldElsewhereBars: 0,
        },
      ]);
    });

    it('sắt còn giữ ở kho xưởng khác (lệnh vừa đổi xưởng, chưa chuyển kho) không tính đủ sắt -> waiting', async () => {
      issued = 3;
      m('stockReservation').findMany.mockResolvedValue([
        {
          productionInvoiceId: 100n,
          materialId: 7n,
          quantity: { toNumber: () => 7 },
          consumedQty: { toNumber: () => 0 },
          warehouse: { code: 'KHO-PHOI-PHA', workshopId: 6n },
        },
      ]);
      const board = await service.getBoard('u1', '5');
      expect(board.unallocated).toEqual([]);
      expect(board.waiting).toEqual([
        expect.objectContaining({
          piCode: 'PI-100',
          availableBars: 3,
          shortBars: 7,
          heldElsewhereBars: 7,
        }),
      ]);
    });

    it('heldElsewhereBars chỉ cộng phần còn lại của giữ chỗ kho xưởng khác, kho khác xưởng nữa cộng dồn', async () => {
      issued = 3;
      const reservation = (qty: number, consumed: number, workshopId: bigint | null) => ({
        productionInvoiceId: 100n,
        materialId: 7n,
        quantity: { toNumber: () => qty },
        consumedQty: { toNumber: () => consumed },
        warehouse: { code: 'K', workshopId },
      });
      m('stockReservation').findMany.mockResolvedValue([
        reservation(5, 2, 6n),
        reservation(4, 0, 9n),
        reservation(2, 5, 6n), // đã tiêu quá: không âm
        reservation(1, 0, 5n), // kho của chính xưởng: tính vào availableBars
      ]);
      const board = await service.getBoard('u1', '5');
      expect(board.waiting).toEqual([
        expect.objectContaining({ availableBars: 4, heldElsewhereBars: 7 }),
      ]);
    });

    it('sắt giữ ở kho của chính xưởng hoặc kho không gắn xưởng vẫn tính đủ sắt', async () => {
      issued = 3;
      m('stockReservation').findMany.mockResolvedValue([
        {
          productionInvoiceId: 100n,
          materialId: 7n,
          quantity: { toNumber: () => 4 },
          consumedQty: { toNumber: () => 0 },
          warehouse: { code: 'KHO-PHOI-PA', workshopId: 5n },
        },
        {
          productionInvoiceId: 100n,
          materialId: 7n,
          quantity: { toNumber: () => 3 },
          consumedQty: { toNumber: () => 0 },
          warehouse: { code: 'KHO-CHUNG', workshopId: null },
        },
      ]);
      const board = await service.getBoard('u1', '5');
      expect(board.waiting).toEqual([]);
      expect(board.unallocated).toEqual([expect.objectContaining({ piCode: 'PI-100' })]);
    });

    it('đã "Chia luôn" đủ cây thì không còn nằm ở chờ sắt', async () => {
      issued = 3;
      reserved = 2; // 5 < 10: chưa đủ sắt
      allocations = [
        baseAllocation({ workstationId: 1n, machineClass: 'LASER', barCount: 2, isManual: true }),
        baseAllocation({ workstationId: 2n, barCount: 8, isManual: true }),
      ];
      const board = await service.getBoard('u1', '5');
      expect(board.waiting).toEqual([]);
      expect(board.unallocated).toEqual([]);
    });

    it('dòng cũ (máy đã ngừng / pattern không còn) không hiện, đếm vào staleCount', async () => {
      allocations = [
        baseAllocation({ workstationId: 99n }),
        baseAllocation({ patternId: 999n }),
        baseAllocation({ workstationId: 2n, barCount: 4 }),
      ];
      const board = await service.getBoard('u1', '5');
      expect(board.rows).toHaveLength(1);
      expect(board.staleCount).toBe(2);
    });

    it('xưởng khoá máy tự động: laserAllowed = false', async () => {
      m('systemConfig').findUnique.mockResolvedValue({
        solverMachineByWorkshop: { PHU_AN: 'tu_dong' },
      });
      const board = await service.getBoard('u1', '5');
      expect(board.workshop.laserAllowed).toBe(false);
    });

    it('xưởng chưa khai máy cắt: bảng rỗng kèm cảnh báo', async () => {
      machines = [];
      const board = await service.getBoard('u1', '5');
      expect(board.machines).toEqual([]);
      expect(board.warnings[0]).toContain('chưa khai máy cắt');
    });
  });

  describe('allowedMachineIds (máy được vào của từng dòng)', () => {
    const laserRow = () =>
      baseAllocation({ workstationId: 1n, machineClass: 'LASER', barCount: 2, seq: 1 });
    const autoRow = () => baseAllocation({ workstationId: 2n, barCount: 5, seq: 2 });

    /** Kết quả thật của validate đổi máy: true nếu BE nhận. */
    const accepted = async (rowId: string, machineId: string): Promise<boolean> =>
      service.update('u1', rowId, { workstationId: machineId }).then(
        () => true,
        () => false,
      );

    it('dòng LASER không vào máy tự động khi xưởng có laze; dòng TU_DONG vào mọi máy', async () => {
      allocations = [laserRow(), autoRow()];
      const board = await service.getBoard('u1', '5');
      expect(board.rows.find((r) => r.machineClass === 'LASER')!.allowedMachineIds).toEqual(['1']);
      expect(board.rows.find((r) => r.machineClass === 'TU_DONG')!.allowedMachineIds).toEqual([
        '1',
        '2',
      ]);
    });

    it('xưởng khoá máy tự động: dòng LASER vào được mọi máy', async () => {
      m('systemConfig').findUnique.mockResolvedValue({
        solverMachineByWorkshop: { PHU_AN: 'tu_dong' },
      });
      allocations = [laserRow()];
      const board = await service.getBoard('u1', '5');
      expect(board.rows[0].allowedMachineIds).toEqual(['1', '2']);
    });

    it('xưởng chỉ có máy tự động: dòng LASER vẫn vào được máy tự động', async () => {
      machines = [{ id: 2n, code: 'T1', name: 'Tự động 1', cutMachineType: 'tu_dong' }];
      m('workstation').count.mockResolvedValue(0);
      allocations = [baseAllocation({ workstationId: 2n, machineClass: 'LASER', seq: 1 })];
      const board = await service.getBoard('u1', '5');
      expect(board.rows[0].allowedMachineIds).toEqual(['2']);
    });

    it('chỉ lấy máy cắt đang dùng của xưởng (máy ngừng dùng không có trong danh sách)', async () => {
      allocations = [autoRow()];
      await service.getBoard('u1', '5');
      expect(m('workstation').findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            kind: 'CUT',
            workshopId: 5n,
          }) as unknown,
        }),
      );
    });

    it('khớp đúng với validate đổi máy của BE (cùng một luật) ở cả 3 cấu hình xưởng', async () => {
      allocations = [laserRow(), autoRow()];
      for (const [id, machineClassRowId] of [
        ['1', 'LASER'],
        ['2', 'TU_DONG'],
      ] as const) {
        const board = await service.getBoard('u1', '5');
        const row = board.rows.find((r) => r.machineClass === machineClassRowId)!;
        for (const target of ['1', '2']) {
          expect(await accepted(id, target)).toBe(row.allowedMachineIds.includes(target));
        }
      }
      m('systemConfig').findUnique.mockResolvedValue({
        solverMachineByWorkshop: { PHU_AN: 'tu_dong' },
      });
      const locked = (await service.getBoard('u1', '5')).rows.find(
        (r) => r.machineClass === 'LASER',
      )!;
      for (const target of ['1', '2']) {
        expect(await accepted('1', target)).toBe(locked.allowedMachineIds.includes(target));
      }
    });
  });

  describe('snapshot dùng chung theo lượt quét (CutSnapshotCache)', () => {
    const proposalLoads = () => m('cuttingProposal').findMany.mock.calls.length;

    beforeEach(() => {
      allocations = [baseAllocation({ workstationId: 2n, barCount: 5, seq: 1 })];
    });

    it('không có cache: mỗi lần đọc nạp lại snapshot', async () => {
      await service.machineProgressByWorkshop(5n);
      await service.steelGapsByPi(5n);
      expect(proposalLoads()).toBe(2);
    });

    it('có cache: machineProgressByWorkshop + steelGapsByPi chỉ nạp snapshot 1 lần / xưởng', async () => {
      const cache = new CutSnapshotCache();
      const progress = await service.machineProgressByWorkshop(5n, cache);
      const gaps = await service.steelGapsByPi(5n, cache);
      expect(proposalLoads()).toBe(1);
      expect(progress).toHaveLength(2);
      expect(gaps.get('100')).toBeDefined();
    });

    it('bỏ cache của xưởng thì lần đọc sau nạp lại', async () => {
      const cache = new CutSnapshotCache();
      await service.machineProgressByWorkshop(5n, cache);
      cache.invalidate(5n);
      await service.steelGapsByPi(5n, cache);
      expect(proposalLoads()).toBe(2);
    });

    it('autoPull không dùng cache: tự nạp snapshot trong transaction', async () => {
      const cache = new CutSnapshotCache();
      await service.machineProgressByWorkshop(5n, cache);
      await service.autoPull(5n, ['1']);
      expect(proposalLoads()).toBe(2);
    });
  });

  describe('phạm vi xưởng', () => {
    it('QLSX chung không gửi workshopId -> 400', async () => {
      await expect(service.getBoard('u1')).rejects.toThrow(
        new BadRequestException('Chọn xưởng để chia máy cắt'),
      );
    });

    it('QLSX có xưởng: không gửi workshopId thì dùng xưởng của họ', async () => {
      scope = { workshopId: 5n, workshopName: 'Phú An', visibleWorkshopIds: [5n] };
      const board = await service.getBoard('u1');
      expect(board.workshop.id).toBe('5');
    });

    it('QLSX có xưởng gửi xưởng khác -> 403', async () => {
      scope = { workshopId: 5n, workshopName: 'Phú An', visibleWorkshopIds: [5n] };
      await expect(service.getBoard('u1', '9')).rejects.toThrow(
        new ForbiddenException('Bạn chỉ chia máy cắt cho Xưởng Phú An'),
      );
    });

    it('route theo :id: dòng thuộc xưởng khác -> 403', async () => {
      scope = { workshopId: 9n, workshopName: 'Phước An', visibleWorkshopIds: [9n] };
      allocations = [baseAllocation({})];
      await expect(service.remove('u1', '1')).rejects.toThrow(ForbiddenException);
    });

    it('xưởng không tồn tại / đã ngừng -> 400', async () => {
      m('workshop').findUnique.mockResolvedValue({ ...PHU_AN, isActive: false });
      await expect(service.getBoard('u1', '5')).rejects.toThrow(BadRequestException);
      m('workshop').findUnique.mockResolvedValue(null);
      await expect(service.getBoard('u1', '5')).rejects.toThrow(BadRequestException);
    });
  });

  describe('auto', () => {
    it('append: chia phần còn lại, cây dập vào máy laze, cây không dập vào máy tự động, xếp lại seq', async () => {
      const board = await service.auto('u1', { workshopId: '5', mode: 'append' });

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$executeRaw).toHaveBeenCalled(); // khoá advisory
      const data = createdData();
      expect(data).toHaveLength(2);
      const laser = data.find((d) => d.machineClass === 'LASER')!;
      const tu = data.find((d) => d.machineClass === 'TU_DONG')!;
      // 4 đoạn dập (1 mảnh × 2 đoạn × 2 bộ) = 2 cây × 2 đoạn dập; còn 8 cây không dập
      expect(laser).toMatchObject({
        workstationId: 1n,
        barCount: 2,
        isManual: false,
        workshopId: 5n,
      });
      expect(laser.punchedSegments).toEqual([{ cutLengthMm: 425, countPerBar: 2 }]);
      expect(tu).toMatchObject({ workstationId: 2n, barCount: 8 });
      expect(tu.punchedSegments).toBe(Prisma.DbNull);
      expect(board.rows.map((r) => [r.workstationId, r.seq, r.barCount])).toEqual([
        ['1', 1, 2],
        ['2', 1, 8],
      ]);
      expect(board.unallocated).toEqual([]);
      // seq đặt hàng loạt bằng 1 câu UPDATE, không cập nhật từng dòng.
      expect(m('cutAllocation').update).not.toHaveBeenCalled();
    });

    it('không chia quá số cây của kiểu cắt khi dòng sửa tay đã lấn sang lớp máy kia', async () => {
      // Kiểu cắt 10 cây = 2 LASER + 8 TU_DONG; QLSX đã để cả 10 cây ở dòng LASER.
      allocations = [
        baseAllocation({
          workstationId: 1n,
          machineClass: 'LASER',
          barCount: 10,
          isManual: true,
          punchedSegments: [{ cutLengthMm: 425, countPerBar: 2 }],
        }),
      ];
      const board = await service.auto('u1', { workshopId: '5', mode: 'append' });
      expect(m('cutAllocation').createManyAndReturn).not.toHaveBeenCalled();
      expect(board.rows.reduce((s, r) => s + r.barCount, 0)).toBe(10);
      expect(board.unallocated).toEqual([]);
    });

    it('hệ thống tự chia (auto) không ghi nhật ký', async () => {
      await service.auto('u1', { workshopId: '5', mode: 'append' });
      expect(m('cutAllocationLog').createMany).not.toHaveBeenCalled();
      expect(m('cutAllocationLog').create).not.toHaveBeenCalled();
    });

    it('append giữ dòng đang có, chỉ chia phần cây chưa có dòng', async () => {
      allocations = [baseAllocation({ workstationId: 2n, barCount: 3, seq: 1, isManual: true })];
      await service.auto('u1', { workshopId: '5', mode: 'append' });
      const data = createdData();
      // TU_DONG: 8 − 3 đang giữ = 5
      expect(data.find((d) => d.machineClass === 'TU_DONG')).toMatchObject({ barCount: 5 });
      expect(m('cutAllocation').deleteMany).not.toHaveBeenCalled();
    });

    it('redo xoá dòng tự chia, giữ dòng sửa tay', async () => {
      allocations = [
        baseAllocation({ workstationId: 2n, barCount: 3, seq: 1, isManual: true }),
        baseAllocation({ workstationId: 2n, barCount: 4, seq: 2, isManual: false }),
      ];
      await service.auto('u1', { workshopId: '5', mode: 'redo' });
      expect(m('cutAllocation').deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2n] } } });
      const data = createdData();
      expect(data.find((d) => d.machineClass === 'TU_DONG')).toMatchObject({ barCount: 5 });
    });

    it('xoá dòng cũ (stale) trước khi chia', async () => {
      allocations = [baseAllocation({ workstationId: 99n, barCount: 4 })];
      const board = await service.auto('u1', { workshopId: '5', mode: 'append' });
      expect(m('cutAllocation').deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1n] } } });
      expect(board.staleCount).toBe(0);
    });

    it('chưa đủ sắt: không tự chia', async () => {
      issued = 1;
      reserved = 1;
      const board = await service.auto('u1', { workshopId: '5', mode: 'append' });
      expect(m('cutAllocation').createManyAndReturn).not.toHaveBeenCalled();
      expect(board.waiting).toHaveLength(1);
    });

    it('xưởng chưa có máy cắt đang dùng -> 400', async () => {
      machines = [];
      await expect(service.auto('u1', { workshopId: '5', mode: 'append' })).rejects.toThrow(
        'Xưởng Phú An chưa khai máy cắt (Sản lượng xưởng › Máy & tem QR)',
      );
    });

    it('xưởng khoá máy tự động: mọi cây vào máy tự động', async () => {
      m('systemConfig').findUnique.mockResolvedValue({
        solverMachineByWorkshop: { PHU_AN: 'tu_dong' },
      });
      machines = [{ id: 2n, code: 'T1', name: 'Tự động 1', cutMachineType: 'tu_dong' }];
      await service.auto('u1', { workshopId: '5', mode: 'append' });
      const data = createdData();
      expect(data.every((d) => d.workstationId === 2n)).toBe(true);
      expect(data.find((d) => d.machineClass === 'LASER')).toMatchObject({ barCount: 2 });
    });
  });

  describe('add', () => {
    it('chia ngay (lệnh, loại sắt) dù chưa thấy đủ sắt', async () => {
      issued = 0;
      reserved = 0;
      const board = await service.add('u1', {
        workshopId: '5',
        productionInvoiceId: '100',
        materialId: '7',
      });
      expect(m('cutAllocation').createManyAndReturn).toHaveBeenCalledTimes(1);
      expect(board.rows).toHaveLength(2);
      // Quyết định của QLSX: "Chia lại" giữ các dòng này như dòng sửa tay.
      expect(createdData().every((d) => d.isManual === true && d.updatedById === 'u1')).toBe(true);
      // Sắt chưa đủ nhưng đã chia đủ cây: không còn nhắc ở chờ sắt.
      expect(board.waiting).toEqual([]);
      // "Chia luôn" là sửa tay: mỗi dòng tạo ra có 1 dòng nhật ký ADD, cùng transaction.
      const logs = (
        m('cutAllocationLog').createMany.mock.calls[0] as [{ data: Array<Record<string, unknown>> }]
      )[0].data;
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.action === 'ADD' && l.createdById === 'u1')).toBe(true);
      expect(logs.every((l) => l.isBundle === false && l.productionInvoiceId === 100n)).toBe(true);
    });

    it('cặp không có kiểu cắt nào của lệnh trong xưởng -> 400', async () => {
      await expect(
        service.add('u1', { workshopId: '5', productionInvoiceId: '100', materialId: '8' }),
      ).rejects.toThrow(BadRequestException);
      expect(m('cutAllocation').createManyAndReturn).not.toHaveBeenCalled();
    });
  });

  describe('update (PATCH)', () => {
    beforeEach(() => {
      allocations = [
        baseAllocation({ workstationId: 2n, barCount: 5, seq: 1 }),
        baseAllocation({ workstationId: 1n, machineClass: 'LASER', barCount: 2, seq: 1 }),
      ];
    });

    it('đổi máy: isManual, updatedById, seq cuối máy mới', async () => {
      // dòng 1 (TU_DONG) sang máy laze
      await service.update('u1', '1', { workstationId: '1' });
      expect(allocations[0]).toMatchObject({
        workstationId: 1n,
        seq: 4,
        isManual: true,
        updatedById: 'u1',
      });
    });

    it('đổi số cây trong giới hạn (còn trống 3 cây)', async () => {
      await service.update('u1', '1', { barCount: 8 });
      expect(allocations[0]).toMatchObject({ barCount: 8, isManual: true });
    });

    const loggedActions = () =>
      m('cutAllocationLog').createMany.mock.calls.flatMap(
        (c) => (c as [{ data: Array<Record<string, unknown>> }])[0].data,
      );

    it('đổi máy ghi MOVE (kèm lý do + ghi chú), đổi số cây ghi BARS, đổi cả hai ghi 2 dòng', async () => {
      await service.update('u1', '1', { workstationId: '1', reason: 'OTHER', note: ' cần gấp ' });
      expect(loggedActions()).toEqual([
        expect.objectContaining({
          action: 'MOVE',
          fromWorkstationId: 2n,
          toWorkstationId: 1n,
          barCount: 5,
          reason: 'OTHER',
          note: 'cần gấp',
          isBundle: false,
          cutAllocationId: 1n,
          productionInvoiceId: 100n,
          createdById: 'u1',
        }),
      ]);

      m('cutAllocationLog').createMany.mockClear();
      await service.update('u1', '2', { barCount: 1 });
      expect(loggedActions()).toEqual([
        expect.objectContaining({ action: 'BARS', barCount: 1, previousBarCount: 2 }),
      ]);

      m('cutAllocationLog').createMany.mockClear();
      allocations = [baseAllocation({ workstationId: 2n, barCount: 5, seq: 1 })];
      await service.update('u1', String(allocations[0].id), { workstationId: '1', barCount: 4 });
      expect(
        loggedActions().map((l) => [l.action, l.barCount, l.previousBarCount ?? null]),
      ).toEqual([
        ['BARS', 4, 5],
        ['MOVE', 4, null],
      ]);
    });

    it('không đổi gì thật (cùng máy, cùng số cây) -> không ghi nhật ký', async () => {
      await service.update('u1', '1', { workstationId: '2', barCount: 5 });
      expect(m('cutAllocationLog').createMany).not.toHaveBeenCalled();
    });

    describe('dòng cắt theo bó', () => {
      beforeEach(() => {
        bundleOn = true;
      });

      it('đổi số cây -> 400, không ghi', async () => {
        await expect(service.update('u1', '1', { barCount: 3 })).rejects.toThrow(
          /không tách sang máy khác/,
        );
        expect(allocations[0].barCount).toBe(5);
        expect(m('cutAllocationLog').createMany).not.toHaveBeenCalled();
      });

      it('đổi máy thiếu lý do / lý do khác Máy hư -> 400', async () => {
        await expect(service.update('u1', '1', { workstationId: '1' })).rejects.toThrow(
          BadRequestException,
        );
        await expect(
          service.update('u1', '1', { workstationId: '1', reason: 'OTHER' }),
        ).rejects.toThrow(/Máy hư/);
        expect(allocations[0].workstationId).toBe(2n);
      });

      it('đổi máy với lý do Máy hư: chuyển nguyên dòng + ghi MOVE isBundle', async () => {
        // máy đích: dòng TU_DONG sang máy tự động khác không có sẵn -> dùng máy laze (dòng TU_DONG
        // không bị chặn)
        await service.update('u1', '1', { workstationId: '1', reason: 'MACHINE_BROKEN' });
        expect(allocations[0]).toMatchObject({ workstationId: 1n, barCount: 5 });
        expect(loggedActions()).toEqual([
          expect.objectContaining({ action: 'MOVE', reason: 'MACHINE_BROKEN', isBundle: true }),
        ]);
      });

      it('"đổi" sang đúng máy hiện tại không cần lý do', async () => {
        await expect(service.update('u1', '1', { workstationId: '2' })).resolves.toBeDefined();
      });
    });

    it('vượt số cây của kiểu cắt -> 400', async () => {
      await expect(service.update('u1', '1', { barCount: 9 })).rejects.toThrow(BadRequestException);
    });

    it('máy đích của xưởng khác -> 400', async () => {
      await expect(service.update('u1', '1', { workstationId: '3' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('dòng LASER sang máy tự động khi xưởng có laze -> 400', async () => {
      await expect(service.update('u1', '2', { workstationId: '2' })).rejects.toThrow(
        'Cây có đoạn dập (lỗ ô van) không cắt máy tự động',
      );
    });

    it('dòng LASER sang máy tự động khi xưởng khoá máy tự động -> được', async () => {
      m('systemConfig').findUnique.mockResolvedValue({
        solverMachineByWorkshop: { PHU_AN: 'tu_dong' },
      });
      await service.update('u1', '2', { workstationId: '2' });
      expect(allocations[1]).toMatchObject({ workstationId: 2n, isManual: true });
    });

    it('dòng cũ -> 409', async () => {
      const original = guardRow;
      guardRow = (id) => {
        const r = original(id);
        return r ? { ...r, cuttingProposal: { status: 'SUPERSEDED' } } : r;
      };
      await expect(service.update('u1', '1', { barCount: 2 })).rejects.toThrow(
        new ConflictException(
          'Dòng này đã cũ (phương án cắt đã tính lại hoặc lệnh đã xong Phôi). Bấm Chia lại.',
        ),
      );
    });

    it('máy của dòng đã chuyển sang xưởng khác -> 409 (bảng cũng coi là dòng cũ)', async () => {
      const original = guardRow;
      guardRow = (id) => {
        const r = original(id);
        return r ? { ...r, workstation: { isActive: true, kind: 'CUT', workshopId: 9n } } : r;
      };
      await expect(service.update('u1', '1', { barCount: 2 })).rejects.toThrow(ConflictException);
    });

    it('body rỗng -> 400', async () => {
      await expect(service.update('u1', '1', {})).rejects.toThrow(BadRequestException);
    });
  });

  describe('split', () => {
    beforeEach(() => {
      allocations = [
        baseAllocation({ workstationId: 2n, barCount: 5, seq: 1, punchedSegments: null }),
      ];
    });

    it('tách sang dòng mới (cả 2 isManual), seq cuối máy đích', async () => {
      await service.split('u1', '1', { barCount: 2, workstationId: '2' });
      expect(allocations).toHaveLength(2);
      expect(allocations[0]).toMatchObject({ barCount: 3, isManual: true });
      expect(allocations[1]).toMatchObject({
        barCount: 2,
        isManual: true,
        workstationId: 2n,
        seq: 4,
        patternId: 200n,
      });
    });

    it('ghi nhật ký SPLIT (từ máy, sang máy, số cây tách, lý do/ghi chú)', async () => {
      await service.split('u1', '1', {
        barCount: 2,
        workstationId: '1',
        reason: 'OTHER',
        note: 'QLSX điều',
      });
      expect(m('cutAllocationLog').create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'SPLIT',
          cutAllocationId: 2n, // dòng mới
          fromWorkstationId: 2n,
          toWorkstationId: 1n,
          barCount: 2,
          previousBarCount: 5,
          isBundle: false,
          reason: 'OTHER',
          note: 'QLSX điều',
          createdById: 'u1',
        }) as unknown,
      });
    });

    it('dòng cắt theo bó không tách -> 400 (đổi máy khi máy hư), không ghi gì', async () => {
      bundleOn = true;
      await expect(service.split('u1', '1', { barCount: 2, workstationId: '1' })).rejects.toThrow(
        /Kiểu cắt theo bó không tách sang máy khác/,
      );
      expect(allocations).toHaveLength(1);
      expect(allocations[0].barCount).toBe(5);
      expect(m('cutAllocationLog').create).not.toHaveBeenCalled();
    });

    it('số cây tách phải trong 1..barCount-1', async () => {
      await expect(service.split('u1', '1', { barCount: 5, workstationId: '2' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.split('u1', '1', { barCount: 0, workstationId: '2' })).rejects.toThrow(
        BadRequestException,
      );
      expect(allocations).toHaveLength(1);
    });
  });

  describe('reorder', () => {
    beforeEach(() => {
      allocations = [
        baseAllocation({ workstationId: 2n, seq: 1 }),
        baseAllocation({ workstationId: 2n, seq: 2 }),
        baseAllocation({ workstationId: 2n, seq: 3 }),
      ];
    });

    it('đặt seq theo vị trí mới, không đổi isManual', async () => {
      await service.reorder('u1', { workstationId: '2', rowIds: ['3', '1', '2'] });
      expect(allocations.map((a) => [a.id, a.seq, a.isManual])).toEqual([
        [1n, 2, false],
        [2n, 3, false],
        [3n, 1, false],
      ]);
    });

    it('thiếu / thừa / trùng dòng -> 400', async () => {
      await expect(
        service.reorder('u1', { workstationId: '2', rowIds: ['1', '2'] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.reorder('u1', { workstationId: '2', rowIds: ['1', '2', '3', '4'] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.reorder('u1', { workstationId: '2', rowIds: ['1', '1', '2'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('máy của xưởng khác với QLSX có xưởng -> 403', async () => {
      scope = { workshopId: 9n, workshopName: 'Phước An', visibleWorkshopIds: [9n] };
      await expect(
        service.reorder('u1', { workstationId: '2', rowIds: ['1', '2', '3'] }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('xoá dòng, số cây quay về chưa chia', async () => {
      allocations = [baseAllocation({ workstationId: 2n, barCount: 4 })];
      const board = await service.remove('u1', '1');
      expect(allocations).toHaveLength(0);
      expect(board.unallocated[0].bars).toBe(10);
      expect(m('cutAllocationLog').create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'REMOVE',
          fromWorkstationId: 2n,
          barCount: 4,
          isBundle: false,
          productionInvoiceId: 100n,
          createdById: 'u1',
        }) as unknown,
      });
    });
  });

  describe('getMachineWork (màn quét máy cắt)', () => {
    it('trả các dòng của đúng máy, theo seq, cùng hình dạng dòng bảng chia (có isBundle)', async () => {
      allocations = [
        baseAllocation({ workstationId: 2n, barCount: 3, seq: 2 }),
        baseAllocation({ workstationId: 1n, machineClass: 'LASER', barCount: 2, seq: 1 }),
        baseAllocation({ workstationId: 2n, barCount: 2, seq: 1 }),
      ];
      const work = await service.getMachineWork(2n);
      expect(work.rows.map((r) => [r.id, r.seq, r.workstationId, r.isBundle])).toEqual([
        ['3', 1, '2', false],
        ['1', 2, '2', false],
      ]);
      expect(work.rows[0]).toMatchObject({ piCode: 'PI-100', materialLabel: 'Sắt hộp · 25x50' });
    });

    it('kèm ước tiến độ: số đoạn báo ở CHÍNH máy này -> barsDoneEst, barsLeftEst, status', async () => {
      // máy 1 có 30 đoạn 425 đã báo, dòng 2 cây × 2 đoạn -> xong hết; máy 2 chưa báo gì
      allocations = [
        baseAllocation({ workstationId: 1n, machineClass: 'LASER', barCount: 2, seq: 1 }),
        baseAllocation({ workstationId: 2n, barCount: 30, seq: 1 }),
      ];
      const w1 = await service.getMachineWork(1n);
      expect(w1).toMatchObject({ barsDoneEst: 2, barsLeftEst: 0, status: 'IDLE' });
      expect(w1.rows[0].barsDoneEst).toBe(2);
      const w2 = await service.getMachineWork(2n);
      expect(w2).toMatchObject({ barsDoneEst: 0, barsLeftEst: 30, status: 'BUSY' });
    });

    it('bỏ dòng cũ (máy ngừng dùng / kiểu cắt không còn)', async () => {
      allocations = [
        baseAllocation({ workstationId: 2n, barCount: 3, seq: 1 }),
        baseAllocation({ workstationId: 2n, barCount: 1, seq: 2, patternId: 999n }),
      ];
      const work = await service.getMachineWork(2n);
      expect(work.rows.map((r) => r.id)).toEqual(['1']);
    });

    it('máy không có xưởng / không phải máy CUT / không tồn tại -> rows rỗng', async () => {
      m('workstation').findUnique.mockResolvedValueOnce({ workshopId: null, kind: 'CUT' });
      const none = { rows: [], barsDoneEst: 0, barsLeftEst: 0, status: 'EMPTY' };
      expect(await service.getMachineWork(2n)).toEqual(none);
      m('workstation').findUnique.mockResolvedValueOnce({ workshopId: 5n, kind: 'STEP' });
      expect(await service.getMachineWork(2n)).toEqual(none);
      expect(await service.getMachineWork(77n)).toEqual(none);
    });
  });

  describe('getWorkshopAllocationPis + machineProgressByWorkshop', () => {
    it('lệnh có dòng chia trên mọi máy cắt của xưởng, không trùng', async () => {
      allocations = [
        baseAllocation({ workstationId: 2n, barCount: 3, seq: 2 }),
        baseAllocation({ workstationId: 1n, machineClass: 'LASER', barCount: 2, seq: 1 }),
      ];
      expect(await service.getWorkshopAllocationPis(5n)).toEqual([
        { productionInvoiceId: '100', code: 'PI-100' },
      ]);
    });

    it('không có dòng chia -> rỗng', async () => {
      expect(await service.getWorkshopAllocationPis(5n)).toEqual([]);
    });

    it('tiến độ từng máy + signature đổi theo việc', async () => {
      allocations = [
        baseAllocation({ workstationId: 1n, machineClass: 'LASER', barCount: 2, seq: 1 }),
        baseAllocation({ workstationId: 2n, barCount: 5, seq: 1 }),
      ];
      const list = await service.machineProgressByWorkshop(5n);
      expect(list).toEqual([
        {
          workstationId: '1',
          name: 'Laze 1',
          workshopId: '5',
          workshopName: 'Phú An',
          totalBars: 2,
          barsLeft: 0,
          status: 'IDLE',
          signature: '2:1',
        },
        {
          workstationId: '2',
          name: 'Tự động 1',
          workshopId: '5',
          workshopName: 'Phú An',
          totalBars: 5,
          barsLeft: 5,
          status: 'LOW',
          signature: '5:2',
        },
      ]);
    });
  });

  describe('tải theo số cây CÒN LẠI', () => {
    it('máy đã cắt hết dòng nhận việc mới trước máy còn dòng chưa cắt', async () => {
      // 2 máy laze, kiểu cắt 10 cây; mỗi máy giữ 3 cây. Máy 1 đã báo đủ đoạn (cắt hết), máy 4 chưa
      // báo gì.
      machines = [
        { id: 1n, code: 'L1', name: 'Laze 1', cutMachineType: 'laser' },
        { id: 4n, code: 'L2', name: 'Laze 2', cutMachineType: 'laser' },
      ];
      allocations = [
        baseAllocation({ workstationId: 1n, barCount: 3, seq: 1 }),
        baseAllocation({ workstationId: 4n, barCount: 3, seq: 1 }),
      ];

      await service.auto('u1', { workshopId: '5', mode: 'append' });

      const data = createdData();
      // Tải cũ (Σ barCount) chia đều 2/2; tải còn lại là 0 và 3 nên máy 1 nhận cả 4 cây.
      expect(data.reduce((s, d) => s + Number(d.barCount), 0)).toBe(4);
      expect(data.every((d) => d.workstationId === 1n)).toBe(true);
    });
  });

  describe('autoPull (máy rảnh tự kéo lệnh kế tiếp)', () => {
    const vnDayOf = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);
    const proposalFor = (o: {
      id: bigint;
      piId: bigint;
      materialId: bigint;
      patternId: bigint;
      rev: bigint;
      sets: number;
      bars: number;
    }) => ({
      id: o.id,
      productionInvoiceId: o.piId,
      productionOrder: null,
      productionInvoice: {
        items: [{ productionOrder: { bomRevisionId: o.rev, quantity: o.sets } }],
      },
      items: [],
      lines: [
        {
          id: o.id * 10n,
          materialId: o.materialId,
          totalBars: o.bars,
          bestStockLengthMm: 6000,
          machine: 'laser',
          pieceSummary: [],
          material: {
            id: o.materialId,
            code: `S${o.materialId}`,
            name: 'Sắt hộp',
            spec: `spec${o.materialId}`,
          },
          patterns: [
            {
              id: o.patternId,
              patternIndex: 0,
              barCount: o.bars,
              wastePerBarMm: 10,
              bundles: null,
              segments: [{ countPerBar: 2, segmentSpec: { cutLengthMm: 425 } }],
            },
          ],
        },
      ],
    });
    const pi = (id: bigint, code: string, day: string) => ({
      id,
      code,
      deadline: vnDayOf('2026-11-30'),
      items: [{ stages: [{ deadline: vnDayOf(day) }], bookingLines: [] }],
    });
    const reservation = (
      piId: bigint,
      materialId: bigint,
      qty: number,
      code: string,
      workshopId: bigint | null = null,
    ) => ({
      productionInvoiceId: piId,
      materialId,
      quantity: { toNumber: () => qty },
      consumedQty: { toNumber: () => 0 },
      warehouse: { code, workshopId },
    });
    const setStarted = (...piIds: bigint[]) =>
      m('productionOrder').findMany.mockImplementation(
        (args: { where?: { floorStage?: string } }) =>
          Promise.resolve(
            args.where?.floorStage === 'ACTIVE'
              ? piIds.map((id) => ({ productionInvoiceItem: { productionInvoiceId: id } }))
              : [],
          ),
      );
    const lockedKeys = () => JSON.stringify((db.$executeRaw as jest.Mock).mock.calls);

    beforeEach(() => {
      // PI 100 chỉ có cây dập (laze), PI 101 / 102 chỉ có cây không dập (máy tự động).
      m('cuttingProposal').findMany.mockResolvedValue([
        proposalFor({
          id: 70n,
          piId: 100n,
          materialId: 7n,
          patternId: 200n,
          rev: 5n,
          sets: 10,
          bars: 10,
        }),
        proposalFor({
          id: 71n,
          piId: 101n,
          materialId: 8n,
          patternId: 201n,
          rev: 6n,
          sets: 1,
          bars: 10,
        }),
        proposalFor({
          id: 72n,
          piId: 102n,
          materialId: 9n,
          patternId: 202n,
          rev: 6n,
          sets: 1,
          bars: 6,
        }),
      ]);
      m('productionInvoice').findMany.mockResolvedValue([
        pi(100n, 'PI-100', '2026-11-14'),
        pi(101n, 'PI-101', '2026-11-15'),
        pi(102n, 'PI-102', '2026-11-16'),
      ]);
      m('steelIssue').groupBy.mockResolvedValue([]);
      m('stockReservation').findMany.mockResolvedValue([
        reservation(100n, 7n, 10, 'KHO-A'),
        reservation(101n, 8n, 10, 'KHO-B'),
        reservation(102n, 9n, 6, 'KHO-B'),
      ]);
      (db.$queryRaw as jest.Mock).mockResolvedValue([]);
      setStarted(100n, 101n, 102n);
    });

    it('bỏ qua lệnh không có phần máy rảnh cắt được, lấy lệnh sau; dừng khi máy rảnh đã có việc; log AUTO_PULL; trả steelGaps + kho', async () => {
      // Máy tự động (2) rảnh. PI-100 chỉ có cây dập -> vào máy laze, không có phần nào cho máy 2 ->
      // để dành. PI-101 vào máy 2 -> nhận. PI-102 không kéo nữa (máy 2 đã có việc).
      const res = await service.autoPull(5n, ['2']);

      expect(res).not.toBeNull();
      expect(res!.workshopId).toBe('5');
      expect(res!.workshopName).toBe('Phú An');
      expect(res!.machines).toEqual([{ id: '2', name: 'Tự động 1' }]);
      expect(res!.orders.map((o) => o.piCode)).toEqual(['PI-101']);
      const o = res!.orders[0];
      expect(o.productionInvoiceId).toBe('101');
      expect(o.idleMachineNames).toEqual(['Tự động 1']);
      expect(o.lines).toEqual([
        {
          materialId: '8',
          materialLabel: 'Sắt hộp · spec8',
          bars: 10,
          machines: [{ id: '2', name: 'Tự động 1', bars: 10 }],
        },
      ]);
      expect(o.steelGaps).toEqual([
        {
          materialId: '8',
          materialCode: 'S8',
          materialLabel: 'Sắt hộp · spec8',
          requiredBars: 10,
          issuedBars: 0,
          missingBars: 10,
          warehouseCodes: ['KHO-B'],
        },
      ]);

      const data = createdData();
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        workshopId: 5n,
        workstationId: 2n,
        productionInvoiceId: 101n,
        patternId: 201n,
        barCount: 10,
        seq: 1,
        isManual: false,
        updatedById: null,
      });
      expect(o.firstAllocationId).toBe(String(allocations[0].id));
      const logs = (
        m('cutAllocationLog').createMany.mock.calls[0] as [{ data: Array<Record<string, unknown>> }]
      )[0].data;
      expect(logs).toEqual([
        expect.objectContaining({
          action: 'AUTO_PULL',
          createdById: null,
          toWorkstationId: 2n,
          barCount: 10,
          isBundle: false,
          patternId: 201n,
          productionInvoiceId: 101n,
          cutAllocationId: allocations[0].id,
        }) as unknown,
      ]);
      expect(lockedKeys()).toContain('cut-allocation:5');
      expect(m('cutAllocation').deleteMany).not.toHaveBeenCalled();
    });

    it('lệnh đã nhận thì nhận TOÀN BỘ dòng (kể cả phần rơi vào máy đang bận); mỗi máy rảnh một lệnh', async () => {
      // Máy 1 (laze) và 2 (tự động) đều rảnh: PI-100 -> máy 1, PI-101 -> máy 2, PI-102 không kéo.
      const res = await service.autoPull(5n, ['1', '2']);

      expect(res!.orders.map((o) => o.piCode)).toEqual(['PI-100', 'PI-101']);
      expect(res!.machines.map((x) => x.id)).toEqual(['1', '2']);
      expect(res!.orders[0].idleMachineNames).toEqual(['Laze 1']);
      expect(createdData().map((d) => [d.productionInvoiceId, d.workstationId])).toEqual([
        [100n, 1n],
        [101n, 2n],
      ]);
    });

    it('nối seq vào cuối việc của máy, không đổi seq / không xoá dòng cũ', async () => {
      // Máy 2 có 1 dòng (seq 7) đã cắt hết (báo 8 đoạn = 4 cây ở máy 2) -> rảnh.
      allocations = [
        baseAllocation({
          workstationId: 2n,
          productionInvoiceId: 100n,
          patternId: 200n,
          cuttingProposalId: 70n,
          barCount: 4,
          seq: 7,
        }),
      ];
      (db.$queryRaw as jest.Mock).mockResolvedValue([
        {
          workstationId: 2n,
          productionInvoiceId: 100n,
          materialId: 7n,
          cutLengthMm: 425,
          qty: 8,
        },
      ]);
      setStarted(101n);

      const res = await service.autoPull(5n, ['2']);

      expect(res!.orders.map((o) => o.piCode)).toEqual(['PI-101']);
      expect(createdData()[0]).toMatchObject({ workstationId: 2n, seq: 8 });
      expect(allocations[0].seq).toBe(7);
      const updatedSeq = (db.$executeRaw as jest.Mock).mock.calls.some((c: unknown[]) =>
        String((c[0] as { sql?: string })?.sql ?? '').includes('UPDATE "cut_allocations"'),
      );
      expect(updatedSeq).toBe(false);
      expect(m('cutAllocation').deleteMany).not.toHaveBeenCalled();
      expect(m('cutAllocation').update).not.toHaveBeenCalled();
    });

    it('không kéo lệnh chưa Bắt đầu / đang tạm dừng (không có lệnh SX ACTIVE thuộc xưởng)', async () => {
      setStarted();
      expect(await service.autoPull(5n, ['2'])).toBeNull();
      expect(m('cutAllocation').createManyAndReturn).not.toHaveBeenCalled();
      expect(m('productionOrder').findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            floorStage: 'ACTIVE',
            productionInvoiceItem: expect.objectContaining({ workshopId: 5n }) as unknown,
          }) as unknown,
        }),
      );
    });

    it('không kéo lệnh đang chờ KHSX kiểm lại phương án cắt (vừa đổi xưởng): PI-101 có cờ thì lấy PI-102', async () => {
      const flagged = new Set(['101']);
      m('productionOrder').findMany.mockImplementation(
        (args: {
          where?: {
            floorStage?: string;
            productionInvoiceItem?: { productionInvoice?: { cuttingRecheckRequired?: boolean } };
          };
        }) =>
          Promise.resolve(
            args.where?.floorStage === 'ACTIVE'
              ? [101n, 102n]
                  .filter(
                    (id) =>
                      args.where?.productionInvoiceItem?.productionInvoice
                        ?.cuttingRecheckRequired !== false || !flagged.has(id.toString()),
                  )
                  .map((id) => ({ productionInvoiceItem: { productionInvoiceId: id } }))
              : [],
          ),
      );
      const res = await service.autoPull(5n, ['2']);
      expect(res!.orders.map((o) => o.piCode)).toEqual(['PI-102']);
    });

    it('không kéo lệnh có sắt còn giữ ở kho xưởng khác (vừa đổi xưởng, chưa chuyển kho): PI-101 thì lấy PI-102, không báo thủ kho kho cũ', async () => {
      m('stockReservation').findMany.mockResolvedValue([
        reservation(100n, 7n, 10, 'KHO-A', 5n),
        reservation(101n, 8n, 10, 'KHO-PHOI-PHA', 6n),
        reservation(102n, 9n, 6, 'KHO-B', 5n),
      ]);
      const res = await service.autoPull(5n, ['2']);
      expect(res!.orders.map((o) => o.piCode)).toEqual(['PI-102']);
      expect(res!.orders[0].steelGaps.flatMap((g) => g.warehouseCodes)).toEqual(['KHO-B']);
    });

    it('chỉ kéo lệnh đã Bắt đầu: PI-101 chưa Bắt đầu thì lấy PI-102', async () => {
      setStarted(102n);
      const res = await service.autoPull(5n, ['2']);
      expect(res!.orders.map((o) => o.piCode)).toEqual(['PI-102']);
    });

    it('không kéo lệnh chưa đủ sắt', async () => {
      m('stockReservation').findMany.mockResolvedValue([
        reservation(100n, 7n, 3, 'KHO-A'),
        reservation(101n, 8n, 4, 'KHO-B'),
        reservation(102n, 9n, 2, 'KHO-B'),
      ]);
      expect(await service.autoPull(5n, ['1', '2'])).toBeNull();
      expect(m('cutAllocation').createManyAndReturn).not.toHaveBeenCalled();
    });

    it('lệnh đã xuất đủ sắt xuống Phôi: không có steelGaps', async () => {
      m('steelIssue').groupBy.mockResolvedValue([
        { productionInvoiceId: 101n, materialId: 8n, _sum: { barCount: 10 } },
      ]);
      m('stockReservation').findMany.mockResolvedValue([]);
      const res = await service.autoPull(5n, ['2']);
      expect(res!.orders[0].piCode).toBe('PI-101');
      expect(res!.orders[0].steelGaps).toEqual([]);
    });

    it('không có máy rảnh thật sự (máy còn dòng chưa cắt) / máy lạ / danh sách rỗng -> null, không ghi', async () => {
      allocations = [
        baseAllocation({
          workstationId: 2n,
          productionInvoiceId: 100n,
          patternId: 200n,
          cuttingProposalId: 70n,
          barCount: 4,
          seq: 1,
        }),
      ];
      expect(await service.autoPull(5n, ['2'])).toBeNull(); // máy 2 chưa báo gì: còn 4 cây
      expect(await service.autoPull(5n, ['99'])).toBeNull();
      expect(await service.autoPull(5n, [])).toBeNull();
      expect(m('cutAllocation').createManyAndReturn).not.toHaveBeenCalled();
      expect(m('cutAllocationLog').createMany).not.toHaveBeenCalled();
    });

    it('xưởng không tồn tại / đã ngừng -> null', async () => {
      m('workshop').findUnique.mockResolvedValue({ ...PHU_AN, isActive: false });
      expect(await service.autoPull(5n, ['2'])).toBeNull();
      m('workshop').findUnique.mockResolvedValue(null);
      expect(await service.autoPull(5n, ['2'])).toBeNull();
    });
  });

  describe('steelGapsByPi (đóng nhắc thủ kho khi xuất đủ)', () => {
    it('lệnh có dòng chia mà đã xuất < cần -> trả thiếu bao nhiêu + mã kho còn giữ', async () => {
      allocations = [baseAllocation({ workstationId: 2n, barCount: 8, seq: 1 })];
      const res = await service.steelGapsByPi(5n);
      expect([...res.keys()]).toEqual(['100']);
      expect(res.get('100')).toEqual([
        {
          materialId: '7',
          materialCode: 'S1',
          materialLabel: 'Sắt hộp · 25x50',
          requiredBars: 10,
          issuedBars: 6,
          missingBars: 4,
          warehouseCodes: ['KHO-SAT'],
        },
      ]);
    });

    it('mã kho chỉ lấy kho thuộc xưởng này / kho không gắn xưởng: thủ kho xưởng khác không nhận tin xuất sắt', async () => {
      allocations = [baseAllocation({ workstationId: 2n, barCount: 8, seq: 1 })];
      m('stockReservation').findMany.mockResolvedValue([
        {
          productionInvoiceId: 100n,
          materialId: 7n,
          quantity: { toNumber: () => 3 },
          consumedQty: { toNumber: () => 0 },
          warehouse: { code: 'KHO-PHOI-PA', workshopId: 5n },
        },
        {
          productionInvoiceId: 100n,
          materialId: 7n,
          quantity: { toNumber: () => 2 },
          consumedQty: { toNumber: () => 0 },
          warehouse: { code: 'KHO-PHOI-PHA', workshopId: 6n },
        },
      ]);
      const res = await service.steelGapsByPi(5n);
      expect(res.get('100')?.[0].warehouseCodes).toEqual(['KHO-PHOI-PA']);
    });

    it('xuất đủ -> rỗng; lệnh chưa có dòng chia hiện hành -> không tính', async () => {
      allocations = [baseAllocation({ workstationId: 2n, barCount: 8, seq: 1 })];
      issued = 10;
      reserved = 0;
      expect((await service.steelGapsByPi(5n)).size).toBe(0);

      allocations = [];
      issued = 0;
      expect((await service.steelGapsByPi(5n)).size).toBe(0);
    });
  });

  describe('getLog (nhật ký + thống kê lệnh có điều chuyển)', () => {
    const logRow = (
      id: bigint,
      action: string,
      pi: { id: bigint; code: string },
      over: Record<string, unknown> = {},
    ) => ({
      id,
      createdAt: new Date('2026-11-14T03:00:00Z'),
      action,
      reason: null,
      note: null,
      isBundle: false,
      barCount: 2,
      previousBarCount: null,
      productionInvoiceId: pi.id,
      patternId: 200n,
      productionInvoice: { code: pi.code },
      fromWorkstation: { id: 1n, name: 'Laze 1' },
      toWorkstation: { id: 2n, name: 'Tự động 1' },
      createdBy: { firstName: 'sản xuất', lastName: 'Quản lý', username: 'qlsx' },
      ...over,
    });

    it('tổng hợp byOrder: chỉ PI có MOVE/SPLIT, đếm Máy hư, nhiều lần nhất trước; entries id là chuỗi', async () => {
      const A = { id: 100n, code: 'PI-100' };
      const B = { id: 101n, code: 'PI-101' };
      const C = { id: 102n, code: 'PI-102' };
      m('cutAllocationLog').findMany.mockResolvedValue([
        logRow(9n, 'SPLIT', A),
        logRow(8n, 'MOVE', B, { reason: 'MACHINE_BROKEN', isBundle: true }),
        logRow(7n, 'MOVE', B, { reason: 'MACHINE_BROKEN', isBundle: true }),
        logRow(6n, 'MOVE', B, { reason: 'OTHER' }),
        logRow(5n, 'ADD', C), // chỉ ADD/BARS/REMOVE: không thuộc "lệnh có điều chuyển"
        logRow(4n, 'BARS', C),
        logRow(3n, 'REMOVE', C),
        logRow(2n, 'MOVE', A),
      ]);
      m('cuttingProposalPattern').findMany.mockResolvedValue([
        { id: 200n, line: { material: { name: 'Sắt hộp', spec: '25x50' } } },
      ]);

      const res = await service.getLog('u1', { workshopId: '5' });

      expect(res.byOrder).toEqual([
        {
          productionInvoiceId: '101',
          piCode: 'PI-101',
          moves: 3,
          splits: 0,
          machineBrokenMoves: 2,
        },
        {
          productionInvoiceId: '100',
          piCode: 'PI-100',
          moves: 1,
          splits: 1,
          machineBrokenMoves: 0,
        },
      ]);
      expect(res.entries).toHaveLength(8);
      expect(res.entries[0]).toEqual({
        id: '9',
        createdAt: new Date('2026-11-14T03:00:00Z'),
        action: 'SPLIT',
        reason: null,
        note: null,
        isBundle: false,
        barCount: 2,
        previousBarCount: null,
        productionInvoiceId: '100',
        piCode: 'PI-100',
        materialLabel: 'Sắt hộp · 25x50',
        fromMachine: { id: '1', name: 'Laze 1' },
        toMachine: { id: '2', name: 'Tự động 1' },
        createdByName: 'Quản lý sản xuất',
      });
    });

    it('dòng AUTO_PULL (hệ thống kéo lệnh): createdByName null, không tính vào byOrder', async () => {
      m('cutAllocationLog').findMany.mockResolvedValue([
        logRow(
          9n,
          'AUTO_PULL',
          { id: 100n, code: 'PI-100' },
          { createdBy: null, fromWorkstation: null },
        ),
      ]);
      const res = await service.getLog('u1', { workshopId: '5' });
      expect(res.entries[0]).toMatchObject({
        action: 'AUTO_PULL',
        createdByName: null,
        fromMachine: null,
        toMachine: { id: '2', name: 'Tự động 1' },
      });
      expect(res.byOrder).toEqual([]);
    });

    it('truy vấn: đúng xưởng, mặc định 30 ngày gần nhất, tối đa 500 dòng, mới nhất trước', async () => {
      await service.getLog('u1', { workshopId: '5', to: '2026-11-14' });
      const args = (
        m('cutAllocationLog').findMany.mock.calls[0] as [Record<string, unknown>]
      )[0] as {
        where: { workshopId: bigint; createdAt: { gte: Date; lt: Date } };
        take: number;
        orderBy: unknown;
      };
      expect(args.where.workshopId).toBe(5n);
      // "đến ngày" gồm cả ngày đó (giờ VN)
      expect(args.where.createdAt.lt).toEqual(vnDay('2026-11-15'));
      expect(args.where.createdAt.gte).toEqual(
        new Date(vnDay('2026-11-15').getTime() - 30 * 86400000),
      );
      expect(args.take).toBe(500);
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);

      await service.getLog('u1', {
        workshopId: '5',
        productionInvoiceId: '100',
        from: '2026-11-01',
        to: '2026-11-14',
      });
      const second = (
        m('cutAllocationLog').findMany.mock.calls[1] as [Record<string, unknown>]
      )[0] as {
        where: Record<string, unknown>;
      };
      expect(second.where).toMatchObject({ productionInvoiceId: 100n });
    });

    it('cùng phạm vi xưởng với bảng: QLSX chung thiếu xưởng -> 400; QLSX có xưởng gửi xưởng khác -> 403', async () => {
      await expect(service.getLog('u1', {})).rejects.toThrow(BadRequestException);
      scope = { workshopId: 9n, workshopName: 'Phước An', visibleWorkshopIds: [9n] };
      await expect(service.getLog('u1', { workshopId: '5' })).rejects.toThrow(ForbiddenException);
    });

    it('khoảng ngày sai -> 400', async () => {
      await expect(
        service.getLog('u1', { workshopId: '5', from: '2026-11-20', to: '2026-11-10' }),
      ).rejects.toThrow(BadRequestException);
      await expect(service.getLog('u1', { workshopId: '5', to: '2026-13-45' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
