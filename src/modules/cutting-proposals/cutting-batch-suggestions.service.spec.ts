import { ConfigService } from '@nestjs/config';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/configuration';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CuttingProposalsService } from './cutting-proposals.service';
import { SolverClientService } from './solver-client.service';
import { RealtimeService } from '../../realtime/realtime.service';

/**
 * Gợi ý gộp đợt cắt (getBatchSuggestions).
 *
 * Dữ liệu dựng theo ĐÚNG BOM thật đang có trong DB nên bộ test này kiêm luôn vai trò mốc hồi quy:
 * bàn J55 dùng sắt vuông 20×20 với đúng 1 cỡ đoạn 840mm (1,88% - vượt ngưỡng 1%), Ghế tình yêu
 * cùng loại sắt đó có đoạn 460mm và kéo xuống 0,53%. Lệch 2 con số này nghĩa là công thức hao hụt
 * đã trôi khỏi solver (xem best-fill.util.ts).
 *
 * Tách khỏi cutting-proposals.service.spec.ts vì đường này không dùng chung mock nào với đường
 * solver (không chạm cuttingProposal/externalApi/stockLedger) - gộp chung chỉ làm cả 2 khó đọc.
 */
describe('CuttingProposalsService.getBatchSuggestions', () => {
  let service: CuttingProposalsService;
  let prisma: Record<string, { findMany: jest.Mock } | { findUniqueOrThrow: jest.Mock }>;

  const STEEL_20X20 = 200n;
  const STEEL_RIENG = 400n;

  const mkItem = (over: Record<string, unknown> = {}) => {
    const merged = {
      id: 1n,
      quantity: 20,
      prodApprovalStatus: 'WAITING_BOSS',
      materialDeadline: new Date('2026-08-20'),
      mfgProductId: 3n,
      mfgProduct: { factoryCode: 'J55', name: 'Bàn J55' },
      stages: [],
      productionInvoice: { code: 'PI-1', deadline: null, salesOrder: { orderCode: 'PO-3' } },
      ...over,
    };
    return {
      // salesOrder đọc trực tiếp ở CẤP ITEM (2026-08-20 - item chưa gom PI vẫn phải hiện đúng PO
      // gốc), KHÔNG còn suy qua productionInvoice.salesOrder - mặc định LẤY THEO
      // productionInvoice.salesOrder đã merge ở trên để mọi call site override productionInvoice
      // (PO-4, PO-GAP...) tự động khớp, khỏi phải sửa từng chỗ; override thẳng `salesOrder` vẫn
      // thắng vì spread `...merged` đứng sau.
      salesOrder: (merged.productionInvoice as { salesOrder: unknown } | null)?.salesOrder ?? null,
      ...merged,
    };
  };

  /** Mô phỏng `Prisma.Decimal` tối thiểu (2026-08-19, cutLengthMm giờ Decimal(7,1)) - đủ cho cả
   *  `.toNumber()` lẫn ép kiểu `Number(x)` mà code service gọi tới. */
  const mockDecimal = (n: number) => ({
    toNumber: () => n,
    valueOf: () => n,
    toString: () => String(n),
  });

  /** Cấu hình thật hiện nay: NCC chỉ bán cây 6000mm, tề đầu 10mm, lưỡi cắt 1mm. */
  const config = {
    solverStockLengths: [6000],
    solverTrimStartMm: 10,
    solverBladeWidthMm: mockDecimal(1.0),
    solverMaxWastePercentage: mockDecimal(1.0),
    solverMaxSurplus: 10,
    // Máy cắt (2026-10-23): mặc định MC Laser; cặp lưỡi/tề + tham số bó của MC Tự động.
    solverMachine: 'laser',
    solverMctdBladeWidthMm: mockDecimal(2.5),
    solverMctdTrimStartMm: 0,
    solverBundleFactors: [14, 16, 18, 20],
    solverMaxManualCuts: 5,
    solverMaxSizesPerPattern: 5,
    solverMergeWindowDays: 7,
    solverMergeMaxSkus: 5,
  };

  /** 1 dòng định mức: mảnh `pieceId` cần `qtyPerPiece` đoạn cỡ `cutLengthMm` của vật tư đó. */
  const mkPieceBom = (
    bomRevisionId: bigint,
    pieceId: bigint,
    materialId: bigint,
    cutLengthMm: number,
    qtyPerPiece = 1,
  ) => ({
    bomRevisionId,
    pieceId,
    qtyPerPiece,
    segmentSpec: { materialId, cutLengthMm: mockDecimal(cutLengthMm) },
  });

  const mkMaterial = (id: bigint, code: string, thresholdPct: number | null = null) => ({
    id,
    code,
    name: code,
    maxCuttingWastePercentage: thresholdPct === null ? null : { toNumber: () => thresholdPct },
  });

  /** propose() mặc định KHÔNG implementation (trả undefined) - đúng hành vi "chưa từng gọi solver"
   *  mà mọi test getBatchSuggestions/previewBatch cũ đã ngầm giả định. Test xác minh chính xác
   *  (2026-09-24) truyền `postMock` riêng để giả lập response solver thật. */
  const build = (over: Record<string, unknown> = {}, postMock: jest.Mock = jest.fn()) => {
    prisma = {
      systemConfig: { findUniqueOrThrow: jest.fn().mockResolvedValue(config) },
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([]) },
      bomRevision: { findMany: jest.fn().mockResolvedValue([]) },
      pieceBom: { findMany: jest.fn().mockResolvedValue([]) },
      bomPiece: { findMany: jest.fn().mockResolvedValue([]) },
      material: { findMany: jest.fn().mockResolvedValue([]) },
      ...over,
    };
    const realtimeStub = { publishEntityChanged: jest.fn(), publishNotificationCreated: jest.fn() };
    // SolverClientService giả: `propose(body, timeoutMs)` = postMock (HiGHS là bộ giải duy nhất, không
    // còn đường http để mock).
    const configStub = { get: jest.fn() } as unknown as ConfigService<AppConfig, true>;
    service = new CuttingProposalsService(
      prisma as unknown as PrismaServiceType,
      { propose: postMock } as unknown as SolverClientService,
      configStub,
      { reserve: jest.fn(), getAvailableQty: jest.fn() } as unknown as StockReservationsService,
      // getBatchSuggestions() không đụng tới thông báo - stub rỗng cho đủ tham số constructor.
      { emit: jest.fn() } as unknown as NotificationsService,
      realtimeStub as unknown as RealtimeService,
    );
  };

  /** Ca hay dùng: 1 sản phẩm, 1 loại sắt, 1 cỡ đoạn. */
  const singleProduct = (
    materialId: bigint,
    cutLengthMm: number,
    qtyPerUnit: number,
    code: string,
  ) => ({
    productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([mkItem()]) },
    bomRevision: { findMany: jest.fn().mockResolvedValue([{ id: 5n, mfgProductId: 3n }]) },
    pieceBom: {
      findMany: jest.fn().mockResolvedValue([mkPieceBom(5n, 10n, materialId, cutLengthMm)]),
    },
    bomPiece: {
      findMany: jest.fn().mockResolvedValue([{ bomRevisionId: 5n, pieceId: 10n, qtyPerUnit }]),
    },
    material: { findMany: jest.fn().mockResolvedValue([mkMaterial(materialId, code)]) },
  });

  it('trả [] và KHÔNG đụng bảng nào khác khi không có đơn nào đang chờ', async () => {
    build();
    await expect(service.getBatchSuggestions()).resolves.toEqual([]);
    expect((prisma.bomRevision as { findMany: jest.Mock }).findMany).not.toHaveBeenCalled();
    expect((prisma.pieceBom as { findMany: jest.Mock }).findMany).not.toHaveBeenCalled();
  });

  it('lọc bằng OR có nhánh null - đơn Sales vừa tạo (status null) PHẢI là ứng viên', async () => {
    build();
    await service.getBatchSuggestions();
    const calls = (prisma.productionInvoiceItem as { findMany: jest.Mock }).findMany.mock.calls as [
      { where: { AND: [{ OR: unknown[] }, { productionInvoiceId: null }] } },
    ][];
    const call = calls[0][0];
    // `notIn` của SQL không khớp NULL, dùng notIn sẽ loại mất đúng nhóm đơn mới nhất - nhóm cần gộp nhất.
    // REJECTED có mặt để SKU bị Sếp bác quay lại được bảng chọn mà gộp tổ hợp khác.
    expect(call.where.AND[0].OR).toEqual([
      { prodApprovalStatus: null },
      { prodApprovalStatus: { in: ['WAITING_QLSX', 'WAITING_BOSS', 'REJECTED'] } },
    ]);
    // Chỉ hiện SKU thực sự chưa gom vào PI nào (2026-08-24 - bỏ nhánh "đang trong PI cắt riêng
    // chưa gộp" vì gây SKU hiện trùng ở cả đây lẫn "Lệnh sản xuất mới").
    expect(call.where.AND[1]).toEqual({ productionInvoiceId: null });
  });

  it('loại sắt đứng riêng đã đạt ngưỡng thì KHÔNG hiện ra', async () => {
    // 660mm -> 9 đoạn/cây, thừa 51mm = 0,85% < 1%. Không phải việc của KHSX.
    build(singleProduct(STEEL_20X20, 660, 4, 'STL-VUONG-50X50'));
    await expect(service.getBatchSuggestions()).resolves.toEqual([]);
  });

  it('J55 + Ghế tình yêu: 1,88% xuống 0,53% và DỪNG ngay ở mức đạt ngưỡng', async () => {
    const j55 = mkItem({ id: 1n, materialDeadline: new Date('2026-08-20') });
    const ghe = mkItem({
      id: 2n,
      quantity: 5,
      mfgProductId: 4n,
      materialDeadline: new Date('2026-08-28'),
      mfgProduct: { factoryCode: 'GHE', name: 'Ghế tình yêu' },
      productionInvoice: { code: 'PI-2', deadline: null, salesOrder: { orderCode: 'PO-4' } },
    });
    build({
      // Cố ý đưa Ghế lên trước để chắc chắn thứ tự do deadline quyết định, không do thứ tự query.
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([ghe, j55]) },
      bomRevision: {
        findMany: jest.fn().mockResolvedValue([
          { id: 5n, mfgProductId: 3n },
          { id: 6n, mfgProductId: 4n },
        ]),
      },
      pieceBom: {
        findMany: jest.fn().mockResolvedValue([
          mkPieceBom(5n, 10n, STEEL_20X20, 840), // J55: chỉ 1 cỡ đoạn -> tự nó vô phương
          mkPieceBom(6n, 20n, STEEL_20X20, 460), // Ghế: cỡ đoạn lấp vừa khoảng trống 944mm
        ]),
      },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([
          { bomRevisionId: 5n, pieceId: 10n, qtyPerUnit: 1 }, // J55: 20 x 840mm
          { bomRevisionId: 6n, pieceId: 20n, qtyPerUnit: 3 }, // Ghế: 5 bộ x 3 = 15 x 460mm
        ]),
      },
      material: {
        findMany: jest.fn().mockResolvedValue([mkMaterial(STEEL_20X20, 'STL-VUONG-20X20')]),
      },
    });

    const [s] = await service.getBatchSuggestions();
    expect(s.materialCode).toBe('STL-VUONG-20X20');
    expect(s.outcome).toBe('FIXED_BY_MERGE');
    // Mốc neo là đơn VƯỢT ngưỡng gấp nhất (J55), không phải đơn gấp nhất nói chung.
    expect(s.anchor.salesOrderCode).toBe('PO-3');
    expect(s.levels).toHaveLength(2);
    expect(s.levels[0].minWastePct).toBeCloseTo(1.883, 3);
    expect(s.levels[0].meetsThreshold).toBe(false);
    expect(s.levels[1].minWastePct).toBeCloseTo(0.533, 3);
    expect(s.levels[1].meetsThreshold).toBe(true);
    // Lợi ích THẬT: cắt riêng 3 cây (J55) + 2 cây (Ghế) = 5; cắt chung 4 cây -> bớt 1 cây.
    expect(s.levels[1].barsSeparate).toBe(5);
    expect(s.levels[1].minBars).toBe(4);
    expect(s.levels[1].barsSavedVsSeparate).toBe(1);
    // Ghế hạn 28/08 vs J55 hạn 20/08 -> đơn xa nhất phải cắt sớm 8 ngày.
    expect(s.levels[1].daysCutEarly).toBe(8);
  });

  it('% giảm mạnh nhưng số cây tiết kiệm CÓ THỂ bằng 0 - phải báo trung thực', async () => {
    // Cùng cặp cỡ đoạn 840/460 (1,88% -> 0,53%) nhưng số lượng lớn: phần cải thiện bị nuốt vào
    // các cây đầy sẵn, không bớt được trọn cây nào. % là chất lượng kiểu cắt, tiết kiệm được cây
    // hay không còn phụ thuộc SỐ LƯỢNG - hiển thị phải nói đúng điều đó.
    const j55 = mkItem({ id: 1n });
    const ghe = mkItem({
      id: 2n,
      quantity: 20,
      mfgProductId: 4n,
      materialDeadline: new Date('2026-08-28'),
      productionInvoice: { code: 'PI-2', deadline: null, salesOrder: { orderCode: 'PO-4' } },
    });
    build({
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([j55, ghe]) },
      bomRevision: {
        findMany: jest.fn().mockResolvedValue([
          { id: 5n, mfgProductId: 3n },
          { id: 6n, mfgProductId: 4n },
        ]),
      },
      pieceBom: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            mkPieceBom(5n, 10n, STEEL_20X20, 840),
            mkPieceBom(6n, 20n, STEEL_20X20, 460),
          ]),
      },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([
          { bomRevisionId: 5n, pieceId: 10n, qtyPerUnit: 1 },
          { bomRevisionId: 6n, pieceId: 20n, qtyPerUnit: 6 }, // 20 bộ x 6 = 120 x 460mm
        ]),
      },
      material: {
        findMany: jest.fn().mockResolvedValue([mkMaterial(STEEL_20X20, 'STL-VUONG-20X20')]),
      },
    });

    const [s] = await service.getBatchSuggestions();
    const last = s.levels[s.levels.length - 1];
    expect(last.minWastePct).toBeCloseTo(0.533, 3); // % vẫn cải thiện mạnh
    expect(last.barsSavedVsSeparate).toBe(0); // nhưng không bớt được cây nào
  });

  it('đơn đang ĐẠT ngưỡng vẫn được gộp vào với vai trò cho mượn cỡ đoạn', async () => {
    // Nếu lọc cả 2 đầu theo ngưỡng thì Ghế (0,17% khi đứng riêng) bị loại và J55 hết đường cứu.
    const j55 = mkItem({ id: 1n });
    const ghe = mkItem({
      id: 2n,
      mfgProductId: 4n,
      materialDeadline: new Date('2026-08-28'),
      productionInvoice: { code: 'PI-2', deadline: null, salesOrder: { orderCode: 'PO-4' } },
    });
    build({
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([j55, ghe]) },
      bomRevision: {
        findMany: jest.fn().mockResolvedValue([
          { id: 5n, mfgProductId: 3n },
          { id: 6n, mfgProductId: 4n },
        ]),
      },
      pieceBom: {
        findMany: jest.fn().mockResolvedValue([
          mkPieceBom(5n, 10n, STEEL_20X20, 840),
          // 3 cỡ đoạn -> Ghế tự nó đã tối ưu, KHÔNG cần gộp
          mkPieceBom(6n, 20n, STEEL_20X20, 460),
          mkPieceBom(6n, 21n, STEEL_20X20, 490),
        ]),
      },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([
          { bomRevisionId: 5n, pieceId: 10n, qtyPerUnit: 1 },
          { bomRevisionId: 6n, pieceId: 20n, qtyPerUnit: 6 },
          { bomRevisionId: 6n, pieceId: 21n, qtyPerUnit: 2 },
        ]),
      },
      material: {
        findMany: jest.fn().mockResolvedValue([mkMaterial(STEEL_20X20, 'STL-VUONG-20X20')]),
      },
    });

    const [s] = await service.getBatchSuggestions();
    expect(s.anchor.salesOrderCode).toBe('PO-3');
    expect(s.orders.map((o) => o.salesOrderCode)).toContain('PO-4');
    expect(s.levels[s.levels.length - 1].meetsThreshold).toBe(true);
  });

  it('loại sắt chỉ 1 đơn dùng mà vượt ngưỡng -> UNFIXABLE_BY_MERGE', async () => {
    // 700mm -> 8 đoạn/cây, thừa 392mm = 6,53%. Không sản phẩm nào khác dùng -> gộp vô ích,
    // phải sửa thiết kế hoặc ngưỡng chứ không phải việc gom đợt.
    build(singleProduct(STEEL_RIENG, 700, 2, 'STL-RIENG'));
    const [s] = await service.getBatchSuggestions();
    expect(s.outcome).toBe('UNFIXABLE_BY_MERGE');
    expect(s.levels).toHaveLength(1);
    expect(s.levels[0].minWastePct).toBeCloseTo(6.533, 3);
    expect(s.levels[0].daysCutEarly).toBeNull(); // 1 đơn thì không có chuyện cắt sớm
  });

  it('ngưỡng riêng cũ trên vật tư KHÔNG còn ghi đè (2026-09-30) - vật tư còn 2% trong DB nhưng ngưỡng chung 1% vẫn coi 1,88% là vượt', async () => {
    build({
      ...singleProduct(STEEL_20X20, 840, 1, 'STL-VUONG-20X20'),
      material: {
        findMany: jest.fn().mockResolvedValue([mkMaterial(STEEL_20X20, 'STL-VUONG-20X20', 2.0)]),
      },
    });
    const result = await service.getBatchSuggestions();
    expect(result).toHaveLength(1);
    expect(result[0].thresholdPct).toBe(1);
  });

  it('đơn không có hạn bị xếp CUỐI, không được làm mốc neo "gấp nhất"', async () => {
    const noDeadline = mkItem({
      id: 1n,
      materialDeadline: null,
      productionInvoice: {
        code: 'PI-1',
        deadline: null,
        salesOrder: { orderCode: 'PO-KHONG-HAN' },
      },
    });
    const urgent = mkItem({
      id: 2n,
      mfgProductId: 4n,
      materialDeadline: new Date('2026-08-20'),
      productionInvoice: { code: 'PI-2', deadline: null, salesOrder: { orderCode: 'PO-GAP' } },
    });
    build({
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([noDeadline, urgent]) },
      bomRevision: {
        findMany: jest.fn().mockResolvedValue([
          { id: 5n, mfgProductId: 3n },
          { id: 6n, mfgProductId: 4n },
        ]),
      },
      pieceBom: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            mkPieceBom(5n, 10n, STEEL_20X20, 840),
            mkPieceBom(6n, 20n, STEEL_20X20, 840),
          ]),
      },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([
          { bomRevisionId: 5n, pieceId: 10n, qtyPerUnit: 1 },
          { bomRevisionId: 6n, pieceId: 20n, qtyPerUnit: 1 },
        ]),
      },
      material: {
        findMany: jest.fn().mockResolvedValue([mkMaterial(STEEL_20X20, 'STL-VUONG-20X20')]),
      },
    });

    const [s] = await service.getBatchSuggestions();
    expect(s.anchor.salesOrderCode).toBe('PO-GAP');
    expect(s.orders[s.orders.length - 1].salesOrderCode).toBe('PO-KHONG-HAN');
  });

  it('gộp truy vấn định mức - KHÔNG lặp theo từng đơn (chặn N+1)', async () => {
    const j55 = mkItem({ id: 1n });
    const ghe = mkItem({ id: 2n, mfgProductId: 4n });
    build({
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([j55, ghe]) },
      bomRevision: {
        findMany: jest.fn().mockResolvedValue([
          { id: 5n, mfgProductId: 3n },
          { id: 6n, mfgProductId: 4n },
        ]),
      },
      pieceBom: {
        findMany: jest.fn().mockResolvedValue([mkPieceBom(5n, 10n, STEEL_20X20, 840)]),
      },
      bomPiece: {
        findMany: jest.fn().mockResolvedValue([{ bomRevisionId: 5n, pieceId: 10n, qtyPerUnit: 1 }]),
      },
      material: {
        findMany: jest.fn().mockResolvedValue([mkMaterial(STEEL_20X20, 'STL-VUONG-20X20')]),
      },
    });

    await service.getBatchSuggestions();
    const pieceBom = prisma.pieceBom as { findMany: jest.Mock };
    expect(pieceBom.findMany).toHaveBeenCalledTimes(1);
    expect(pieceBom.findMany).toHaveBeenCalledWith({
      where: { bomRevisionId: { in: [5n, 6n] } },
      include: { segmentSpec: true },
    });
  });

  // ── Bảng chọn của KHSX + tính thử theo tổ hợp ─────────────────────────────
  describe('getBatchCandidates / previewBatch', () => {
    /** J55 (840mm, vượt ngưỡng) + Ghế (460mm, đạt ngưỡng) - dùng lại ở nhiều test dưới. */
    const twoSkuSharingMaterial = () => {
      const j55 = mkItem({ id: 1n });
      const ghe = mkItem({
        id: 2n,
        quantity: 5,
        mfgProductId: 4n,
        materialDeadline: new Date('2026-08-28'),
        mfgProduct: { factoryCode: 'GHE', name: 'Ghế tình yêu' },
        productionInvoice: { code: 'PI-2', deadline: null, salesOrder: { orderCode: 'PO-4' } },
      });
      return {
        productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([j55, ghe]) },
        bomRevision: {
          findMany: jest.fn().mockResolvedValue([
            { id: 5n, mfgProductId: 3n },
            { id: 6n, mfgProductId: 4n },
          ]),
        },
        pieceBom: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              mkPieceBom(5n, 10n, STEEL_20X20, 840),
              mkPieceBom(6n, 20n, STEEL_20X20, 460),
            ]),
        },
        bomPiece: {
          findMany: jest.fn().mockResolvedValue([
            { bomRevisionId: 5n, pieceId: 10n, qtyPerUnit: 1 },
            { bomRevisionId: 6n, pieceId: 20n, qtyPerUnit: 3 },
          ]),
        },
        material: {
          findMany: jest.fn().mockResolvedValue([mkMaterial(STEEL_20X20, 'STL-VUONG-20X20')]),
        },
      };
    };

    it('bảng gồm CẢ SKU đã đạt ngưỡng - KHSX cần toàn cảnh để tự ghép', async () => {
      // SKU thứ 2 dùng cỡ 660mm -> 9 đoạn/cây, thừa 51mm = 0,85% < 1%: TỰ NÓ không cần gộp.
      // Nhưng nó vẫn phải có mặt trong bảng vì chính nó là nguồn cỡ đoạn cứu J55. Lọc bỏ SKU đạt
      // ngưỡng là giết tính năng: không còn gì để gộp vào.
      const j55 = mkItem({ id: 1n });
      const ok = mkItem({
        id: 2n,
        mfgProductId: 4n,
        mfgProduct: { factoryCode: 'SKU-OK', name: 'SKU tự nó đã đạt' },
        materialDeadline: new Date('2026-09-30'), // hạn xa hơn -> phải xếp SAU J55
      });
      build({
        productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([ok, j55]) },
        bomRevision: {
          findMany: jest.fn().mockResolvedValue([
            { id: 5n, mfgProductId: 3n },
            { id: 6n, mfgProductId: 4n },
          ]),
        },
        pieceBom: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              mkPieceBom(5n, 10n, STEEL_20X20, 840),
              mkPieceBom(6n, 20n, STEEL_20X20, 660),
            ]),
        },
        bomPiece: {
          findMany: jest.fn().mockResolvedValue([
            { bomRevisionId: 5n, pieceId: 10n, qtyPerUnit: 1 },
            { bomRevisionId: 6n, pieceId: 20n, qtyPerUnit: 1 },
          ]),
        },
        material: {
          findMany: jest.fn().mockResolvedValue([mkMaterial(STEEL_20X20, 'STL-VUONG-20X20')]),
        },
      });

      const res = await service.getBatchCandidates();
      expect(res.items).toHaveLength(2);
      const okItem = res.items.find((i) => i.mfgProductCode === 'SKU-OK');
      expect(okItem?.materials[0].overThreshold).toBe(false);
      expect(okItem?.materials[0].standaloneWastePct).toBeCloseTo(0.85, 2);
      // SKU vượt ngưỡng phải xếp lên đầu, kể cả khi hạn của nó không phải gần nhất.
      expect(res.items[0].mfgProductCode).toBe('J55');
      expect(res.items[0].materials[0].overThreshold).toBe(true);
      // standaloneMinBars (2026-08-19) - cận dưới số cây khi CHỈ SKU này cắt một mình, để FE cảnh
      // báo "nhu cầu nhỏ, cận dưới không đáng tin" (mục 15.6-7). Chỉ cần > 0 và có mặt trong DTO -
      // công thức đã được kiểm bởi test riêng của minBarsFor() qua buildBatchLevel.
      expect(res.items[0].materials[0].standaloneMinBars).toBeGreaterThan(0);
      expect(okItem?.materials[0].standaloneMinBars).toBeGreaterThan(0);
    });

    // Luật gộp (2026-10-24): mốc cần sắt cách nhau ≤ solverMergeWindowDays, ≤ solverMergeMaxSkus SKU. 2 SKU của
    // twoSkuSharingMaterial có mốc 20/08 (id 1) và 28/08 (id 2) - cách 8 ngày - và đều có chip đỏ khi cắt riêng.
    const withWindow = (days: number, maxSkus = 5) => ({
      ...twoSkuSharingMaterial(),
      systemConfig: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...config,
          solverMergeWindowDays: days,
          solverMergeMaxSkus: maxSkus,
          solverAllowCustomLength: true,
        }),
      },
    });

    it('tick sẵn ĐÚNG 1 SKU: đơn có chip đỏ với mốc cần sắt sớm nhất (gộp thêm là việc của fix-options)', async () => {
      build(withWindow(10));
      const res = await service.getBatchCandidates();
      expect(res.recommendedItemIds).toEqual(['1']);
    });

    /** Solver giả cho fix-options: tổng đoạn 20 (1 SKU) -> vô nghiệm ở 1 %/cây (tốt nhất 4 %); 35 (2 SKU) -> 0,5 % đạt; dò chiều dài -> 5120;
     *  đơn gấp (100 %) -> 4 %. */
    const fixSolver = () =>
      jest.fn((body: Record<string, unknown>) => {
        const qty = (body.bom as Array<{ qty_per_part: number }>).reduce(
          (a, r) => a + r.qty_per_part,
          0,
        );
        const ok = (pct: number, len = 6000) => ({
          purchase_plan: [
            {
              material: '200',
              feasible: true,
              waste_percentage: pct,
              total_bars: 3,
              best_stock_length: len,
              over_threshold: false,
            },
          ],
        });
        if (body.auto_scan === true) return Promise.resolve(ok(0.3, 5120));
        if (body.max_waste_percentage === 100) return Promise.resolve(ok(4));
        if (qty > 20) return Promise.resolve(ok(0.5));
        return Promise.resolve({
          purchase_plan: [
            {
              material: '200',
              feasible: false,
              best_achievable: { length: 6000, waste_pct: 4, bars: 3 },
            },
          ],
        });
      });

    it('fix-options: loại sắt vượt ở cây chuẩn -> gợi ý gộp đơn trong cửa sổ, đặt cây riêng, đơn gấp; "thêm tất cả"', async () => {
      build(withWindow(10), fixSolver());
      const res = await service.getBatchFixOptions({ productionInvoiceItemIds: ['1'] });
      expect(res).toMatchObject({
        ruleOk: true,
        count: 1,
        windowDays: 10,
        maxSkus: 5,
        addAllItemIds: ['2'],
      });
      expect(res.materials[0]).toMatchObject({
        materialId: '200',
        status: 'over',
        verifiedLengthSource: 'scan',
        addSuggestion: { itemIds: ['2'], wastePct: 0.5, meetsThreshold: true, spanDaysAfter: 8 },
        customLength: { lengthMm: 5120, wastePct: 0.3 },
        urgent: { lengthMm: 6000, wastePct: 4 },
      });
    });

    it('fix-options: đơn kia ngoài cửa sổ (8 > 7 ngày) -> không gợi ý gộp, nói rõ vì sao', async () => {
      build(withWindow(7), fixSolver());
      const res = await service.getBatchFixOptions({ productionInvoiceItemIds: ['1'] });
      expect(res.materials[0].addSuggestion).toBeNull();
      expect(res.materials[0].addReason).toContain('trong khung 7 ngày');
      expect(res.addAllItemIds).toBeNull();
    });

    it('fix-options: đợt đã đủ trần SKU -> không gộp thêm', async () => {
      build(withWindow(10, 1), fixSolver());
      const res = await service.getBatchFixOptions({ productionInvoiceItemIds: ['1'] });
      expect(res.materials[0].addReason).toContain('đã đủ 1 SKU');
    });

    it('fix-options: đợt đang QUÁ trần SKU -> nói "quá trần", không nói "đã đủ"', async () => {
      // solver giả: ở 1 %/cây luôn vô nghiệm (cả khi gộp đủ 2 SKU) -> loại sắt vẫn "over" -> có dòng gộp thêm
      const alwaysOver = jest.fn((body: Record<string, unknown>) =>
        Promise.resolve(
          body.auto_scan === true || body.max_waste_percentage === 100
            ? {
                purchase_plan: [
                  {
                    material: '200',
                    feasible: true,
                    waste_percentage: 4,
                    total_bars: 3,
                    best_stock_length: 6000,
                  },
                ],
              }
            : {
                purchase_plan: [
                  {
                    material: '200',
                    feasible: false,
                    best_achievable: { length: 6000, waste_pct: 4, bars: 3 },
                  },
                ],
              },
        ),
      );
      build(withWindow(10, 1), alwaysOver);
      const res = await service.getBatchFixOptions({ productionInvoiceItemIds: ['1', '2'] });
      expect(res.materials[0].addReason).toContain('Đợt đang có 2 SKU, quá trần 1 SKU');
    });

    it('fix-options: đợt đang chọn vi phạm luật gộp -> ruleOk=false kèm câu báo', async () => {
      build(withWindow(7), fixSolver());
      const res = await service.getBatchFixOptions({ productionInvoiceItemIds: ['1', '2'] });
      expect(res.ruleOk).toBe(false);
      expect(res.ruleReason).toContain('cách nhau 8 ngày');
    });

    it('SKU chưa có định mức ACTIVE vẫn hiện ra, có cờ hasActiveBom=false', async () => {
      // Im lặng bỏ qua sẽ khiến KHSX tưởng SKU đó không có vấn đề gì.
      const coBom = mkItem({ id: 1n });
      const khongBom = mkItem({
        id: 9n,
        mfgProductId: 99n,
        mfgProduct: { factoryCode: 'NO-BOM', name: 'Chưa có định mức' },
      });
      build({
        productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([coBom, khongBom]) },
        bomRevision: { findMany: jest.fn().mockResolvedValue([{ id: 5n, mfgProductId: 3n }]) },
        pieceBom: {
          findMany: jest.fn().mockResolvedValue([mkPieceBom(5n, 10n, STEEL_20X20, 840)]),
        },
        bomPiece: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ bomRevisionId: 5n, pieceId: 10n, qtyPerUnit: 1 }]),
        },
        material: {
          findMany: jest.fn().mockResolvedValue([mkMaterial(STEEL_20X20, 'STL-VUONG-20X20')]),
        },
      });
      const res = await service.getBatchCandidates();
      const noBom = res.items.find((i) => i.mfgProductCode === 'NO-BOM');
      expect(noBom?.hasActiveBom).toBe(false);
      expect(noBom?.materials).toEqual([]);
    });

    // BUG đã sửa (2026-09-12, phát hiện qua test tay thật): `loadBatchContext()` từng có
    // `if (byMaterial.size === 0) return null` - khi ĐANG CHỜ ĐÚNG 1 SKU (case rất phổ biến: 1
    // đơn Sales mới) và SKU đó không cần cắt sắt (BomRevision ACTIVE nhưng 0 dòng pieceBom - vd
    // sản phẩm chỉ dùng phụ kiện/PieceMaterialYield), `byMaterial` rỗng TOÀN CỤC nên hàm trả về
    // `null`, kéo theo getBatchCandidates() trả `items: []` - SKU biến mất khỏi "Tối ưu cắt sắt"
    // dù nó đang chờ thật. FE không có gì để bấm "Tạo lệnh sản xuất riêng" (claimSolo() ở
    // ProductionInvoicesService không hề phụ thuộc byMaterial) nên SKU kẹt vĩnh viễn ở bước "Sales
    // vừa tạo". Khác test "SKU chưa có định mức ACTIVE" ở trên (item đó CHƯA có BomRevision) - ca
    // này có BomRevision ACTIVE hẳn hoi, chỉ là 0 dòng pieceBom (đúng nghĩa "không cần cắt sắt").
    it('1 SKU đang chờ, KHÔNG cần cắt sắt (0 dòng pieceBom) - vẫn phải hiện ra, không được rỗng cả bảng', async () => {
      const khongCanSat = mkItem({
        id: 1n,
        mfgProduct: { factoryCode: 'PHU-KIEN', name: 'Sản phẩm chỉ dùng phụ kiện' },
      });
      build({
        productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([khongCanSat]) },
        bomRevision: { findMany: jest.fn().mockResolvedValue([{ id: 5n, mfgProductId: 3n }]) },
        pieceBom: { findMany: jest.fn().mockResolvedValue([]) },
        bomPiece: { findMany: jest.fn().mockResolvedValue([]) },
        material: { findMany: jest.fn().mockResolvedValue([]) },
      });

      const res = await service.getBatchCandidates();
      expect(res.items).toHaveLength(1);
      expect(res.items[0].mfgProductCode).toBe('PHU-KIEN');
      expect(res.items[0].hasActiveBom).toBe(true);
      expect(res.items[0].materials).toEqual([]);
      expect(res.recommendedItemIds).toEqual([]);
    });

    it('tính thử đúng theo tổ hợp được chọn: 2 SKU -> bớt 1 cây', async () => {
      build(twoSkuSharingMaterial());
      const res = await service.previewBatch({ productionInvoiceItemIds: ['1', '2'] });
      expect(res.totalBarsSaved).toBe(1);
      expect(res.daysCutEarly).toBe(8);
      const line = res.lines.find((l) => l.materialCode === 'STL-VUONG-20X20');
      expect(line?.contributingSkus.sort()).toEqual(['GHE', 'J55']);
      expect(line?.barsSeparate).toBe(5);
      expect(line?.minBars).toBe(4);
      expect(line?.minWastePct).toBeCloseTo(0.533, 3);
    });

    it('chọn 1 SKU thì không có gì để gộp - dòng chỉ có 1 SKU đóng góp, bớt 0 cây', async () => {
      build(twoSkuSharingMaterial());
      const res = await service.previewBatch({ productionInvoiceItemIds: ['1'] });
      expect(res.totalBarsSaved).toBe(0);
      expect(res.lines[0].contributingSkus).toEqual(['J55']);
      expect(res.lines[0].minWastePct).toBeCloseTo(1.883, 3);
      expect(res.daysCutEarly).toBeNull(); // 1 đơn thì không có chuyện cắt sớm
    });

    it('bỏ qua id không nằm trong danh sách ứng viên thay vì tính sai', async () => {
      build(twoSkuSharingMaterial());
      const res = await service.previewBatch({ productionInvoiceItemIds: ['1', '999'] });
      expect(res.lines[0].contributingSkus).toEqual(['J55']);
    });

    // ── chiều dài cây theo từng quy cách KHSX chọn (2026-09-16) ────────────────────────

    it('đổi chiều dài cây thì CHIP "hao hụt khi cắt riêng" tính lại theo cây mới', async () => {
      // Chính ca người dùng mô tả: ban đầu 6m ra một dãy chip, sửa sang 5850 thì phải tự tính lại.
      // Nếu chip đứng yên thì màn hình tự mâu thuẫn - chip nói cây 6m, đợt lại cắt cây 5m85.
      build(twoSkuSharingMaterial());
      const mac = await service.getBatchCandidates();

      build(twoSkuSharingMaterial());
      const chon = await service.getBatchCandidates({ '200': 5850 });

      const chipMac = mac.items.find((i) => i.mfgProductCode === 'J55')?.materials[0];
      const chipChon = chon.items.find((i) => i.mfgProductCode === 'J55')?.materials[0];
      expect(chipMac?.stockLengthMm).toBe(6000);
      expect(chipChon?.stockLengthMm).toBe(5850);
      expect(chipChon?.standaloneWastePct).not.toBeCloseTo(chipMac!.standaloneWastePct, 3);
      // 840mm trên cây 5850: tề đầu 10 -> dùng được 5840, cắt 6 đoạn hết 6×(840+1)=5046, dôi 794.
      // Hao hụt tính trên CẢ CÂY và tính cả phần tề đầu: (10+794)/5850 = 13,744%.
      expect(chipChon?.standaloneWastePct).toBeCloseTo(13.744, 2);
      expect(chipChon?.overThreshold).toBe(true);
    });

    it('đổi chiều dài cây đổi luôn tổ hợp hệ thống tick sẵn, không chỉ đổi con số', async () => {
      // Chiều dài quyết định loại sắt nào BỊ COI LÀ vượt ngưỡng, mà gợi ý gộp chỉ dựng cho loại
      // vượt ngưỡng - nên recommendedItemIds phải tính trên CÙNG chiều dài với bảng, nếu không hệ
      // thống tick sẵn một nhóm dựa trên cây 6m trong khi bảng đang hiện số của cây 5m85.
      build(withWindow(10));
      const chon = await service.getBatchCandidates({ '200': 5850 });

      // Cả 2 SKU đều dùng loại 200 nên khi ép cây xấu, gợi ý gộp vẫn phải gom đủ 2 SKU.
      expect(chon.recommendedItemIds.length).toBeGreaterThan(0);
    });

    it('tính theo ĐÚNG cây KHSX chọn cho quy cách đó, không phải cây chuẩn của công ty', async () => {
      // systemConfig mock chỉ có [6000]. Chọn 5850 cho đúng loại sắt này thì con số PHẢI đổi -
      // nếu không đổi nghĩa là preview vẫn tính theo 6m trong khi đợt sẽ cắt 5m85, tức màn hình
      // nói một đằng solver làm một nẻo.
      build(twoSkuSharingMaterial());
      const mac = await service.previewBatch({ productionInvoiceItemIds: ['1', '2'] });

      build(twoSkuSharingMaterial());
      const chon = await service.previewBatch({
        productionInvoiceItemIds: ['1', '2'],
        stockLengthsByMaterial: { '200': 5850 },
      });

      const lineMac = mac.lines.find((l) => l.materialCode === 'STL-VUONG-20X20');
      const lineChon = chon.lines.find((l) => l.materialCode === 'STL-VUONG-20X20');
      // Không chọn -> rơi về danh sách chuẩn của công ty, mà danh sách đó chỉ có đúng 1 cây
      // (6000) nên vẫn nêu được tên cây đã dùng. null chỉ xảy ra khi công ty khai nhiều cỡ.
      expect(lineMac?.stockLengthMm).toBe(6000);
      expect(lineChon?.stockLengthMm).toBe(5850);
      expect(lineChon?.minWastePct).not.toBeCloseTo(lineMac!.minWastePct, 3);
    });

    it('quy cách KHÔNG có trong map vẫn dùng cây chuẩn - map là ghi đè từng phần', async () => {
      build(twoSkuSharingMaterial());
      const res = await service.previewBatch({
        productionInvoiceItemIds: ['1', '2'],
        stockLengthsByMaterial: { '999': 5850 }, // id không thuộc đợt này
      });
      const line = res.lines.find((l) => l.materialCode === 'STL-VUONG-20X20');
      expect(line?.stockLengthMm).toBe(6000); // vẫn là cây chuẩn, không bị khoá lạ kéo theo
      expect(line?.minWastePct).toBeCloseTo(0.533, 3); // y hệt test "2 SKU -> bớt 1 cây" ở trên
    });

    /**
     * verifyExactStandaloneWaste (2026-09-24, mục 19): best-fill.util.ts là cận dưới LÝ TƯỞNG,
     * có thể "xanh" (đạt ngưỡng) trong khi solver thật auto-scan sang cây khác vì nhu cầu không
     * tile gọn vào cây chuẩn - xem changelog. getBatchCandidates() giờ gọi THẲNG solver (auto_scan
     * =false, chỉ đúng loại sắt này) để thay ước tính bằng số thật, khi còn ĐÁNG (≤5 cỡ đoạn).
     */
    describe('xác minh chính xác bằng solver thật (verified)', () => {
      it('feasible=true -> dùng số THẬT solver trả, verified=true, gọi ĐÚNG endpoint/tham số', async () => {
        const postMock = jest.fn().mockResolvedValue({
          purchase_plan: [
            {
              material: '200',
              feasible: true,
              waste_percentage: 0.72,
              total_bars: 14,
              best_stock_length: 6000,
              over_threshold: false,
            },
          ],
        });
        build(singleProduct(STEEL_20X20, 840, 20, 'STL-VUONG-20X20'), postMock);

        const res = await service.getBatchCandidates();
        const m = res.items[0].materials[0];
        expect(m.verified).toBe(true);
        expect(m.standaloneWastePct).toBe(0.72); // KHÔNG còn là cận dưới best-fill (1,883%)
        expect(m.standaloneMinBars).toBe(14);
        expect(m.overThreshold).toBe(false);
        expect(m.verifiedLengthSource).toBe('fixed');

        // auto_scan=false (chỉ hỏi "cây chuẩn có ăn không"), đúng 1 dòng bom (đúng loại sắt này).
        expect(postMock).toHaveBeenCalledWith(
          expect.objectContaining({
            auto_scan: false,
            num_sets: 1,
            stock_lengths: '6000',
            // demand = qtyPerUnit(20, singleProduct) × quantity(20, mkItem mặc định) = 400.
            bom: [expect.objectContaining({ material: '200', cut_length: 840, qty_per_part: 400 })],
          }) as unknown,
          expect.any(Number),
        );
      });

      it('kết quả xác minh được NHỚ qua lần tải trang: gọi lại cùng bài -> không gọi solver lần 2 (2026-10-24)', async () => {
        const postMock = jest.fn().mockResolvedValue({
          purchase_plan: [
            { material: '200', feasible: true, waste_percentage: 0.72, total_bars: 14 },
          ],
        });
        build(singleProduct(STEEL_20X20, 840, 20, 'STL-VUONG-20X20'), postMock);

        await service.getBatchCandidates();
        const again = await service.getBatchCandidates();

        expect(postMock).toHaveBeenCalledTimes(1);
        expect(again.items[0].materials[0]).toMatchObject({
          verified: true,
          standaloneWastePct: 0.72,
        });
      });

      it('lượt nhanh không kịp -> chip giữ ước tính (verified=false), KHÔNG nhớ; lượt KIỂM BÙ (deepVerify) giải lại với thời gian dài hơn', async () => {
        const postMock = jest
          .fn()
          .mockRejectedValueOnce(new Error('timeout'))
          .mockResolvedValue({
            purchase_plan: [
              { material: '200', feasible: true, waste_percentage: 0.72, total_bars: 14 },
            ],
          });
        build(singleProduct(STEEL_20X20, 840, 20, 'STL-VUONG-20X20'), postMock);

        const fast = await service.getBatchCandidates();
        expect(fast.items[0].materials[0].verified).toBe(false);

        const deep = await service.getBatchCandidates(undefined, undefined, true);
        expect(deep.items[0].materials[0]).toMatchObject({
          verified: true,
          standaloneWastePct: 0.72,
        });
        expect(postMock).toHaveBeenCalledTimes(2);
        const [firstBody, firstTimeout] = postMock.mock.calls[0] as unknown as [
          Record<string, unknown>,
          number,
        ];
        const [deepBody, deepTimeout] = postMock.mock.calls[1] as unknown as [
          Record<string, unknown>,
          number,
        ];
        expect(firstBody.time_limit_seconds).toBe(5);
        expect(deepBody.time_limit_seconds).toBe(30);
        expect(deepTimeout).toBeGreaterThan(firstTimeout);
      });

      it('chọn MC Tự động -> xác minh gửi solver CÙNG máy với đợt (tề/lưỡi MCTĐ + tham số bó)', async () => {
        const postMock = jest.fn().mockResolvedValue({
          purchase_plan: [
            { material: '200', feasible: true, waste_percentage: 0.5, total_bars: 14 },
          ],
        });
        build(singleProduct(STEEL_20X20, 840, 20, 'STL-VUONG-20X20'), postMock);

        await service.getBatchCandidates(undefined, 'tu_dong');

        expect(postMock).toHaveBeenCalledWith(
          expect.objectContaining({
            machine: 'tu_dong',
            trim_start: 0,
            blade_width: 2.5,
            bundle_factors: [14, 16, 18, 20],
            max_manual_cuts: 5,
            max_sizes_per_pattern: 5,
          }) as unknown,
          expect.any(Number),
        );
      });

      it('không chọn máy -> MC Laser của công ty: machine=laser, tề/lưỡi MC Laser, không có tham số bó', async () => {
        const postMock = jest.fn().mockResolvedValue({
          purchase_plan: [
            { material: '200', feasible: true, waste_percentage: 0.5, total_bars: 14 },
          ],
        });
        build(singleProduct(STEEL_20X20, 840, 20, 'STL-VUONG-20X20'), postMock);

        await service.getBatchCandidates();

        const body = (postMock.mock.calls[0] as unknown as [Record<string, unknown>])[0];
        expect(body).toEqual(
          expect.objectContaining({ machine: 'laser', trim_start: 10, blade_width: 1 }),
        );
        expect(body).not.toHaveProperty('bundle_factors');
      });

      it('kết quả xác minh KHÔNG dùng chung giữa hai máy: cùng nhu cầu, khác máy -> gọi solver riêng với body riêng', async () => {
        const postMock = jest.fn().mockResolvedValue({
          purchase_plan: [
            { material: '200', feasible: true, waste_percentage: 0.5, total_bars: 14 },
          ],
        });
        build(singleProduct(STEEL_20X20, 840, 20, 'STL-VUONG-20X20'), postMock);

        await service.getBatchCandidates(undefined, 'laser');
        await service.getBatchCandidates(undefined, 'tu_dong');

        expect(postMock).toHaveBeenCalledTimes(2);
        const bodies = (postMock.mock.calls as unknown as [Record<string, unknown>][]).map(
          (c) => c[0],
        );
        expect(bodies.map((b) => b.machine)).toEqual(['laser', 'tu_dong']);
        expect(bodies.map((b) => b.blade_width)).toEqual([1, 2.5]);
      });

      it('nhiều SKU cùng loại sắt + cùng nhu cầu -> gọi solver ĐÚNG 1 lần, mọi dòng dùng chung kết quả', async () => {
        // 2026-10-21: [30×120, 60×240] lặp ở 11 SKU từng chiếm 73/79 s của trang (giải trùng 11 lần).
        const postMock = jest.fn().mockResolvedValue({
          purchase_plan: [
            {
              material: '200',
              feasible: true,
              waste_percentage: 0.72,
              total_bars: 14,
              best_stock_length: 6000,
              over_threshold: false,
            },
          ],
        });
        const base = singleProduct(STEEL_20X20, 840, 20, 'STL-VUONG-20X20');
        build(
          {
            ...base,
            // 3 SKU, cùng sản phẩm/BOM và cùng số lượng -> cùng nhu cầu 400 đoạn 840 mm cho loại 200.
            productionInvoiceItem: {
              findMany: jest
                .fn()
                .mockResolvedValue([mkItem({ id: 1n }), mkItem({ id: 2n }), mkItem({ id: 3n })]),
            },
          },
          postMock,
        );

        const res = await service.getBatchCandidates();
        const mats = res.items.flatMap((i) => i.materials);
        expect(mats).toHaveLength(3);
        expect(mats.every((m) => m.verified && m.standaloneWastePct === 0.72)).toBe(true);
        expect(postMock).toHaveBeenCalledTimes(1);
      });

      it('khác nhu cầu -> mỗi nhu cầu 1 lần gọi riêng (không gộp nhầm)', async () => {
        const postMock = jest.fn().mockResolvedValue({ purchase_plan: [] });
        const base = singleProduct(STEEL_20X20, 840, 20, 'STL-VUONG-20X20');
        build(
          {
            ...base,
            productionInvoiceItem: {
              findMany: jest
                .fn()
                .mockResolvedValue([
                  mkItem({ id: 1n, quantity: 20 }),
                  mkItem({ id: 2n, quantity: 21 }),
                ]),
            },
          },
          postMock,
        );

        await service.getBatchCandidates();
        expect(postMock).toHaveBeenCalledTimes(2);
        const calls = postMock.mock.calls as Array<[{ bom: Array<{ qty_per_part: number }> }]>;
        const qtys = calls.map((c) => c[0].bom[0].qty_per_part);
        expect(qtys.sort()).toEqual([400, 420]);
      });

      it('feasible=false nhưng có best_achievable -> vẫn là số THẬT, verified=true, overThreshold=true', async () => {
        // Đúng ca SAT-VUONG-20X20 thật (2026-09-23): cây chuẩn không đạt ngưỡng cho ĐÚNG nhu cầu,
        // nhưng solver đã tự nới hết bộ lọc để tìm "tốt nhất có thể" - vẫn hơn hẳn ước tính cận dưới.
        const postMock = jest.fn().mockResolvedValue({
          purchase_plan: [
            {
              material: '200',
              feasible: false,
              best_achievable: { length: 6000, waste_pct: 6.83, bars: 18 },
            },
          ],
        });
        build(singleProduct(STEEL_20X20, 840, 20, 'STL-VUONG-20X20'), postMock);

        const res = await service.getBatchCandidates();
        const m = res.items[0].materials[0];
        expect(m.verified).toBe(true);
        expect(m.overThreshold).toBe(true);
        expect(m.standaloneWastePct).toBe(6.83);
        expect(m.standaloneMinBars).toBe(18);
        // "scan" = KHÔNG cắt được ở stockLengths với luật mọi cây ≤ ngưỡng - đây mới là LÝ DO
        // overThreshold=true, không phải so standaloneWastePct với thresholdPct (xem test dưới).
        expect(m.verifiedLengthSource).toBe('scan');
      });

      it('best_achievable trả về % THẤP HƠN ngưỡng -> overThreshold VẪN true (chứng minh chặt, không phải hardcode mù)', async () => {
        // Lịch sử đúng ca SAT-VUONG-20X20 thật (2026-09-24, 1 ngày 3 lần sửa):
        //  (a) sáng: hardcode overThreshold=true bất kể số -> người dùng hỏi "0,78% < 1% mà sao đỏ?"
        //  (b) sửa thành so trực tiếp wastePct>thresholdPct -> 0,78<1 ra XANH -> người dùng gọi thẳng
        //      là "bịp bợm" vì 0,78% chỉ đạt được bằng cách PHÁ luật mỗi cây - thực tế không đạt.
        //  (c) mục này: overThreshold LUÔN true cho nhánh best_achievable, nhưng có LÝ DO CHỨNG MINH
        //      CHẶT (generate_patterns đã liệt kê hết kiểu ≤ngưỡng, phủ nhu cầu chỉ bằng chúng thất
        //      bại -> mọi phương án hợp lệ khác BẮT BUỘC có cây vượt ngưỡng) - không phải đoán mò
        //      như (a). standaloneWastePct=0,78 vẫn trả về nhưng CHỈ là dữ liệu phụ (tooltip FE),
        //      KHÔNG phải "hao hụt sẽ đạt" - xem changelog mục 19.9.
        const postMock = jest.fn().mockResolvedValue({
          purchase_plan: [
            {
              material: '200',
              feasible: false,
              best_achievable: { length: 6000, waste_pct: 0.78, bars: 14 },
            },
          ],
        });
        build(singleProduct(STEEL_20X20, 840, 20, 'STL-VUONG-20X20'), postMock);

        const res = await service.getBatchCandidates();
        const m = res.items[0].materials[0];
        expect(m.standaloneWastePct).toBe(0.78); // vẫn trả về làm dữ liệu phụ
        expect(m.overThreshold).toBe(true); // KHÔNG so với standaloneWastePct - luôn true ở nhánh này
        expect(m.verifiedLengthSource).toBe('scan'); // vẫn ghi lại: hệ thống sẽ auto-scan khi solve thật
      });

      it('quá nhiều cỡ đoạn (>5) -> KHÔNG gọi solver, giữ nguyên ước tính cũ', async () => {
        const postMock = jest.fn().mockResolvedValue({ purchase_plan: [{ feasible: true }] });
        const materialId = 700n;
        build(
          {
            productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([mkItem()]) },
            bomRevision: { findMany: jest.fn().mockResolvedValue([{ id: 5n, mfgProductId: 3n }]) },
            pieceBom: {
              findMany: jest
                .fn()
                .mockResolvedValue(
                  [100, 200, 300, 400, 500, 600].map((len, i) =>
                    mkPieceBom(5n, BigInt(10 + i), materialId, len),
                  ),
                ),
            },
            bomPiece: {
              findMany: jest.fn().mockResolvedValue(
                [10, 11, 12, 13, 14, 15].map((pieceId) => ({
                  bomRevisionId: 5n,
                  pieceId: BigInt(pieceId),
                  qtyPerUnit: 1,
                })),
              ),
            },
            material: {
              findMany: jest.fn().mockResolvedValue([mkMaterial(materialId, 'NHIEU-CO')]),
            },
          },
          postMock,
        );

        const res = await service.getBatchCandidates();
        expect(postMock).not.toHaveBeenCalled();
        expect(res.items[0].materials[0].verified).toBe(false);
      });

      it('solver lỗi/timeout -> rơi về ước tính cũ, verified=false, KHÔNG throw', async () => {
        const postMock = jest.fn().mockRejectedValue(new Error('timeout'));
        build(singleProduct(STEEL_20X20, 840, 20, 'STL-VUONG-20X20'), postMock);

        const res = await service.getBatchCandidates();
        const m = res.items[0].materials[0];
        expect(m.verified).toBe(false);
        expect(m.standaloneWastePct).toBeCloseTo(1.883, 2); // y hệt ước tính best-fill.util.ts cũ
      });
    });
  });
});
