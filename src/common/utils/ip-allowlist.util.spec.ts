import { BadRequestException } from '@nestjs/common';
import {
  isIpAllowed,
  isNetworkRestrictedAccount,
  isPrivateOrLoopbackIp,
  normalizeAllowedIpEntry,
  normalizeAllowedIps,
  unwrapMappedIpv4,
} from './ip-allowlist.util';

describe('normalizeAllowedIpEntry', () => {
  it('IPv4, CIDR, IPv6 cụ thể hợp lệ được chuẩn hoá', () => {
    expect(normalizeAllowedIpEntry(' 203.0.113.5 ')).toBe('203.0.113.5');
    expect(normalizeAllowedIpEntry('203.0.113.0/24')).toBe('203.0.113.0/24');
    expect(normalizeAllowedIpEntry('::FFFF:203.0.113.5')).toBe('203.0.113.5');
    expect(normalizeAllowedIpEntry('2001:0DB8:0:0:0:0:0:1')).toBe('2001:db8::1');
  });

  it.each([
    '',
    '   ',
    'abc',
    '999.1.1.1',
    '1.2.3',
    '1.2.3.4/33',
    '1.2.3.4/7', // gần như cho cả Internet
    '0.0.0.0/0',
    '1.2.3.4/abc',
    '1.2.3.4/24/8',
    '2001:db8::/32', // chưa hỗ trợ CIDR IPv6
  ])('từ chối %j', (bad) => {
    expect(() => normalizeAllowedIpEntry(bad)).toThrow(BadRequestException);
  });

  it('cả danh sách: bỏ trùng, giữ thứ tự; 1 dòng sai làm hỏng cả danh sách (400 nêu rõ dòng)', () => {
    expect(normalizeAllowedIps(['1.1.1.1', ' 1.1.1.1 ', '2.2.2.0/24'])).toEqual([
      '1.1.1.1',
      '2.2.2.0/24',
    ]);
    expect(() => normalizeAllowedIps(['1.1.1.1', 'rác'])).toThrow(/rác/);
  });
});

describe('isIpAllowed', () => {
  it('danh sách RỖNG = tắt = luôn cho phép (kể cả không biết IP)', () => {
    expect(isIpAllowed('8.8.8.8', [])).toBe(true);
    expect(isIpAllowed(undefined, [])).toBe(true);
  });

  it('khớp đúng IP; IPv4 bọc trong IPv6 (::ffff:) vẫn khớp', () => {
    const list = ['203.0.113.5'];
    expect(isIpAllowed('203.0.113.5', list)).toBe(true);
    expect(isIpAllowed('::ffff:203.0.113.5', list)).toBe(true);
    expect(isIpAllowed('203.0.113.6', list)).toBe(false);
  });

  it('khớp dải CIDR đúng biên', () => {
    const list = ['203.0.113.0/24', '198.51.100.128/25'];
    expect(isIpAllowed('203.0.113.0', list)).toBe(true);
    expect(isIpAllowed('203.0.113.255', list)).toBe(true);
    expect(isIpAllowed('203.0.114.1', list)).toBe(false);
    expect(isIpAllowed('198.51.100.200', list)).toBe(true);
    expect(isIpAllowed('198.51.100.100', list)).toBe(false); // nằm ngoài nửa dưới /25
    expect(isIpAllowed('10.0.0.1', ['10.0.0.1/32'])).toBe(true);
  });

  it('IPv6: so sánh theo dạng chuẩn (viết khác nhau vẫn khớp), không khớp dải IPv4', () => {
    expect(isIpAllowed('2001:DB8:0:0:0:0:0:1', ['2001:db8::1'])).toBe(true);
    expect(isIpAllowed('2001:db8::2', ['2001:db8::1'])).toBe(false);
    expect(isIpAllowed('2001:db8::1', ['203.0.113.0/24'])).toBe(false);
  });

  it('danh sách có giá trị mà không biết / không đọc được IP khách -> TỪ CHỐI (không đoán)', () => {
    expect(isIpAllowed(undefined, ['203.0.113.5'])).toBe(false);
    expect(isIpAllowed('', ['203.0.113.5'])).toBe(false);
    expect(isIpAllowed('không-phải-ip', ['203.0.113.5'])).toBe(false);
  });
});

describe('isPrivateOrLoopbackIp / unwrapMappedIpv4', () => {
  it('nhận IP nội bộ + loopback; IP công cộng thì không', () => {
    for (const ip of [
      '127.0.0.1',
      '::1',
      '10.1.2.3',
      '192.168.0.9',
      '172.20.0.1',
      '::ffff:127.0.0.1',
      'fd00::1',
    ]) {
      expect(isPrivateOrLoopbackIp(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '203.0.113.5', '172.32.0.1', '2001:db8::1']) {
      expect(isPrivateOrLoopbackIp(ip)).toBe(false);
    }
    expect(unwrapMappedIpv4('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(unwrapMappedIpv4('1.2.3.4')).toBe('1.2.3.4');
  });
});

describe('isNetworkRestrictedAccount - "ai có chức năng quét mã"', () => {
  it('công nhân (FLOOR_WORKER) và tài khoản tổ Phôi/Hàn/Sơn bị giới hạn', () => {
    expect(isNetworkRestrictedAccount({ roles: ['FLOOR_WORKER'], mfgRole: 'PHOI' })).toBe(true);
    expect(isNetworkRestrictedAccount({ roles: ['PHOI_STAFF'], mfgRole: 'PHOI' })).toBe(true);
    expect(isNetworkRestrictedAccount({ roles: ['HAN_STAFF'], mfgRole: 'HAN' })).toBe(true);
    expect(isNetworkRestrictedAccount({ roles: ['SON_STAFF'], mfgRole: 'SON' })).toBe(true);
  });

  it('Sếp, QLSX, KCS, thủ kho, Admin KHÔNG bị giới hạn', () => {
    for (const a of [
      { roles: ['BOSS'], mfgRole: null },
      { roles: ['PRODUCTION_MANAGER'], mfgRole: 'PRODUCTION_MANAGER' },
      { roles: ['KCS_STAFF'], mfgRole: 'KCS' },
      { roles: ['WAREHOUSE_STAFF'], mfgRole: null },
      { roles: ['ADMIN'], mfgRole: null },
    ]) {
      expect(isNetworkRestrictedAccount(a)).toBe(false);
    }
  });
});

describe('ghi chú sau # của mỗi dòng (2 địa điểm: văn phòng Quy Nhơn, xưởng Tây Sơn)', () => {
  it('giữ ghi chú, chuẩn hoá phần IP, giữ nguyên chữ hoa của ghi chú', () => {
    expect(normalizeAllowedIpEntry('  203.0.113.5   #   Văn phòng Quy Nhơn ')).toBe(
      '203.0.113.5 # Văn phòng Quy Nhơn',
    );
    expect(normalizeAllowedIpEntry('198.51.100.0/24#Xưởng Tây Sơn')).toBe(
      '198.51.100.0/24 # Xưởng Tây Sơn',
    );
    expect(normalizeAllowedIpEntry('203.0.113.5 #')).toBe('203.0.113.5'); // ghi chú rỗng = không có
  });

  it('từ chối: ghi chú quá dài, hoặc chỉ có ghi chú không có IP', () => {
    expect(() => normalizeAllowedIpEntry(`1.2.3.4 # ${'x'.repeat(61)}`)).toThrow(/Ghi chú quá dài/);
    expect(() => normalizeAllowedIpEntry('# chỉ ghi chú')).toThrow(BadRequestException);
  });

  it('khớp IP bỏ qua ghi chú: cả 2 địa điểm cùng nằm trong danh sách', () => {
    const list = normalizeAllowedIps([
      '203.0.113.5 # Văn phòng Quy Nhơn',
      '198.51.100.0/24 # Xưởng Tây Sơn',
    ]);
    expect(isIpAllowed('203.0.113.5', list)).toBe(true); // văn phòng
    expect(isIpAllowed('198.51.100.77', list)).toBe(true); // xưởng
    expect(isIpAllowed('8.8.8.8', list)).toBe(false);
  });

  it('trùng địa chỉ (khác ghi chú) chỉ giữ 1 dòng, ưu tiên dòng CÓ ghi chú', () => {
    expect(normalizeAllowedIps(['1.1.1.1', '1.1.1.1 # Văn phòng', '1.1.1.1 # khác'])).toEqual([
      '1.1.1.1 # Văn phòng',
    ]);
    expect(normalizeAllowedIps(['1.1.1.1 # A', '1.1.1.1'])).toEqual(['1.1.1.1 # A']);
  });
});
