import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ExternalApiHttpError } from '../external/external-api.service';
import { SolverWorkerHost } from './solver-ts/solver-worker-host';
import { ProposeResponse } from './solver-ts/types';

/**
 * Lớp gọi bộ giải "Đề xuất thanh sắt" - 1 hàm `propose(body, timeoutMs)`.
 *
 * HiGHS (WASM) là bộ giải DUY NHẤT của ERP (người dùng chốt 2026-10-23, changelog 2026-10-20 mục 9):
 * solver TypeScript chạy NGAY TRONG tiến trình BE, trên worker thread (solver-ts/solver-worker-host.ts)
 * nên lượt giải nặng không chặn event loop của API. Không còn đường gọi DNA-DEXUAT qua mạng.
 *
 * Lỗi được ép về ĐÚNG 2 kiểu mà CuttingProposalsService đã xử lý từ thời còn gọi DEXUAT
 * (saveFailure/extractErrorMessage, verifyExactStandaloneWaste catch -> null) nên service đó không phải
 * đổi: `propose()` trả `status: 'error'` (400 INVALID_INPUT / 500 SOLVER_ERROR) -> ExternalApiHttpError
 * (http_status, body); worker hết giờ/chết/tràn RAM -> ServiceUnavailableException.
 *
 * Hợp đồng dữ liệu (tên trường request/response) theo solver-ts/types.ts - nguồn gốc là
 * `api_de_xuat_propose` của DEXUAT, nay là hợp đồng riêng của BE.
 */
@Injectable()
export class SolverClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SolverClientService.name);
  private host: SolverWorkerHost | null = null;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  onModuleInit(): void {
    const ts = this.tsConfig();
    this.logger.log(
      `Solver HiGHS WASM trong worker thread: workers=${ts.workers}, heap=${ts.heapMb} MB, maxRss=${ts.maxRssMb || 'không giới hạn'} MB`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.host?.close();
    this.host = null;
  }

  private tsConfig(): { workers: number; heapMb: number; maxRssMb: number } {
    const ts = this.configService.get('solver.ts', { infer: true });
    return {
      workers: ts?.workers ?? 1,
      heapMb: ts?.heapMb ?? 0,
      maxRssMb: ts?.maxRssMb ?? 0,
    };
  }

  /** Tạo host worker (lazy, chỉ khi thật sự có lượt giải). Tách ra để spec thay bằng host giả. */
  protected createWorkerHost(): SolverWorkerHost {
    const ts = this.tsConfig();
    return new SolverWorkerHost({
      poolSize: ts.workers,
      maxOldGenerationSizeMb: ts.heapMb,
      maxRssMb: ts.maxRssMb,
    });
  }

  /**
   * Gọi solver với body (xem solver-ts/types.ts `ProposeRequest`). `timeoutMs` là trần cho CẢ lần gọi,
   * gồm cả thời gian chờ hàng đợi worker + chạy.
   */
  async propose<T>(body: unknown, timeoutMs: number): Promise<T> {
    if (!this.host) this.host = this.createWorkerHost();
    const startedAt = Date.now();
    let res: ProposeResponse;
    try {
      res = await this.host.run(body, timeoutMs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Solver thất bại sau ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${msg}`,
      );
      throw new ServiceUnavailableException(msg);
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (res.status === 'error') {
      // Cùng dạng Django trả cho 400/500 -> extractErrorMessage đọc body.message như cũ.
      const { http_status, ...djangoBody } = res;
      this.logger.warn(`Solver trả lỗi ${http_status} sau ${elapsed}s: ${res.message}`);
      throw new ExternalApiHttpError(http_status, djangoBody);
    }
    this.logger.log(`Solver xong sau ${elapsed}s (${res.purchase_plan.length} loại sắt)`);
    return res as unknown as T;
  }
}
