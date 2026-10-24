import { BomOptionKind } from '../../generated/prisma/client';
import { BomOptionRow, excludedMaterialIds, loadBomOptionExclusions } from './bom-option.util';

const WIRE = BomOptionKind.WIRE;
const CUSHION = BomOptionKind.CUSHION;

const option = (bomRevisionId: bigint, kind: BomOptionKind, materialId: bigint): BomOptionRow => ({
  bomRevisionId,
  kind,
  materialId,
});

describe('bom-option.util', () => {
  describe('excludedMaterialIds', () => {
    const options = [
      option(10n, WIRE, 60n),
      option(10n, WIRE, 61n),
      option(10n, WIRE, 62n),
      option(10n, CUSHION, 90n),
      option(10n, CUSHION, 91n),
    ];

    it('loại các dây đã tick mà lệnh không chọn, giữ đúng dây đã chọn', () => {
      const excluded = excludedMaterialIds(options, {
        bomRevisionId: 10n,
        wireMaterialId: 61n,
        cushionMaterialId: 90n,
      });

      expect([...excluded].sort()).toEqual(['60', '62', '91']);
    });

    it('lệnh chưa chọn một loại (null) thì KHÔNG lọc gì cho loại đó', () => {
      const excluded = excludedMaterialIds(options, {
        bomRevisionId: 10n,
        wireMaterialId: 60n,
        cushionMaterialId: null,
      });

      expect([...excluded].sort()).toEqual(['61', '62']);
    });

    it('SKU không có tick nào thì không loại gì (hành vi cũ)', () => {
      const excluded = excludedMaterialIds([], {
        bomRevisionId: 10n,
        wireMaterialId: null,
        cushionMaterialId: null,
      });

      expect(excluded.size).toBe(0);
    });

    it('bỏ qua tick của revision khác (lệnh ghim revision cũ)', () => {
      const excluded = excludedMaterialIds(options, {
        bomRevisionId: 99n,
        wireMaterialId: 60n,
        cushionMaterialId: 90n,
      });

      expect(excluded.size).toBe(0);
    });
  });

  describe('loadBomOptionExclusions', () => {
    it('nạp tick của mọi revision bằng 1 query và trả tập loại trừ theo từng lệnh', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([
          option(10n, WIRE, 60n),
          option(10n, WIRE, 61n),
          option(11n, WIRE, 70n),
          option(11n, WIRE, 71n),
        ]);
      const db = { bomOption: { findMany } } as unknown as Parameters<
        typeof loadBomOptionExclusions
      >[0];

      const result = await loadBomOptionExclusions(db, [
        { id: 1n, bomRevisionId: 10n, wireMaterialId: 60n, cushionMaterialId: null },
        { id: 2n, bomRevisionId: 10n, wireMaterialId: 61n, cushionMaterialId: null },
        { id: 3n, bomRevisionId: 11n, wireMaterialId: null, cushionMaterialId: null },
      ]);

      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { bomRevisionId: { in: [10n, 11n] } } }),
      );
      // Hai lệnh cùng SKU/revision nhưng khác dây: mỗi lệnh loại dây của lệnh kia.
      expect([...result.get('1')!]).toEqual(['61']);
      expect([...result.get('2')!]).toEqual(['60']);
      expect(result.get('3')!.size).toBe(0);
    });

    it('không có lệnh nào thì không query', async () => {
      const findMany = jest.fn();
      const db = { bomOption: { findMany } } as unknown as Parameters<
        typeof loadBomOptionExclusions
      >[0];

      await expect(loadBomOptionExclusions(db, [])).resolves.toEqual(new Map());
      expect(findMany).not.toHaveBeenCalled();
    });
  });
});
