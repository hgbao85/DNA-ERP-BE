/**
 * Quản lý worker thread chạy solver TS (xem solver.worker.ts): hàng đợi FIFO, mỗi worker 1 bài/lúc,
 * hết giờ thì `terminate()` worker (HiGHS đang chặn luồng không thể "xin" nó dừng), lần gọi sau tự
 * tạo worker mới. Mặc định 1 worker = giữ đúng ngữ nghĩa "1 lượt giải tại 1 thời điểm" như hàng đợi
 * enqueueSolverRun của CuttingProposalsService; SOLVER_TS_WORKERS > 1 chỉ để các lần xác minh nhanh
 * (verifyExactStandaloneWaste, 6 lần song song) không phải chờ lượt giải chính.
 *
 * Giới hạn bộ nhớ - 2 lớp, cả 2 đều "chết worker, không chết API":
 *  - `resourceLimits.maxOldGenerationSizeMb`: trần heap V8 CỦA WORKER (mảng pattern, JSON...). Vượt
 *    -> worker bị V8 kết thúc (ERR_WORKER_OUT_OF_MEMORY), host nhận 'error'/'exit' và báo lỗi cho
 *    riêng bài đó. KHÔNG bao trùm bộ nhớ WASM của HiGHS (WebAssembly.Memory là ArrayBuffer ngoài
 *    heap V8).
 *  - Watchdog RSS: trong lúc có bài chạy, cứ 500 ms đọc `process.memoryUsage().rss` (toàn tiến
 *    trình - gồm cả WASM); vượt `maxRssMb` thì terminate mọi worker đang chạy. Đây là lưới an toàn
 *    thô (RSS gồm cả phần API), đặt trần theo gói RAM của container.
 *
 * `timeoutMs` của `run()` tính từ lúc GỌI (gồm cả thời gian chờ hàng đợi): đồng hồ bấm ngay khi xếp
 * hàng, bài còn đang chờ mà hết giờ thì bị gỡ khỏi hàng đợi và từ chối ngay - caller không bao giờ
 * chờ lâu hơn số đã khai, giống SolverClientService nhánh http (timeout HTTP client). Quan trọng cho
 * verifyExactStandaloneWaste (trần 8 s) xếp sau một lượt giải chính (tới 300 s).
 */
import { Logger } from '@nestjs/common';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { WorkerJobMessage, WorkerResultMessage } from './solver.worker';
import { ProposeResponse } from './types';

export interface SolverWorkerHostOptions {
  /** số worker chạy song song (mặc định 1) */
  poolSize?: number;
  /** trần heap V8 mỗi worker (MB); 0/undefined = mặc định của Node */
  maxOldGenerationSizeMb?: number;
  /** trần RSS toàn tiến trình (MB) khi có bài đang chạy; 0/undefined = tắt watchdog */
  maxRssMb?: number;
  /** đường dẫn file worker (mặc định: solver.worker.js/.ts cạnh file này) */
  workerFile?: string;
  /** chu kỳ watchdog RSS (ms) */
  rssPollMs?: number;
}

export class SolverWorkerTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Solver TS không trả lời trong ${timeoutMs}ms (đã terminate worker)`);
    this.name = 'SolverWorkerTimeoutError';
  }
}

export class SolverWorkerCrashError extends Error {
  constructor(detail: string) {
    super(`Solver TS worker chết: ${detail}`);
    this.name = 'SolverWorkerCrashError';
  }
}

export class SolverWorkerMemoryError extends Error {
  constructor(rssMb: number, limitMb: number) {
    super(
      `Solver TS vượt trần bộ nhớ (RSS ${rssMb.toFixed(0)} MB > ${limitMb} MB) - đã terminate worker`,
    );
    this.name = 'SolverWorkerMemoryError';
  }
}

interface Job {
  id: number;
  body: unknown;
  timeoutMs: number;
  timer: NodeJS.Timeout;
  resolve: (r: ProposeResponse) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker | null;
  job: Job | null;
}

/**
 * Tìm file worker: khi chạy từ dist là .js; khi chạy qua ts-node/ts-jest là .ts (nạp ts-node vào worker -
 * mỗi lần tạo worker tốn ~2-3 s biên dịch, chỉ chấp nhận cho test/script). SOLVER_TS_WORKER_FILE (đường dẫn
 * tuyệt đối tới solver.worker.js đã build) CHỈ để script đo chạy bằng ts-node mà vẫn dùng worker đã biên dịch.
 */
export function resolveWorkerFile(): { file: string; execArgv: string[] } {
  const override = process.env.SOLVER_TS_WORKER_FILE;
  if (override) return { file: override, execArgv: [] };
  const isTs = __filename.endsWith('.ts');
  return {
    file: path.join(__dirname, isTs ? 'solver.worker.ts' : 'solver.worker.js'),
    execArgv: isTs ? ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register'] : [],
  };
}

export class SolverWorkerHost {
  private readonly logger = new Logger(SolverWorkerHost.name);
  private readonly slots: Slot[];
  private readonly queue: Job[] = [];
  private nextId = 1;
  private rssTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly opts: Required<Omit<SolverWorkerHostOptions, 'workerFile'>> & {
    workerFile?: string;
  };

  constructor(options: SolverWorkerHostOptions = {}) {
    this.opts = {
      poolSize: Math.max(1, options.poolSize ?? 1),
      maxOldGenerationSizeMb: options.maxOldGenerationSizeMb ?? 0,
      maxRssMb: options.maxRssMb ?? 0,
      rssPollMs: options.rssPollMs ?? 500,
      workerFile: options.workerFile,
    };
    this.slots = Array.from({ length: this.opts.poolSize }, () => ({ worker: null, job: null }));
  }

  /** Số bài đang chờ / đang chạy / worker đang sống - để log và test. */
  stats(): { queued: number; running: number; workersAlive: number } {
    return {
      queued: this.queue.length,
      running: this.slots.filter((s) => s.job).length,
      workersAlive: this.slots.filter((s) => s.worker).length,
    };
  }

  run(body: unknown, timeoutMs: number): Promise<ProposeResponse> {
    if (this.closed) return Promise.reject(new SolverWorkerCrashError('host đã đóng'));
    return new Promise<ProposeResponse>((resolve, reject) => {
      const job: Job = {
        id: this.nextId++,
        body,
        timeoutMs,
        timer: setTimeout(() => this.onTimeout(job), Math.max(0, timeoutMs)),
        resolve,
        reject,
      };
      this.queue.push(job);
      this.dispatch();
    });
  }

  /** Terminate mọi worker, từ chối mọi bài đang chờ. Gọi khi app tắt. */
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0))
      this.settle(job, new SolverWorkerCrashError('host đang đóng'));
    await Promise.all(
      this.slots.map(async (slot) => {
        if (slot.job) this.failSlot(slot, new SolverWorkerCrashError('host đang đóng'));
        await this.killWorker(slot);
      }),
    );
    this.stopRssWatchdog();
  }

  private settle(job: Job, err: Error | null, result?: ProposeResponse): void {
    clearTimeout(job.timer);
    if (err) job.reject(err);
    else job.resolve(result as ProposeResponse);
  }

  private onTimeout(job: Job): void {
    const qi = this.queue.indexOf(job);
    if (qi >= 0) {
      // Còn đang chờ hàng đợi - gỡ ra, không chiếm worker.
      this.queue.splice(qi, 1);
      this.logger.warn(`Solver TS: bài ${job.id} hết ${job.timeoutMs}ms khi còn đang chờ hàng đợi`);
      this.settle(job, new SolverWorkerTimeoutError(job.timeoutMs));
      return;
    }
    const slot = this.slots.find((s) => s.job === job);
    if (!slot) return; // đã xong trước khi timer kịp huỷ
    this.logger.error(
      `Solver TS quá ${job.timeoutMs}ms (bài ${job.id}) -> terminate worker ${slot.worker?.threadId ?? '?'}`,
    );
    this.failSlot(slot, new SolverWorkerTimeoutError(job.timeoutMs));
    void this.killWorker(slot);
    this.dispatch();
  }

  private dispatch(): void {
    for (const slot of this.slots) {
      if (slot.job) continue;
      const job = this.queue.shift();
      if (!job) break;
      let worker: Worker;
      try {
        worker = this.ensureWorker(slot);
      } catch (e) {
        this.settle(
          job,
          new SolverWorkerCrashError(`không tạo được worker: ${(e as Error).message}`),
        );
        continue;
      }
      slot.job = job;
      const msg: WorkerJobMessage = { id: job.id, body: job.body };
      worker.postMessage(msg);
      this.startRssWatchdog();
    }
    if (!this.slots.some((s) => s.job)) this.stopRssWatchdog();
  }

  private ensureWorker(slot: Slot): Worker {
    if (slot.worker) return slot.worker;
    const resolved = resolveWorkerFile();
    const worker = new Worker(this.opts.workerFile ?? resolved.file, {
      execArgv: this.opts.workerFile ? [] : resolved.execArgv,
      resourceLimits: this.opts.maxOldGenerationSizeMb
        ? { maxOldGenerationSizeMb: this.opts.maxOldGenerationSizeMb }
        : undefined,
    });
    slot.worker = worker;
    worker.on('message', (reply: WorkerResultMessage) => {
      if (!slot.job || reply.id !== slot.job.id) return; // bài cũ đã bị huỷ
      const job = slot.job;
      slot.job = null;
      this.settle(job, null, reply.result);
      this.dispatch();
    });
    worker.on('error', (err) => {
      this.logger.error(`Solver TS worker ${worker.threadId} lỗi: ${err.message}`);
      if (slot.worker === worker) {
        if (slot.job) this.failSlot(slot, new SolverWorkerCrashError(err.message));
        slot.worker = null;
      }
      this.dispatch();
    });
    worker.on('exit', (code) => {
      if (slot.worker === worker) {
        if (slot.job) this.failSlot(slot, new SolverWorkerCrashError(`exit code ${code}`));
        slot.worker = null;
      }
      this.dispatch();
    });
    this.logger.log(
      `Tạo solver TS worker ${worker.threadId} (pool ${this.opts.poolSize}, heap ${
        this.opts.maxOldGenerationSizeMb ? `${this.opts.maxOldGenerationSizeMb} MB` : 'mặc định'
      }, RSS ${this.opts.maxRssMb ? `${this.opts.maxRssMb} MB` : 'không giới hạn'})`,
    );
    return worker;
  }

  private failSlot(slot: Slot, err: Error): void {
    const job = slot.job;
    slot.job = null;
    if (job) this.settle(job, err);
  }

  private async killWorker(slot: Slot): Promise<void> {
    const w = slot.worker;
    slot.worker = null;
    if (!w) return;
    w.removeAllListeners('exit');
    w.removeAllListeners('error');
    w.on('error', () => undefined);
    try {
      await w.terminate();
    } catch {
      /* worker đã chết */
    }
  }

  private startRssWatchdog(): void {
    if (!this.opts.maxRssMb || this.rssTimer) return;
    this.rssTimer = setInterval(() => {
      const rssMb = process.memoryUsage().rss / 1024 / 1024;
      if (rssMb <= this.opts.maxRssMb) return;
      this.logger.error(
        `RSS ${rssMb.toFixed(0)} MB > SOLVER_TS_MAX_RSS_MB=${this.opts.maxRssMb} -> terminate worker đang chạy`,
      );
      for (const slot of this.slots) {
        if (!slot.job) continue;
        this.failSlot(slot, new SolverWorkerMemoryError(rssMb, this.opts.maxRssMb));
        void this.killWorker(slot);
      }
      this.dispatch();
    }, this.opts.rssPollMs);
    this.rssTimer.unref?.();
  }

  private stopRssWatchdog(): void {
    if (this.rssTimer) clearInterval(this.rssTimer);
    this.rssTimer = null;
  }
}
