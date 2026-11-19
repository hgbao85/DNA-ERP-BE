import {
  PhoiNeedInput,
  buildCutBlockMessage,
  buildPhoiNeedIndex,
  buildStepBlockMessage,
  computePhoiStep,
  phoiOrderKey,
  pickPhoiBlock,
  stepsOverCutCap,
} from './phoi-need.util';

/**
 * UB1 (QA, P1-T3-U1) - hàm thuần số cần / vật lý của Phôi, viết theo AC (không chép test của dev).
 * AC21, AC25, AC26, AC30, AC31, AC34 (số mới), AC39 (mốc "đủ"), AC60, luật chọn câu.
 */
const c = (raw: number, failed = 0, short = 0, scrap = 0) => ({ raw, failed, short, scrap });
const ctx = (qty: number, mm = '355') => ({ cutLengthMm: mm, skuLabel: 'S', qty });

describe('UB1 phoi-need.util (QA)', () => {
  describe('AC19 / AC21: câu chặn vế số cần', () => {
    it('AC19: cắt cần 1180, đã báo 1180, KCS lỗi 10 -> đã tính 1170; báo 10 qua, báo 11 bị chặn; câu có cần / đã tính / tối đa / bạn nhập / đuôi', () => {
      const input: PhoiNeedInput = {
        baseByStep: { CAT: 1180 },
        lineSteps: [[]],
        counts: { CAT: c(1180, 10) },
      };
      const n = computePhoiStep(input, 'CAT');
      expect(n.counted).toBe(1170);
      expect(n.room).toBe(10);
      expect(n.maxNow).toBe(10);
      expect(pickPhoiBlock(n, 10)).toBeNull();
      expect(pickPhoiBlock(n, 11)).toBe('NEED');
      const msg = buildCutBlockMessage(n, { cutLengthMm: '441', skuLabel: 'S', qty: 11 });
      expect(msg).toContain('cần 1180');
      expect(msg).toContain('đã tính 1170');
      expect(msg).toContain('tối đa 10');
      expect(msg).toContain('bạn nhập 11');
      expect(msg).toContain('Số cần sai thì báo QLSX.');
    });

    it('AC19: đã báo đúng 1180 không lỗi -> báo thêm 1 bị chặn, câu "tối đa 0", "bạn nhập 1"', () => {
      const input: PhoiNeedInput = {
        baseByStep: { CAT: 1180 },
        lineSteps: [[]],
        counts: { CAT: c(1180) },
      };
      const n = computePhoiStep(input, 'CAT');
      expect(pickPhoiBlock(n, 1)).toBe('NEED');
      const msg = buildCutBlockMessage(n, { cutLengthMm: '441', skuLabel: 'S', qty: 1 });
      expect(msg).toContain('cần 1180');
      expect(msg).toContain('đã tính 1180');
      expect(msg).toContain('tối đa 0');
      expect(msg).toContain('bạn nhập 1');
    });

    it('AC21: Uốn cần 1180, đã tính 1180 (đã cắt 1180) -> báo Uốn 1 bị chặn, câu "cần Uốn 1180 ... tối đa 0"', () => {
      const input: PhoiNeedInput = {
        baseByStep: { CAT: 1180, UON: 1180 },
        lineSteps: [['UON']],
        counts: { CAT: c(1180), UON: c(1180) },
      };
      const n = computePhoiStep(input, 'UON');
      expect(n.room).toBe(0);
      expect(n.physicalLeft).toBe(0);
      expect(pickPhoiBlock(n, 1)).toBe('NEED'); // bằng nhau -> câu số cần
      const msg = buildStepBlockMessage(n, 'NEED', ctx(1));
      expect(msg).toContain('cần Uốn 1180');
      expect(msg).toContain('đã tính 1180');
      expect(msg).toContain('tối đa 0');
      expect(msg).toContain('bạn nhập 1');
    });

    it('AC21: còn 5, báo 4 qua; báo 6 bị chặn "tối đa 5" (ca 2 người: sau lần 4 chỉ còn 1)', () => {
      const before: PhoiNeedInput = {
        baseByStep: { CAT: 1185, UON: 1180 },
        lineSteps: [['UON']],
        counts: { CAT: c(1185), UON: c(1175) },
      };
      const n1 = computePhoiStep(before, 'UON');
      expect(n1.room).toBe(5);
      expect(pickPhoiBlock(n1, 4)).toBeNull();
      expect(pickPhoiBlock(n1, 6)).toBe('NEED');
      // người thứ 2 thấy số đã cộng lần 4
      const after: PhoiNeedInput = { ...before, counts: { ...before.counts, UON: c(1179) } };
      const n2 = computePhoiStep(after, 'UON');
      expect(pickPhoiBlock(n2, 4)).toBe('NEED');
      expect(buildStepBlockMessage(n2, 'NEED', ctx(4))).toContain('tối đa 1');
    });
  });

  describe('AC25: maxNow = max(0, min(room, physicalLeft)); chặn đúng maxNow / maxNow+1', () => {
    // Uốn 355: cần 1180; lỗi 8 (bỏ 5, làm lại 3) -> đã tính 1172; cắt 1180 (+5 bù chưa cắt); Uốn thô 1180.
    const base: PhoiNeedInput = {
      baseByStep: { CAT: 1180, UON: 1180 },
      lineSteps: [['UON']],
      counts: { CAT: c(1180), UON: c(1180, 8, 0, 5) },
    };

    it('số liệu AC25: theo số cần còn 8, vật lý còn 3 -> maxNow Uốn 3, máy cắt còn 5', () => {
      const uon = computePhoiStep(base, 'UON');
      expect(uon.counted).toBe(1172);
      expect(uon.room).toBe(8);
      expect(uon.used).toBe(1177);
      expect(uon.physicalLeft).toBe(3);
      expect(uon.maxNow).toBe(3);
      const cut = computePhoiStep(base, 'CAT');
      expect(cut.required).toBe(1185);
      expect(cut.maxNow).toBe(5);
    });

    it('AC25: báo đúng maxNow thì qua, maxNow+1 thì bị chặn (cả Cắt lẫn công đoạn) - dùng chung 1 hàm', () => {
      for (const step of ['CAT', 'UON'] as const) {
        const n = computePhoiStep(base, step);
        expect(pickPhoiBlock(n, n.maxNow)).toBeNull();
        expect(pickPhoiBlock(n, n.maxNow + 1)).not.toBeNull();
      }
    });

    it('AC25: Uốn nhập 4 -> chặn vế vật lý; câu có "báo cắt thêm 1 đoạn 355mm"', () => {
      const n = computePhoiStep(base, 'UON');
      const kind = pickPhoiBlock(n, 4);
      expect(kind).toBe('PHYSICAL');
      const msg = buildStepBlockMessage(n, kind!, ctx(4));
      expect(msg).toContain('báo cắt thêm 1 đoạn 355mm');
      expect(msg).toContain('tối đa 3');
    });

    it('luật chọn câu: cả 2 vế cùng chặn -> vế có số tối đa nhỏ hơn; bằng nhau -> vế số cần', () => {
      // room 8, physicalLeft 3: nhập 10 chặn cả hai, vật lý nhỏ hơn
      const n = computePhoiStep(base, 'UON');
      expect(pickPhoiBlock(n, 10)).toBe('PHYSICAL');
      // room 2, physicalLeft 5: cả hai chặn khi nhập 9, số cần nhỏ hơn
      const needSmaller: PhoiNeedInput = {
        baseByStep: { CAT: 1180, UON: 1180 },
        lineSteps: [['UON']],
        counts: { CAT: c(1185), UON: c(1178) },
      };
      const m = computePhoiStep(needSmaller, 'UON');
      expect(m.room).toBe(2);
      expect(m.physicalLeft).toBe(7);
      expect(pickPhoiBlock(m, 9)).toBe('NEED');
      // bằng nhau
      const eq = computePhoiStep(
        {
          baseByStep: { CAT: 100, UON: 100 },
          lineSteps: [['UON']],
          counts: { CAT: c(100), UON: c(97) },
        },
        'UON',
      );
      expect(eq.room).toBe(3);
      expect(eq.physicalLeft).toBe(3);
      expect(pickPhoiBlock(eq, 4)).toBe('NEED');
    });

    it('biên: qty 0 không bao giờ bị chặn; maxNow không âm khi vật lý âm', () => {
      const neg: PhoiNeedInput = {
        baseByStep: { CAT: 100, UON: 120 },
        lineSteps: [['UON']],
        counts: { CAT: c(100, 0, 5), UON: c(100) },
      };
      const n = computePhoiStep(neg, 'UON');
      expect(n.physicalLeft).toBe(-5);
      expect(n.maxNow).toBe(0);
      expect(pickPhoiBlock(n, 0)).toBeNull();
    });

    it('biên: dữ liệu rỗng (chưa có counts) -> 0 hết, không NaN', () => {
      const n = computePhoiStep({ baseByStep: {}, lineSteps: [], counts: {} }, 'UON');
      expect(n.required).toBe(0);
      expect(n.maxNow).toBe(0);
      expect(n.room).toBe(0);
      expect(Number.isNaN(n.physicalLeft)).toBe(false);
    });
  });

  describe('AC26: dòng đã báo vượt từ trước deploy', () => {
    it('cắt 1190 trên số cần 1180 -> over 10, room âm nhưng maxNow 0, báo thêm 1 bị chặn "tối đa 0"', () => {
      const input: PhoiNeedInput = {
        baseByStep: { CAT: 1180 },
        lineSteps: [[]],
        counts: { CAT: c(1190) },
      };
      const n = computePhoiStep(input, 'CAT');
      expect(n.over).toBe(10);
      expect(n.maxNow).toBe(0);
      expect(pickPhoiBlock(n, 1)).toBe('NEED');
      expect(buildCutBlockMessage(n, ctx(1, '441'))).toContain('tối đa 0');
      expect(buildCutBlockMessage(n, ctx(1, '441'))).not.toMatch(/tối đa -/);
    });

    it('công đoạn phụ vượt: over 10, physicalLeft âm không làm maxNow âm', () => {
      const input: PhoiNeedInput = {
        baseByStep: { CAT: 100, UON: 100 },
        lineSteps: [['UON']],
        counts: { CAT: c(100), UON: c(110) },
      };
      const n = computePhoiStep(input, 'UON');
      expect(n.over).toBe(10);
      expect(n.maxNow).toBe(0);
      expect(buildStepBlockMessage(n, pickPhoiBlock(n, 1)!, ctx(1))).not.toMatch(/tối đa -/);
    });
  });

  describe('AC30: chuỗi thật Bỏ 5 / Làm lại 3', () => {
    const afterReview: PhoiNeedInput = {
      baseByStep: { CAT: 1180, UON: 1180 },
      lineSteps: [['UON']],
      counts: { CAT: c(1180), UON: c(1180, 8, 0, 5) },
    };

    it('Cắt cần 1185 = baseRequired 1180 + extraNeed 5; báo cắt 5 qua, 6 bị chặn', () => {
      const cut = computePhoiStep(afterReview, 'CAT');
      expect(cut.baseRequired).toBe(1180);
      expect(cut.extraNeed).toBe(5);
      expect(cut.required).toBe(1185);
      expect(pickPhoiBlock(cut, 5)).toBeNull();
      expect(pickPhoiBlock(cut, 6)).toBe('NEED');
    });

    it('Uốn bù 3 (làm lại) qua ngay, không cần cắt', () => {
      const uon = computePhoiStep(afterReview, 'UON');
      expect(pickPhoiBlock(uon, 3)).toBeNull();
    });

    it('báo thêm Uốn khi chưa cắt (ví dụ 4) -> câu "báo cắt thêm ... đoạn 355mm"; cắt 5 xong thì Uốn thêm 5 qua', () => {
      const uon = computePhoiStep(afterReview, 'UON');
      const kind = pickPhoiBlock(uon, 4);
      expect(kind).not.toBeNull();
      expect(buildStepBlockMessage(uon, kind!, ctx(4))).toMatch(
        /báo cắt thêm \d+ đoạn 355mm ở máy cắt trước/,
      );
      // làm lại 3 đã báo, rồi cắt 5 xong
      const next: PhoiNeedInput = {
        ...afterReview,
        counts: { CAT: c(1185), UON: c(1183, 8, 0, 5) },
      };
      const uon2 = computePhoiStep(next, 'UON');
      expect(uon2.physicalLeft).toBe(5);
      expect(pickPhoiBlock(uon2, 5)).toBeNull();
    });
  });

  describe('AC31: Dập bỏ 4', () => {
    it('cần Cắt +4, Uốn +4, Dập không đổi, Dập đã tính -4; dòng "460 trơn" không nhận phần cộng', () => {
      const input: PhoiNeedInput = {
        baseByStep: { CAT: 300, UON: 100, DAP: 100 },
        lineSteps: [[], ['UON', 'DAP']],
        counts: { CAT: c(300), UON: c(100), DAP: c(100, 4, 0, 4) },
      };
      expect(computePhoiStep(input, 'CAT').extraNeed).toBe(4);
      expect(computePhoiStep(input, 'UON').extraNeed).toBe(4);
      const dap = computePhoiStep(input, 'DAP');
      expect(dap.extraNeed).toBe(0);
      expect(dap.required).toBe(100);
      expect(dap.counted).toBe(96);
      // dòng trơn: không có Uốn / Dập -> base Uốn / Dập = 0, extra Uốn = 0
      const plain: PhoiNeedInput = {
        baseByStep: { CAT: 200 },
        lineSteps: [[], []],
        counts: { DAP: c(10, 4, 0, 4) },
      };
      expect(computePhoiStep(plain, 'UON').extraNeed).toBe(0);
    });

    it('báo Dập trước Uốn vẫn được khi cắt đủ (không ràng buộc thứ tự)', () => {
      const input: PhoiNeedInput = {
        baseByStep: { CAT: 100, UON: 100, DAP: 100 },
        lineSteps: [['UON', 'DAP']],
        counts: { CAT: c(100), DAP: c(50) },
      };
      const dap = computePhoiStep(input, 'DAP');
      expect(pickPhoiBlock(dap, 50)).toBeNull();
    });
  });

  describe('AC34 (số mới): Uốn cần 1200, cắt 1180 (đợt A 120), Uốn đã báo 1180', () => {
    const afterShort: PhoiNeedInput = {
      baseByStep: { CAT: 1200, UON: 1200 },
      lineSteps: [['UON']],
      counts: { CAT: c(1180, 0, 5), UON: c(1180) },
    };

    it('KCS ghi thiếu 5 ở Cắt -> Uốn vượt số đoạn cắt thực có 5 (stepsOverCutCap)', () => {
      expect(stepsOverCutCap(afterShort)).toEqual([{ step: 'UON', overBy: 5, cutCap: 1175 }]);
    });

    it('báo Uốn 1 -> vế vật lý thắng (vì physicalLeft -5 < room 20); câu có "KCS ghi thiếu 5 đoạn cắt"', () => {
      const n = computePhoiStep(afterShort, 'UON');
      expect(n.room).toBe(20);
      expect(n.physicalLeft).toBe(-5);
      expect(n.maxNow).toBe(0);
      const kind = pickPhoiBlock(n, 1);
      expect(kind).toBe('PHYSICAL');
      expect(buildStepBlockMessage(n, kind!, ctx(1))).toContain('KCS ghi thiếu 5 đoạn cắt');
    });

    it('cắt thêm 6 thì báo Uốn được đúng 1; báo 2 bị chặn', () => {
      const more: PhoiNeedInput = {
        ...afterShort,
        counts: { CAT: c(1186, 0, 5), UON: c(1180) },
      };
      const n = computePhoiStep(more, 'UON');
      expect(n.physicalLeft).toBe(1);
      expect(n.maxNow).toBe(1);
      expect(pickPhoiBlock(n, 1)).toBeNull();
      expect(pickPhoiBlock(n, 2)).toBe('PHYSICAL');
    });

    it('không có thiếu thì stepsOverCutCap rỗng; công đoạn chưa báo (raw 0) không vào danh sách', () => {
      expect(
        stepsOverCutCap({
          baseByStep: { CAT: 10, UON: 10 },
          lineSteps: [['UON']],
          counts: { CAT: c(10), UON: c(10) },
        }),
      ).toEqual([]);
      expect(
        stepsOverCutCap({
          baseByStep: { CAT: 10, UON: 10 },
          lineSteps: [['UON']],
          counts: { CAT: c(10, 0, 3) },
        }),
      ).toEqual([]);
    });

    it('thiếu ở Cắt có "lỗi - làm lại" ở Uốn: dùng_T trừ phần làm lại (không tính 2 lần)', () => {
      const n = computePhoiStep(
        {
          baseByStep: { CAT: 100, UON: 100 },
          lineSteps: [['UON']],
          counts: { CAT: c(100, 0, 2), UON: c(100, 6, 0, 2) },
        },
        'UON',
      );
      // làm lại = 6 - 2 = 4; dùng = 100 - 0 - 4 = 96; cutCap = 98 -> còn 2
      expect(n.rework).toBe(4);
      expect(n.used).toBe(96);
      expect(n.physicalLeft).toBe(2);
    });
  });

  describe('AC39: mốc "đủ" của tiến độ', () => {
    it('chưa cắt lại thì chưa đủ (room > 0); cắt 5 + Uốn 5 + KCS đạt thì room 0', () => {
      const pending: PhoiNeedInput = {
        baseByStep: { CAT: 1180, UON: 1180 },
        lineSteps: [['UON']],
        counts: { CAT: c(1180), UON: c(1180, 5, 0, 5) },
      };
      expect(computePhoiStep(pending, 'CAT').room).toBe(5);
      expect(computePhoiStep(pending, 'UON').room).toBe(5);
      const done: PhoiNeedInput = {
        ...pending,
        counts: { CAT: c(1185), UON: c(1185, 5, 0, 5) },
      };
      expect(computePhoiStep(done, 'CAT').room).toBe(0);
      expect(computePhoiStep(done, 'UON').room).toBe(0);
    });
  });

  describe('AC60 / AG2: PI nhiều SKU, đợt cũ chưa gắn SKU', () => {
    const rows = {
      orders: [
        { id: BigInt(1), bomRevisionId: BigInt(10), quantity: 2 },
        { id: BigInt(2), bomRevisionId: BigInt(10), quantity: 3 },
      ],
      bomPieces: [{ bomRevisionId: BigInt(10), pieceId: BigInt(100), qtyPerUnit: 1 }],
      pieceBoms: [
        {
          bomRevisionId: BigInt(10),
          pieceId: BigInt(100),
          segmentSpecId: BigInt(500),
          qtyPerPiece: 10,
          processSteps: ['UON'],
        },
      ],
    };

    it('đợt cắt 30 đoạn chưa gắn SKU và Uốn bỏ 5 chưa gắn SKU: ở khoá "none", không cộng vào số cần của SKU nào', () => {
      const index = buildPhoiNeedIndex({
        ...rows,
        cut: [{ segmentSpecId: BigInt(500), productionOrderId: null, qty: 30 }],
        cutQc: [],
        step: [{ segmentSpecId: BigInt(500), productionOrderId: null, step: 'UON', qty: 10 }],
        stepQc: [
          {
            segmentSpecId: BigInt(500),
            productionOrderId: null,
            step: 'UON',
            failedQty: 5,
            scrapQty: 5,
          },
        ],
      });
      const sku1 = computePhoiStep(index.get('1', '500')!, 'CAT');
      const sku2 = computePhoiStep(index.get('2', '500')!, 'CAT');
      expect(sku1.required).toBe(20);
      expect(sku2.required).toBe(30);
      expect(sku1.extraNeed).toBe(0);
      expect(sku2.extraNeed).toBe(0);
      expect(sku1.counted).toBe(0);
      expect(sku2.counted).toBe(0);
      expect(sku1.maxNow).toBe(20); // báo cắt cho SKU không bị chặn theo phần chưa gắn
      expect(index.orderKeysOf('500').sort()).toEqual(['1', '2', 'none']);
    });

    it('PI 1 SKU: đợt chưa gắn SKU gộp vào SKU duy nhất', () => {
      const one = [{ id: BigInt(7) }];
      expect(phoiOrderKey(one, null)).toBe('7');
      expect(phoiOrderKey(one, BigInt(7))).toBe('7');
      expect(phoiOrderKey([{ id: BigInt(1) }, { id: BigInt(2) }], null)).toBe('none');
      expect(phoiOrderKey([], undefined)).toBe('none');
    });

    it('số cần theo SKU = qtyPerPiece x qtyPerUnit x SL SKU; qtyPerUnit 0 thì không có số cần', () => {
      const index = buildPhoiNeedIndex({
        ...rows,
        bomPieces: [{ bomRevisionId: BigInt(10), pieceId: BigInt(100), qtyPerUnit: 0 }],
        cut: [],
        cutQc: [],
        step: [],
        stepQc: [],
      });
      expect(index.byKey.size).toBe(0);
    });
  });

  describe('thiếu không phải lỗi', () => {
    it('Cắt: thiếu 3 giảm đã tính (room tăng 3) nhưng không đổi failed', () => {
      const n = computePhoiStep(
        { baseByStep: { CAT: 100 }, lineSteps: [[]], counts: { CAT: c(100, 2, 3) } },
        'CAT',
      );
      expect(n.failed).toBe(2);
      expect(n.short).toBe(3);
      expect(n.counted).toBe(95);
      expect(n.room).toBe(5);
    });
  });
});
