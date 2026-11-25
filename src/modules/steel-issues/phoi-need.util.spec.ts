import {
  PhoiNeedInput,
  PhoiNeedRows,
  buildCutBlockMessage,
  buildPhoiNeedIndex,
  buildStepBlockMessage,
  computePhoiStep,
  extraNeedOf,
  phoiOrderKey,
  pickPhoiBlock,
  stepsOverCutCap,
} from './phoi-need.util';

const c = (raw: number, failed = 0, short = 0, scrap = 0) => ({ raw, failed, short, scrap });

describe('phoi-need.util - công thức số cần / giới hạn vật lý', () => {
  describe('extraNeedOf / computePhoiStep: phần bỏ (cắt lại)', () => {
    it('Uốn bỏ 5 -> cần Cắt thêm 5, Uốn không đổi', () => {
      const input: PhoiNeedInput = {
        baseByStep: { CAT: 1180, UON: 1180 },
        lineSteps: [['UON']],
        counts: { CAT: c(1180), UON: c(1180, 8, 0, 5) },
      };
      const cut = computePhoiStep(input, 'CAT');
      const uon = computePhoiStep(input, 'UON');
      expect(cut.extraNeed).toBe(5);
      expect(cut.required).toBe(1185);
      expect(cut.room).toBe(5);
      expect(cut.maxNow).toBe(5);
      expect(uon.extraNeed).toBe(0);
      expect(uon.required).toBe(1180);
    });

    it('Dập bỏ 4 với dòng Uốn + Dập -> Cắt +4, Uốn +4, Dập không đổi; dòng trơn / dòng chỉ Uốn không nhận phần bỏ', () => {
      const withBoth: PhoiNeedInput = {
        baseByStep: { CAT: 300, UON: 100, DAP: 100 },
        lineSteps: [[], ['UON', 'DAP']],
        counts: { DAP: c(100, 4, 0, 4) },
      };
      expect(computePhoiStep(withBoth, 'CAT').extraNeed).toBe(4);
      expect(computePhoiStep(withBoth, 'UON').extraNeed).toBe(4);
      expect(computePhoiStep(withBoth, 'DAP').extraNeed).toBe(0);
      // Uốn và Dập ở 2 dòng ĐỊNH MỨC khác nhau: không dòng nào cần cả 2 -> Uốn không phải làm bù.
      const separate: PhoiNeedInput = {
        baseByStep: { CAT: 200, UON: 100, DAP: 100 },
        lineSteps: [['UON'], ['DAP']],
        counts: { DAP: c(100, 4, 0, 4) },
      };
      expect(computePhoiStep(separate, 'UON').extraNeed).toBe(0);
      expect(computePhoiStep(separate, 'CAT').extraNeed).toBe(4);
      // Công đoạn đứng TRƯỚC không bị cộng khi bỏ ở công đoạn đứng sau chính nó (Dập bỏ không làm Đục lỗ phải bù).
      expect(extraNeedOf('DUC_LO', { DAP: 4 }, [['DAP', 'DUC_LO']])).toBe(0);
      expect(extraNeedOf('UON', { DAP: 4 }, [['DAP', 'UON']])).toBe(4);
    });

    it('thứ tự công đoạn lấy theo thứ tự nghiệp vụ, không theo thứ tự lưu trong processSteps', () => {
      expect(extraNeedOf('UON', { DAP: 3 }, [['DAP', 'UON']])).toBe(3);
    });
  });

  describe('đã tính / vật lý', () => {
    it('lỗi và thiếu cùng trừ khỏi số đã tính (counted)', () => {
      const input: PhoiNeedInput = {
        baseByStep: { CAT: 100 },
        lineSteps: [[]],
        counts: { CAT: c(100, 10, 5) },
      };
      const n = computePhoiStep(input, 'CAT');
      expect(n.counted).toBe(85);
      expect(n.room).toBe(15);
      expect(n.maxNow).toBe(15);
    });

    it('làm lại 3: dùng_T trừ 3 (đoạn làm lại không dùng thêm đoạn cắt mới)', () => {
      // AC25: cắt 1180; Uốn thô 1180, lỗi 8 (bỏ 5, làm lại 3) -> đã tính 1172, đã dùng 1177.
      const input: PhoiNeedInput = {
        baseByStep: { CAT: 1180, UON: 1180 },
        lineSteps: [['UON']],
        counts: { CAT: c(1180), UON: c(1180, 8, 0, 5) },
      };
      const n = computePhoiStep(input, 'UON');
      expect(n.counted).toBe(1172);
      expect(n.room).toBe(8);
      expect(n.used).toBe(1177);
      expect(n.rework).toBe(3);
      expect(n.physicalLeft).toBe(3);
      expect(n.maxNow).toBe(3);
    });

    it('thiếu ở Cắt trừ khỏi cutCap: Uốn đã dùng nhiều hơn số cắt thực có -> physicalLeft âm, maxNow = 0', () => {
      // AC34: cắt thô 1180, KCS ghi thiếu 5; Uốn thô 1180.
      const input: PhoiNeedInput = {
        baseByStep: { CAT: 1200, UON: 1200 },
        lineSteps: [['UON']],
        counts: { CAT: c(1180, 0, 5), UON: c(1180) },
      };
      const n = computePhoiStep(input, 'UON');
      expect(n.cutCap).toBe(1175);
      expect(n.physicalLeft).toBe(-5);
      expect(n.maxNow).toBe(0);
      expect(stepsOverCutCap(input)).toEqual([{ step: 'UON', overBy: 5, cutCap: 1175 }]);
    });

    it('maxNow không bao giờ âm; đã vượt số cần thì over > 0 và maxNow = 0', () => {
      const input: PhoiNeedInput = {
        baseByStep: { CAT: 1180 },
        lineSteps: [[]],
        counts: { CAT: c(1190) },
      };
      const n = computePhoiStep(input, 'CAT');
      expect(n.room).toBe(-10);
      expect(n.over).toBe(10);
      expect(n.maxNow).toBe(0);
    });

    it('Cắt không có vế vật lý', () => {
      const n = computePhoiStep({ baseByStep: { CAT: 5 }, lineSteps: [[]], counts: {} }, 'CAT');
      expect(n.physicalLeft).toBeNull();
      expect(n.maxNow).toBe(5);
    });

    it('phần mở thêm luôn 0: không đổi số cần', () => {
      const n = computePhoiStep(
        { baseByStep: { CAT: 5 }, lineSteps: [[]], counts: {}, openedByStep: { CAT: 0 } },
        'CAT',
      );
      expect(n.required).toBe(5);
    });
  });

  describe('luật chọn câu (AC21 / AC25 / AC34)', () => {
    const uon = (counts: PhoiNeedInput['counts'], need = 1180) =>
      computePhoiStep(
        { baseByStep: { CAT: need, UON: need }, lineSteps: [['UON']], counts },
        'UON',
      );

    it('AC21: đã đủ -> vế số cần chặn, tối đa 0', () => {
      const n = uon({ CAT: c(1180), UON: c(1180) });
      expect(pickPhoiBlock(n, 1)).toBe('NEED');
      const msg = buildStepBlockMessage(n, 'NEED', { cutLengthMm: '355', skuLabel: 'S', qty: 1 });
      expect(msg).toContain('cần Uốn 1180');
      expect(msg).toContain('tối đa 0');
      expect(msg).toContain('bạn nhập 1');
      expect(msg.endsWith('Số cần sai thì báo QLSX.')).toBe(true);
    });

    it('AC21: còn 5, nhập 4 -> qua; nhập 6 -> chặn "tối đa 5"', () => {
      const n = uon({ CAT: c(1180), UON: c(1175) });
      expect(pickPhoiBlock(n, 4)).toBeNull();
      expect(pickPhoiBlock(n, 5)).toBeNull();
      expect(pickPhoiBlock(n, 6)).toBe('NEED');
    });

    it('AC25: còn 8 theo số cần, 3 theo vật lý, nhập 4 -> vế vật lý, "báo cắt thêm 1 đoạn 355mm"', () => {
      const n = computePhoiStep(
        {
          baseByStep: { CAT: 1180, UON: 1180 },
          lineSteps: [['UON']],
          counts: { CAT: c(1180), UON: c(1180, 8, 0, 5) },
        },
        'UON',
      );
      expect(pickPhoiBlock(n, 3)).toBeNull();
      expect(pickPhoiBlock(n, 4)).toBe('PHYSICAL');
      const msg = buildStepBlockMessage(n, 'PHYSICAL', {
        cutLengthMm: '355',
        skuLabel: 'S',
        qty: 4,
      });
      expect(msg).toContain('đã cắt 1180 đoạn');
      expect(msg).toContain('đã Uốn 1177 (không tính 3 đoạn KCS cho làm lại)');
      expect(msg).toContain('tối đa 3, bạn nhập 4');
      expect(msg).toContain('báo cắt thêm 1 đoạn 355mm ở máy cắt trước');
    });

    it('cả 2 vế cùng chặn: lấy câu của vế có số tối đa NHỎ hơn; bằng nhau thì câu số cần', () => {
      // room 2, physicalLeft 5, nhập 10 -> cả 2 chặn, số cần nhỏ hơn.
      const a = uon({ CAT: c(1180), UON: c(1175) }); // room 5, phys 5 (bằng nhau)
      expect(pickPhoiBlock(a, 10)).toBe('NEED');
      const b = computePhoiStep(
        {
          baseByStep: { CAT: 1180, UON: 1180 },
          lineSteps: [['UON']],
          counts: { CAT: c(1180), UON: c(1170, 0, 0, 0) },
        },
        'UON',
      );
      // room 10, phys 10 -> bằng nhau.
      expect(pickPhoiBlock(b, 11)).toBe('NEED');
      const d = computePhoiStep(
        {
          baseByStep: { CAT: 1180, UON: 1180 },
          lineSteps: [['UON']],
          counts: { CAT: c(1180, 0, 4), UON: c(1170) },
        },
        'UON',
      );
      // room 10, phys 1176-1170 = 6 -> vật lý nhỏ hơn.
      expect(d.physicalLeft).toBe(6);
      expect(pickPhoiBlock(d, 11)).toBe('PHYSICAL');
    });

    it('AC34: Uốn còn 20 theo số cần nhưng vật lý âm -> báo 1 bị vế vật lý, câu có "KCS ghi thiếu 5 đoạn cắt"', () => {
      const n = computePhoiStep(
        {
          baseByStep: { CAT: 1200, UON: 1200 },
          lineSteps: [['UON']],
          counts: { CAT: c(1180, 0, 5), UON: c(1180) },
        },
        'UON',
      );
      expect(n.room).toBe(20);
      expect(pickPhoiBlock(n, 1)).toBe('PHYSICAL');
      const msg = buildStepBlockMessage(n, 'PHYSICAL', {
        cutLengthMm: '355',
        skuLabel: 'S',
        qty: 1,
      });
      expect(msg).toContain('KCS ghi thiếu 5 đoạn cắt');
      expect(msg).toContain('báo cắt thêm 6 đoạn 355mm');
    });

    it('câu Cắt: có "cần", "đã tính", "tối đa", "bạn nhập", ghi chú số cắt lại', () => {
      const n = computePhoiStep(
        {
          baseByStep: { CAT: 1180, UON: 1180 },
          lineSteps: [['UON']],
          counts: { CAT: c(1180), UON: c(1180, 5, 0, 5) },
        },
        'CAT',
      );
      const msg = buildCutBlockMessage(n, { cutLengthMm: '441', skuLabel: 'S', qty: 6 });
      expect(msg).toContain('cần 1185 đoạn (gồm 5 đoạn cắt lại cho đoạn KCS bỏ)');
      expect(msg).toContain('đã tính 1180');
      expect(msg).toContain('tối đa 5');
      expect(msg).toContain('bạn nhập 6');
      expect(msg.endsWith('Số cần sai thì báo QLSX.')).toBe(true);
    });
  });

  describe('buildPhoiNeedIndex: gom dòng thô theo (SKU, cỡ)', () => {
    const rows = (orders: PhoiNeedRows['orders']): PhoiNeedRows => ({
      orders,
      bomPieces: [{ bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 2 }],
      pieceBoms: [
        {
          bomRevisionId: 5n,
          pieceId: 20n,
          segmentSpecId: 30n,
          qtyPerPiece: 3,
          processSteps: ['UON'],
        },
      ],
      cut: [
        { segmentSpecId: 30n, productionOrderId: null, qty: 30 },
        { segmentSpecId: 30n, productionOrderId: 1n, qty: 10 },
      ],
      cutQc: [{ segmentSpecId: 30n, productionOrderId: 1n, failedQty: 2, shortQty: 3 }],
      step: [{ segmentSpecId: 30n, productionOrderId: null, step: 'UON', qty: 7 }],
      stepQc: [
        {
          segmentSpecId: 30n,
          productionOrderId: null,
          step: 'UON',
          failedQty: 4,
          shortQty: 1,
          scrapQty: 4,
        },
      ],
    });

    it('PI 1 SKU: đợt chưa gắn SKU tính cho SKU duy nhất; base = qtyPerPiece × qtyPerUnit × SL', () => {
      const idx = buildPhoiNeedIndex(rows([{ id: 1n, bomRevisionId: 5n, quantity: 10 }]));
      expect(idx.orderKeysOf('30')).toEqual(['1']);
      const input = idx.get('1', '30')!;
      expect(input.baseByStep).toEqual({ CAT: 60, UON: 60 });
      expect(input.counts.CAT).toEqual({ raw: 40, failed: 2, short: 3, scrap: 0 });
      expect(input.counts.UON).toEqual({ raw: 7, failed: 4, short: 1, scrap: 4 });
      expect(computePhoiStep(input, 'CAT').extraNeed).toBe(4);
    });

    it('PI nhiều SKU: đợt chưa gắn SKU ra khoá none, KHÔNG làm tăng số cần của SKU nào (kể cả phần bỏ)', () => {
      const idx = buildPhoiNeedIndex(
        rows([
          { id: 1n, bomRevisionId: 5n, quantity: 10 },
          { id: 2n, bomRevisionId: 5n, quantity: 10 },
        ]),
      );
      expect(idx.orderKeysOf('30').sort()).toEqual(['1', '2', 'none']);
      expect(idx.get('none', '30')!.counts.UON).toEqual({ raw: 7, failed: 4, short: 1, scrap: 4 });
      expect(computePhoiStep(idx.get('1', '30')!, 'CAT').extraNeed).toBe(0);
      expect(computePhoiStep(idx.get('2', '30')!, 'CAT').extraNeed).toBe(0);
      expect(idx.get('1', '30')!.counts.CAT).toEqual({ raw: 10, failed: 2, short: 3, scrap: 0 });
    });

    it('phoiOrderKey', () => {
      expect(phoiOrderKey([{ id: 9n }], null)).toBe('9');
      expect(phoiOrderKey([{ id: 9n }, { id: 8n }], null)).toBe('none');
      expect(phoiOrderKey([{ id: 9n }, { id: 8n }], 8n)).toBe('8');
    });
  });

  describe('đoạn dư theo phương án + đoạn dư lấy từ kho (anh Nhân câu 12b/13a/14a, 24/11/2026)', () => {
    const rows = (planSurplus: Parameters<typeof buildPhoiNeedIndex>[0]['planSurplus']) =>
      buildPhoiNeedIndex({
        orders: [{ id: 1n, bomRevisionId: 5n, quantity: 10 }],
        bomPieces: [{ bomRevisionId: 5n, pieceId: 20n, qtyPerUnit: 1 }],
        pieceBoms: [
          {
            bomRevisionId: 5n,
            pieceId: 20n,
            segmentSpecId: 7n,
            qtyPerPiece: 3,
            processSteps: ['UON'],
          },
        ],
        cut: [{ segmentSpecId: 7n, productionOrderId: 1n, qty: 30 }],
        cutQc: [],
        step: [],
        stepQc: [],
        planSurplus,
      }).get('1', '7')!;

    it('dư theo phương án: số cần giữ 30, báo thêm được 4 đoạn ở Cắt và Uốn', () => {
      const input = rows([{ productionOrderId: 1n, segmentSpecId: 7n, qty: 4 }]);
      const cat = computePhoiStep(input, 'CAT');
      expect(cat.required).toBe(30);
      expect(cat.planSurplus).toBe(4);
      expect(cat.maxNow).toBe(4);
      const uon = computePhoiStep(input, 'UON');
      expect(uon.required).toBe(30);
      expect(uon.maxNow).toBe(30);
      expect(pickPhoiBlock(cat, 5)).toBe('NEED');
      expect(pickPhoiBlock(cat, 4)).toBeNull();
    });

    it('lấy 5 đoạn đã uốn từ kho: số cần Cắt và Uốn còn 25', () => {
      const input = rows([
        { productionOrderId: 1n, segmentSpecId: 7n, qty: 5, fromStockSteps: 'UON' },
      ]);
      expect(computePhoiStep(input, 'CAT').required).toBe(25);
      expect(computePhoiStep(input, 'UON').required).toBe(25);
      expect(computePhoiStep(input, 'CAT').over).toBe(5);
    });

    it('lấy đoạn trơn từ kho: chỉ giảm số cần Cắt, Uốn vẫn đủ 30', () => {
      const input = rows([
        { productionOrderId: 1n, segmentSpecId: 7n, qty: 5, fromStockSteps: '' },
      ]);
      expect(computePhoiStep(input, 'CAT').required).toBe(25);
      expect(computePhoiStep(input, 'UON').required).toBe(30);
    });
  });
});
