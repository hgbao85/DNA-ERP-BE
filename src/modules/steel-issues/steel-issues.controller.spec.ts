import { ForbiddenException } from '@nestjs/common';
import {
  LEGACY_CUT_REPORT_CLOSED_MESSAGE,
  LEGACY_STEEL_RECEIVE_CLOSED_MESSAGE,
} from '../../common/constants/legacy-floor-report.constant';
import { SteelIssuesController } from './steel-issues.controller';
import { SteelIssuesService } from './steel-issues.service';

describe('SteelIssuesController - route báo của màn cũ đã đóng', () => {
  let service: Record<string, jest.Mock>;
  let controller: SteelIssuesController;

  beforeEach(() => {
    service = {
      receive: jest.fn(),
      recordCutBatch: jest.fn(),
      finishCutBundle: jest.fn(),
      recordStepBatch: jest.fn(),
      submitStepBundle: jest.fn(),
      assignCutBundleOrder: jest.fn().mockResolvedValue('ok'),
      assignStepBundleOrder: jest.fn().mockResolvedValue('ok'),
      findAll: jest.fn().mockResolvedValue('ok'),
    };
    controller = new SteelIssuesController(service as unknown as SteelIssuesService);
  });

  const closed: Array<[string, () => unknown, string]> = [
    ['receive', () => controller.receive(), LEGACY_STEEL_RECEIVE_CLOSED_MESSAGE],
    ['recordCutBatch', () => controller.recordCutBatch(), LEGACY_CUT_REPORT_CLOSED_MESSAGE],
    ['finishCutBundle', () => controller.finishCutBundle(), LEGACY_CUT_REPORT_CLOSED_MESSAGE],
    ['recordStepBatch', () => controller.recordStepBatch(), LEGACY_CUT_REPORT_CLOSED_MESSAGE],
    ['submitStepBundle', () => controller.submitStepBundle(), LEGACY_CUT_REPORT_CLOSED_MESSAGE],
  ];

  it.each(closed)('%s ném ForbiddenException đúng câu, không gọi service', (_name, call, msg) => {
    expect(call).toThrow(ForbiddenException);
    expect(call).toThrow(msg);
    for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
  });

  it('route POST cut-bundles/:id/undo-last-batch đã bị xoá (404): controller không còn hàm, service không còn undoLastCutBatch (P1, S14)', () => {
    expect((controller as unknown as Record<string, unknown>).undoLastCutBatch).toBeUndefined();
    expect(
      (SteelIssuesService.prototype as unknown as Record<string, unknown>).undoLastCutBatch,
    ).toBeUndefined();
    const routes = Reflect.ownKeys(SteelIssuesController.prototype).filter(
      (k) => k !== 'constructor',
    );
    const paths = routes.map(
      (k) =>
        Reflect.getMetadata(
          'path',
          (SteelIssuesController.prototype as never)[k] as object,
        ) as unknown,
    );
    expect(paths).not.toContain('cut-bundles/:id/undo-last-batch');
  });

  it('route gán SKU vẫn gọi service', async () => {
    await controller.assignCutBundleOrder('1', { productionOrderId: '2' }, 'u1');
    await controller.assignStepBundleOrder('1', { productionOrderId: '2' }, 'u1');
    expect(service.assignCutBundleOrder).toHaveBeenCalledWith('1', '2', 'u1');
    expect(service.assignStepBundleOrder).toHaveBeenCalledWith('1', '2', 'u1');
  });

  it('route reassign-order vẫn gọi service', async () => {
    await controller.reassignCutBundleOrder('1', { productionOrderId: '2' }, 'u1');
    await controller.reassignStepBundleOrder('1', { productionOrderId: '2' }, 'u1');
    expect(service.assignCutBundleOrder).toHaveBeenCalledWith('1', '2', 'u1', true);
    expect(service.assignStepBundleOrder).toHaveBeenCalledWith('1', '2', 'u1', true);
  });

  it('route GET vẫn gọi service', async () => {
    await controller.findAll({} as never);
    expect(service.findAll).toHaveBeenCalled();
  });
});
