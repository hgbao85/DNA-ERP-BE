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
});
