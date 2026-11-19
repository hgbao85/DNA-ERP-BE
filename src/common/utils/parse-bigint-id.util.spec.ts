import { BadRequestException } from '@nestjs/common';
import { parseBigIntId } from './parse-bigint-id.util';

describe('parseBigIntId', () => {
  it('nhận số nguyên dương hợp lệ, kể cả giá trị lớn nhất của bigint', () => {
    expect(parseBigIntId('12')).toBe(12n);
    expect(parseBigIntId('9223372036854775807')).toBe(9223372036854775807n);
  });

  it('từ chối chuỗi không phải số', () => {
    expect(() => parseBigIntId('abc')).toThrow(BadRequestException);
  });

  it('T3-10: từ chối số vượt 2^63-1 bằng 400 thay vì để DB trả 500', () => {
    expect(() => parseBigIntId('9223372036854775808')).toThrow(BadRequestException);
    expect(() => parseBigIntId('99999999999999999999999')).toThrow(
      'Mã (id) không hợp lệ: 99999999999999999999999',
    );
  });
});
