import { PrismaServiceType } from '../../prisma/prisma.service';
import { WorkQueueService } from './work-queue.service';

/**
 * UB9 (P1 "KCS tự chuyển", tester-unit #3) - số đỏ menu KCS của GET /me/work-queue.
 *
 * Spec của Dev (work-queue.service.spec.ts) giả lập listKcsPendingItems rồi kiểm phép đếm. Ở đây KHÔNG giả lập hàm đó: chạy
 * WorkQueueService + kcs-pending.util THẬT trên DB giả (mỗi bảng trả đúng dòng theo điều kiện status / PI), để bắt lỗi ở chỗ nối
 * "bảng -> dòng đợt -> số đỏ" (AC1, AC10, AC11, AC12, MF6).
 */

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 18, h, m));
const KCS_USER = { id: 'kcs-1', roles: ['KCS_STAFF'], warehouseScope: null };

interface Db {
  cutBundles: { status: string; piId: bigint | null; at?: Date }[];
  stepBatches: {
    pi: bigint;
    order: bigint | null;
    worker: string;
    material?: bigint;
    step?: string;
  }[];
  stepBundles: { pi: bigint }[];
  batches: { stage: 'PHOI' | 'HAN' | 'SON'; status: string; pi: bigint }[];
  pieceStepBatches: { order: bigint; piece: bigint; step: string; pi: bigint }[];
  pieceStepBundles: { pi: bigint }[];
  yieldBatches: { pi: bigint; recipe: bigint; step: string }[];
  yieldBundles: { pi: bigint }[];
  /** PI còn SKU ACTIVE; PI khác coi là dừng. */
  activePis: bigint[];
  /** Số SKU (lệnh) của từng PI. */
  skuCount: Record<string, number>;
}

const emptyDb = (): Db => ({
  cutBundles: [],
  stepBatches: [],
  stepBundles: [],
  batches: [],
  pieceStepBatches: [],
  pieceStepBundles: [],
  yieldBatches: [],
  yieldBundles: [],
  activePis: [],
  skuCount: {},
});

/** DB giả: trả dòng theo ĐÚNG điều kiện status mà util hỏi (không trả thừa), để đổi trạng thái là số đỏ đổi theo. */
function makePrisma(d: Db) {
  const reports = [{ createdAt: T(1) }];
  const wherePi = (ids: bigint[]) => ids;
  return {
    cutBundle: {
      findMany: jest.fn(({ where }: { where: { status: { in: string[] } } }) =>
        Promise.resolve(
          d.cutBundles
            .filter((b) => where.status.in.includes(b.status))
            .map((b) => ({
              status: b.status,
              createdAt: b.at ?? T(1),
              steelIssue: b.piId == null ? null : { productionInvoiceId: b.piId },
              floorReports: reports,
            })),
        ),
      ),
    },
    stepBatch: {
      findMany: jest.fn(() =>
        Promise.resolve(
          d.stepBatches.map((s) => ({
            productionInvoiceId: s.pi,
            materialId: s.material ?? 7n,
            step: s.step ?? 'UON',
            productionOrderId: s.order,
            reportedById: s.worker,
            createdAt: T(1),
            floorReports: reports,
          })),
        ),
      ),
    },
    stepBundle: {
      findMany: jest.fn(() =>
        Promise.resolve(
          d.stepBundles.map((s) => ({
            productionInvoiceId: s.pi,
            submittedAt: T(2),
            batches: [{ createdAt: T(1), floorReports: reports }],
          })),
        ),
      ),
    },
    productionBatch: {
      findMany: jest.fn(
        ({ where }: { where: { stage: { in: string[] }; status: { in: string[] } } }) =>
          Promise.resolve(
            d.batches
              .filter((b) => where.stage.in.includes(b.stage) && where.status.in.includes(b.status))
              .map((b) => ({
                stage: b.stage,
                status: b.status,
                reportedAt: T(1),
                productionOrder: { productionInvoiceItem: { productionInvoiceId: b.pi } },
                floorReports: reports,
              })),
          ),
      ),
    },
    pieceStepBatch: {
      findMany: jest.fn(() =>
        Promise.resolve(
          d.pieceStepBatches.map((p) => ({
            productionOrderId: p.order,
            pieceId: p.piece,
            step: p.step,
            reportedAt: T(1),
            productionOrder: { productionInvoiceItem: { productionInvoiceId: p.pi } },
          })),
        ),
      ),
    },
    pieceStepBundle: {
      findMany: jest.fn(() =>
        Promise.resolve(
          d.pieceStepBundles.map((p) => ({
            submittedAt: T(2),
            productionOrder: { productionInvoiceItem: { productionInvoiceId: p.pi } },
            batches: [{ reportedAt: T(1) }],
          })),
        ),
      ),
    },
    materialYieldStepBatch: {
      findMany: jest.fn(() =>
        Promise.resolve(
          d.yieldBatches.map((y) => ({
            productionInvoiceId: y.pi,
            recipeId: y.recipe,
            step: y.step,
            reportedAt: T(1),
          })),
        ),
      ),
    },
    materialYieldStepBundle: {
      findMany: jest.fn(() =>
        Promise.resolve(
          d.yieldBundles.map((y) => ({
            productionInvoiceId: y.pi,
            submittedAt: T(2),
            batches: [{ reportedAt: T(1) }],
          })),
        ),
      ),
    },
    productionInvoice: {
      findMany: jest.fn(({ where }: { where: { id: { in: bigint[] } } }) =>
        Promise.resolve(
          wherePi(where.id.in)
            .filter((id) => d.activePis.includes(id))
            .map((id) => ({ id })),
        ),
      ),
    },
    productionOrder: {
      findMany: jest.fn(
        ({
          where,
        }: {
          where: { productionInvoiceItem: { productionInvoiceId: { in: bigint[] } } };
        }) =>
          Promise.resolve(
            where.productionInvoiceItem.productionInvoiceId.in.flatMap((pi) =>
              Array.from({ length: d.skuCount[pi.toString()] ?? 1 }, (_, i) => ({
                id: pi * 100n + BigInt(i),
                productionInvoiceItem: { productionInvoiceId: pi },
              })),
            ),
          ),
      ),
    },
  };
}

function makeService(d: Db) {
  const prisma = makePrisma(d);
  // Nếu KCS bị lọc theo xưởng thì getScope sẽ bị gọi: để nó ném lỗi cho lộ ngay.
  const workshopScope = {
    getScope: jest.fn().mockRejectedValue(new Error('KCS không được hỏi phạm vi xưởng')),
  };
  const never = (n: string) =>
    new Proxy(
      {},
      {
        get: () => () => {
          throw new Error(`${n} không được gọi khi chỉ có vai KCS`);
        },
      },
    );
  const service = new WorkQueueService(
    prisma as unknown as PrismaServiceType,
    never('cuttingProposals') as never,
    never('salesOrders') as never,
    never('materialsDue') as never,
    workshopScope as never,
    never('paintReminder') as never,
  );
  return { service, prisma, workshopScope };
}

const counts = async (d: Db, user = KCS_USER) => {
  const h = makeService(d);
  const r = await h.service.getWorkQueue(user);
  return { ...h, counts: r.counts };
};

describe('UB9 AC1 - đợt cắt đang mở (CUTTING) tính vào số đỏ KCS Phôi, không cần tin CUT_BUNDLE_TO_KCS', () => {
  it('công nhân vừa Lưu 120 đoạn (đợt CUTTING, chưa ai bấm Chấm) -> kcsPhoi = 1, kcsHan / kcsSon = 0', async () => {
    const d = emptyDb();
    d.activePis = [45n];
    d.cutBundles = [{ status: 'CUTTING', piId: 45n }];

    const { counts: c } = await counts(d);

    expect(c).toMatchObject({ kcsPhoi: 1, kcsHan: 0, kcsSon: 0 });
  });

  it('KCS bấm Chấm (CUTTING -> AWAITING_QC): số đỏ KHÔNG đổi (đợt vẫn chờ chấm); KCS chấm xong (QC_*) thì giảm 1', async () => {
    const d = emptyDb();
    d.activePis = [45n];
    d.cutBundles = [{ status: 'CUTTING', piId: 45n }];
    expect((await counts(d)).counts.kcsPhoi).toBe(1);

    d.cutBundles[0].status = 'AWAITING_QC';
    expect((await counts(d)).counts.kcsPhoi).toBe(1);

    d.cutBundles[0].status = 'QC_PASSED';
    expect((await counts(d)).counts.kcsPhoi).toBe(0);
  });

  it('đợt cắt không gắn lệnh nào (steelIssue null) vẫn tính, không ném lỗi', async () => {
    const d = emptyDb();
    d.cutBundles = [{ status: 'CUTTING', piId: null }];

    expect((await counts(d)).counts.kcsPhoi).toBe(1);
  });

  it('2 công nhân cùng báo cắt -> 2 đợt đang mở = số đỏ 2 (số đếm là số đợt, không phải số lần báo hay số đoạn)', async () => {
    const d = emptyDb();
    d.activePis = [45n];
    d.cutBundles = [
      { status: 'CUTTING', piId: 45n },
      { status: 'CUTTING', piId: 45n },
    ];
    expect((await counts(d)).counts.kcsPhoi).toBe(2);
  });
});

describe('UB9 AC10 - KCS thấy mọi xưởng; số đỏ = số dòng chờ (đang mở + đã chốt) trên 3 màn', () => {
  const full = (): Db => {
    const d = emptyDb();
    // PI 45 = Phú An, PI 46 = Phước An (lô Sơn của PI 46 sơn ở Phú An) - số đếm không phân biệt xưởng.
    d.activePis = [45n, 46n];
    d.cutBundles = [
      { status: 'CUTTING', piId: 45n },
      { status: 'AWAITING_QC', piId: 46n },
    ];
    d.stepBatches = [{ pi: 46n, order: 4600n, worker: 'cn-an' }];
    d.stepBundles = [{ pi: 45n }];
    d.pieceStepBatches = [{ order: 4500n, piece: 5n, step: 'DAP', pi: 45n }];
    d.yieldBatches = [{ pi: 46n, recipe: 3n, step: 'CAT' }];
    d.batches = [
      { stage: 'PHOI', status: 'OPEN', pi: 45n },
      { stage: 'HAN', status: 'OPEN', pi: 45n },
      { stage: 'HAN', status: 'AWAITING_QC', pi: 46n },
      { stage: 'SON', status: 'OPEN', pi: 46n },
    ];
    return d;
  };

  it('tổng 3 màn khớp từng loại đợt của cả 2 xưởng: Phôi 7 (2 cắt + 1 nhóm công đoạn + 1 đã chốt + 1 pat + 1 chân nhôm + 1 lô mảnh), Hàn 2, Sơn 1', async () => {
    const { counts: c } = await counts(full());

    expect(c).toMatchObject({ kcsPhoi: 7, kcsHan: 2, kcsSon: 1 });
  });

  it('KCS có gắn xưởng Phú An: số đỏ giống hệt KCS không gắn xưởng, và không hề hỏi phạm vi xưởng', async () => {
    const withWorkshop = await counts(full(), {
      id: 'kcs-pa',
      roles: ['KCS_STAFF'],
      warehouseScope: null,
    });
    const without = await counts(full());

    expect(withWorkshop.counts).toEqual(without.counts);
    expect(withWorkshop.workshopScope.getScope).not.toHaveBeenCalled();
  });

  it('lô đã QC_DONE / bị loại không còn trong số đỏ (chỉ OPEN + AWAITING_QC)', async () => {
    const d = full();
    d.batches.push(
      { stage: 'HAN', status: 'QC_DONE', pi: 45n },
      { stage: 'SON', status: 'REJECTED', pi: 46n },
    );

    expect((await counts(d)).counts).toMatchObject({ kcsPhoi: 7, kcsHan: 2, kcsSon: 1 });
  });

  it('chấm xong lô Hàn đã chốt: kcsHan giảm 1, 2 màn kia không đổi', async () => {
    const d = full();
    d.batches.find((b) => b.stage === 'HAN' && b.status === 'AWAITING_QC')!.status = 'QC_DONE';

    expect((await counts(d)).counts).toMatchObject({ kcsPhoi: 7, kcsHan: 1, kcsSon: 1 });
  });

  it('vai không phải KCS (công nhân, không vai) không có khoá kcs* và không đọc bảng đợt nào', async () => {
    const { service, prisma } = makeService(emptyDb());

    for (const roles of [['FLOOR_WORKER'], []]) {
      const r = await service.getWorkQueue({ id: 'u', roles, warehouseScope: null });
      expect(r.counts).not.toHaveProperty('kcsPhoi');
      expect(r.counts).not.toHaveProperty('kcsHan');
      expect(r.counts).not.toHaveProperty('kcsSon');
    }
    expect(prisma.cutBundle.findMany).not.toHaveBeenCalled();
    expect(prisma.productionBatch.findMany).not.toHaveBeenCalled();
  });
});

describe('UB9 AC11 / MF6 - lệnh tạm dừng / kết thúc: dòng xám không tính vào số đỏ', () => {
  it('lô Hàn đang mở 20 mảnh, rồi QLSX Tạm dừng mọi SKU của lệnh -> kcsHan từ 1 về 0; Tiếp tục lại thì về 1', async () => {
    const d = emptyDb();
    d.activePis = [45n];
    d.batches = [{ stage: 'HAN', status: 'OPEN', pi: 45n }];
    expect((await counts(d)).counts.kcsHan).toBe(1);

    d.activePis = [];
    expect((await counts(d)).counts.kcsHan).toBe(0);

    d.activePis = [45n];
    expect((await counts(d)).counts.kcsHan).toBe(1);
  });

  it('Q3: đợt ĐÃ CHỐT (AWAITING_QC) rồi lệnh mới dừng -> cũng không tính, cho cả 5 loại đợt', async () => {
    const d = emptyDb();
    d.activePis = []; // PI 45 dừng
    d.cutBundles = [{ status: 'AWAITING_QC', piId: 45n }];
    d.stepBundles = [{ pi: 45n }];
    d.pieceStepBundles = [{ pi: 45n }];
    d.yieldBundles = [{ pi: 45n }];
    d.batches = [
      { stage: 'PHOI', status: 'AWAITING_QC', pi: 45n },
      { stage: 'HAN', status: 'AWAITING_QC', pi: 45n },
      { stage: 'SON', status: 'AWAITING_QC', pi: 45n },
    ];

    expect((await counts(d)).counts).toMatchObject({ kcsPhoi: 0, kcsHan: 0, kcsSon: 0 });
  });

  it('chỉ lệnh bị dừng bị loại: lệnh khác đang chạy vẫn tính đủ', async () => {
    const d = emptyDb();
    d.activePis = [46n];
    d.batches = [
      { stage: 'HAN', status: 'OPEN', pi: 45n },
      { stage: 'HAN', status: 'OPEN', pi: 46n },
    ];

    expect((await counts(d)).counts.kcsHan).toBe(1);
  });
});

describe('UB9 AC12 / MF5 - dòng công đoạn phụ chưa gắn SKU', () => {
  it('PI 1 SKU: dòng chưa gắn SKU gộp vào nhóm của SKU duy nhất (cùng người) -> 1 dòng, tính vào số đỏ', async () => {
    const d = emptyDb();
    d.activePis = [45n];
    d.skuCount = { '45': 1 };
    d.stepBatches = [
      { pi: 45n, order: null, worker: 'cn-an' }, // dữ liệu cũ, 20 đoạn
      { pi: 45n, order: 4500n, worker: 'cn-an' }, // SKU duy nhất, 80 đoạn
    ];

    expect((await counts(d)).counts.kcsPhoi).toBe(1);
  });

  it('PI 1 SKU chỉ có dòng chưa gắn SKU: vẫn tính (không bị xám mãi)', async () => {
    const d = emptyDb();
    d.activePis = [45n];
    d.skuCount = { '45': 1 };
    d.stepBatches = [{ pi: 45n, order: null, worker: 'cn-an' }];

    expect((await counts(d)).counts.kcsPhoi).toBe(1);
  });

  it('PI NHIỀU SKU: nhóm chưa gắn SKU là dòng xám (không tính); nhóm đã gắn SKU của cùng người vẫn tính', async () => {
    const d = emptyDb();
    d.activePis = [45n];
    d.skuCount = { '45': 2 };
    d.stepBatches = [
      { pi: 45n, order: null, worker: 'cn-an' },
      { pi: 45n, order: 4500n, worker: 'cn-an' },
    ];

    expect((await counts(d)).counts.kcsPhoi).toBe(1);
  });

  it('PI nhiều SKU chỉ có dòng chưa gắn SKU -> số đỏ 0 (không có gì chấm được)', async () => {
    const d = emptyDb();
    d.activePis = [45n];
    d.skuCount = { '45': 3 };
    d.stepBatches = [{ pi: 45n, order: null, worker: 'cn-an' }];

    expect((await counts(d)).counts.kcsPhoi).toBe(0);
  });

  it('mỗi công nhân 1 nhóm riêng: 2 người cùng PI / sắt / công đoạn / SKU = 2 dòng; cùng người khác công đoạn = 2 dòng', async () => {
    const d = emptyDb();
    d.activePis = [45n];
    d.stepBatches = [
      { pi: 45n, order: 4500n, worker: 'cn-an' },
      { pi: 45n, order: 4500n, worker: 'cn-binh' },
      { pi: 45n, order: 4500n, worker: 'cn-an', step: 'DAP' },
      { pi: 45n, order: 4500n, worker: 'cn-an' }, // lần Lưu thứ 2 của cn-an cùng công đoạn: vẫn 1 nhóm
    ];

    expect((await counts(d)).counts.kcsPhoi).toBe(3);
  });
});

describe('UB9 AC9 - pat và chân nhôm chưa gom tính theo nhóm, không theo từng lần báo', () => {
  it('3 lần báo pat Dập cùng (lệnh, mảnh, công đoạn) + 2 lần báo chân nhôm cùng (PI, công thức, công đoạn) -> 2 dòng', async () => {
    const d = emptyDb();
    d.activePis = [45n];
    d.pieceStepBatches = [
      { order: 4500n, piece: 5n, step: 'DAP', pi: 45n },
      { order: 4500n, piece: 5n, step: 'DAP', pi: 45n },
      { order: 4500n, piece: 5n, step: 'DAP', pi: 45n },
    ];
    d.yieldBatches = [
      { pi: 45n, recipe: 3n, step: 'CAT' },
      { pi: 45n, recipe: 3n, step: 'CAT' },
    ];

    expect((await counts(d)).counts.kcsPhoi).toBe(2);
  });

  it('pat khác công đoạn / khác mảnh là nhóm riêng; chân nhôm khác công thức là nhóm riêng', async () => {
    const d = emptyDb();
    d.activePis = [45n];
    d.pieceStepBatches = [
      { order: 4500n, piece: 5n, step: 'DAP', pi: 45n },
      { order: 4500n, piece: 5n, step: 'KHOAN', pi: 45n },
      { order: 4500n, piece: 6n, step: 'DAP', pi: 45n },
    ];
    d.yieldBatches = [
      { pi: 45n, recipe: 3n, step: 'CAT' },
      { pi: 45n, recipe: 4n, step: 'CAT' },
    ];

    expect((await counts(d)).counts.kcsPhoi).toBe(5);
  });

  it('KCS chốt nhóm (bundle AWAITING_QC thay cho dòng chưa gom): số đỏ không đổi; chấm xong thì bundle rời danh sách', async () => {
    const d = emptyDb();
    d.activePis = [45n];
    d.pieceStepBatches = [{ order: 4500n, piece: 5n, step: 'DAP', pi: 45n }];
    expect((await counts(d)).counts.kcsPhoi).toBe(1);

    d.pieceStepBatches = [];
    d.pieceStepBundles = [{ pi: 45n }];
    expect((await counts(d)).counts.kcsPhoi).toBe(1);

    d.pieceStepBundles = [];
    expect((await counts(d)).counts.kcsPhoi).toBe(0);
  });
});
