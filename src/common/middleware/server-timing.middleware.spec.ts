import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import { ClsService } from 'nestjs-cls';
import { AppConfig } from '../../config/configuration';
import { AppClsStore, RequestTiming } from '../interfaces/cls-store.interface';
import { buildServerTimingHeader, ServerTimingMiddleware } from './server-timing.middleware';

function makeMiddleware(corsOrigin: string, enabled = true) {
  const store: Partial<AppClsStore> = {};
  const cls = {
    set: jest.fn((k: string, v: unknown) => {
      (store as Record<string, unknown>)[k] = v;
    }),
  } as unknown as ClsService<AppClsStore>;
  const config = {
    get: jest.fn((key: string) =>
      key === 'cors.origin' ? corsOrigin : key === 'serverTiming.enabled' ? enabled : undefined,
    ),
  } as unknown as ConfigService<AppConfig, true>;
  return { mw: new ServerTimingMiddleware(cls, config), store };
}

/** Response giả: writeHead gốc chỉ đánh dấu headersSent. */
function makeRes() {
  const headers: Record<string, string> = {};
  const res = Object.assign(new EventEmitter(), {
    headersSent: false,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    writeHead: jest.fn(function (this: { headersSent: boolean }) {
      this.headersSent = true;
    }),
  });
  return { res, headers };
}

function run(mw: ServerTimingMiddleware, origin?: string) {
  const { res, headers } = makeRes();
  const next = jest.fn();
  mw.use({ headers: origin ? { origin } : {} } as never, res as never, next);
  (res.writeHead as (s: number) => void)(200);
  return { headers, next };
}

describe('ServerTimingMiddleware', () => {
  it('đặt Server-Timing và Timing-Allow-Origin khi origin được phép', () => {
    const { mw, store } = makeMiddleware('http://a.test, http://b.test');
    const { headers, next } = run(mw, 'http://b.test');
    expect(next).toHaveBeenCalled();
    expect(store.timing).toBeDefined();
    expect(headers['Server-Timing']).toMatch(/^total;dur=\d+\.\d, db;dur=0\.0;desc="0 queries"$/);
    expect(headers['Timing-Allow-Origin']).toBe('http://b.test');
  });

  it('không đặt Timing-Allow-Origin khi origin lạ hoặc không có Origin', () => {
    const { mw } = makeMiddleware('http://a.test');
    expect(run(mw, 'http://evil.test').headers['Timing-Allow-Origin']).toBeUndefined();
    const noOrigin = run(mw);
    expect(noOrigin.headers['Timing-Allow-Origin']).toBeUndefined();
    expect(noOrigin.headers['Server-Timing']).toBeDefined();
  });

  it('CORS là * thì Timing-Allow-Origin là *', () => {
    const { mw } = makeMiddleware('*');
    expect(run(mw, 'http://any.test').headers['Timing-Allow-Origin']).toBe('*');
  });

  it('tắt thì không đặt header và không bọc writeHead', () => {
    const { mw, store } = makeMiddleware('http://a.test', false);
    const { headers, next } = run(mw, 'http://a.test');
    expect(next).toHaveBeenCalled();
    expect(store.timing).toBeUndefined();
    expect(headers['Server-Timing']).toBeUndefined();
    expect(headers['Timing-Allow-Origin']).toBeUndefined();
  });
});

describe('buildServerTimingHeader', () => {
  const base: RequestTiming = {
    startMs: 100,
    dbMs: 95.14,
    dbCount: 7,
    solverMs: 0,
    solverCount: 0,
  };

  it('bỏ mục solver khi không gọi lần nào', () => {
    expect(buildServerTimingHeader(base, 282.4)).toBe(
      'total;dur=182.4, db;dur=95.1;desc="7 queries"',
    );
  });

  it('thêm mục solver khi có gọi', () => {
    expect(buildServerTimingHeader({ ...base, solverMs: 50, solverCount: 2 }, 282.4)).toContain(
      'solver;dur=50.0;desc="2 calls"',
    );
  });
});
