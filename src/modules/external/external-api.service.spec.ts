import { ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { Observable, of, throwError } from 'rxjs';
import { ExternalApiHttpError, ExternalApiService } from './external-api.service';

describe('ExternalApiService', () => {
  let service: ExternalApiService;
  let httpService: { get: jest.Mock; post: jest.Mock };

  const okResponse = <T>(data: T): AxiosResponse<T> =>
    ({
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    }) as unknown as AxiosResponse<T>;

  beforeEach(() => {
    httpService = { get: jest.fn(), post: jest.fn() };
    service = new ExternalApiService(httpService as unknown as HttpService);
  });

  describe('get', () => {
    it('resolves with response.data on success', async () => {
      httpService.get.mockReturnValue(of(okResponse({ ok: true })));

      const result = await service.get<{ ok: boolean }>('https://example.com/health');

      expect(result).toEqual({ ok: true });
    });

    it('retries transient failures before giving up, then wraps the failure as 503', async () => {
      // retry() re-subscribes to the Observable httpService.get() already returned - it does not
      // call httpService.get() again - so the retry count must be observed via subscriptions to
      // that Observable, not via httpService.get.mock.calls.length (which is always 1).
      let subscriptions = 0;
      httpService.get.mockReturnValue(
        new Observable((subscriber) => {
          subscriptions += 1;
          subscriber.error(new Error('ECONNRESET'));
        }),
      );

      await expect(service.get('https://example.com/flaky')).rejects.toThrow(
        ServiceUnavailableException,
      );
      // 1 initial attempt + RETRY_ATTEMPTS(2) retries = 3 subscriptions.
      expect(subscriptions).toBe(3);
    }, 15000);
  });

  describe('post', () => {
    it('resolves with response.data on success', async () => {
      httpService.post.mockReturnValue(of(okResponse({ created: true })));

      const result = await service.post<{ created: boolean }>('https://example.com/orders', {
        a: 1,
      });

      expect(result).toEqual({ created: true });
    });

    it('surfaces a real error response (4xx/5xx) as ExternalApiHttpError instead of a generic 503, so callers can tell "external service answered with a business error" apart from "external service unreachable"', async () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 422',
        response: { status: 422, data: { code: 'NO_FEASIBLE_SOLUTION' } },
      };
      httpService.post.mockReturnValue(throwError(() => axiosError));

      const failure: unknown = await service
        .post('https://example.com/solve', {})
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(ExternalApiHttpError);
      expect((failure as ExternalApiHttpError).status).toBe(422);
      expect((failure as ExternalApiHttpError).body).toEqual({ code: 'NO_FEASIBLE_SOLUTION' });
    });

    it('wraps a network failure (no HTTP response at all) as 503, not ExternalApiHttpError', async () => {
      httpService.post.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

      await expect(service.post('https://example.com/solve', {})).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('forwards the url/body/config straight through to the underlying HttpService', async () => {
      httpService.post.mockReturnValue(of(okResponse({ ok: true })));

      await service.post('https://example.com/solve', { plan: 1 }, undefined, 120_000);

      expect(httpService.post).toHaveBeenCalledWith(
        'https://example.com/solve',
        { plan: 1 },
        undefined,
      );
    });
  });
});
