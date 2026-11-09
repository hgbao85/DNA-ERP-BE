import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CACHE_TTL_MS, MaterialsDueService } from './materials-due.service';

// Hôm nay 05/11/2026 (10:00 giờ VN).
const NOW = new Date('2026-11-05T03:00:00.000Z');
const TODAY = '2026-11-05';
/** Mốc 00:00 giờ VN của ngày `YYYY-MM-DD` (cách lưu hạn trong DB). */
const at = (day: string) => new Date(`${day}T00:00:00+07:00`);
const plus = (n: number) => {
  const d = new Date(at(TODAY).getTime() + n * 86_400_000);
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
};

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  username: 'u1',
  email: null,
  roles: [],
  permissions: [],
  mfgRole: null,
  warehouseScope: null,
  ...over,
});

interface LineOpts {
  id?: number;
  pi?: number;
  materialId?: number;
  buyQty?: number;
  orderQty?: number | null;
  receivedQty?: number;
  status?: string;
  name?: string;
  unit?: string;
  detailKind?: string | null;
  buyerId?: string | null;
  buyer?: { firstName: string; lastName: string } | null;
  warehouse?: { code: string; name: string } | null;
  receiveWarehouseCode?: string | null;
  stockLengthMm?: number | null;
  spec?: string | null;
  supplierOrder?: {
    id?: number;
    seq: number;
    year: number;
    status: string;
    supplier: { name: string };
  } | null;
  quotes?: { supplierName: string; supplier: { name: string } | null }[];
}

const line = (o: LineOpts = {}) => ({
  id: BigInt(o.id ?? 1),
  materialId: BigInt(o.materialId ?? 500),
  buyQty: o.buyQty ?? 100,
  orderQty: o.orderQty ?? null,
  receivedQty: o.receivedQty ?? 0,
  status: o.status ?? 'PURCHASING',
  receiveWarehouseCode: o.receiveWarehouseCode ?? null,
  stockLengthMm: o.stockLengthMm ?? null,
  spec: o.spec ?? null,
  proposal: { productionInvoiceId: BigInt(o.pi ?? 7) },
  material: {
    name: o.name ?? 'Sơn ABC',
    unit: o.unit ?? 'kg',
    detailKind: o.detailKind ?? null,
    buyerId: o.buyerId === undefined ? 'b1' : o.buyerId,
    buyer: o.buyer === undefined ? { firstName: 'Lan', lastName: 'Nguyễn' } : o.buyer,
    warehouse:
      o.warehouse === undefined ? { code: 'phoi-son-han', name: 'Kho Phôi Sơn Hàn' } : o.warehouse,
  },
  supplierOrder: o.supplierOrder ? { id: 900n, ...o.supplierOrder } : null,
  quotes: o.quotes ?? [],
});

interface ItemOpts {
  id?: number;
  pi?: number;
  lsx?: string | null;
  sku?: string;
  materialDeadline?: string | null;
  finishedMaterialDeadline?: string | null;
  wire?: number | null;
  cushion?: number | null;
  piCode?: string;
  piDeadline?: string | null;
  stages?: { stageType: string; deadline: string }[];
}

const item = (o: ItemOpts = {}) => ({
  id: BigInt(o.id ?? 1),
  productionInvoiceId: BigInt(o.pi ?? 7),
  lsxCode: o.lsx === undefined ? 'MY-313' : o.lsx,
  materialDeadline: o.materialDeadline ? at(o.materialDeadline) : null,
  finishedMaterialDeadline: o.finishedMaterialDeadline ? at(o.finishedMaterialDeadline) : null,
  wireMaterialId: o.wire == null ? null : BigInt(o.wire),
  cushionMaterialId: o.cushion == null ? null : BigInt(o.cushion),
  productionInvoice: {
    code: o.piCode ?? 'PI-2026-007',
    deadline: o.piDeadline ? at(o.piDeadline) : null,
  },
  mfgProduct: { factoryCode: o.sku ?? 'SKU-1' },
  stages: (o.stages ?? []).map((s) => ({ stageType: s.stageType, deadline: at(s.deadline) })),
});

describe('MaterialsDueService (Phần A – Đợt 4, YC6)', () => {
  let prisma: {
    purchaseProposalItem: { findMany: jest.Mock };
    productionInvoiceItem: { findMany: jest.Mock };
    productionInvoice: { findMany: jest.Mock };
    warehouse: { findMany: jest.Mock; findFirst: jest.Mock };
    systemConfig: { findUnique: jest.Mock };
  };
  let lines: ReturnType<typeof line>[];
  let items: ReturnType<typeof item>[];
  /** Mọi dòng đã duyệt kể cả đã Kết thúc (không có trong `items`) - chỉ dây / nệm. */
  let approved: ReturnType<typeof item>[];
  let service: MaterialsDueService;

  beforeEach(() => {
    lines = [];
    items = [];
    approved = [];
    prisma = {
      purchaseProposalItem: {
        findMany: jest.fn().mockImplementation(() => Promise.resolve(lines)),
      },
      productionInvoiceItem: {
        findMany: jest
          .fn()
          .mockImplementation(
            (args: { where: { lsxCode?: unknown }; select: { stages?: unknown } }) => {
              if (args.where.lsxCode) return Promise.resolve(items.filter((i) => i.lsxCode));
              if (args.select.stages) return Promise.resolve(items);
              return Promise.resolve(approved.length ? approved : items);
            },
          ),
      },
      productionInvoice: {
        findMany: jest.fn().mockResolvedValue([{ id: 7n, code: 'PI-2026-007' }]),
      },
      warehouse: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ name: 'Kho Vật tư TP' }),
      },
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ materialEarliestArrivalDays: 4 }) },
    };
    service = new MaterialsDueService(prisma as never);
  });

  const all = (over: { view?: 'all' } = {}) =>
    service.list(user({ roles: ['BOSS'] }), { view: over.view ?? 'all' }, NOW);

  describe('trạng thái theo khoảng ngày (N = 4)', () => {
    const stateFor = async (deadlineOffset: number | null) => {
      lines = [line()];
      items = [item({ materialDeadline: deadlineOffset === null ? null : plus(deadlineOffset) })];
      const r = await all();
      return r.rows[0];
    };

    it('quá hạn 1 ngày -> OVERDUE, daysLeft -1', async () => {
      const row = await stateFor(-1);
      expect(row).toMatchObject({ state: 'OVERDUE', daysLeft: -1, deadline: plus(-1) });
    });

    it('hạn chót hôm nay -> DEADLINE_TODAY', async () => {
      const row = await stateFor(0);
      expect(row).toMatchObject({ state: 'DEADLINE_TODAY', daysLeft: 0 });
    });

    it('còn 1..4 ngày (trong khoảng được về) -> IN_WINDOW; ranh giới N = 4', async () => {
      expect(await stateFor(1)).toMatchObject({ state: 'IN_WINDOW', daysLeft: 1 });
      const edge = await stateFor(4);
      expect(edge).toMatchObject({ state: 'IN_WINDOW', daysLeft: 4, earliestArrival: TODAY });
    });

    it('còn 5 ngày -> UPCOMING (ngày được về sớm nhất là mai)', async () => {
      expect(await stateFor(5)).toMatchObject({ state: 'UPCOMING', earliestArrival: plus(1) });
    });

    it('không SKU nào có hạn -> NO_DEADLINE, deadline / earliestArrival / daysLeft null', async () => {
      expect(await stateFor(null)).toMatchObject({
        state: 'NO_DEADLINE',
        deadline: null,
        earliestArrival: null,
        daysLeft: null,
      });
    });

    it('N = 0: chỉ ngày hạn chót là "hôm nay", ngày trước đó là UPCOMING', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ materialEarliestArrivalDays: 0 });
      expect(await stateFor(0)).toMatchObject({ state: 'DEADLINE_TODAY', earliestArrival: TODAY });
      expect(await stateFor(1)).toMatchObject({ state: 'UPCOMING', earliestArrival: plus(1) });
    });

    it('chưa có dòng SystemConfig -> mặc định N = 4', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      lines = [line()];
      items = [item({ materialDeadline: plus(4) })];
      const r = await all();
      expect(r.earliestArrivalDays).toBe(4);
      expect(r.rows[0].state).toBe('IN_WINDOW');
    });

    it('response mang N từ SystemConfig', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ materialEarliestArrivalDays: 7 });
      lines = [line()];
      items = [item({ materialDeadline: plus(7) })];
      const r = await all();
      expect(r.earliestArrivalDays).toBe(7);
      expect(r.rows[0]).toMatchObject({ state: 'IN_WINDOW', earliestArrival: TODAY });
    });
  });

  describe('lệnh gộp, SKU, hạn theo nhóm', () => {
    it('dòng mua dùng chung 2 SKU 2 hạn -> 1 dòng, hạn = SKU sớm nhất, skus xếp theo hạn', async () => {
      lines = [line()];
      items = [
        item({ id: 1, lsx: 'MY-314', sku: 'B', materialDeadline: plus(6) }),
        item({ id: 2, lsx: 'MY-313', sku: 'A', materialDeadline: plus(2) }),
      ];
      const r = await all();
      expect(r.rows).toHaveLength(1);
      const row = r.rows[0];
      expect(row.deadline).toBe(plus(2));
      expect(row.state).toBe('IN_WINDOW');
      expect(row.skus.map((s) => [s.lenhCode, s.skuCode, s.deadline])).toEqual([
        ['MY-313', 'A', plus(2)],
        ['MY-314', 'B', plus(6)],
      ]);
    });

    it('lệnh gộp 2 SKU: priorityNote theo thứ tự ranksBefore (hạn sớm trước), dùng số LSX; 1 SKU thì null', async () => {
      lines = [line()];
      items = [
        item({ id: 1, lsx: 'MY-9404', sku: 'B', materialDeadline: plus(6) }),
        item({ id: 2, lsx: 'MY-9403', sku: 'A', materialDeadline: plus(2) }),
      ];
      expect((await all()).rows[0].priorityNote).toBe(
        'Hàng về chia trước cho MY-9403, rồi MY-9404',
      );

      items = [item({ id: 1, lsx: 'MY-9404', sku: 'B', materialDeadline: plus(6) })];
      expect((await all()).rows[0].priorityNote).toBeNull();
    });

    it('priorityNote: bằng hạn thì dòng vào lệnh trước (id nhỏ), chưa có hạn xếp cuối', async () => {
      lines = [line()];
      items = [
        item({ id: 3, lsx: 'C', sku: 'C', materialDeadline: null }),
        item({ id: 2, lsx: 'B', sku: 'B', materialDeadline: plus(3) }),
        item({ id: 1, lsx: 'A', sku: 'A', materialDeadline: plus(3) }),
      ];
      expect((await all()).rows[0].priorityNote).toBe('Hàng về chia trước cho A, rồi B, rồi C');
    });

    it('supplierOrderId có khi dòng đã vào đơn NCC chưa huỷ', async () => {
      lines = [
        line({
          supplierOrder: { seq: 1, year: 2026, status: 'APPROVED', supplier: { name: 'X' } },
        }),
      ];
      items = [item({ materialDeadline: plus(2) })];
      expect((await all()).rows[0].supplierOrderId).toBe('900');
    });

    it('lenhCode của SKU = số LSX của dòng, chưa có thì mã lệnh hiển thị của PI (không phải mã PI khi đã có LSX)', async () => {
      lines = [line()];
      items = [
        item({ id: 1, lsx: 'MY-313', sku: 'A', materialDeadline: plus(2) }),
        item({ id: 2, lsx: null, sku: 'B', materialDeadline: plus(3) }),
      ];
      const r = await all();
      const row = r.rows[0];
      expect(row.lenhCode).toBe('MY-313'); // loadLenhDisplayCodes: LSX của các dòng nối " + "
      expect(row.skus.find((s) => s.skuCode === 'A')!.lenhCode).toBe('MY-313');
      expect(row.skus.find((s) => s.skuCode === 'B')!.lenhCode).toBe('MY-313');
      expect(row.skus.some((s) => s.lenhCode.startsWith('PI-'))).toBe(false);
    });

    it('SKU chưa có hạn xếp cuối và không kéo hạn của dòng', async () => {
      lines = [line()];
      items = [
        item({ id: 1, sku: 'N', materialDeadline: null }),
        item({ id: 2, sku: 'A', materialDeadline: plus(3) }),
      ];
      const row = (await all()).rows[0];
      expect(row.deadline).toBe(plus(3));
      expect(row.skus.map((s) => s.skuCode)).toEqual(['A', 'N']);
      expect(row.skus[1].deadline).toBeNull();
    });

    it('nhóm FINISHED (phụ kiện / nệm / bao bì) theo hạn Mua VT còn lại, không phải hạn Mua VT khung', async () => {
      lines = [line({ detailKind: 'ACCESSORY' })];
      items = [item({ materialDeadline: plus(1), finishedMaterialDeadline: plus(9) })];
      const row = (await all()).rows[0];
      expect(row.group).toBe('FINISHED');
      expect(row.deadline).toBe(plus(9));
    });

    it('chưa có hạn mua: dự phòng bắt đầu Phôi − 1 (FRAME) và bắt đầu Đóng gói − 7 (FINISHED)', async () => {
      lines = [line({ id: 1 }), line({ id: 2, detailKind: 'PACKAGING', materialId: 501 })];
      items = [
        item({
          stages: [
            { stageType: 'PHOI_START', deadline: plus(10) },
            { stageType: 'PACKAGING_START', deadline: plus(20) },
          ],
        }),
      ];
      const rows = (await all()).rows;
      expect(rows.find((r) => r.group === 'FRAME')!.deadline).toBe(plus(9));
      expect(rows.find((r) => r.group === 'FINISHED')!.deadline).toBe(plus(13));
    });

    it('PI không còn dòng SKU đang chạy nào (đã Kết thúc / huỷ -> DB không trả) -> bỏ dòng mua', async () => {
      lines = [line()];
      items = []; // lọc ở truy vấn
      const r = await all();
      expect(r.rows).toEqual([]);
      expect(r.counts).toEqual({
        overdue: 0,
        deadlineToday: 0,
        inWindow: 0,
        upcoming: 0,
        noDeadline: 0,
      });
    });

    it('truy vấn SKU dùng đúng filter "đang chạy" của Bảng mốc: đã duyệt, lệnh chưa Kết thúc, PI chưa huỷ, đơn bán còn sống', async () => {
      lines = [line()];
      items = [item({ materialDeadline: plus(1) })];
      await all();
      const calls = prisma.productionInvoiceItem.findMany.mock.calls as [
        { where: Record<string, unknown>; select: { stages?: unknown } },
      ][];
      const call = calls.find((c) => c[0].select.stages)![0];
      expect(call.where).toMatchObject({
        prodApprovalStatus: 'APPROVED',
        productionOrder: { is: { floorStage: { not: 'FINISHED' } } },
        productionInvoice: { status: { not: 'CANCELLED' } },
        OR: [{ salesOrderId: null }, { salesOrder: { isActive: true, deletedAt: null } }],
      });
    });
  });

  describe('dây / nệm riêng của từng dòng SKU (luật chung với Bảng mốc)', () => {
    it('dây của dòng khác trong PI không tính sang dòng này; dây của dòng đã Kết thúc không tính sang dòng còn chạy', async () => {
      const a = item({ id: 1, sku: 'A', wire: 100, materialDeadline: plus(2) });
      const b = item({ id: 2, sku: 'B', wire: 101, materialDeadline: plus(3) });
      const finished = item({ id: 3, sku: 'C', wire: 102, materialDeadline: plus(1) });
      items = [a, b]; // C đã Kết thúc: không có trên bảng
      approved = [a, b, finished];
      lines = [
        line({ id: 1, materialId: 100, name: 'Dây A' }),
        line({ id: 2, materialId: 101, name: 'Dây B' }),
        line({ id: 3, materialId: 102, name: 'Dây C (đã xong)' }),
        line({ id: 4, materialId: 999, name: 'Sắt chung' }),
      ];
      const rows = (await all()).rows;
      const skus = (name: string) =>
        rows.find((r) => r.materialName === name)?.skus.map((s) => s.skuCode);
      expect(skus('Dây A')).toEqual(['A']);
      expect(skus('Dây B')).toEqual(['B']);
      expect(skus('Dây C (đã xong)')).toBeUndefined(); // không SKU đang chạy nào dùng -> bỏ
      expect(skus('Sắt chung')).toEqual(['A', 'B']);
    });
  });

  describe('số theo dõi = SỐ CHỐT MUA', () => {
    const remainingOf = async (o: LineOpts) => {
      lines = [line(o)];
      items = [item({ materialDeadline: plus(1) })];
      return (await all()).rows[0];
    };

    it('cần 100, chốt mua 120, về 110 -> còn 10 trên số chốt', async () => {
      const row = await remainingOf({ buyQty: 100, orderQty: 120, receivedQty: 110 });
      expect(row).toMatchObject({
        needQty: 100,
        orderQty: 120,
        receivedQty: 110,
        remainingQty: 10,
      });
    });

    it('cần 100, chốt mua 120, về 100 -> VẪN còn 20 (không ngoại lệ mua dư)', async () => {
      const row = await remainingOf({ buyQty: 100, orderQty: 120, receivedQty: 100 });
      expect(row.remainingQty).toBe(20);
    });

    it('về đủ số chốt mua -> không có trong danh sách', async () => {
      lines = [line({ buyQty: 100, orderQty: 120, receivedQty: 120 })];
      items = [item({ materialDeadline: plus(1) })];
      expect((await all()).rows).toEqual([]);
    });

    it('chưa chốt số mua: theo buyQty; số chốt thấp hơn buyQty thì vẫn theo buyQty', async () => {
      expect(
        (await remainingOf({ buyQty: 100, orderQty: null, receivedQty: 60 })).remainingQty,
      ).toBe(40);
      expect((await remainingOf({ buyQty: 100, orderQty: 80, receivedQty: 60 })).orderQty).toBe(
        100,
      );
    });

    it('sai số thập phân (0,1 + 0,2) không làm dòng đã đủ bị coi là thiếu', async () => {
      lines = [line({ buyQty: 0.3, receivedQty: 0.1 + 0.2 })];
      items = [item({ materialDeadline: plus(1) })];
      expect((await all()).rows).toEqual([]);
    });

    it('chỉ lấy dòng NEW / QUOTING / SUBMITTED / PURCHASING (lọc theo chỉ mục status), PI phải có', async () => {
      lines = [line()];
      items = [item({ materialDeadline: plus(1) })];
      await all();
      const calls = prisma.purchaseProposalItem.findMany.mock.calls as [{ where: unknown }][];
      const where = calls[0][0].where;
      expect(where).toEqual({
        status: { in: ['NEW', 'QUOTING', 'SUBMITTED', 'PURCHASING'] },
        proposal: { productionInvoiceId: { not: null } },
      });
    });

    it.each(['NEW', 'QUOTING', 'SUBMITTED', 'PURCHASING'])(
      'trạng thái %s -> purchaseStatus giữ nguyên',
      async (status) => {
        expect((await remainingOf({ status })).purchaseStatus).toBe(status);
      },
    );
  });

  describe('NCC, người mua, kho, tên vật tư', () => {
    it('đơn đặt hàng chưa huỷ: tên NCC + số đơn seq/year', async () => {
      lines = [
        line({
          supplierOrder: { seq: 52, year: 2026, status: 'APPROVED', supplier: { name: 'Sơn Hà' } },
          quotes: [{ supplierName: 'NCC báo giá', supplier: null }],
        }),
      ];
      items = [item({ materialDeadline: plus(1) })];
      const row = (await all()).rows[0];
      expect(row).toMatchObject({ supplierName: 'Sơn Hà', supplierOrderCode: '52/2026' });
    });

    it('đơn đã huỷ: rơi về báo giá được chọn (tên NCC trong danh mục trước, rồi tên nhập tay), không có số đơn', async () => {
      lines = [
        line({
          id: 1,
          supplierOrder: { seq: 9, year: 2026, status: 'CANCELLED', supplier: { name: 'Đã huỷ' } },
          quotes: [{ supplierName: 'Tên tay', supplier: { name: 'NCC danh mục' } }],
        }),
        line({
          id: 2,
          materialId: 501,
          supplierOrder: { seq: 9, year: 2026, status: 'CANCELLED', supplier: { name: 'Đã huỷ' } },
          quotes: [{ supplierName: 'Tên tay', supplier: null }],
        }),
      ];
      items = [item({ materialDeadline: plus(1) })];
      const rows = (await all()).rows;
      expect(rows.find((r) => r.lineId === '1')).toMatchObject({
        supplierName: 'NCC danh mục',
        supplierOrderCode: null,
      });
      expect(rows.find((r) => r.lineId === '2')).toMatchObject({
        supplierName: 'Tên tay',
        supplierOrderCode: null,
      });
    });

    it('chưa đặt: supplierName / supplierOrderCode null', async () => {
      lines = [line()];
      items = [item({ materialDeadline: plus(1) })];
      expect((await all()).rows[0]).toMatchObject({ supplierName: null, supplierOrderCode: null });
    });

    it('người mua "firstName lastName"; vật tư chưa gán người mua -> null', async () => {
      lines = [line({ id: 1 }), line({ id: 2, materialId: 501, buyerId: null, buyer: null })];
      items = [item({ materialDeadline: plus(1) })];
      const rows = (await all()).rows;
      expect(rows.find((r) => r.lineId === '1')).toMatchObject({
        buyerId: 'b1',
        buyerName: 'Lan Nguyễn',
      });
      expect(rows.find((r) => r.lineId === '2')).toMatchObject({ buyerId: null, buyerName: null });
    });

    it('kho = kho của vật tư, hoặc kho ghi đè (tên kho tra 1 lần)', async () => {
      prisma.warehouse.findMany.mockResolvedValue([{ code: 'vat-tu-tp', name: 'Kho TP' }]);
      lines = [
        line({ id: 1 }),
        line({ id: 2, materialId: 501, receiveWarehouseCode: 'vat-tu-tp' }),
      ];
      items = [item({ materialDeadline: plus(1) })];
      const rows = (await all()).rows;
      expect(rows.find((r) => r.lineId === '1')).toMatchObject({
        warehouseCode: 'phoi-son-han',
        warehouseName: 'Kho Phôi Sơn Hàn',
      });
      expect(rows.find((r) => r.lineId === '2')).toMatchObject({
        warehouseCode: 'vat-tu-tp',
        warehouseName: 'Kho TP',
      });
      expect(prisma.warehouse.findMany).toHaveBeenCalledTimes(1);
    });

    it('tên vật tư kèm chiều dài cây (đơn vị "cây") hoặc quy cách; các dòng còn lại theo Material.unit', async () => {
      lines = [
        line({ id: 1, name: 'Sắt', unit: 'Mm', stockLengthMm: 6000 }),
        line({ id: 2, materialId: 501, name: 'Nệm', unit: 'cái', spec: '1m2' }),
        line({ id: 3, materialId: 502, name: 'Đinh', unit: 'kg' }),
      ];
      items = [item({ materialDeadline: plus(1) })];
      const rows = (await all()).rows;
      const byId = (id: string) => rows.find((r) => r.lineId === id)!;
      expect(byId('1')).toMatchObject({
        materialName: `Sắt (${(6000).toLocaleString('vi-VN')} mm)`,
        unit: 'cây',
      });
      expect(byId('2')).toMatchObject({ materialName: 'Nệm (1m2)', unit: 'cái' });
      expect(byId('3')).toMatchObject({ materialName: 'Đinh', unit: 'kg' });
    });
  });

  describe('phạm vi người xem', () => {
    beforeEach(() => {
      lines = [
        line({
          id: 1,
          materialId: 500,
          buyerId: 'b1',
          warehouse: { code: 'phoi-son-han', name: 'K1' },
        }),
        line({
          id: 2,
          materialId: 501,
          buyerId: 'b2',
          warehouse: { code: 'vat-tu-tp', name: 'K2' },
        }),
        line({
          id: 3,
          materialId: 502,
          buyerId: 'b1',
          warehouse: { code: 'vat-tu-tp', name: 'K2' },
        }),
      ];
      items = [item({ materialDeadline: plus(1) })];
    });

    it('người mua: mặc định "mine" (chỉ vật tư mình), canChooseScope = true', async () => {
      const r = await service.list(user({ id: 'b1', roles: ['PURCHASER'] }), { view: 'all' }, NOW);
      expect(r).toMatchObject({ scope: 'mine', canChooseScope: true, warehouseScope: null });
      expect(r.rows.map((x) => x.lineId).sort()).toEqual(['1', '3']);
    });

    it('người mua chọn scope=all -> thấy hết', async () => {
      const r = await service.list(
        user({ id: 'b1', roles: ['PURCHASER'] }),
        { view: 'all', scope: 'all' },
        NOW,
      );
      expect(r.scope).toBe('all');
      expect(r.rows).toHaveLength(3);
    });

    it.each(['PRODUCTION_PLANNER', 'PRODUCTION_MANAGER', 'BOSS', 'ADMIN'])(
      '%s: thấy tất cả, bỏ qua scope=mine, không chọn được',
      async (role) => {
        const r = await service.list(user({ roles: [role] }), { view: 'all', scope: 'mine' }, NOW);
        expect(r).toMatchObject({ scope: 'all', canChooseScope: false, warehouseScope: null });
        expect(r.rows).toHaveLength(3);
      },
    );

    it('thủ kho có warehouseScope: chỉ dòng kho mình, response ghi mã kho', async () => {
      const r = await service.list(
        user({ roles: ['WAREHOUSE_STAFF'], warehouseScope: 'vat-tu-tp' }),
        { view: 'all' },
        NOW,
      );
      expect(r).toMatchObject({
        scope: 'all',
        canChooseScope: false,
        warehouseScope: 'vat-tu-tp',
        warehouseScopeName: 'Kho Vật tư TP',
      });
      expect(r.rows.map((x) => x.lineId).sort()).toEqual(['2', '3']);
    });

    it('thủ kho không khoá kho (warehouseScope null) -> tất cả', async () => {
      const r = await service.list(user({ roles: ['WAREHOUSE_STAFF'] }), { view: 'all' }, NOW);
      expect(r.warehouseScope).toBeNull();
      expect(r.rows).toHaveLength(3);
    });

    it('vừa người mua vừa thủ kho: tính theo người mua', async () => {
      const r = await service.list(
        user({ id: 'b2', roles: ['PURCHASER', 'WAREHOUSE_STAFF'], warehouseScope: 'phoi-son-han' }),
        { view: 'all' },
        NOW,
      );
      expect(r.canChooseScope).toBe(true);
      expect(r.warehouseScope).toBeNull();
      expect(r.rows.map((x) => x.lineId)).toEqual(['2']);
    });

    it('counts đếm trên tập đã lọc phạm vi, TRƯỚC bộ lọc view', async () => {
      lines = [
        line({ id: 1, materialId: 500, buyerId: 'b1' }),
        line({ id: 2, materialId: 501, buyerId: 'b1' }),
        line({ id: 3, materialId: 502, buyerId: 'b2' }),
      ];
      items = [
        item({ id: 1, sku: 'A', wire: 500, materialDeadline: plus(-3) }),
        item({ id: 2, sku: 'B', wire: 501, materialDeadline: plus(9) }),
        item({ id: 3, sku: 'C', wire: 502, materialDeadline: plus(2) }),
      ];
      const r = await service.list(
        user({ id: 'b1', roles: ['PURCHASER'] }),
        { view: 'overdue' },
        NOW,
      );
      expect(r.counts).toEqual({
        overdue: 1,
        deadlineToday: 0,
        inWindow: 0,
        upcoming: 1,
        noDeadline: 0,
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].state).toBe('OVERDUE');
    });
  });

  describe('view, sắp xếp', () => {
    beforeEach(() => {
      lines = [
        line({ id: 1, materialId: 1, name: 'Z-overdue' }),
        line({ id: 2, materialId: 2, name: 'B-today' }),
        line({ id: 3, materialId: 3, name: 'C-window' }),
        line({ id: 4, materialId: 4, name: 'D-upcoming' }),
        line({ id: 5, materialId: 5, name: 'E-nodeadline' }),
        line({ id: 6, materialId: 6, name: 'A-window-sooner' }),
      ];
      items = [
        item({ id: 1, wire: 1, sku: 'S1', materialDeadline: plus(-2) }),
        item({ id: 2, wire: 2, sku: 'S2', materialDeadline: plus(0) }),
        item({ id: 3, wire: 3, sku: 'S3', materialDeadline: plus(4) }),
        item({ id: 4, wire: 4, sku: 'S4', materialDeadline: plus(8) }),
        item({ id: 5, wire: 5, sku: 'S5', materialDeadline: null }),
        item({ id: 6, wire: 6, sku: 'S6', materialDeadline: plus(2) }),
      ];
    });

    const names = (r: { rows: { materialName: string }[] }) => r.rows.map((x) => x.materialName);

    it('view=all: OVERDUE → DEADLINE_TODAY → IN_WINDOW (hạn gần trước) → UPCOMING → NO_DEADLINE', async () => {
      expect(names(await all())).toEqual([
        'Z-overdue',
        'B-today',
        'A-window-sooner',
        'C-window',
        'D-upcoming',
        'E-nodeadline',
      ]);
    });

    it('view=overdue chỉ OVERDUE', async () => {
      const r = await service.list(user({ roles: ['BOSS'] }), { view: 'overdue' }, NOW);
      expect(names(r)).toEqual(['Z-overdue']);
    });

    it('view=today = DEADLINE_TODAY + IN_WINDOW (mặc định khi không truyền view)', async () => {
      const r = await service.list(user({ roles: ['BOSS'] }), {}, NOW);
      expect(r.view).toBe('today');
      expect(names(r)).toEqual(['B-today', 'A-window-sooner', 'C-window']);
    });

    it('view=date D: dòng có [về sớm nhất, hạn chót] chứa D', async () => {
      // N = 4: S3 hạn +4 -> về từ hôm nay; S4 hạn +8 -> về từ +4; S6 hạn +2 -> về từ −2.
      const at4 = await service.list(
        user({ roles: ['BOSS'] }),
        { view: 'date', date: plus(4) },
        NOW,
      );
      expect(names(at4).sort()).toEqual(['C-window', 'D-upcoming']);
      expect(at4).toMatchObject({ view: 'date', date: plus(4) });
      const at8 = await service.list(
        user({ roles: ['BOSS'] }),
        { view: 'date', date: plus(8) },
        NOW,
      );
      expect(names(at8)).toEqual(['D-upcoming']);
      const at9 = await service.list(
        user({ roles: ['BOSS'] }),
        { view: 'date', date: plus(9) },
        NOW,
      );
      expect(at9.rows).toEqual([]);
    });

    it('view=date thiếu date hoặc date sai -> 400', async () => {
      await expect(service.list(user({ roles: ['BOSS'] }), { view: 'date' }, NOW)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.list(user({ roles: ['BOSS'] }), { view: 'date', date: '2026-02-31' }, NOW),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.list(user({ roles: ['BOSS'] }), { view: 'date', date: 'abc' }, NOW),
      ).rejects.toThrow(BadRequestException);
    });

    it('date chỉ được ghi vào response khi view=date', async () => {
      const r = await service.list(user({ roles: ['BOSS'] }), { view: 'all', date: plus(4) }, NOW);
      expect(r.date).toBeNull();
    });
  });

  describe('badge (countDueNow) và bộ nhớ tạm 60 s', () => {
    beforeEach(() => {
      lines = [
        line({ id: 1, materialId: 1, buyerId: 'b1', warehouse: { code: 'k1', name: 'K1' } }),
        line({ id: 2, materialId: 2, buyerId: 'b1', warehouse: { code: 'k2', name: 'K2' } }),
        line({ id: 3, materialId: 3, buyerId: 'b2', warehouse: { code: 'k1', name: 'K1' } }),
        line({ id: 4, materialId: 4, buyerId: 'b1', warehouse: { code: 'k1', name: 'K1' } }),
      ];
      items = [
        item({ id: 1, wire: 1, sku: 'S1', materialDeadline: plus(-1) }), // OVERDUE
        item({ id: 2, wire: 2, sku: 'S2', materialDeadline: plus(0) }), // DEADLINE_TODAY
        item({ id: 3, wire: 3, sku: 'S3', materialDeadline: plus(3) }), // IN_WINDOW
        item({ id: 4, wire: 4, sku: 'S4', materialDeadline: plus(20) }), // UPCOMING - không tính badge
      ];
    });

    it('người mua: quá hạn + hạn chót hôm nay + trong khoảng, CHỈ vật tư của mình', async () => {
      expect(await service.countDueNow(user({ id: 'b1', roles: ['PURCHASER'] }), NOW)).toBe(2);
      expect(await service.countDueNow(user({ id: 'b2', roles: ['PURCHASER'] }), NOW)).toBe(1);
    });

    it('thủ kho: theo kho mình', async () => {
      expect(
        await service.countDueNow(user({ roles: ['WAREHOUSE_STAFF'], warehouseScope: 'k1' }), NOW),
      ).toBe(2);
      expect(
        await service.countDueNow(user({ roles: ['WAREHOUSE_STAFF'], warehouseScope: 'k2' }), NOW),
      ).toBe(1);
    });

    it('người vừa mua vừa thủ kho: theo người mua', async () => {
      expect(
        await service.countDueNow(
          user({ id: 'b2', roles: ['PURCHASER', 'WAREHOUSE_STAFF'], warehouseScope: 'k2' }),
          NOW,
        ),
      ).toBe(1);
    });

    it('nhiều người gọi trong 60 s chỉ tính 1 lần', async () => {
      await service.countDueNow(user({ id: 'b1', roles: ['PURCHASER'] }), NOW);
      await service.countDueNow(
        user({ id: 'b2', roles: ['PURCHASER'] }),
        new Date(NOW.getTime() + 30_000),
      );
      await service.countDueNow(
        user({ roles: ['WAREHOUSE_STAFF'], warehouseScope: 'k1' }),
        new Date(NOW.getTime() + CACHE_TTL_MS - 1),
      );
      expect(prisma.purchaseProposalItem.findMany).toHaveBeenCalledTimes(1);
    });

    it('quá 60 s thì tính lại', async () => {
      await service.countDueNow(user({ id: 'b1', roles: ['PURCHASER'] }), NOW);
      await service.countDueNow(
        user({ id: 'b1', roles: ['PURCHASER'] }),
        new Date(NOW.getTime() + CACHE_TTL_MS),
      );
      expect(prisma.purchaseProposalItem.findMany).toHaveBeenCalledTimes(2);
    });

    it('sang ngày VN mới thì tính lại dù chưa đủ 60 s (trạng thái đổi theo ngày)', async () => {
      const lastMinute = new Date('2026-11-05T16:59:30.000Z'); // 23:59:30 VN
      const nextDay = new Date('2026-11-05T17:00:10.000Z'); // 00:00:10 06/11 VN
      await service.countDueNow(user({ id: 'b1', roles: ['PURCHASER'] }), lastMinute);
      await service.countDueNow(user({ id: 'b1', roles: ['PURCHASER'] }), nextDay);
      expect(prisma.purchaseProposalItem.findMany).toHaveBeenCalledTimes(2);
    });

    it('list() luôn tính mới và cập nhật bộ nhớ tạm cho badge', async () => {
      await service.countDueNow(user({ id: 'b1', roles: ['PURCHASER'] }), NOW);
      lines = [lines[0]]; // dữ liệu đổi (hàng về)
      await service.list(
        user({ roles: ['BOSS'] }),
        { view: 'all' },
        new Date(NOW.getTime() + 5_000),
      );
      expect(prisma.purchaseProposalItem.findMany).toHaveBeenCalledTimes(2);
      const n = await service.countDueNow(
        user({ id: 'b1', roles: ['PURCHASER'] }),
        new Date(NOW.getTime() + 10_000),
      );
      expect(n).toBe(1); // dùng số mới, không truy vấn thêm
      expect(prisma.purchaseProposalItem.findMany).toHaveBeenCalledTimes(2);
    });

    it('listAllRows(fresh) bỏ qua bộ nhớ tạm cho tin sáng', async () => {
      await service.countDueNow(user({ id: 'b1', roles: ['PURCHASER'] }), NOW);
      const { rows, today } = await service.listAllRows(new Date(NOW.getTime() + 1_000));
      expect(today).toBe(TODAY);
      expect(rows).toHaveLength(4);
      expect(prisma.purchaseProposalItem.findMany).toHaveBeenCalledTimes(2);
    });

    it('không có dòng mua nào: badge 0 và không truy vấn SKU', async () => {
      lines = [];
      expect(await service.countDueNow(user({ id: 'b1', roles: ['PURCHASER'] }), NOW)).toBe(0);
      expect(prisma.productionInvoiceItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('hiệu năng', () => {
    it('~500 dòng mua / 120 SKU: số truy vấn cố định, không N+1', async () => {
      const piCount = 40;
      lines = Array.from({ length: 500 }, (_, i) =>
        line({ id: i + 1, pi: (i % piCount) + 1, materialId: 1000 + i, buyQty: 10 }),
      );
      items = Array.from({ length: 120 }, (_, i) =>
        item({
          id: i + 1,
          pi: (i % piCount) + 1,
          sku: `SKU-${i}`,
          lsx: `MY-${i}`,
          wire: i % 3 === 0 ? 1000 + i : null,
          materialDeadline: plus((i % 12) - 3),
        }),
      );
      approved = items;
      prisma.productionInvoice.findMany.mockResolvedValue(
        Array.from({ length: piCount }, (_, i) => ({ id: BigInt(i + 1), code: `PI-${i + 1}` })),
      );
      const r = await service.list(user({ roles: ['BOSS'] }), { view: 'all' }, NOW);
      expect(r.rows.length).toBeGreaterThan(400);
      expect(prisma.purchaseProposalItem.findMany).toHaveBeenCalledTimes(1);
      // SKU đang chạy + dây/nệm đã duyệt + số LSX = 3 truy vấn productionInvoiceItem; PI 1; kho 0 (không ghi đè); cấu hình 1.
      expect(prisma.productionInvoiceItem.findMany).toHaveBeenCalledTimes(3);
      expect(prisma.productionInvoice.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.warehouse.findMany).not.toHaveBeenCalled();
      expect(prisma.systemConfig.findUnique).toHaveBeenCalledTimes(1);
    });
  });
});
