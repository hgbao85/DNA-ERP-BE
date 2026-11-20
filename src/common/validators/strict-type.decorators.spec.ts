import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsDateString, IsOptional, validate } from 'class-validator';
import { IsOnOrAfterField, KeepRawValue, ToStrictBoolean } from './strict-type.decorators';

const opts = { enableImplicitConversion: true };

class QueryDto {
  @IsOptional()
  @ToStrictBoolean()
  @IsBoolean()
  a?: boolean;

  @IsOptional()
  @ToStrictBoolean({ allowNumeric: true })
  @IsBoolean()
  n?: boolean;
}

class BodyDto {
  @IsOptional()
  @KeepRawValue()
  @IsBoolean()
  flag?: boolean;
}

class RangeDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  @IsOnOrAfterField('from')
  to?: string;
}

describe('strict-type decorators', () => {
  it('ToStrictBoolean đọc giá trị gốc: false -> false, abc -> lỗi', async () => {
    expect(plainToInstance(QueryDto, { a: 'false' }, opts).a).toBe(false);
    expect(plainToInstance(QueryDto, { a: 'true' }, opts).a).toBe(true);
    expect(plainToInstance(QueryDto, { a: '1' }, opts).a).toBe('1');
    expect(plainToInstance(QueryDto, { n: '1' }, opts).n).toBe(true);
    expect(plainToInstance(QueryDto, { n: '0' }, opts).n).toBe(false);
    expect(await validate(plainToInstance(QueryDto, { a: 'abc' }, opts))).toHaveLength(1);
    expect(await validate(plainToInstance(QueryDto, { n: 'abc' }, opts))).toHaveLength(1);
    expect(await validate(plainToInstance(QueryDto, {}, opts))).toHaveLength(0);
  });

  it('KeepRawValue: chuỗi "true" / "abc" / số không bị ép thành boolean', async () => {
    expect(await validate(plainToInstance(BodyDto, { flag: 'abc' }, opts))).toHaveLength(1);
    expect(await validate(plainToInstance(BodyDto, { flag: 'true' }, opts))).toHaveLength(1);
    expect(await validate(plainToInstance(BodyDto, { flag: 1 }, opts))).toHaveLength(1);
    expect(await validate(plainToInstance(BodyDto, { flag: false }, opts))).toHaveLength(0);
    expect(await validate(plainToInstance(BodyDto, {}, opts))).toHaveLength(0);
  });

  it('IsOnOrAfterField: to < from lỗi; bằng nhau, thiếu một đầu thì qua', async () => {
    const bad = await validate(plainToInstance(RangeDto, { from: '2026-12-31', to: '2026-01-01' }));
    expect(bad).toHaveLength(1);
    expect(Object.values(bad[0].constraints ?? {})).toContain(
      'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc',
    );
    expect(
      await validate(plainToInstance(RangeDto, { from: '2026-01-01', to: '2026-01-01' })),
    ).toHaveLength(0);
    expect(await validate(plainToInstance(RangeDto, { from: '2026-01-01' }))).toHaveLength(0);
    expect(await validate(plainToInstance(RangeDto, { to: '2026-01-01' }))).toHaveLength(0);
  });
});
