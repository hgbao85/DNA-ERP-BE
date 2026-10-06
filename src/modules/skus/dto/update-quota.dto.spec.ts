import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  QuotaDetailLineDto,
  QuotaMaterialLineDto,
  QuotaPieceMaterialLineDto,
} from './update-quota.dto';

// B1 (2026-10-06, E2E): trước đây @Min(0) cho phép lưu bì zipper / dây / đinh với số lượng 0.
describe('update-quota DTO - số lượng dòng định mức phải dương (B1)', () => {
  const check = async (cls: new () => object, body: Record<string, unknown>) =>
    validate(plainToInstance(cls, body));

  it('QuotaDetailLineDto (bì zipper) từ chối qtyPerUnit = 0', async () => {
    const errors = await check(QuotaDetailLineDto, {
      group: 'BAO_BI_DONG_GOI',
      materialId: '86',
      qtyPerUnit: 0,
    });
    expect(errors.map((e) => e.property)).toContain('qtyPerUnit');
  });

  it('QuotaDetailLineDto chấp nhận qtyPerUnit > 0', async () => {
    const errors = await check(QuotaDetailLineDto, {
      group: 'BAO_BI_DONG_GOI',
      materialId: '86',
      qtyPerUnit: 1,
    });
    expect(errors).toHaveLength(0);
  });

  it('QuotaMaterialLineDto từ chối qtyPerUnit = 0 và số âm', async () => {
    expect(
      (await check(QuotaMaterialLineDto, { materialId: '1', qtyPerUnit: 0 })).length,
    ).toBeGreaterThan(0);
    expect(
      (await check(QuotaMaterialLineDto, { materialId: '1', qtyPerUnit: -1 })).length,
    ).toBeGreaterThan(0);
  });

  it('QuotaPieceMaterialLineDto (Dây/Đinh) từ chối qtyPerPiece = 0', async () => {
    const errors = await check(QuotaPieceMaterialLineDto, {
      group: 'WIRE',
      materialId: '43',
      qtyPerPiece: 0,
    });
    expect(errors.map((e) => e.property)).toContain('qtyPerPiece');
  });
});
