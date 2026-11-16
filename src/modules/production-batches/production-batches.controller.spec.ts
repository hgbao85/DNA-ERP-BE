import { ForbiddenException } from '@nestjs/common';
import { LEGACY_HAN_SON_REPORT_CLOSED_MESSAGE } from '../../common/constants/legacy-floor-report.constant';
import { ProductionBatchesController } from './production-batches.controller';
import { ProductionBatchesService } from './production-batches.service';

describe('ProductionBatchesController - chặn Hàn / Sơn ở route báo cũ', () => {
  let service: Record<string, jest.Mock>;
  let controller: ProductionBatchesController;

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue('ok'),
      recordProductionBatch: jest.fn().mockResolvedValue('ok'),
      finishProductionBatch: jest.fn().mockResolvedValue('ok'),
    };
    controller = new ProductionBatchesController(service as unknown as ProductionBatchesService);
  });

  const dto = {} as never;
  const calls: Array<[string, (role: string | null) => unknown]> = [
    ['create', (role) => controller.create('1', dto, 'u1', role, null, 'k')],
    [
      'recordProductionBatch',
      (role) => controller.recordProductionBatch('1', dto, 'u1', role, 'k'),
    ],
    ['finishProductionBatch', (role) => controller.finishProductionBatch('1', 'u1', role, null)],
  ];

  describe.each(calls)('%s', (_name, call) => {
    it.each(['HAN', 'SON'])('chặn %s, không gọi service', (role) => {
      expect(() => call(role)).toThrow(ForbiddenException);
      expect(() => call(role)).toThrow(LEGACY_HAN_SON_REPORT_CLOSED_MESSAGE);
      for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
    });

    it('PHOI đi tiếp xuống service', async () => {
      await call('PHOI');
      const total = Object.values(service).reduce((n, fn) => n + fn.mock.calls.length, 0);
      expect(total).toBe(1);
    });
  });
});
