import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMaterialDto } from './create-material.dto';

/**
 * CreateMaterialDto cố ý KHÔNG validate hầu hết field (xem docstring class) - 2 field hao hụt
 * là ngoại lệ vì chúng nuôi thẳng xuống solver cắt sắt ngoài, giá trị rác (vd "2,5") lọt xuống
 * Prisma Decimal sẽ vỡ thành 500 khó hiểu thay vì 400 rõ ràng qua ValidationPipe
 * (whitelist: true, transform: true - xem main.ts). Test này khoá đúng invariant đó ở tầng DTO,
 * không cần dựng cả HTTP stack có auth thật (repo chưa có tiền lệ e2e nào cho 1 route riêng lẻ).
 */
describe('CreateMaterialDto - validate maxCuttingWastePercentage/purchaseWastePercentage', () => {
  const base = { name: 'Sat cay', unit: 'kg' };

  it('từ chối chuỗi không phải số (D.hao-hut-sat)', async () => {
    const dto = plainToInstance(CreateMaterialDto, { ...base, maxCuttingWastePercentage: 'abc' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'maxCuttingWastePercentage')).toBe(true);
  });

  it('từ chối giá trị ngoài khoảng [0, 100] (D.hao-hut-sat)', async () => {
    const dto = plainToInstance(CreateMaterialDto, { ...base, purchaseWastePercentage: 150 });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'purchaseWastePercentage')).toBe(true);
  });

  it('chấp nhận số hợp lệ trong khoảng (D.hao-hut-sat)', async () => {
    const dto = plainToInstance(CreateMaterialDto, {
      ...base,
      maxCuttingWastePercentage: 2.5,
      purchaseWastePercentage: 0,
    });

    const errors = await validate(dto);

    expect(errors.filter((e) => e.property.includes('WastePercentage'))).toHaveLength(0);
  });

  it('bỏ trống (undefined) vẫn hợp lệ - 2 field này optional', async () => {
    const dto = plainToInstance(CreateMaterialDto, base);

    const errors = await validate(dto);

    expect(errors.filter((e) => e.property.includes('WastePercentage'))).toHaveLength(0);
  });
});
