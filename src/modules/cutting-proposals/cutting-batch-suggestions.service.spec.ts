import { ConfigService } from '@nestjs/config';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/configuration';
import { ExternalApiService } from '../external/external-api.service';
import { StockReservationsService } from '../stock/stock-reservations.service';
import { CuttingProposalsService } from './cutting-proposals.service';

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

  /** Cấu hình thật hiện nay: NCC chỉ bán cây 6000mm, tề đầu 10mm, lưỡi cắt 1mm. */
  const config = {
    solverStockLengths: [6000],
    solverTrimStartMm: 10,
    solverBladeWidthMm: 1.0,
    solverMaxWastePercentage: 1.0,
  };

  const mkItem = (over: Record<string, unknown> = {}) => ({
    id: 1n,
    quantity: 20,
    prodApprovalStatus: 'WAITING_BOSS',
    materialDeadline: new Date('2026-08-20'),
    mfgProductId: 3n,
    mfgProduct: { factoryCode: 'J55', name: 'Bàn J55' },
    stages: [],
    productionInvoice: { code: 'PI-1', deadline: null, salesOrder: { code: 'PO-3' } },
    ...over,
  });

  /** 1 dòng định mức: mảnh `pieceId` cần `qtyPerPiece` đoạn cỡ `cutLengthMm` của vật tư đó. */
  const mkPieceBom = (
    bomRevisionId: bigint,
    pieceId: bigint,
    materialId: bigint,
    cutLengthMm: number,
    qtyPerPiece = 1,
  ) => ({ bomRevisionId, pieceId, qtyPerPiece, segmentSpec: { materialId, cutLengthMm } });

  const mkMaterial = (id: bigint, code: string, thresholdPct: number | null = null) => ({
    id,
    code,
    name: code,
    maxCuttingWastePercentage: thresholdPct === null ? null : { toNumber: () => thresholdPct },
  });

  const build = (over: Record<string, unknown> = {}) => {
    prisma = {
      systemConfig: { findUniqueOrThrow: jest.fn().mockResolvedValue(config) },
      productionInvoiceItem: { findMany: jest.fn().mockResolvedValue([]) },
      bomRevision: { findMany: jest.fn().mockResolvedValue([]) },
      pieceBom: { findMany: jest.fn().mockResolvedValue([]) },
      bomPiece: { findMany: jest.fn().mockResolvedValue([]) },
      material: { findMany: jest.fn().mockResolvedValue([]) },
      ...over,
    };
    service = new CuttingProposalsService(
      prisma as unknown as PrismaServiceType,
      { post: jest.fn() } as unknown as ExternalApiService,
      { get: jest.fn() } as unknown as ConfigService<AppConfig, true>,
      { reserve: jest.fn(), getAvailableQty: jest.fn() } as unknown as StockReservationsService,
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
      { where: { OR: unknown[]; productionInvoice: unknown } },
    ][];
    const call = calls[0][0];
    // `notIn` của SQL không khớp NULL, dùng notIn sẽ loại mất đúng nhóm đơn mới nhất - nhóm cần gộp nhất.
    // REJECTED có mặt để SKU bị Sếp bác quay lại được bảng chọn mà gộp tổ hợp khác.
    expect(call.where.OR).toEqual([
      { prodApprovalStatus: null },
      { prodApprovalStatus: { in: ['WAITING_QLSX', 'WAITING_BOSS', 'REJECTED'] } },
    ]);
    // SKU đang nằm trong một đợt gộp thì không hiện ra để gộp chồng lần nữa.
    expect(call.where.productionInvoice).toEqual({ isMerged: false });
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
      productionInvoice: { code: 'PI-2', deadline: null, salesOrder: { code: 'PO-4' } },
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
      productionInvoice: { code: 'PI-2', deadline: null, salesOrder: { code: 'PO-4' } },
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
      productionInvoice: { code: 'PI-2', deadline: null, salesOrder: { code: 'PO-4' } },
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

  it('ngưỡng riêng của vật tư ghi đè mặc định - đặt 2% thì 1,88% biến mất khỏi danh sách', async () => {
    build({
      ...singleProduct(STEEL_20X20, 840, 1, 'STL-VUONG-20X20'),
      material: {
        findMany: jest.fn().mockResolvedValue([mkMaterial(STEEL_20X20, 'STL-VUONG-20X20', 2.0)]),
      },
    });
    await expect(service.getBatchSuggestions()).resolves.toEqual([]);
  });

  it('đơn không có hạn bị xếp CUỐI, không được làm mốc neo "gấp nhất"', async () => {
    const noDeadline = mkItem({
      id: 1n,
      materialDeadline: null,
      productionInvoice: { code: 'PI-1', deadline: null, salesOrder: { code: 'PO-KHONG-HAN' } },
    });
    const urgent = mkItem({
      id: 2n,
      mfgProductId: 4n,
      materialDeadline: new Date('2026-08-20'),
      productionInvoice: { code: 'PI-2', deadline: null, salesOrder: { code: 'PO-GAP' } },
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
        productionInvoice: { code: 'PI-2', deadline: null, salesOrder: { code: 'PO-4' } },
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

    it('tick sẵn đúng tổ hợp tối thiểu đủ đạt ngưỡng', async () => {
      build(twoSkuSharingMaterial());
      const res = await service.getBatchCandidates();
      expect(res.recommendedItemIds.sort()).toEqual(['1', '2']);
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
  });
});
