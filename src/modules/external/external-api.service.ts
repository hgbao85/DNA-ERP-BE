import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AxiosRequestConfig, isAxiosError } from 'axios';
import CircuitBreaker from 'opossum';
import { firstValueFrom } from 'rxjs';
import { retry, timeout } from 'rxjs/operators';

const REQUEST_TIMEOUT_MS = 5000;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;
/**
 * Ceiling for the POST breaker's own timeout tracking. opossum sets this ONCE at construction
 * for the whole breaker instance - it does NOT read the per-call `timeoutMs` argument passed to
 * post() (that one only bounds the underlying axios call). The two are independent layers
 * wrapping the same request, and whichever is SMALLER wins.
 *
 * MUST stay >= the largest `timeoutMs` any caller passes to post() anywhere in the codebase, or
 * that caller's own (larger, intentionally configured) timeout is silently overridden by this one
 * - exactly what happened here once: SOLVER_TIMEOUT_SECONDS was raised to 900s for the cat_sat_iea
 * integration (cutting-proposals, can legitimately run minutes under auto_scan retry) while this
 * ceiling stayed at the old 600s, so slow-but-legitimate solves got killed at 10 minutes no matter
 * how high SOLVER_TIMEOUT_SECONDS was set - silently, with a generic "External service unavailable"
 * that gave no hint the real cause was this unrelated constant.
 *
 * Set generously above any known caller (currently: solver, up to 900s) instead of matching it
 * exactly, so the NEXT config raise doesn't reopen the same gap - and see the assertion in post()
 * below, which turns any future violation of this invariant into an immediate, loud error instead
 * of a silent 10-minutes-later timeout.
 */
const POST_BREAKER_TIMEOUT_MS = 1_800_000; // 30 phút

/** A real HTTP response with an error status (4xx/5xx) - as opposed to a network failure or
 * circuit-breaker short-circuit, which surface as ServiceUnavailableException instead. Callers
 * that need to distinguish "the external service answered with a business error" (e.g. cat_sat_iea's
 * 422 NO_FEASIBLE_SOLUTION) from "the external service is unreachable" should catch this. */
export class ExternalApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`External API responded with status ${status}`);
    this.name = 'ExternalApiHttpError';
  }
}

/**
 * Reusable wrapper for calling external HTTP services (payment gateways, shipping
 * carriers, government e-invoice APIs, ...) with a timeout, automatic retry for
 * transient failures, and a circuit breaker so a downed dependency degrades
 * gracefully instead of piling up hanging requests. Copy this pattern for any
 * future integration rather than calling HttpService directly.
 */
@Injectable()
export class ExternalApiService {
  private readonly logger = new Logger(ExternalApiService.name);
  private readonly getBreaker: CircuitBreaker<[url: string, config?: AxiosRequestConfig], unknown>;
  private readonly postBreaker: CircuitBreaker<
    [url: string, body: unknown, config: AxiosRequestConfig | undefined, timeoutMs: number],
    unknown
  >;

  constructor(private readonly httpService: HttpService) {
    this.getBreaker = new CircuitBreaker(
      (url: string, config?: AxiosRequestConfig) => this.executeGetRequest(url, config),
      {
        timeout: REQUEST_TIMEOUT_MS,
        errorThresholdPercentage: 50,
        resetTimeout: 15000,
      },
    );
    this.registerBreakerLogs(this.getBreaker, 'GET');

    this.postBreaker = new CircuitBreaker(
      (url: string, body: unknown, config: AxiosRequestConfig | undefined, timeoutMs: number) =>
        this.executePostRequest(url, body, config, timeoutMs),
      {
        timeout: POST_BREAKER_TIMEOUT_MS,
        errorThresholdPercentage: 50,
        resetTimeout: 15000,
      },
    );
    this.registerBreakerLogs(this.postBreaker, 'POST');
  }

  private registerBreakerLogs(breaker: CircuitBreaker, label: string): void {
    breaker.on('open', () =>
      this.logger.warn(
        `Circuit breaker (${label}) OPEN - external calls are being short-circuited`,
      ),
    );
    breaker.on('halfOpen', () =>
      this.logger.log(`Circuit breaker (${label}) HALF-OPEN - testing external service recovery`),
    );
    breaker.on('close', () =>
      this.logger.log(`Circuit breaker (${label}) CLOSED - external service has recovered`),
    );
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    try {
      return (await this.getBreaker.fire(url, config)) as T;
    } catch (error) {
      this.logger.error(`External call to ${url} failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(`External service unavailable: ${url}`);
    }
  }

  /**
   * POST with a caller-supplied timeout (ms) - use for slow external calls (e.g. the cat_sat_iea
   * solver, which can legitimately take tens of seconds) where the default 5s GET timeout would
   * always fail. Throws `ExternalApiHttpError` when the external service responded with an error
   * status (so callers can read `.status`/`.body`), or `ServiceUnavailableException` for network
   * failures/timeouts/circuit-breaker short-circuits.
   */
  async post<T>(
    url: string,
    body?: unknown,
    config?: AxiosRequestConfig,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    // Bảo vệ bất biến giải thích ở POST_BREAKER_TIMEOUT_MS: fail ngay và rõ ràng ở đây, thay vì
    // để request âm thầm bị breaker cắt giữa chừng sau hàng phút chờ - lỗi đó cực khó truy ra vì
    // không trỏ gì tới đúng nguyên nhân (đã xảy ra thật với ca merge cắt sắt).
    if (timeoutMs > POST_BREAKER_TIMEOUT_MS) {
      throw new Error(
        `post() timeoutMs=${timeoutMs}ms vượt POST_BREAKER_TIMEOUT_MS=${POST_BREAKER_TIMEOUT_MS}ms - ` +
          'nâng ceiling đó lên trước (xem comment tại khai báo hằng số).',
      );
    }
    try {
      return (await this.postBreaker.fire(url, body, config, timeoutMs)) as T;
    } catch (error) {
      if (error instanceof ExternalApiHttpError) {
        throw error;
      }
      this.logger.error(`External call to ${url} failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(`External service unavailable: ${url}`);
    }
  }

  private async executeGetRequest<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response$ = this.httpService
      .get<T>(url, config)
      .pipe(timeout(REQUEST_TIMEOUT_MS), retry({ count: RETRY_ATTEMPTS, delay: RETRY_DELAY_MS }));
    const response = await firstValueFrom(response$);
    return response.data;
  }

  private async executePostRequest<T>(
    url: string,
    body: unknown,
    config: AxiosRequestConfig | undefined,
    timeoutMs: number,
  ): Promise<T> {
    try {
      const response$ = this.httpService.post<T>(url, body, config).pipe(timeout(timeoutMs));
      const response = await firstValueFrom(response$);
      return response.data;
    } catch (error) {
      if (isAxiosError(error) && error.response) {
        throw new ExternalApiHttpError(error.response.status, error.response.data);
      }
      throw error;
    }
  }
}
