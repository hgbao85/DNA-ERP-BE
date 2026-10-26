import * as path from 'node:path';
import {
  resolveWorkerFile,
  SolverWorkerCrashError,
  SolverWorkerHost,
  SolverWorkerTimeoutError,
} from './solver-worker-host';

const FAKE = path.join(__dirname, 'fake-solver.worker.js');
type Echo = { status: string; echo: { mode?: string; tag?: string }; threadId: number };

describe('SolverWorkerHost (worker giả)', () => {
  let host: SolverWorkerHost;
  afterEach(async () => {
    await host.close();
  });

  it('chạy bài qua worker và trả đúng kết quả; worker được dùng lại cho bài sau', async () => {
    host = new SolverWorkerHost({ workerFile: FAKE });
    const a = (await host.run({ tag: 'a' }, 5000)) as unknown as Echo;
    const b = (await host.run({ tag: 'b' }, 5000)) as unknown as Echo;
    expect(a.echo.tag).toBe('a');
    expect(b.echo.tag).toBe('b');
    expect(b.threadId).toBe(a.threadId);
    expect(host.stats()).toEqual({ queued: 0, running: 0, workersAlive: 1 });
  });

  it('FIFO 1 bài/lúc với pool 1: bài 2 chờ bài 1 xong, thứ tự giữ nguyên', async () => {
    host = new SolverWorkerHost({ workerFile: FAKE, poolSize: 1 });
    const order: string[] = [];
    const p1 = host.run({ mode: 'sleep', ms: 150, tag: '1' }, 5000).then(() => order.push('1'));
    const p2 = host.run({ mode: 'echo', tag: '2' }, 5000).then(() => order.push('2'));
    await new Promise((r) => setTimeout(r, 30));
    expect(host.stats()).toMatchObject({ queued: 1, running: 1 });
    await Promise.all([p1, p2]);
    expect(order).toEqual(['1', '2']);
  });

  it('pool 2: hai bài chạy song song trên 2 worker khác nhau', async () => {
    host = new SolverWorkerHost({ workerFile: FAKE, poolSize: 2 });
    const [a, b] = (await Promise.all([
      host.run({ mode: 'sleep', ms: 100 }, 5000),
      host.run({ mode: 'sleep', ms: 100 }, 5000),
    ])) as unknown as Echo[];
    expect(a.threadId).not.toBe(b.threadId);
    expect(host.stats().workersAlive).toBe(2);
  });

  it('hết giờ: terminate worker, reject SolverWorkerTimeoutError, bài kế chạy trên worker mới', async () => {
    host = new SolverWorkerHost({ workerFile: FAKE });
    const first = (await host.run({ mode: 'echo' }, 5000)) as unknown as Echo;
    await expect(host.run({ mode: 'hang' }, 100)).rejects.toBeInstanceOf(SolverWorkerTimeoutError);
    expect(host.stats()).toEqual({ queued: 0, running: 0, workersAlive: 0 });
    const next = (await host.run({ mode: 'echo' }, 5000)) as unknown as Echo;
    expect(next.threadId).not.toBe(first.threadId);
  });

  it('timeout tính từ lúc gọi, gồm cả thời gian chờ hàng đợi', async () => {
    host = new SolverWorkerHost({ workerFile: FAKE, poolSize: 1 });
    const slow = host.run({ mode: 'sleep', ms: 200 }, 5000);
    await expect(host.run({ mode: 'echo' }, 50)).rejects.toBeInstanceOf(SolverWorkerTimeoutError);
    await expect(slow).resolves.toMatchObject({ status: 'success' });
  });

  it('worker chết (exit) khi đang chạy -> reject SolverWorkerCrashError, host hồi phục', async () => {
    host = new SolverWorkerHost({ workerFile: FAKE });
    await expect(host.run({ mode: 'crash' }, 5000)).rejects.toBeInstanceOf(SolverWorkerCrashError);
    await expect(host.run({ mode: 'echo' }, 5000)).resolves.toMatchObject({ status: 'success' });
  });

  it('worker trả lời rồi tự thoát (WASM hỏng): bài này vẫn nhận kết quả, bài sau chạy trên worker mới', async () => {
    host = new SolverWorkerHost({ workerFile: FAKE });
    const a = (await host.run({ mode: 'reply-then-exit' }, 5000)) as unknown as Echo;
    expect(a.status).toBe('success');
    await new Promise((r) => setTimeout(r, 50));
    expect(host.stats().workersAlive).toBe(0);
    const b = (await host.run({ mode: 'echo' }, 5000)) as unknown as Echo;
    expect(b.threadId).not.toBe(a.threadId);
  });

  it('worker ném lỗi ngoài handler -> reject SolverWorkerCrashError kèm thông báo', async () => {
    host = new SolverWorkerHost({ workerFile: FAKE });
    await expect(host.run({ mode: 'throw' }, 5000)).rejects.toThrow('worker nổ');
  });

  it('close(): từ chối bài đang chờ, terminate worker, không nhận bài mới', async () => {
    host = new SolverWorkerHost({ workerFile: FAKE, poolSize: 1 });
    // Bắt rejection NGAY (close() từ chối trước khi expect kịp gắn handler -> unhandled rejection).
    const running = host.run({ mode: 'hang' }, 60_000).catch((e: unknown) => e);
    const waiting = host.run({ mode: 'echo' }, 60_000).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 30));
    await host.close();
    expect(await running).toBeInstanceOf(SolverWorkerCrashError);
    expect(await waiting).toBeInstanceOf(SolverWorkerCrashError);
    await expect(host.run({}, 1000)).rejects.toThrow('host đã đóng');
    expect(host.stats()).toEqual({ queued: 0, running: 0, workersAlive: 0 });
  });

  it('watchdog RSS: vượt trần -> terminate worker, reject lỗi bộ nhớ', async () => {
    // Trần 1 MB: RSS tiến trình jest luôn vượt -> watchdog phải cắt bài ngay nhịp đầu.
    host = new SolverWorkerHost({ workerFile: FAKE, maxRssMb: 1, rssPollMs: 20 });
    await expect(host.run({ mode: 'hang' }, 5000)).rejects.toThrow('vượt trần bộ nhớ');
    expect(host.stats().workersAlive).toBe(0);
  });

  it('resolveWorkerFile: dưới ts-jest trỏ .ts và nạp ts-node vào worker', () => {
    const r = resolveWorkerFile();
    expect(r.file.endsWith('solver.worker.ts')).toBe(true);
    expect(r.execArgv).toEqual(['-r', 'ts-node/register', '-r', 'tsconfig-paths/register']);
  });
});

describe('SolverWorkerHost (worker THẬT: solver.worker.ts + HiGHS)', () => {
  it('giải ca h10-20 trong worker và trả đúng hợp đồng JSON', async () => {
    const host = new SolverWorkerHost();
    try {
      const res = await host.run(
        {
          num_sets: 100,
          bom: [
            {
              part: 'a',
              qty_per_set: 16,
              material: 'A',
              spec: '',
              cut_length: 497,
              qty_per_part: 1,
            },
            {
              part: 'b',
              qty_per_set: 32,
              material: 'A',
              spec: '',
              cut_length: 355,
              qty_per_part: 1,
            },
          ],
          stock_lengths: '6000',
          max_waste_percentage: 1,
          time_limit_seconds: 30,
        },
        60_000,
      );
      expect(res.status).toBe('success');
      if (res.status !== 'success') return;
      expect(res.summary).toMatchObject({ total_bars_all: 325, waste_percentage: 0.353 });
      const bad = await host.run({ num_sets: 0, bom: [{}] }, 10_000);
      expect(bad).toMatchObject({ status: 'error', code: 'INVALID_INPUT', http_status: 400 });
    } finally {
      await host.close();
    }
  }, 60_000);
});
