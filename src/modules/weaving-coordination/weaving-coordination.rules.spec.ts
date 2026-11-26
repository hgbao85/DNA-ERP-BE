import { promiseAction, validateFollowUp, weavingRowStatus } from './weaving-coordination.rules';

describe('Điều phối đan - luật thuần', () => {
  const today = '2026-11-25';

  describe('weavingRowStatus (Đ1)', () => {
    it('đã trả đủ -> DONE (bất kể hạn)', () => {
      expect(weavingRowStatus(10, 10, '2026-11-01', today)).toMatchObject({
        status: 'DONE',
        held: 0,
      });
    });
    it('chưa có mốc Nhập đan -> NO_DEADLINE', () => {
      expect(weavingRowStatus(10, 3, null, today)).toMatchObject({
        status: 'NO_DEADLINE',
        held: 7,
        daysLeft: null,
      });
    });
    it('qua hạn -> LATE; còn 0..3 ngày -> DUE_SOON; > 3 ngày -> ON_TRACK', () => {
      expect(weavingRowStatus(10, 0, '2026-11-24', today)).toMatchObject({
        status: 'LATE',
        daysLeft: -1,
      });
      expect(weavingRowStatus(10, 0, '2026-11-25', today).status).toBe('DUE_SOON');
      expect(weavingRowStatus(10, 0, '2026-11-28', today)).toMatchObject({
        status: 'DUE_SOON',
        daysLeft: 3,
      });
      expect(weavingRowStatus(10, 0, '2026-11-29', today)).toMatchObject({
        status: 'ON_TRACK',
        daysLeft: 4,
      });
    });
  });

  describe('validateFollowUp (Đ2)', () => {
    const ctx = { sent: 10, held: 6, today };
    it('nội dung bắt buộc', () => {
      expect(validateFollowUp({ content: '   ' }, ctx)).toMatch(/Nội dung/);
    });
    it('điểm đan chưa nhận mảnh của lệnh -> lỗi', () => {
      expect(validateFollowUp({ content: 'gọi' }, { ...ctx, sent: 0, held: 0 })).toMatch(
        /chưa nhận/,
      );
    });
    it('chỉ ghi chú (không hẹn) -> hợp lệ', () => {
      expect(validateFollowUp({ content: 'gọi không nghe' }, ctx)).toBeNull();
    });
    it('hẹn phải đủ cả số và ngày', () => {
      expect(validateFollowUp({ content: 'x', promisedQty: 3 }, ctx)).toMatch(/cả số mảnh và ngày/);
      expect(validateFollowUp({ content: 'x', promisedDate: today }, ctx)).toMatch(
        /cả số mảnh và ngày/,
      );
    });
    it('số hẹn > 0 và ≤ đang giữ', () => {
      expect(validateFollowUp({ content: 'x', promisedQty: 0, promisedDate: today }, ctx)).toMatch(
        /lớn hơn 0/,
      );
      expect(validateFollowUp({ content: 'x', promisedQty: 7, promisedDate: today }, ctx)).toMatch(
        /vượt/,
      );
      expect(
        validateFollowUp({ content: 'x', promisedQty: 6, promisedDate: today }, ctx),
      ).toBeNull();
    });
    it('đã trả đủ thì không hẹn được', () => {
      expect(
        validateFollowUp(
          { content: 'x', promisedQty: 1, promisedDate: today },
          { ...ctx, held: 0 },
        ),
      ).toMatch(/đã trả đủ/);
    });
    it('ngày hẹn phải hợp lệ và không trước hôm nay', () => {
      expect(
        validateFollowUp({ content: 'x', promisedQty: 1, promisedDate: '2026-02-30' }, ctx),
      ).toMatch(/không hợp lệ/);
      expect(
        validateFollowUp({ content: 'x', promisedQty: 1, promisedDate: '2026-11-24' }, ctx),
      ).toMatch(/trước hôm nay/);
    });
  });

  describe('promiseAction (nhắc)', () => {
    const base = {
      status: 'OPEN' as const,
      promisedQty: 5,
      promisedDay: '2026-11-25',
      returnedSince: 0,
      heldNow: 6,
      today,
    };
    it('chưa tới ngày hẹn -> chờ', () => {
      expect(promiseAction({ ...base, today: '2026-11-24' })).toBe('KEEP_WAITING');
    });
    it('tới ngày hẹn mà chưa đủ -> nhắc; đã nhắc rồi thì không nhắc lại', () => {
      expect(promiseAction({ ...base, returnedSince: 4 })).toBe('REMIND');
      expect(promiseAction({ ...base, status: 'REMINDED', today: '2026-11-27' })).toBe(
        'KEEP_WAITING',
      );
    });
    it('về đủ số hẹn (kể từ lúc hẹn) hoặc hết giữ hàng -> đóng', () => {
      expect(promiseAction({ ...base, returnedSince: 5 })).toBe('CLOSE_KEPT');
      expect(promiseAction({ ...base, status: 'REMINDED', returnedSince: 6 })).toBe('CLOSE_KEPT');
      expect(promiseAction({ ...base, heldNow: 0 })).toBe('CLOSE_KEPT');
    });
  });
});
