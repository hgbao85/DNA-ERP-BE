import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AxiosRequestConfig } from 'axios';
import CircuitBreaker from 'opossum';
import { firstValueFrom } from 'rxjs';
import { retry, timeout } from 'rxjs/operators';

const REQUEST_TIMEOUT_MS = 5000;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

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
  private readonly breaker: CircuitBreaker<[url: string, config?: AxiosRequestConfig], unknown>;

  constructor(private readonly httpService: HttpService) {
    this.breaker = new CircuitBreaker(
      (url: string, config?: AxiosRequestConfig) => this.executeRequest(url, config),
      {
        timeout: REQUEST_TIMEOUT_MS,
        errorThresholdPercentage: 50,
        resetTimeout: 15000,
      },
    );

    this.breaker.on('open', () =>
      this.logger.warn('Circuit breaker OPEN - external calls are being short-circuited'),
    );
    this.breaker.on('halfOpen', () =>
      this.logger.log('Circuit breaker HALF-OPEN - testing external service recovery'),
    );
    this.breaker.on('close', () =>
      this.logger.log('Circuit breaker CLOSED - external service has recovered'),
    );
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    try {
      return (await this.breaker.fire(url, config)) as T;
    } catch (error) {
      this.logger.error(`External call to ${url} failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(`External service unavailable: ${url}`);
    }
  }

  private async executeRequest<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response$ = this.httpService
      .get<T>(url, config)
      .pipe(timeout(REQUEST_TIMEOUT_MS), retry({ count: RETRY_ATTEMPTS, delay: RETRY_DELAY_MS }));
    const response = await firstValueFrom(response$);
    return response.data;
  }
}
