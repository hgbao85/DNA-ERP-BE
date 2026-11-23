import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { NOTIFICATION_TYPES } from './notification-types';

/**
 * P1 (18/11/2026) - UB10a: định nghĩa tin theo hợp đồng v2 mục 13 + bản sửa MF1.
 * Test thuần, không DB. Ánh xạ AC: AC18 (KCS_BATCH_STALE), AC3 / AC44 (câu QC_FAILED, QC_PASSED,
 * FLOOR_STAGE_COMPLETE), AC48 (FLOOR_BATCH_STALE giữ chữ, Lead chốt A).
 */
describe('P1 UB10a - KCS_BATCH_STALE (AC18)', () => {
  const def = NOTIFICATION_TYPES.KCS_BATCH_STALE;

  it('AC18: loại tin tồn tại, ACTION_REQUIRED / WARNING / entityType FLOOR_STAGE', () => {
    expect(def).toBeDefined();
    expect(def.category).toBe('ACTION_REQUIRED');
    expect(def.severity).toBe('WARNING');
    expect(def.entityType).toBe('FLOOR_STAGE');
  });

  it('AC18: title có xưởng dùng dấu " · "', () => {
    expect(
      def.title({ stage: 'HAN', count: 2, hours: 4, workshopId: '7', workshopName: 'Xưởng A' }),
    ).toBe('Tổ Hàn · Xưởng A: 2 đợt chờ KCS chấm quá 4 giờ');
  });

  it('AC18: title không xưởng thì bỏ cả phần " · "', () => {
    const title = def.title({ stage: 'SON', count: 1, hours: 6 });
    expect(title).toBe('Tổ Sơn: 1 đợt chờ KCS chấm quá 6 giờ');
    expect(title).not.toContain('·');
  });

  it.each([
    ['PHOI', 'Phôi'],
    ['HAN', 'Hàn'],
    ['SON', 'Sơn'],
  ] as const)('AC18: tổ %s hiện nhãn "%s" ở title và message', (stage, label) => {
    expect(def.title({ stage, count: 3, hours: 4 })).toContain(`Tổ ${label}`);
    expect(def.message({ stage, count: 3, hours: 4 })).toContain(`KCS ${label}`);
  });

  it('AC18: message nói KCS chưa chấm quá N giờ, không còn nói "gửi KCS"', () => {
    const msg = def.message({ stage: 'HAN', count: 2, hours: 4 });
    expect(msg).toContain('KCS chưa chấm quá 4 giờ');
    expect(msg).not.toContain('gửi KCS');
  });

  it.each([
    ['PHOI', 'kcs-phoi'],
    ['HAN', 'kcs-han'],
    ['SON', 'kcs-son'],
  ] as const)('AC18 / MF1: tổ %s link tới đúng tab %s, KHÔNG có alternatives', (stage, page) => {
    const link = def.link?.({ stage, count: 1, hours: 4 });
    expect(link).toEqual({ module: 'production', page });
    expect(link).not.toHaveProperty('alternatives');
  });

  it('AC18 (đổi 23/11/2026, bỏ hàng đợi xưởng): người nhận CHỈ KCS_STAFF, không còn QLSX, không chỉ định đích danh', () => {
    const rec = def.recipients({ stage: 'HAN', count: 1, hours: 4, workshopId: '7' });
    expect(rec.roles).toEqual([BUSINESS_ROLES.KCS_STAFF]);
    expect(rec.userIds).toBeUndefined();
    expect(rec.allActiveUsers).toBeUndefined();
  });
});

describe('P1 UB10a - FLOOR_BATCH_STALE giữ chữ (AC48, Lead chốt A)', () => {
  const def = NOTIFICATION_TYPES.FLOOR_BATCH_STALE;

  it('AC48: title / message / link / người nhận y như bản N1', () => {
    expect(def.title({ stage: 'HAN', count: 2, hours: 4, workshopName: 'Xưởng A' })).toBe(
      'Tổ Hàn · Xưởng A: 2 đợt chờ gửi KCS quá 4 giờ',
    );
    expect(def.title({ stage: 'PHOI', count: 1, hours: 4 })).toBe(
      'Tổ Phôi: 1 đợt chờ gửi KCS quá 4 giờ',
    );
    expect(def.message({ stage: 'HAN', count: 2, hours: 4 })).toBe(
      'Công nhân đã báo nhưng chưa gửi KCS quá 4 giờ - kiểm và gửi KCS (hoặc hủy lần báo sai).',
    );
    expect(def.link?.({ stage: 'HAN', count: 2, hours: 4 })).toEqual({
      module: 'production',
      page: 'san-luong-xuong',
    });
    expect(def.recipients({ stage: 'HAN', count: 2, hours: 4 })).toEqual({
      roles: [BUSINESS_ROLES.PRODUCTION_MANAGER],
    });
    expect(def.category).toBe('ACTION_REQUIRED');
    expect(def.severity).toBe('WARNING');
    expect(def.entityType).toBe('FLOOR_STAGE');
  });
});

describe('P1 UB10a - FLOOR_STAGE_COMPLETE (AC44)', () => {
  const def = NOTIFICATION_TYPES.FLOOR_STAGE_COMPLETE;

  it('AC44: câu có "KCS chấm hết" và vẫn giữ cụm "Chuyển lệnh tiếp"', () => {
    const msg = def.message({ stage: 'HAN', piCode: 'PI-X' });
    expect(msg).toContain('KCS chấm hết');
    expect(msg).toContain('Chuyển lệnh tiếp');
    expect(msg).toContain('Hàn');
    expect(msg).toContain('PI-X');
  });
});

describe('P1 UB10a - QC_FAILED (AC3 / AC44)', () => {
  const def = NOTIFICATION_TYPES.QC_FAILED;
  const base = { piCode: 'PI-X', failedQty: 7, senderRole: BUSINESS_ROLES.HAN_STAFF };

  it('câu mặc định chứa failedQty và không còn nhắc "gửi KCS"', () => {
    const msg = def.message(base);
    expect(msg).toContain('Công nhân làm bù 7');
    expect(msg).not.toContain('gửi KCS');
    expect(msg).not.toContain('QLSX kiểm rồi');
  });

  it('failedQty khác thì câu đổi theo', () => {
    expect(def.message({ ...base, failedQty: 12 })).toContain('làm bù 12');
  });

  it('có todo thì todo thắng câu mặc định (đợt Cắt / công đoạn phụ)', () => {
    expect(def.message({ ...base, todo: 'Cắt bù 3 đoạn' })).toBe('Cắt bù 3 đoạn');
  });

  it('người nhận = tổ gửi + QLSX', () => {
    expect(def.recipients(base)).toEqual({
      roles: [BUSINESS_ROLES.HAN_STAFF, BUSINESS_ROLES.PRODUCTION_MANAGER],
    });
  });
});

describe('P1 UB10a - QC_PASSED (AC3 / AC44)', () => {
  const def = NOTIFICATION_TYPES.QC_PASSED;

  it('có note thì hiện note', () => {
    expect(def.message({ piCode: 'PI-X', note: 'Thiếu 2 đoạn, đã ghi nhận' })).toBe(
      'Thiếu 2 đoạn, đã ghi nhận',
    );
  });

  it('không có note thì "Không có lỗi."', () => {
    expect(def.message({ piCode: 'PI-X' })).toBe('Không có lỗi.');
  });

  it('title giữ "KCS duyệt đạt", người nhận QLSX', () => {
    expect(def.title({ piCode: 'PI-X' })).toBe('PI-X: KCS duyệt đạt');
    expect(def.recipients({ piCode: 'PI-X' })).toEqual({
      roles: [BUSINESS_ROLES.PRODUCTION_MANAGER],
    });
  });
});
