import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ScanReceiveSteelDto } from './floor-scan.dto';

const errorsOf = (o: object) => validateSync(plainToInstance(ScanReceiveSteelDto, o));

describe('ScanReceiveSteelDto', () => {
  it('0 cây bị chặn, báo thủ kho', () => {
    const errors = errorsOf({ receivedBarCount: 0 });
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toContain(
      'Số cây nhận phải từ 1 trở lên. Không nhận được cây nào thì báo thủ kho.',
    );
  });

  it('số cây âm hoặc lẻ bị chặn', () => {
    expect(errorsOf({ receivedBarCount: -1 })).toHaveLength(1);
    expect(errorsOf({ receivedBarCount: 1.5 })).toHaveLength(1);
  });

  it('từ 1 trở lên hoặc bỏ trống (hiểu là đủ) thì hợp lệ', () => {
    expect(errorsOf({ receivedBarCount: 1 })).toHaveLength(0);
    expect(errorsOf({})).toHaveLength(0);
  });
});
