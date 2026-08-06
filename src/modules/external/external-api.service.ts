import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AxiosRequestConfig, isAxiosError } from 'axios';
import CircuitBreaker from 'opossum';
import { firstValueFrom } from 'rxjs';
import { retry, timeout } from 'rxjs/operators';

const REQUEST_TIMEOUT_MS = 5000;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;
/** Ceiling for the POST breaker's own timeout tracking - actual per-call timeout is passed via
 * the `timeoutMs` param to post() (see cat_sat_iea integration, which can run minutes). This is
 * just an upper bound so the breaker itself never hangs indefinitely. */
const POST_BREAKER_TIMEOUT_MS = 600_000;

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
