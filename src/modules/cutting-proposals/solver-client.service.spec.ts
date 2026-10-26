import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ExternalApiHttpError } from '../external/external-api.service';
import { SolverClientService } from './solver-client.service';
import {
  SolverWorkerHost,
  SolverWorkerMemoryError,
  SolverWorkerTimeoutError,
} from './solver-ts/solver-worker-host';
import { ProposeResponse } from './solver-ts/types';

/** Host giả: trả/ném theo kịch bản, ghi lại body + timeout nhận được. */
class FakeHost {
  calls: Array<{ body: unknown; timeoutMs: number }> = [];
  closed = false;
  constructor(private readonly answer: (body: unknown) => Promise<ProposeResponse>) {}
  run(body: unknown, timeoutMs: number): Promise<ProposeResponse> {
    this.calls.push({ body, timeoutMs });
    return this.answer(body);
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

class TestableService extends SolverClientService {
  constructor(
    config: ConfigService<AppConfig, true>,
    public readonly fakeHost: FakeHost,
  ) {
    super(config);
  }
  protected override createWorkerHost(): SolverWorkerHost {
    return this.fakeHost as unknown as SolverWorkerHost;
  }
}

describe('SolverClientService', () => {
  let configMap: Record<string, unknown>;
  const configService = () =>
    ({ get: jest.fn((key: string) => configMap[key]) }) as unknown as ConfigService<
      AppConfig,
      true
    >;

  beforeEach(() => {
    configMap = {
      'solver.timeoutSeconds': 300,
      'solver.ts': { workers: 1, heapMb: 0, maxRssMb: 0 },
    };
  });

  describe('HiGHS trong worker thread', () => {
    const okResponse: ProposeResponse = {
      status: 'success',
      summary: {
        num_sets: 1,
        num_material_groups: 1,
        total_solve_seconds: 0.1,
        total_bars_all: 3,
        total_purchased_mm: 18000,
        total_waste_mm: 30,
        total_surplus_pieces: 0,
        waste_percentage: 0.1667,
        any_over_threshold: false,
      },
      purchase_plan: [],
      input_echo: {},
    } as unknown as ProposeResponse;

    const build = (answer: (body: unknown) => Promise<ProposeResponse>) => {
      const fake = new FakeHost(answer);
      return new TestableService(configService(), fake);
    };

    it('trả kết quả của worker; timeout chuyển nguyên vẹn', async () => {
      const svc = build(() => Promise.resolve(okResponse));
      await expect(svc.propose({ b: 2 }, 777)).resolves.toBe(okResponse);
      expect(svc.fakeHost.calls).toEqual([{ body: { b: 2 }, timeoutMs: 777 }]);
    });

    it('propose() trả status=error 400 -> ExternalApiHttpError(400, body Django)', async () => {
      const svc = build(() =>
        Promise.resolve({
          status: 'error',
          code: 'INVALID_INPUT',
          message: 'num_sets phải ≥ 1',
          http_status: 400,
        }),
      );
      const err = await svc.propose({}, 1000).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ExternalApiHttpError);
      expect((err as ExternalApiHttpError).status).toBe(400);
      expect((err as ExternalApiHttpError).body).toEqual({
        status: 'error',
        code: 'INVALID_INPUT',
        message: 'num_sets phải ≥ 1',
      });
    });

    it('propose() ném exception bên trong worker -> status=error 500 SOLVER_ERROR -> ExternalApiHttpError(500)', async () => {
      const svc = build(() =>
        Promise.resolve({
          status: 'error',
          code: 'SOLVER_ERROR',
          message: 'bùm',
          http_status: 500,
        }),
      );
      const err = await svc.propose({}, 1000).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ExternalApiHttpError);
      expect((err as ExternalApiHttpError).status).toBe(500);
    });

    it.each([
      ['hết giờ', new SolverWorkerTimeoutError(5000)],
      ['tràn RAM', new SolverWorkerMemoryError(900, 512)],
      ['worker chết', new Error('exit code 7')],
    ])(
      '%s -> ServiceUnavailableException (verifyExactStandaloneWaste catch -> null)',
      async (_n, e) => {
        const svc = build(() => Promise.reject(e));
        const err = await svc.propose({}, 5000).catch((x: unknown) => x);
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        expect((err as Error).message).toContain(e.message);
      },
    );

    it('onModuleDestroy đóng host; host chỉ tạo khi có lượt giải đầu tiên', async () => {
      const svc = build(() => Promise.resolve(okResponse));
      await svc.onModuleDestroy(); // chưa có host -> không lỗi
      expect(svc.fakeHost.closed).toBe(false);
      await svc.propose({}, 100);
      await svc.onModuleDestroy();
      expect(svc.fakeHost.closed).toBe(true);
    });
  });
});
