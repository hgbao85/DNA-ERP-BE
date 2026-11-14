import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSystemConfigDto } from './update-system-config.dto';

/**
 * Cấu hình máy cắt (2026-10-23): khoá luật ở tầng DTO (ValidationPipe whitelist+transform, xem main.ts)
 * - đúng tiền lệ solver-override.dto.spec.ts. Các luật: máy thuộc enum; hệ số bó là 1-8 số nguyên > 1;
 * cắt tay 0-100; số cỡ đoạn/kiểu cắt 1-10; lưỡi 0-10 mm; tề đầu 0-100 mm.
 */
describe('UpdateSystemConfigDto - máy cắt', () => {
  const base = { companyName: 'DNA Steel' };
  const errorsOn = async (payload: Record<string, unknown>) =>
    (await validate(plainToInstance(UpdateSystemConfigDto, { ...base, ...payload }))).map(
      (e) => e.property,
    );

  it('không gửi trường máy cắt nào thì hợp lệ (giữ nguyên cấu hình hiện có)', async () => {
    expect(await errorsOn({})).toEqual([]);
  });

  it('nhận cấu hình MC Tự động đầy đủ hợp lệ', async () => {
    expect(
      await errorsOn({
        solverMachine: 'tu_dong',
        solverMctdBladeWidthMm: 2.5,
        solverMctdTrimStartMm: 0,
        solverBundleFactors: [14, 16, 18, 20],
        solverMaxManualCuts: 5,
        solverMaxSizesPerPattern: 5,
      }),
    ).toEqual([]);
  });

  it('solverMachine chỉ nhận laser | tu_dong', async () => {
    expect(await errorsOn({ solverMachine: 'laser' })).toEqual([]);
    expect(await errorsOn({ solverMachine: 'tu_dong' })).toEqual([]);
    expect(await errorsOn({ solverMachine: 'plasma' })).toContain('solverMachine');
  });

  describe('solverBundleFactors', () => {
    it('từ chối mảng rỗng và quá 8 phần tử', async () => {
      expect(await errorsOn({ solverBundleFactors: [] })).toContain('solverBundleFactors');
      expect(await errorsOn({ solverBundleFactors: [2, 3, 4, 5, 6, 7, 8, 9, 10] })).toContain(
        'solverBundleFactors',
      );
      expect(await errorsOn({ solverBundleFactors: [2, 3, 4, 5, 6, 7, 8, 9] })).toEqual([]);
    });

    it('từ chối hệ số trùng nhau và hệ số > 100', async () => {
      expect(await errorsOn({ solverBundleFactors: [14, 14] })).toContain('solverBundleFactors');
      expect(await errorsOn({ solverBundleFactors: [14, 101] })).toContain('solverBundleFactors');
      expect(await errorsOn({ solverBundleFactors: [2, 100] })).toEqual([]);
    });

    it('từ chối hệ số <= 1 (hệ số 1 là cây cắt tay, solver tự thêm) và số lẻ', async () => {
      expect(await errorsOn({ solverBundleFactors: [1, 14] })).toContain('solverBundleFactors');
      expect(await errorsOn({ solverBundleFactors: [0] })).toContain('solverBundleFactors');
      expect(await errorsOn({ solverBundleFactors: [14.5] })).toContain('solverBundleFactors');
    });
  });

  it('solverMaxManualCuts 0-100', async () => {
    expect(await errorsOn({ solverMaxManualCuts: 0 })).toEqual([]);
    expect(await errorsOn({ solverMaxManualCuts: 100 })).toEqual([]);
    expect(await errorsOn({ solverMaxManualCuts: -1 })).toContain('solverMaxManualCuts');
    expect(await errorsOn({ solverMaxManualCuts: 101 })).toContain('solverMaxManualCuts');
    expect(await errorsOn({ solverMaxManualCuts: 2.5 })).toContain('solverMaxManualCuts');
  });

  it('solverMaxSizesPerPattern 1-10', async () => {
    expect(await errorsOn({ solverMaxSizesPerPattern: 1 })).toEqual([]);
    expect(await errorsOn({ solverMaxSizesPerPattern: 10 })).toEqual([]);
    expect(await errorsOn({ solverMaxSizesPerPattern: 0 })).toContain('solverMaxSizesPerPattern');
    expect(await errorsOn({ solverMaxSizesPerPattern: 11 })).toContain('solverMaxSizesPerPattern');
  });

  it('solverLaserMinTailMm 0-1000, số nguyên', async () => {
    expect(await errorsOn({ solverLaserMinTailMm: 0 })).toEqual([]);
    expect(await errorsOn({ solverLaserMinTailMm: 100 })).toEqual([]);
    expect(await errorsOn({ solverLaserMinTailMm: 1000 })).toEqual([]);
    expect(await errorsOn({ solverLaserMinTailMm: -1 })).toContain('solverLaserMinTailMm');
    expect(await errorsOn({ solverLaserMinTailMm: 1001 })).toContain('solverLaserMinTailMm');
    expect(await errorsOn({ solverLaserMinTailMm: 10.5 })).toContain('solverLaserMinTailMm');
  });

  it('solverMaxSizesPerBarByWorkshop: object { mã xưởng: số nguyên 1-10 }, {} hợp lệ (bỏ hết luật)', async () => {
    const prop = 'solverMaxSizesPerBarByWorkshop';
    expect(await errorsOn({ [prop]: { PHUOC_AN: 2 } })).toEqual([]);
    expect(await errorsOn({ [prop]: { PHUOC_AN: 1, PHU_AN: 10 } })).toEqual([]);
    expect(await errorsOn({ [prop]: {} })).toEqual([]);
    expect(await errorsOn({ [prop]: { PHUOC_AN: 0 } })).toContain(prop);
    expect(await errorsOn({ [prop]: { PHUOC_AN: 11 } })).toContain(prop);
    expect(await errorsOn({ [prop]: { PHUOC_AN: 2.5 } })).toContain(prop);
    expect(await errorsOn({ [prop]: { PHUOC_AN: '2' } })).toContain(prop);
    expect(await errorsOn({ [prop]: { '': 2 } })).toContain(prop);
    expect(await errorsOn({ [prop]: [2] })).toContain(prop);
    expect(await errorsOn({ [prop]: 'PHUOC_AN=2' })).toContain(prop);
    expect(await errorsOn({ [prop]: null })).toEqual([]); // IsOptional bỏ qua null/undefined
  });

  it('solverMachineByWorkshop: object { mã xưởng: laser | tu_dong }, {} hợp lệ', async () => {
    const prop = 'solverMachineByWorkshop';
    expect(await errorsOn({ [prop]: { PHUOC_AN: 'tu_dong' } })).toEqual([]);
    expect(await errorsOn({ [prop]: { PHUOC_AN: 'tu_dong', PHU_AN: 'laser' } })).toEqual([]);
    expect(await errorsOn({ [prop]: {} })).toEqual([]);
    expect(await errorsOn({ [prop]: { PHUOC_AN: 'plasma' } })).toContain(prop);
    expect(await errorsOn({ [prop]: { PHUOC_AN: 2 } })).toContain(prop);
    expect(await errorsOn({ [prop]: { '': 'laser' } })).toContain(prop);
    expect(await errorsOn({ [prop]: ['laser'] })).toContain(prop);
    expect(await errorsOn({ [prop]: 'laser' })).toContain(prop);
  });

  it('solverBundleFactorsBySpec: khoá V/H/FI, mảng 1-12 số nguyên 2-500 không trùng, {} hợp lệ', async () => {
    const prop = 'solverBundleFactorsBySpec';
    expect(await errorsOn({ [prop]: { V10: [60, 64], 'H13-26': [20], FI19: [30] } })).toEqual([]);
    expect(await errorsOn({ [prop]: { v10: [60], ' h10-20 ': [20] } })).toEqual([]); // viết thường/khoảng trắng được chuẩn hoá
    expect(await errorsOn({ [prop]: { 'FI12.5': [30] } })).toEqual([]);
    expect(await errorsOn({ [prop]: {} })).toEqual([]);
    expect(await errorsOn({ [prop]: { VUONG10: [60] } })).toContain(prop);
    expect(await errorsOn({ [prop]: { H10: [60] } })).toContain(prop);
    expect(await errorsOn({ [prop]: { V10: [] } })).toContain(prop);
    expect(await errorsOn({ [prop]: { V10: [1] } })).toContain(prop);
    expect(await errorsOn({ [prop]: { V10: [501] } })).toContain(prop);
    expect(await errorsOn({ [prop]: { V10: [60, 60] } })).toContain(prop);
    expect(await errorsOn({ [prop]: { V10: [60.5] } })).toContain(prop);
    expect(
      await errorsOn({ [prop]: { V10: Array.from({ length: 13 }, (_, i) => i + 2) } }),
    ).toContain(prop);
    expect(await errorsOn({ [prop]: { V10: 60 } })).toContain(prop);
    expect(await errorsOn({ [prop]: [60] })).toContain(prop);
  });

  it('lưỡi MC Tự động 0-10 mm (cho số lẻ), tề đầu 0-100 mm (số nguyên)', async () => {
    expect(await errorsOn({ solverMctdBladeWidthMm: 0 })).toEqual([]);
    expect(await errorsOn({ solverMctdBladeWidthMm: 10 })).toEqual([]);
    expect(await errorsOn({ solverMctdBladeWidthMm: -0.1 })).toContain('solverMctdBladeWidthMm');
    expect(await errorsOn({ solverMctdBladeWidthMm: 10.5 })).toContain('solverMctdBladeWidthMm');
    // Cột DB là Decimal(6,1): 2.55 sẽ bị làm tròn lặng lẽ -> chặn ở DTO.
    expect(await errorsOn({ solverMctdBladeWidthMm: 2.55 })).toContain('solverMctdBladeWidthMm');
    expect(await errorsOn({ solverMctdBladeWidthMm: 2.5 })).toEqual([]);
    expect(await errorsOn({ solverMctdTrimStartMm: 100 })).toEqual([]);
    expect(await errorsOn({ solverMctdTrimStartMm: 101 })).toContain('solverMctdTrimStartMm');
    expect(await errorsOn({ solverMctdTrimStartMm: -1 })).toContain('solverMctdTrimStartMm');
    expect(await errorsOn({ solverMctdTrimStartMm: 1.5 })).toContain('solverMctdTrimStartMm');
  });

  it('solverLengthStepMm phải là bội 50, báo lỗi tiếng Việt nhắc "bội 50"', async () => {
    for (const bad of [10, 25, 60]) {
      const errors = await validate(
        plainToInstance(UpdateSystemConfigDto, { ...base, solverLengthStepMm: bad }),
      );
      const own = errors.find((e) => e.property === 'solverLengthStepMm');
      expect(own).toBeDefined();
      expect(Object.values(own?.constraints ?? {}).join(' | ')).toContain('bội 50');
    }
    for (const good of [50, 100, 1000]) {
      expect(await errorsOn({ solverLengthStepMm: good })).toEqual([]);
    }
    expect(await errorsOn({})).toEqual([]);
  });

  // Phần A – Đợt 3 (YC10)
  it('capacityContPerDay 0,1-20, tối đa 2 số lẻ', async () => {
    expect(await errorsOn({ capacityContPerDay: 1.3 })).toEqual([]);
    expect(await errorsOn({ capacityContPerDay: 0.1 })).toEqual([]);
    expect(await errorsOn({ capacityContPerDay: 20 })).toEqual([]);
    expect(await errorsOn({ capacityContPerDay: 0.05 })).toContain('capacityContPerDay');
    expect(await errorsOn({ capacityContPerDay: 0 })).toContain('capacityContPerDay');
    expect(await errorsOn({ capacityContPerDay: 20.01 })).toContain('capacityContPerDay');
    expect(await errorsOn({ capacityContPerDay: 1.333 })).toContain('capacityContPerDay');
  });

  it('daysPerContPhuocAn là số nguyên 1-60', async () => {
    expect(await errorsOn({ daysPerContPhuocAn: 4 })).toEqual([]);
    expect(await errorsOn({ daysPerContPhuocAn: 1 })).toEqual([]);
    expect(await errorsOn({ daysPerContPhuocAn: 60 })).toEqual([]);
    expect(await errorsOn({ daysPerContPhuocAn: 0 })).toContain('daysPerContPhuocAn');
    expect(await errorsOn({ daysPerContPhuocAn: 61 })).toContain('daysPerContPhuocAn');
    expect(await errorsOn({ daysPerContPhuocAn: 2.5 })).toContain('daysPerContPhuocAn');
  });

  // Phần A – Đợt 4 (YC6)
  it('materialEarliestArrivalDays là số nguyên 0-30', async () => {
    expect(await errorsOn({ materialEarliestArrivalDays: 4 })).toEqual([]);
    expect(await errorsOn({ materialEarliestArrivalDays: 0 })).toEqual([]);
    expect(await errorsOn({ materialEarliestArrivalDays: 30 })).toEqual([]);
    expect(await errorsOn({ materialEarliestArrivalDays: -1 })).toContain(
      'materialEarliestArrivalDays',
    );
    expect(await errorsOn({ materialEarliestArrivalDays: 31 })).toContain(
      'materialEarliestArrivalDays',
    );
    expect(await errorsOn({ materialEarliestArrivalDays: 2.5 })).toContain(
      'materialEarliestArrivalDays',
    );
  });
});
