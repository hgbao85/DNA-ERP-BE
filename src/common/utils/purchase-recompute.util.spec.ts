import { PurchaseProposalStatus as S } from '../../generated/prisma/client';
import {
  PurchaseRecomputeItem,
  eventFromPlan,
  planPurchaseRecompute,
  toRecomputeItem,
} from './purchase-recompute.util';

const item = (
  id: number,
  status: S,
  buyQty: number,
  orderQty: number | null = null,
  receivedQty = 0,
): PurchaseRecomputeItem => ({ id: BigInt(id), status, buyQty, orderQty, receivedQty });

describe('planPurchaseRecompute', () => {
  it('chưa có dòng nào: tạo dòng mới; số 0 thì tạo luôn ở PURCHASED', () => {
    expect(planPurchaseRecompute([], 50).create).toEqual({ buyQty: 50, toPurchased: false });
    expect(planPurchaseRecompute([], 0).create).toEqual({ buyQty: 0, toPurchased: true });
  });

  it.each([S.NEW, S.QUOTING, S.REJECTED])(
    'dòng %s có orderQty 110, nhu cầu giảm 100 -> 50: xoá orderQty + báo reset (lỗi a)',
    (status) => {
      const plan = planPurchaseRecompute([item(1, status, 100, 110)], 50);
      expect(plan.update).toEqual({
        itemId: 1n,
        buyQty: 50,
        clearOrderQty: true,
        toPurchased: false,
      });
      expect(plan.orderQtyReset).toEqual({
        itemId: 1n,
        oldOrderQty: 110,
        newBuyQty: 50,
        slipPrinted: false,
      });
      expect(plan.demandDropped).toBeNull();
      expect(plan.create).toBeNull();
    },
  );

  it('dòng SUBMITTED (phiếu đã in) giảm: báo reset kèm cờ slipPrinted', () => {
    const plan = planPurchaseRecompute([item(1, S.SUBMITTED, 100, 110)], 50);
    expect(plan.update?.clearOrderQty).toBe(true);
    expect(plan.orderQtyReset?.slipPrinted).toBe(true);
  });

  it('dòng NEW nằm trong đơn đặt hàng nháp giảm: phiếu coi như đã in -> slipPrinted (13/11/2026)', () => {
    const plan = planPurchaseRecompute(
      [{ ...item(1, S.NEW, 100, 110), inSupplierOrder: true }],
      50,
    );
    expect(plan.orderQtyReset?.slipPrinted).toBe(true);
  });

  it('toRecomputeItem: có supplierOrderId thì inSupplierOrder = true', () => {
    expect(toRecomputeItem({ id: 1n, supplierOrderId: 9n }).inSupplierOrder).toBe(true);
    expect(toRecomputeItem({ id: 1n, supplierOrderId: null }).inSupplierOrder).toBe(false);
  });

  it('nhu cầu TĂNG: giữ orderQty, không báo', () => {
    const plan = planPurchaseRecompute([item(1, S.NEW, 100, 110)], 130);
    expect(plan.update).toEqual({
      itemId: 1n,
      buyQty: 130,
      clearOrderQty: false,
      toPurchased: false,
    });
    expect(plan.orderQtyReset).toBeNull();
  });

  it('nhu cầu giữ nguyên: giữ orderQty', () => {
    const plan = planPurchaseRecompute([item(1, S.QUOTING, 100, 110)], 100);
    expect(plan.update?.clearOrderQty).toBe(false);
  });

  it('dòng không có orderQty mà giảm: chỉ ghi buyQty, không báo reset', () => {
    const plan = planPurchaseRecompute([item(1, S.NEW, 100)], 50);
    expect(plan.update).toEqual({
      itemId: 1n,
      buyQty: 50,
      clearOrderQty: false,
      toPurchased: false,
    });
    expect(plan.orderQtyReset).toBeNull();
  });

  it('giảm về 0: NEW -> PURCHASED, xoá orderQty nhưng không báo reset; QUOTING không đổi trạng thái', () => {
    const a = planPurchaseRecompute([item(1, S.NEW, 100, 110)], 0);
    expect(a.update).toEqual({ itemId: 1n, buyQty: 0, clearOrderQty: true, toPurchased: true });
    expect(a.orderQtyReset).toBeNull();
    const b = planPurchaseRecompute([item(1, S.QUOTING, 100, 110)], 0);
    expect(b.update?.toPurchased).toBe(false);
  });

  describe('có dòng PURCHASING (đã ký)', () => {
    it('giảm dưới số đã ký: không sửa dòng ký, báo demandDropped (lỗi b)', () => {
      const plan = planPurchaseRecompute([item(1, S.PURCHASING, 100, 120, 20)], 60);
      // còn chờ về = 120 - 20 = 100 > 60
      expect(plan.update).toBeNull();
      expect(plan.create).toBeNull();
      expect(plan.demandDropped).toEqual({ neededQty: 80, signedQty: 120 });
    });

    it('người mua làm tròn lên lúc ký (cần 406, ký mua 450), tính lại vẫn cần 406: KHÔNG báo nhu cầu giảm, không mua thêm', () => {
      const plan = planPurchaseRecompute([item(1, S.PURCHASING, 406, 450, 0)], 406);
      expect(plan.demandDropped).toBeNull();
      expect(plan.create).toBeNull();
      expect(plan.update).toBeNull();
    });

    it('làm tròn lên lúc ký, nhu cầu thật giảm (406 -> 300): báo, số đã ký báo theo số thực mua 450', () => {
      const plan = planPurchaseRecompute([item(1, S.PURCHASING, 406, 450, 0)], 300);
      expect(plan.demandDropped).toEqual({ neededQty: 300, signedQty: 450 });
    });

    it('tăng: phần thêm vào dòng NEW mới', () => {
      const plan = planPurchaseRecompute([item(1, S.PURCHASING, 100, null, 0)], 130);
      expect(plan.create).toEqual({ buyQty: 30, toPurchased: false });
      expect(plan.update).toBeNull();
      expect(plan.demandDropped).toBeNull();
    });

    it('tăng: dùng lại dòng chưa ký cùng khoá, giữ orderQty khi số phần thêm không giảm', () => {
      const plan = planPurchaseRecompute([item(1, S.PURCHASING, 100), item(2, S.NEW, 20, 25)], 130);
      expect(plan.update).toEqual({
        itemId: 2n,
        buyQty: 30,
        clearOrderQty: false,
        toPurchased: false,
      });
      expect(plan.create).toBeNull();
    });

    it('hàng đã nhận một phần được trừ khỏi phần chờ về', () => {
      const plan = planPurchaseRecompute([item(1, S.PURCHASING, 100, null, 40)], 90);
      // còn chờ về 60, cần thêm 30
      expect(plan.create).toEqual({ buyQty: 30, toPurchased: false });
    });

    it('dòng chưa ký có orderQty, phần thêm giảm: xoá orderQty + báo reset, vẫn báo dropped nếu dưới số ký', () => {
      const plan = planPurchaseRecompute([item(1, S.PURCHASING, 100), item(2, S.NEW, 50, 60)], 120);
      expect(plan.update).toEqual({
        itemId: 2n,
        buyQty: 20,
        clearOrderQty: true,
        toPurchased: false,
      });
      expect(plan.orderQtyReset?.newBuyQty).toBe(20);
      expect(plan.demandDropped).toBeNull();
    });

    it('giảm dưới số ký, còn dòng NEW: dòng NEW về 0 -> PURCHASED, dòng ký giữ nguyên', () => {
      const plan = planPurchaseRecompute([item(1, S.PURCHASING, 100), item(2, S.NEW, 20)], 60);
      expect(plan.update).toEqual({
        itemId: 2n,
        buyQty: 0,
        clearOrderQty: false,
        toPurchased: true,
      });
      expect(plan.demandDropped).toEqual({ neededQty: 60, signedQty: 100 });
    });
  });

  describe('dòng PURCHASED', () => {
    // Rà soát 14/11 MH2: số mới truyền vào ĐÃ trừ hàng đã nhận (còn trong kho hoặc đã xuất cho PI) - không trừ receivedQty lần nữa.
    it('chỉ có dòng PURCHASED: nhu cầu 100 -> 130, đã nhận đủ 100 -> số mới 30 -> tách dòng NEW 30', () => {
      const plan = planPurchaseRecompute([item(1, S.PURCHASED, 100, null, 100)], 30);
      expect(plan.create).toEqual({ buyQty: 30, toPurchased: false });
      expect(plan.update).toBeNull();
    });

    it('chỉ có dòng PURCHASED, không thiếu (số mới 0): không làm gì', () => {
      const plan = planPurchaseRecompute([item(1, S.PURCHASED, 100, null, 100)], 0);
      expect(plan.create).toBeNull();
      expect(plan.update).toBeNull();
    });

    it('số mới đã trừ hàng đã nhận: KHÔNG trừ receivedQty lần nữa (trước đây 30 − 100 -> không mua, thiếu 30)', () => {
      const plan = planPurchaseRecompute([item(1, S.PURCHASED, 100, null, 100)], 30);
      expect(plan.create?.buyQty).toBe(30);
    });

    it('2 dòng đã đóng (đóng thiếu + đặt lại): mua đúng số còn thiếu, không mua trùng phần dòng sau đã nhận', () => {
      const plan = planPurchaseRecompute(
        [item(1, S.PURCHASED, 100, null, 60), item(2, S.PURCHASED, 40, null, 40)],
        10,
      );
      expect(plan.create).toEqual({ buyQty: 10, toPurchased: false });
    });

    it('có cả PURCHASED và NEW: ghi số mới vào dòng NEW', () => {
      const plan = planPurchaseRecompute(
        [item(1, S.PURCHASED, 100, null, 100), item(2, S.NEW, 30)],
        25,
      );
      expect(plan.update).toEqual({
        itemId: 2n,
        buyQty: 25,
        clearOrderQty: false,
        toPurchased: false,
      });
    });
  });
});

describe('eventFromPlan / toRecomputeItem', () => {
  it('plan không có sự kiện -> null', () => {
    expect(eventFromPlan(5n, planPurchaseRecompute([item(1, S.NEW, 10)], 8))).toBeNull();
  });
  it('plan có reset -> gói theo vật tư', () => {
    const ev = eventFromPlan(5n, planPurchaseRecompute([item(1, S.NEW, 10, 12)], 8));
    expect(ev?.materialId).toBe(5n);
    expect(ev?.orderQtyReset?.oldOrderQty).toBe(12);
  });
  it('đổi Decimal sang số', () => {
    const r = toRecomputeItem({
      id: 1n,
      status: S.NEW,
      buyQty: { toNumber: () => 4.5 },
      orderQty: null,
      receivedQty: { toNumber: () => 1 },
    });
    expect(r).toEqual({
      id: 1n,
      status: S.NEW,
      buyQty: 4.5,
      orderQty: null,
      receivedQty: 1,
      inSupplierOrder: false,
    });
  });
});
