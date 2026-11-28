import {
  kcsExtraDefect,
  packagingLockKey,
  packingAvailable,
  setsPassed,
  transferCheckAvailable,
  transferCheckLockKey,
  validateKcsGrade,
} from './ck-dg-caps.util';
import { isCkDgQrEnabled } from './ck-dg-qr.config';

describe('ck-dg-caps.util (Chuyền kiểm / Đóng gói QR, 24/11/2026)', () => {
  describe('transferCheckAvailable (C3)', () => {
    it('Hiện có − đã kiểm − chờ KCS − đã bỏ', () => {
      expect(transferCheckAvailable(100, { checkedQty: 30, pendingQty: 20, scrapQty: 5 })).toBe(45);
    });
    it('không âm khi đã chiếm vượt Hiện có (dữ liệu cũ nhập tay)', () => {
      expect(transferCheckAvailable(10, { checkedQty: 12, pendingQty: 0, scrapQty: 0 })).toBe(0);
    });
    it('chưa có hàng về -> 0', () => {
      expect(transferCheckAvailable(0, { checkedQty: 0, pendingQty: 0, scrapQty: 0 })).toBe(0);
    });
  });

  describe('setsPassed (D2 - đồng bộ mọi mảnh)', () => {
    const bom = [
      { pieceId: 1n, qtyPerUnit: 1 },
      { pieceId: 2n, qtyPerUnit: 2 },
    ];
    it('mảnh thấp nhất quyết định', () => {
      expect(
        setsPassed(
          bom,
          new Map([
            ['1', 10],
            ['2', 9],
          ]),
        ),
      ).toBe(4);
    });
    it('mảnh chưa kiểm -> 0 bộ', () => {
      expect(setsPassed(bom, new Map([['1', 10]]))).toBe(0);
    });
    it('định mức rỗng -> 0', () => {
      expect(setsPassed([], new Map())).toBe(0);
    });
  });

  describe('packingAvailable (D2 + số lượng lệnh)', () => {
    it('min(bộ đã qua chuyền kiểm, số lượng lệnh) − đã đóng', () => {
      expect(packingAvailable({ orderQty: 10, setsPassed: 6, packedQty: 2 })).toBe(4);
      expect(packingAvailable({ orderQty: 10, setsPassed: 50, packedQty: 7 })).toBe(3);
    });
    it('không âm', () => {
      expect(packingAvailable({ orderQty: 10, setsPassed: 2, packedQty: 5 })).toBe(0);
    });
  });

  describe('validateKcsGrade (C2)', () => {
    const reported = { passedQty: 8, defectQty: 2 };
    it('hợp lệ: đạt + làm lại = báo', () => {
      expect(validateKcsGrade(reported, { passedQty: 7, reworkQty: 3, scrapQty: 0 })).toBeNull();
    });
    it('câu 9a (25/11): chấm bỏ > 0 -> lỗi, kể cả khi tổng khớp', () => {
      expect(validateKcsGrade(reported, { passedQty: 7, reworkQty: 2, scrapQty: 1 })).toMatch(
        /không còn chấm/,
      );
    });
    it('đạt KCS vượt số báo đạt -> lỗi', () => {
      expect(validateKcsGrade(reported, { passedQty: 9, reworkQty: 1, scrapQty: 0 })).toMatch(
        /không được vượt/,
      );
    });
    it('tổng không khớp -> lỗi', () => {
      expect(validateKcsGrade(reported, { passedQty: 8, reworkQty: 0, scrapQty: 0 })).toMatch(
        /phải bằng/,
      );
    });
    it('số âm / không nguyên -> lỗi', () => {
      expect(validateKcsGrade(reported, { passedQty: -1, reworkQty: 11, scrapQty: 0 })).toMatch(
        /không âm/,
      );
      expect(validateKcsGrade(reported, { passedQty: 1.5, reworkQty: 8.5, scrapQty: 0 })).toMatch(
        /không âm/,
      );
    });
    it('kcsExtraDefect = báo đạt − đạt KCS', () => {
      expect(kcsExtraDefect(8, 6)).toBe(2);
      expect(kcsExtraDefect(8, 8)).toBe(0);
    });
  });

  it('khoá dùng chung với recordTransferCheck / recordPackaging', () => {
    expect(transferCheckLockKey(5n, 7n)).toBe('transfer-check:5:7');
    expect(packagingLockKey(5n)).toBe('packaging:5');
  });

  describe('isCkDgQrEnabled', () => {
    const prev = process.env.CK_DG_QR_ENABLED;
    afterEach(() => {
      if (prev === undefined) delete process.env.CK_DG_QR_ENABLED;
      else process.env.CK_DG_QR_ENABLED = prev;
    });
    it('mặc định tắt, chỉ "true" mới bật', () => {
      delete process.env.CK_DG_QR_ENABLED;
      expect(isCkDgQrEnabled()).toBe(false);
      process.env.CK_DG_QR_ENABLED = ' TRUE ';
      expect(isCkDgQrEnabled()).toBe(true);
      process.env.CK_DG_QR_ENABLED = '1';
      expect(isCkDgQrEnabled()).toBe(false);
    });
  });
});
